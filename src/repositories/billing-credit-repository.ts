import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { addBillingDays, billingStatus, kenyaDate, nextBillingPayment, PLANS, type BillingAccount, type BillingInterval, type PlanCode } from "../domain/billing";
import { accountKey, listBillingPayments, listPlatformBillingAccounts, requireBillingAccount, type BillingAudit, type BillingDocument, type BillingPayment } from "./billing-repository";

export type BillingCreditStatus = "available" | "partially_applied" | "applied" | "expired" | "voided";
export type BillingCreditEventType = "issued" | "reserved" | "released" | "applied" | "expired" | "voided" | "forfeited";

export interface BillingCredit {
  id: string;
  tenantId: string;
  originalAmountKes: number;
  remainingAmountKes: number;
  status: BillingCreditStatus;
  expiresOn: string | null;
  reason: string;
  customerMessage: string;
  issuedBy: string;
  requestId: string;
  issuedAt: string;
  updatedAt: string;
}

export interface BillingCreditEvent {
  id: string;
  tenantId: string;
  creditId: string;
  type: BillingCreditEventType;
  amountKes: number;
  actorId: string;
  reason: string;
  chargeId: string | null;
  paymentId: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface BillingCharge {
  id: string;
  tenantId: string;
  tenantName: string;
  status: "open" | "settled" | "cancelled";
  settlementKind: "cash" | "cash_and_credit" | "credit" | null;
  planCode: PlanCode;
  planName: string;
  billingInterval: BillingInterval;
  billingMonths: number;
  listAmountKes: number;
  customPriceAdjustmentKes: number;
  annualDiscountKes: number;
  promotionDiscountKes: number;
  creditAppliedKes: number;
  cashAmountKes: number;
  netRevenueKes: number;
  periodStartsOn: string;
  periodEndsOn: string;
  dueOn: string;
  offerId: string | null;
  promotionId: string | null;
  promotionLabel: string | null;
  paymentId: string | null;
  issuedAt: string;
  settledAt: string | null;
}

const creditKey = (tenantId: string, id: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#CREDIT#${id}` });
const chargeKey = (tenantId: string, id: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#CHARGE#${id}` });
const requestKey = (tenantId: string, requestId: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#CREDIT_REQUEST#${requestId}` });
const documentKey = (tenantId: string, id: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#DOCUMENT#${id}` });
const eventItem = (event: BillingCreditEvent) => ({ partitionKey: `TENANT#${event.tenantId}`, sortKey: `BILLING#CREDIT_EVENT#${event.createdAt}#${event.id}`, entityType: "billing_credit_event", ...event });
const auditItem = (audit: BillingAudit) => ({ partitionKey: `TENANT#${audit.tenantId}`, sortKey: `BILLING#AUDIT#${audit.createdAt}#${audit.id}`, entityType: "billing_audit", ...audit });
const clean = <T>(item?: Record<string, unknown>): T | null => {
  if (!item) return null;
  const { partitionKey: _pk, sortKey: _sk, accessPartition: _ap, accessSort: _as, entityType: _type, ...value } = item;
  return value as T;
};
const listPrefix = async <T>(tenantId: string, prefix: string) => {
  const response = await dynamoDB.send(new QueryCommand({ TableName: TABLE_NAME, KeyConditionExpression: "partitionKey = :pk AND begins_with(sortKey, :prefix)", ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":prefix": prefix }, ScanIndexForward: false }));
  return (response.Items ?? []).map((item) => clean<T>(item)!);
};

export const listBillingCredits = (tenantId: string) => listPrefix<BillingCredit>(tenantId, "BILLING#CREDIT#");
export const listBillingCreditEvents = (tenantId: string) => listPrefix<BillingCreditEvent>(tenantId, "BILLING#CREDIT_EVENT#");
export const listBillingCharges = (tenantId: string) => listPrefix<BillingCharge>(tenantId, "BILLING#CHARGE#");

const eligibleCredits = (credits: BillingCredit[], today = kenyaDate()) => credits
  .filter((credit) => credit.remainingAmountKes > 0 && credit.status !== "voided" && credit.status !== "expired" && (!credit.expiresOn || credit.expiresOn >= today))
  .sort((left, right) => (left.expiresOn ?? "9999-12-31").localeCompare(right.expiresOn ?? "9999-12-31") || left.issuedAt.localeCompare(right.issuedAt));
const activeCredits = async (tenantId: string, today = kenyaDate()) => eligibleCredits(await listBillingCredits(tenantId), today);

const creditAllocations = (credits: BillingCredit[], amountKes: number) => {
  let remaining = amountKes;
  const allocations: Array<{ credit: BillingCredit; amountKes: number }> = [];
  for (const credit of credits) {
    if (remaining <= 0) break;
    const amount = Math.min(credit.remainingAmountKes, remaining);
    if (amount > 0) allocations.push({ credit, amountKes: amount });
    remaining -= amount;
  }
  return { allocations, covered: remaining === 0 };
};

export const issueBillingCredit = async (tenantId: string, input: { amountKes: number; expiresOn?: string | null; reason: string; customerMessage?: string | null; requestId: string }, actorId: string) => {
  if (!Number.isSafeInteger(input.amountKes) || input.amountKes < 1 || input.amountKes > 10_000_000) throw new Error("Credit must be between KES 1 and KES 10,000,000");
  const reason = input.reason.trim();
  const customerMessage = input.customerMessage?.trim() ?? "";
  if (reason.length < 3 || reason.length > 500) throw new Error("Credit reason must be between 3 and 500 characters");
  if (customerMessage.length > 500) throw new Error("Customer message must not exceed 500 characters");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId)) throw new Error("Credit request ID is invalid");
  if (input.expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn) || input.expiresOn < kenyaDate())) throw new Error("Credit expiry cannot be in the past");
  const requestHash = JSON.stringify({ amountKes: input.amountKes, expiresOn: input.expiresOn ?? null, reason, customerMessage });
  const existingRequest = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: requestKey(tenantId, input.requestId) }));
  if (existingRequest.Item?.creditId) {
    if (existingRequest.Item.requestHash !== requestHash) throw new Error("Credit request ID was already used with different details");
    const existing = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: creditKey(tenantId, String(existingRequest.Item.creditId)) }));
    const credit = clean<BillingCredit>(existing.Item);
    if (credit) {
      const account = await requireBillingAccount(tenantId);
      const recoveryAttempted = ["restricted", "cancelled"].includes(billingStatus(account)) || (account.workspaceState ?? "active") === "archived";
      const settlement = recoveryAttempted ? await attemptCreditSettlement(tenantId, actorId, account) : null;
      return { credit: (await listBillingCredits(tenantId)).find((item) => item.id === credit.id) ?? credit, settlement, idempotent: true, recoveryAttempted };
    }
  }
  const account = await requireBillingAccount(tenantId);
  if (["deleting", "deleted"].includes(account.workspaceState ?? "active")) throw new Error("Credits cannot be issued after workspace deletion has started");
  const active = await activeCredits(tenantId);
  if (active.length >= 20) throw new Error("This business has too many active credits; apply or void an existing credit first");
  const now = new Date().toISOString();
  const id = randomUUID();
  const credit: BillingCredit = { id, tenantId, originalAmountKes: input.amountKes, remainingAmountKes: input.amountKes, status: "available", expiresOn: input.expiresOn ?? null, reason, customerMessage, issuedBy: actorId, requestId: input.requestId, issuedAt: now, updatedAt: now };
  const event: BillingCreditEvent = { id: randomUUID(), tenantId, creditId: id, type: "issued", amountKes: input.amountKes, actorId, reason, chargeId: null, paymentId: null, requestId: input.requestId, createdAt: now };
  const audit: BillingAudit = { id: randomUUID(), tenantId, action: "billing_credit_issued", actorId, reason, before: JSON.stringify({ creditBalanceKes: account.creditBalanceKes ?? 0 }), after: JSON.stringify({ creditId: id, amountKes: input.amountKes, expiresOn: credit.expiresOn, creditBalanceKes: (account.creditBalanceKes ?? 0) + input.amountKes }), createdAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...creditKey(tenantId, id), entityType: "billing_credit", ...credit }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: eventItem(event), ConditionExpression: "attribute_not_exists(sortKey)" } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(audit), ConditionExpression: "attribute_not_exists(sortKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...requestKey(tenantId, input.requestId), entityType: "billing_credit_request", creditId: id, requestHash, createdAt: now }, ConditionExpression: "attribute_not_exists(sortKey)" } },
    { Update: { TableName: TABLE_NAME, Key: accountKey(tenantId), UpdateExpression: "SET creditBalanceKes = if_not_exists(creditBalanceKes, :zero) + :amount, updatedAt = :now", ExpressionAttributeValues: { ":zero": 0, ":amount": input.amountKes, ":now": now } } },
  ] }));
  const settlement = await attemptCreditSettlement(tenantId, actorId);
  return { credit: (await listBillingCredits(tenantId)).find((item) => item.id === id) ?? credit, settlement, idempotent: false, recoveryAttempted: false };
};

async function applyCreditsToOpenCharge(account: BillingAccount, payment: BillingPayment, allCredits: BillingCredit[], actorId: string) {
  const reservedByCredit = new Map<string, number>();
  for (const allocation of payment.creditAllocations ?? []) reservedByCredit.set(allocation.creditId, (reservedByCredit.get(allocation.creditId) ?? 0) + allocation.amountKes);
  let remainingCash = payment.amountKes;
  const additional: Array<{ credit: BillingCredit; amountKes: number }> = [];
  for (const credit of eligibleCredits(allCredits)) {
    if (remainingCash <= 0) break;
    const available = Math.max(0, credit.remainingAmountKes - (reservedByCredit.get(credit.id) ?? 0));
    const amountKes = Math.min(available, remainingCash);
    if (amountKes > 0) additional.push({ credit, amountKes });
    remainingCash -= amountKes;
  }
  if (additional.length === 0) return null;
  const now = new Date().toISOString();
  const combinedByCredit = new Map<string, { creditId: string; amountKes: number; remainingBeforeKes: number }>();
  for (const allocation of [...(payment.creditAllocations ?? []), ...additional.map(({ credit, amountKes }) => ({ creditId: credit.id, amountKes, remainingBeforeKes: credit.remainingAmountKes }))]) {
    const existing = combinedByCredit.get(allocation.creditId);
    combinedByCredit.set(allocation.creditId, { creditId: allocation.creditId, amountKes: (existing?.amountKes ?? 0) + allocation.amountKes, remainingBeforeKes: existing?.remainingBeforeKes ?? allocation.remainingBeforeKes });
  }
  const combinedAllocations = [...combinedByCredit.values()];
  const combinedCreditKes = combinedAllocations.reduce((total, allocation) => total + allocation.amountKes, 0);
  if (remainingCash > 0) {
    await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${account.tenantId}`, sortKey: "BILLING#PAYMENT_PENDING" }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
      { Update: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${account.tenantId}`, sortKey: `BILLING#PAYMENT#${payment.id}` }, UpdateExpression: "SET amountKes = :cash, creditAppliedKes = :credit, creditAllocations = :allocations", ConditionExpression: "#status = :rejected AND creditAppliedKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":cash": remainingCash, ":credit": combinedCreditKes, ":allocations": combinedAllocations, ":rejected": "rejected", ":expected": payment.creditAppliedKes ?? 0 } } },
      { Update: { TableName: TABLE_NAME, Key: chargeKey(account.tenantId, payment.chargeId!), UpdateExpression: "SET creditAppliedKes = :credit, cashAmountKes = :cash, netRevenueKes = :cash", ConditionExpression: "#status = :open", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":credit": combinedCreditKes, ":cash": remainingCash, ":open": "open" } } },
      ...additional.map(({ credit }) => ({ ConditionCheck: { TableName: TABLE_NAME, Key: creditKey(account.tenantId, credit.id), ConditionExpression: "remainingAmountKes = :expected", ExpressionAttributeValues: { ":expected": credit.remainingAmountKes } } })),
      ...additional.map(({ credit, amountKes }) => ({ Put: { TableName: TABLE_NAME, Item: eventItem({ id: randomUUID(), tenantId: account.tenantId, creditId: credit.id, type: "reserved", amountKes, actorId, reason: "Reserved against an open subscription charge", chargeId: payment.chargeId!, paymentId: payment.id, requestId: null, createdAt: now }), ConditionExpression: "attribute_not_exists(sortKey)" } })),
    ] }));
    return null;
  }

  const statusBefore = billingStatus(account);
  const record: BillingCharge = {
    id: payment.chargeId!, tenantId: account.tenantId, tenantName: account.tenantName, status: "settled", settlementKind: "credit", planCode: payment.planCode, planName: PLANS[payment.planCode].name,
    billingInterval: payment.billingInterval ?? "monthly", billingMonths: payment.billingMonths ?? 1, listAmountKes: (payment.baseAmountKes ?? combinedCreditKes) + (payment.customPriceAdjustmentKes ?? 0),
    customPriceAdjustmentKes: payment.customPriceAdjustmentKes ?? 0, annualDiscountKes: payment.annualDiscountKes ?? 0, promotionDiscountKes: payment.promotionCreditKes ?? 0,
    creditAppliedKes: combinedCreditKes, cashAmountKes: 0, netRevenueKes: 0, periodStartsOn: payment.periodStartsOn, periodEndsOn: payment.periodEndsOn, dueOn: payment.periodStartsOn,
    offerId: payment.offerId, promotionId: account.offer?.promotionId ?? null, promotionLabel: payment.offerLabel, paymentId: payment.id, issuedAt: payment.submittedAt, settledAt: now,
  };
  const documentId = randomUUID();
  const document: BillingDocument = { id: documentId, number: `TMK-CRS-${now.slice(0, 7).replace("-", "")}-${documentId.slice(0, 8).toUpperCase()}`, tenantId: account.tenantId, kind: "credit_notice", planCode: payment.planCode, planName: PLANS[payment.planCode].name, billingInterval: payment.billingInterval ?? "monthly", billingMonths: payment.billingMonths ?? 1, amountKes: 0, baseAmountKes: payment.baseAmountKes ?? combinedCreditKes, annualDiscountKes: payment.annualDiscountKes ?? 0, promotionCreditKes: payment.promotionCreditKes ?? 0, customPriceAdjustmentKes: payment.customPriceAdjustmentKes ?? 0, creditAppliedKes: combinedCreditKes, cashAmountKes: 0, chargeId: payment.chargeId!, promotionLabel: payment.offerLabel, subtotalKes: 0, vatAmountKes: 0, issuedOn: kenyaDate(), paymentId: `credit:${payment.chargeId}`, externalEtimsReference: null, notice: "Account-credit settlement only. No cash was collected. This is not a KRA tax invoice or eTIMS credit note.", createdAt: now };
  const audit: BillingAudit = { id: randomUUID(), tenantId: account.tenantId, action: "billing_open_charge_settled_by_credit", actorId, reason: "Additional account credit fully settled an open subscription charge", before: JSON.stringify({ status: statusBefore, chargeId: payment.chargeId, cashDueKes: payment.amountKes }), after: JSON.stringify({ paidThrough: payment.periodEndsOn, creditAppliedKes: combinedCreditKes, cashDueKes: 0 }), createdAt: now };
  const items: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [
    { ConditionCheck: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${account.tenantId}`, sortKey: "BILLING#PAYMENT_PENDING" }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Update: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${account.tenantId}`, sortKey: `BILLING#PAYMENT#${payment.id}` }, UpdateExpression: "SET creditAllocations = :empty, chargeSettledByCreditAt = :now", ConditionExpression: "#status = :rejected AND creditAppliedKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":empty": [], ":now": now, ":rejected": "rejected", ":expected": payment.creditAppliedKes ?? 0 } } },
    { Update: { TableName: TABLE_NAME, Key: chargeKey(account.tenantId, payment.chargeId!), UpdateExpression: "SET #status = :settled, settlementKind = :kind, creditAppliedKes = :credit, cashAmountKes = :zero, netRevenueKes = :zero, settledAt = :now", ConditionExpression: "#status = :open", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":settled": "settled", ":kind": "credit", ":credit": combinedCreditKes, ":zero": 0, ":now": now, ":open": "open" } } },
    { Put: { TableName: TABLE_NAME, Item: { ...documentKey(account.tenantId, documentId), entityType: "billing_document", ...document }, ConditionExpression: "attribute_not_exists(sortKey)" } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(audit), ConditionExpression: "attribute_not_exists(sortKey)" } },
  ];
  for (const allocation of combinedAllocations) {
    const credit = allCredits.find(({ id }) => id === allocation.creditId);
    if (!credit) throw new Error("A reserved account credit was not found");
    const amountKes = combinedAllocations.filter(({ creditId }) => creditId === credit.id).reduce((total, item) => total + item.amountKes, 0);
    if (items.some((item) => item.Update?.Key?.sortKey === creditKey(account.tenantId, credit.id).sortKey)) continue;
    const nextRemaining = credit.remainingAmountKes - amountKes;
    items.push({ Update: { TableName: TABLE_NAME, Key: creditKey(account.tenantId, credit.id), UpdateExpression: "SET remainingAmountKes = :remaining, #status = :status, updatedAt = :now", ConditionExpression: "remainingAmountKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":remaining": nextRemaining, ":status": nextRemaining ? "partially_applied" : "applied", ":now": now, ":expected": credit.remainingAmountKes } } });
    items.push({ Put: { TableName: TABLE_NAME, Item: eventItem({ id: randomUUID(), tenantId: account.tenantId, creditId: credit.id, type: "applied", amountKes, actorId, reason: "Automatically applied to an open subscription charge", chargeId: payment.chargeId!, paymentId: payment.id, requestId: null, createdAt: now }), ConditionExpression: "attribute_not_exists(sortKey)" } });
  }
  const offerUpdate = payment.offerId ? ", #offer.#remaining = #offer.#remaining - :one" : "";
  items.push({ Update: { TableName: TABLE_NAME, Key: accountKey(account.tenantId), UpdateExpression: `SET planCode = :plan, billingInterval = :interval, paidThrough = :paidThrough, pendingPlanCode = :none, pendingBillingInterval = :none, cancelledAt = :none, workspaceState = :active, delinquentSince = :none, archivedAt = :none, deletionScheduledOn = :none, creditBalanceKes = creditBalanceKes - :credit, updatedAt = :now${offerUpdate}`, ...(payment.offerId ? { ConditionExpression: "#offer.#id = :offerId AND #offer.#remaining > :zero", ExpressionAttributeNames: { "#offer": "offer", "#remaining": "remainingPayments", "#id": "id" } } : {}), ExpressionAttributeValues: { ":plan": payment.planCode, ":interval": payment.billingInterval ?? "monthly", ":paidThrough": payment.periodEndsOn, ":none": null, ":active": "active", ":credit": combinedCreditKes, ":now": now, ...(payment.offerId ? { ":one": 1, ":zero": 0, ":offerId": payment.offerId } : {}) } } });
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: items }));
  return record;
}

export const attemptCreditSettlement = async (tenantId: string, actorId = "billing-worker", suppliedAccount?: BillingAccount) => {
  const [account, pending, allCredits] = await Promise.all([suppliedAccount ?? requireBillingAccount(tenantId), listBillingPayments(tenantId), listBillingCredits(tenantId)]);
  if (!account.planCode) return null;
  if (account.suspendedAt || ["deleting", "deleted"].includes(account.workspaceState ?? "active") || pending.some((payment) => payment.status === "submitted")) return null;
  const openPayment = pending.find((payment) => payment.status === "rejected" && Boolean(payment.creditAllocations?.length) && payment.chargeId);
  if (openPayment) return applyCreditsToOpenCharge(account, openPayment, allCredits, actorId);
  const credits = eligibleCredits(allCredits);
  const charge = nextBillingPayment(account);
  const allocation = creditAllocations(credits, charge.amountKes);
  if (!allocation.covered) return null;
  const now = new Date().toISOString();
  const id = randomUUID();
  const documentId = randomUUID();
  const statusBefore = billingStatus(account);
  const record: BillingCharge = {
    id, tenantId, tenantName: account.tenantName, status: "settled", settlementKind: "credit", planCode: charge.planCode, planName: charge.planName,
    billingInterval: charge.billingInterval, billingMonths: charge.billingMonths, listAmountKes: charge.baseAmountKes + charge.customPriceAdjustmentKes,
    customPriceAdjustmentKes: charge.customPriceAdjustmentKes, annualDiscountKes: charge.annualDiscountKes, promotionDiscountKes: charge.promotionCreditKes,
    creditAppliedKes: charge.amountKes, cashAmountKes: 0, netRevenueKes: 0, periodStartsOn: charge.periodStartsOn, periodEndsOn: charge.periodEndsOn,
    dueOn: charge.dueOn, offerId: charge.offerId, promotionId: account.offer?.promotionId ?? null, promotionLabel: charge.offerLabel, paymentId: null, issuedAt: now, settledAt: now,
  };
  const document: BillingDocument = {
    id: documentId, number: `TMK-CRS-${now.slice(0, 7).replace("-", "")}-${documentId.slice(0, 8).toUpperCase()}`, tenantId, kind: "credit_notice",
    planCode: charge.planCode, planName: charge.planName, billingInterval: charge.billingInterval, billingMonths: charge.billingMonths, amountKes: 0,
    baseAmountKes: charge.baseAmountKes, annualDiscountKes: charge.annualDiscountKes, promotionCreditKes: charge.promotionCreditKes,
    customPriceAdjustmentKes: charge.customPriceAdjustmentKes, creditAppliedKes: charge.amountKes, cashAmountKes: 0, chargeId: id,
    promotionLabel: charge.offerLabel, subtotalKes: 0, vatAmountKes: 0, issuedOn: kenyaDate(), paymentId: `credit:${id}`, externalEtimsReference: null,
    notice: "Account-credit settlement only. No cash was collected. This is not a KRA tax invoice or eTIMS credit note.", createdAt: now,
  };
  const audit: BillingAudit = { id: randomUUID(), tenantId, action: "billing_charge_settled_by_credit", actorId, reason: "Available account credit automatically settled the subscription charge", before: JSON.stringify({ status: statusBefore, creditBalanceKes: account.creditBalanceKes ?? 0 }), after: JSON.stringify({ chargeId: id, paidThrough: charge.periodEndsOn, creditAppliedKes: charge.amountKes, workspaceState: "active" }), createdAt: now };
  const items: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [
    { ConditionCheck: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${tenantId}`, sortKey: "BILLING#PAYMENT_PENDING" }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...chargeKey(tenantId, id), entityType: "billing_charge", ...record }, ConditionExpression: "attribute_not_exists(sortKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...documentKey(tenantId, documentId), entityType: "billing_document", ...document }, ConditionExpression: "attribute_not_exists(sortKey)" } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(audit), ConditionExpression: "attribute_not_exists(sortKey)" } },
  ];
  for (const { credit, amountKes } of allocation.allocations) {
    const nextRemaining = credit.remainingAmountKes - amountKes;
    items.push({ Update: { TableName: TABLE_NAME, Key: creditKey(tenantId, credit.id), UpdateExpression: "SET remainingAmountKes = :remaining, #status = :status, updatedAt = :now", ConditionExpression: "remainingAmountKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":remaining": nextRemaining, ":status": nextRemaining ? "partially_applied" : "applied", ":now": now, ":expected": credit.remainingAmountKes } } });
    items.push({ Put: { TableName: TABLE_NAME, Item: eventItem({ id: randomUUID(), tenantId, creditId: credit.id, type: "applied", amountKes, actorId, reason: "Automatically applied to subscription charge", chargeId: id, paymentId: null, requestId: null, createdAt: now }), ConditionExpression: "attribute_not_exists(sortKey)" } });
  }
  const offerUpdate = charge.offerId ? ", #offer.#remaining = #offer.#remaining - :one" : "";
  items.push({ Update: { TableName: TABLE_NAME, Key: accountKey(tenantId), UpdateExpression: `SET planCode = :plan, billingInterval = :interval, paidThrough = :paidThrough, pendingPlanCode = :none, pendingBillingInterval = :none, cancelledAt = :none, workspaceState = :active, delinquentSince = :none, archivedAt = :none, deletionScheduledOn = :none, creditBalanceKes = creditBalanceKes - :credit, updatedAt = :now${offerUpdate}`, ...(charge.offerId ? { ConditionExpression: "#offer.#id = :offerId AND #offer.#remaining > :zero", ExpressionAttributeNames: { "#offer": "offer", "#remaining": "remainingPayments", "#id": "id" } } : {}), ExpressionAttributeValues: { ":plan": charge.planCode, ":interval": charge.billingInterval, ":paidThrough": charge.periodEndsOn, ":none": null, ":active": "active", ":credit": charge.amountKes, ":now": now, ...(charge.offerId ? { ":one": 1, ":zero": 0, ":offerId": charge.offerId } : {}) } } });
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: items }));
  return record;
};

export const voidBillingCredit = async (tenantId: string, creditId: string, reasonValue: string, actorId: string) => {
  const reason = reasonValue.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Void reason must be between 3 and 500 characters");
  const payments = await listBillingPayments(tenantId);
  if (payments.some((payment) => payment.status === "submitted" && payment.creditAllocations?.some((allocation) => allocation.creditId === creditId))) throw new Error("Resolve the submitted payment before voiding its reserved account credit");
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: creditKey(tenantId, creditId) }));
  const credit = clean<BillingCredit>(response.Item);
  if (!credit) throw new Error("Credit was not found");
  if (credit.remainingAmountKes <= 0 || credit.status === "voided" || credit.status === "expired") throw new Error("This credit has no unused value to void");
  const now = new Date().toISOString();
  const amountKes = credit.remainingAmountKes;
  const rejectedReservations = payments.filter((payment) => payment.status === "rejected" && payment.creditAllocations?.some((allocation) => allocation.creditId === creditId));
  const audit: BillingAudit = { id: randomUUID(), tenantId, action: "billing_credit_voided", actorId, reason, before: JSON.stringify(credit), after: JSON.stringify({ ...credit, remainingAmountKes: 0, status: "voided" }), createdAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { ConditionCheck: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${tenantId}`, sortKey: "BILLING#PAYMENT_PENDING" }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    ...rejectedReservations.flatMap((payment) => {
      const releasedKes = (payment.creditAllocations ?? []).filter((allocation) => allocation.creditId === creditId).reduce((total, allocation) => total + allocation.amountKes, 0);
      const remainingAllocations = (payment.creditAllocations ?? []).filter((allocation) => allocation.creditId !== creditId);
      return [
        { Update: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#PAYMENT#${payment.id}` }, UpdateExpression: "SET amountKes = amountKes + :released, creditAppliedKes = creditAppliedKes - :released, creditAllocations = :allocations", ConditionExpression: "#status = :rejected AND creditAppliedKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":released": releasedKes, ":allocations": remainingAllocations, ":rejected": "rejected", ":expected": payment.creditAppliedKes ?? 0 } } },
        ...(payment.chargeId ? [{ Update: { TableName: TABLE_NAME, Key: chargeKey(tenantId, payment.chargeId), UpdateExpression: "SET creditAppliedKes = creditAppliedKes - :released, cashAmountKes = cashAmountKes + :released, netRevenueKes = netRevenueKes + :released", ConditionExpression: "#status = :open", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":released": releasedKes, ":open": "open" } } }] : []),
        { Put: { TableName: TABLE_NAME, Item: eventItem({ id: randomUUID(), tenantId, creditId, type: "released", amountKes: releasedKes, actorId, reason: "Reservation released before unused credit was voided", chargeId: payment.chargeId ?? payment.id, paymentId: payment.id, requestId: null, createdAt: now }), ConditionExpression: "attribute_not_exists(sortKey)" } },
      ];
    }),
    { Update: { TableName: TABLE_NAME, Key: creditKey(tenantId, creditId), UpdateExpression: "SET remainingAmountKes = :zero, #status = :voided, updatedAt = :now", ConditionExpression: "remainingAmountKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":zero": 0, ":voided": "voided", ":now": now, ":expected": amountKes } } },
    { Update: { TableName: TABLE_NAME, Key: accountKey(tenantId), UpdateExpression: "SET creditBalanceKes = creditBalanceKes - :amount, updatedAt = :now", ConditionExpression: "creditBalanceKes >= :amount", ExpressionAttributeValues: { ":amount": amountKes, ":now": now } } },
    { Put: { TableName: TABLE_NAME, Item: eventItem({ id: randomUUID(), tenantId, creditId, type: "voided", amountKes, actorId, reason, chargeId: null, paymentId: null, requestId: null, createdAt: now }), ConditionExpression: "attribute_not_exists(sortKey)" } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(audit), ConditionExpression: "attribute_not_exists(sortKey)" } },
  ] }));
  return { ...credit, remainingAmountKes: 0, status: "voided" as const, updatedAt: now };
};

export const resumeLifecycleDates = (account: BillingAccount, today = kenyaDate()) => {
  if (!account.suspendedAt) return { delinquentSince: account.delinquentSince ?? null, archivedAt: account.archivedAt ?? null, deletionScheduledOn: account.deletionScheduledOn ?? null };
  const pausedOn = kenyaDate(new Date(account.suspendedAt));
  const pauseDays = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${pausedOn}T00:00:00Z`)) / 86_400_000));
  if (pauseDays === 0) return { delinquentSince: account.delinquentSince ?? null, archivedAt: account.archivedAt ?? null, deletionScheduledOn: account.deletionScheduledOn ?? null };
  if ((account.workspaceState ?? "active") === "archived") return {
    delinquentSince: account.delinquentSince ?? null,
    archivedAt: account.archivedAt ? new Date(Date.parse(account.archivedAt) + pauseDays * 86_400_000).toISOString() : null,
    deletionScheduledOn: account.deletionScheduledOn ? addBillingDays(account.deletionScheduledOn, pauseDays) : null,
  };
  return { delinquentSince: account.delinquentSince ? addBillingDays(account.delinquentSince, pauseDays) : null, archivedAt: account.archivedAt ?? null, deletionScheduledOn: account.deletionScheduledOn ?? null };
};

export const setWorkspaceSuspension = async (tenantId: string, suspended: boolean, reasonValue: string, actorId: string) => {
  const account = await requireBillingAccount(tenantId);
  const reason = reasonValue.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("Suspension reason must be between 3 and 500 characters");
  if (suspended === Boolean(account.suspendedAt)) return account;
  if (["deleting", "deleted"].includes(account.workspaceState ?? "active")) throw new Error("A workspace cannot be suspended or reactivated after deletion has started");
  const now = new Date().toISOString();
  const resumedDates = suspended ? { delinquentSince: account.delinquentSince ?? null, archivedAt: account.archivedAt ?? null, deletionScheduledOn: account.deletionScheduledOn ?? null } : resumeLifecycleDates(account);
  const next = { ...account, ...resumedDates, suspendedAt: suspended ? now : null, suspendedBy: suspended ? actorId : null, suspensionReason: suspended ? reason : null, updatedAt: now };
  const audit: BillingAudit = { id: randomUUID(), tenantId, action: suspended ? "workspace_suspended" : "workspace_reactivated", actorId, reason, before: JSON.stringify({ suspendedAt: account.suspendedAt ?? null, suspendedBy: account.suspendedBy ?? null, suspensionReason: account.suspensionReason ?? null, delinquentSince: account.delinquentSince ?? null, archivedAt: account.archivedAt ?? null, deletionScheduledOn: account.deletionScheduledOn ?? null }), after: JSON.stringify({ suspendedAt: next.suspendedAt, suspendedBy: next.suspendedBy, suspensionReason: next.suspensionReason, delinquentSince: next.delinquentSince, archivedAt: next.archivedAt, deletionScheduledOn: next.deletionScheduledOn }), createdAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...accountKey(tenantId), accessPartition: "PLATFORM#BILLING", accessSort: tenantId, entityType: "billing_account", ...next }, ConditionExpression: "updatedAt = :expected", ExpressionAttributeValues: { ":expected": account.updatedAt } } },
    { Put: { TableName: TABLE_NAME, Item: auditItem(audit), ConditionExpression: "attribute_not_exists(sortKey)" } },
  ] }));
  return next;
};

export const expireBillingCredits = async (tenantId: string, today = kenyaDate()) => {
  const [allCredits, payments] = await Promise.all([listBillingCredits(tenantId), listBillingPayments(tenantId)]);
  const reservedCreditIds = new Set(payments.filter((payment) => payment.status === "submitted" || (payment.status === "rejected" && Boolean(payment.creditAllocations?.length))).flatMap((payment) => (payment.creditAllocations ?? []).map(({ creditId }) => creditId)));
  const credits = allCredits.filter((credit) => !reservedCreditIds.has(credit.id) && credit.remainingAmountKes > 0 && credit.expiresOn != null && credit.expiresOn < today && credit.status !== "expired" && credit.status !== "voided");
  let expiredKes = 0;
  for (const credit of credits) {
    const now = new Date().toISOString(); const amountKes = credit.remainingAmountKes;
    await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${tenantId}`, sortKey: "BILLING#PAYMENT_PENDING" }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
      { Update: { TableName: TABLE_NAME, Key: creditKey(tenantId, credit.id), UpdateExpression: "SET remainingAmountKes = :zero, #status = :expired, updatedAt = :now", ConditionExpression: "remainingAmountKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":zero": 0, ":expired": "expired", ":now": now, ":expected": amountKes } } },
      { Update: { TableName: TABLE_NAME, Key: accountKey(tenantId), UpdateExpression: "SET creditBalanceKes = creditBalanceKes - :amount, updatedAt = :now", ConditionExpression: "creditBalanceKes >= :amount", ExpressionAttributeValues: { ":amount": amountKes, ":now": now } } },
      { Put: { TableName: TABLE_NAME, Item: eventItem({ id: randomUUID(), tenantId, creditId: credit.id, type: "expired", amountKes, actorId: "billing-worker", reason: `Credit expired on ${credit.expiresOn}`, chargeId: null, paymentId: null, requestId: null, createdAt: now }), ConditionExpression: "attribute_not_exists(sortKey)" } },
    ] }));
    expiredKes += amountKes;
  }
  return { expired: credits.length, expiredKes };
};

export const forfeitBillingCredits = async (tenantId: string) => {
  const credits = (await listBillingCredits(tenantId)).filter((credit) => credit.remainingAmountKes > 0 && credit.status !== "voided" && credit.status !== "expired");
  for (const credit of credits) {
    const now = new Date().toISOString(); const amountKes = credit.remainingAmountKes;
    await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${tenantId}`, sortKey: "BILLING#PAYMENT_PENDING" }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
      { Update: { TableName: TABLE_NAME, Key: creditKey(tenantId, credit.id), UpdateExpression: "SET remainingAmountKes = :zero, #status = :expired, updatedAt = :now", ConditionExpression: "remainingAmountKes = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":zero": 0, ":expired": "expired", ":now": now, ":expected": amountKes } } },
      { Update: { TableName: TABLE_NAME, Key: accountKey(tenantId), UpdateExpression: "SET creditBalanceKes = creditBalanceKes - :amount, updatedAt = :now", ConditionExpression: "creditBalanceKes >= :amount", ExpressionAttributeValues: { ":amount": amountKes, ":now": now } } },
      { Put: { TableName: TABLE_NAME, Item: eventItem({ id: randomUUID(), tenantId, creditId: credit.id, type: "forfeited", amountKes, actorId: "billing-worker", reason: "Unused credit forfeited when the workspace deletion period ended", chargeId: null, paymentId: null, requestId: null, createdAt: now }), ConditionExpression: "attribute_not_exists(sortKey)" } },
    ] }));
  }
  return credits.length;
};

const recognizedInRange = (amount: number, start: string, end: string, from: string, to: string) => {
  const day = 86_400_000;
  const startMs = Date.parse(`${start}T00:00:00Z`); const endExclusive = Date.parse(`${addBillingDays(end, 1)}T00:00:00Z`);
  const totalDays = (endExclusive - startMs) / day;
  const cumulative = (date: string) => Math.floor(amount * Math.max(0, Math.min(totalDays, (Date.parse(`${date}T00:00:00Z`) - startMs) / day)) / totalDays);
  return cumulative(addBillingDays(to, 1)) - cumulative(from);
};

export const platformRevenueReport = async (from: string, to: string, filters: { tenantId?: string | null; promotionId?: string | null } = {}) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error("Select a valid report date range");
  const accounts = (await listPlatformBillingAccounts()).filter((account) => !filters.tenantId || account.tenantId === filters.tenantId);
  const settledCharges = (await Promise.all(accounts.map((account) => listBillingCharges(account.tenantId)))).flat().filter((item) => item.status === "settled" && (!filters.promotionId || item.promotionId === filters.promotionId));
  const rows: Array<BillingCharge & { recognizedListAmountKes: number; recognizedCustomPriceAdjustmentKes: number; recognizedAnnualDiscountKes: number; recognizedPromotionDiscountKes: number; recognizedCreditImpactKes: number; recognizedRevenueKes: number }> = [];
  for (const charge of settledCharges.filter((item) => item.periodStartsOn <= to && item.periodEndsOn >= from)) {
    rows.push({ ...charge,
      recognizedListAmountKes: recognizedInRange(charge.listAmountKes, charge.periodStartsOn, charge.periodEndsOn, from, to),
      recognizedCustomPriceAdjustmentKes: recognizedInRange(charge.customPriceAdjustmentKes, charge.periodStartsOn, charge.periodEndsOn, from, to),
      recognizedAnnualDiscountKes: recognizedInRange(charge.annualDiscountKes, charge.periodStartsOn, charge.periodEndsOn, from, to),
      recognizedPromotionDiscountKes: recognizedInRange(charge.promotionDiscountKes, charge.periodStartsOn, charge.periodEndsOn, from, to),
      recognizedCreditImpactKes: recognizedInRange(charge.creditAppliedKes, charge.periodStartsOn, charge.periodEndsOn, from, to),
      recognizedRevenueKes: recognizedInRange(charge.netRevenueKes, charge.periodStartsOn, charge.periodEndsOn, from, to),
    });
  }
  const events = (await Promise.all(accounts.map((account) => listBillingCreditEvents(account.tenantId)))).flat();
  const filteredChargeIds = new Set(settledCharges.map(({ id }) => id));
  const reportEvents = filters.promotionId ? events.filter((event) => Boolean(event.chargeId && filteredChargeIds.has(event.chargeId))) : events;
  const sum = <T>(items: T[], field: keyof T) => items.reduce((total, item) => total + Number(item[field] ?? 0), 0);
  const confirmed = (await Promise.all(accounts.map(async (account) => (await listBillingPayments(account.tenantId)).filter((payment) => payment.status === "confirmed" && (!filters.promotionId || filteredChargeIds.has(payment.chargeId ?? payment.id)) && (payment.reviewedAt ?? payment.paidOn) >= from && (payment.reviewedAt ?? payment.paidOn).slice(0, 10) <= to)))).flat();
  const asOf = `${to}T23:59:59.999Z`;
  return { from, to, rows, summary: {
    listPriceRevenueKes: sum(rows, "recognizedListAmountKes"), customPriceAdjustmentKes: sum(rows, "recognizedCustomPriceAdjustmentKes"), annualDiscountKes: sum(rows, "recognizedAnnualDiscountKes"),
    promotionDiscountKes: sum(rows, "recognizedPromotionDiscountKes"), creditImpactKes: sum(rows, "recognizedCreditImpactKes"), recognizedRevenueKes: sum(rows, "recognizedRevenueKes"),
    cashCollectedKes: confirmed.reduce((total, payment) => total + payment.amountKes, 0),
    deferredRevenueKes: settledCharges.reduce((total, charge) => total + (charge.settledAt && charge.settledAt <= asOf ? charge.netRevenueKes - recognizedInRange(charge.netRevenueKes, charge.periodStartsOn, charge.periodEndsOn, charge.periodStartsOn, to) : 0), 0),
    creditsIssuedKes: reportEvents.filter((event) => event.type === "issued" && event.createdAt.slice(0, 10) >= from && event.createdAt.slice(0, 10) <= to).reduce((total, event) => total + event.amountKes, 0),
    creditsAppliedKes: reportEvents.filter((event) => event.type === "applied" && event.createdAt.slice(0, 10) >= from && event.createdAt.slice(0, 10) <= to).reduce((total, event) => total + event.amountKes, 0),
    creditsExpiredOrVoidedKes: reportEvents.filter((event) => ["expired", "voided", "forfeited"].includes(event.type) && event.createdAt.slice(0, 10) >= from && event.createdAt.slice(0, 10) <= to).reduce((total, event) => total + event.amountKes, 0),
    outstandingCreditKes: filters.promotionId ? 0 : reportEvents.filter((event) => event.createdAt <= asOf).reduce((total, event) => total + (event.type === "issued" ? event.amountKes : ["applied", "expired", "voided", "forfeited"].includes(event.type) ? -event.amountKes : 0), 0),
    promotionRedemptions: settledCharges.filter((charge) => Boolean(charge.offerId || charge.promotionId) && Boolean(charge.settledAt) && charge.settledAt!.slice(0, 10) >= from && charge.settledAt!.slice(0, 10) <= to).length,
  }, calculatedAt: new Date().toISOString() };
};
