import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import {
  addBillingDays,
  addBillingMonth,
  billingStatus,
  effectivePlan,
  kenyaDate,
  PLANS,
  type BillingAccount,
  type BillingOverride,
  type PlanCode,
} from "../domain/billing";

export type PaymentStatus = "submitted" | "confirmed" | "rejected";
export type BillingDocumentKind = "invoice" | "receipt";

export interface BillingPayment {
  id: string;
  tenantId: string;
  tenantName: string;
  planCode: PlanCode;
  amountKes: number;
  mpesaReference: string;
  paidOn: string;
  status: PaymentStatus;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface BillingDocument {
  id: string;
  number: string;
  tenantId: string;
  kind: BillingDocumentKind;
  planCode: PlanCode;
  planName: string;
  amountKes: number;
  issuedOn: string;
  paymentId: string;
  externalEtimsReference: string | null;
  notice: string;
  createdAt: string;
}

export interface BillingAudit {
  id: string;
  tenantId: string;
  action: string;
  actorId: string;
  reason: string;
  before: string;
  after: string;
  createdAt: string;
}

const accountKey = (tenantId: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: "BILLING#ACCOUNT" });
const paymentKey = (tenantId: string, id: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#PAYMENT#${id}` });
const documentKey = (tenantId: string, id: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#DOCUMENT#${id}` });
const clean = <T>(item?: Record<string, unknown>): T | null => {
  if (!item) return null;
  const { partitionKey: _pk, sortKey: _sk, accessPartition: _ap, accessSort: _as, entityType: _type, ...value } = item;
  return value as T;
};

export const billingEnforcementEnabled = () => process.env.BILLING_ENFORCEMENT_ENABLED === "true";

export const validateBillingEnvironment = () => {
  if (!billingEnforcementEnabled()) return;
  const required = ["BILLING_VENDOR_LEGAL_NAME", "BILLING_VENDOR_KRA_PIN", "BILLING_VENDOR_ADDRESS", "BILLING_SUPPORT_EMAIL", "BILLING_SUPPORT_PHONE", "BILLING_TILL_NUMBER"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Billing enforcement requires environment values: ${missing.join(", ")}`);
  if (!/^[A-Z][0-9]{9}[A-Z]$/.test(process.env.BILLING_VENDOR_KRA_PIN!.trim().toUpperCase())) throw new Error("BILLING_VENDOR_KRA_PIN is invalid");
  if (!/^[0-9]{5,12}$/.test(process.env.BILLING_TILL_NUMBER!.trim())) throw new Error("BILLING_TILL_NUMBER is invalid");
};

export const acquireBillingCapacityLock = async (tenantId: string, resource: "users" | "stores") => {
  const token = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await dynamoDB.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { partitionKey: `TENANT#${tenantId}#BILLING_LOCK#${resource}`, sortKey: "LOCK", entityType: "billing_capacity_lock", token, expiresAt: now + 30 },
    ConditionExpression: "attribute_not_exists(partitionKey) OR expiresAt < :now",
    ExpressionAttributeValues: { ":now": now },
  }));
  return async () => {
    await dynamoDB.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { partitionKey: `TENANT#${tenantId}#BILLING_LOCK#${resource}`, sortKey: "LOCK" },
      ConditionExpression: "#token = :token",
      ExpressionAttributeNames: { "#token": "token" },
      ExpressionAttributeValues: { ":token": token },
    })).catch((error) => { if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error; });
  };
};

export const getBillingAccount = async (tenantId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: accountKey(tenantId) }));
  return clean<BillingAccount>(response.Item);
};

export const requireBillingAccount = async (tenantId: string) => {
  const account = await getBillingAccount(tenantId);
  if (!account) throw new Error("Billing is not configured for this workspace. Contact BiasharaKit support.");
  return account;
};

export const createBillingAccount = async (input: {
  tenantId: string;
  tenantName: string;
  ownerUserId: string;
  ownerUsername: string;
  planCode: PlanCode;
  termsVersion: string;
  privacyVersion: string;
  acceptedBy: string;
  trialStartedOn?: string;
}) => {
  const now = new Date().toISOString();
  const trialStartedOn = input.trialStartedOn ?? kenyaDate();
  const account: BillingAccount = {
    ...input,
    trialStartedOn,
    trialEndsOn: addBillingDays(trialStartedOn, 13),
    paidThrough: null,
    cancelledAt: null,
    pendingPlanCode: null,
    acceptedAt: now,
    override: null,
    createdAt: now,
    updatedAt: now,
  };
  await dynamoDB.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...accountKey(input.tenantId), accessPartition: "PLATFORM#BILLING", accessSort: input.tenantId, entityType: "billing_account", ...account },
    ConditionExpression: "attribute_not_exists(partitionKey)",
  }));
  return account;
};

export const assignPlatformBillingPlan = async (input: {
  tenantId: string;
  tenantName: string;
  ownerUserId: string;
  ownerUsername: string;
  planCode: PlanCode;
  termsVersion: string;
  privacyVersion: string;
  actorId: string;
  reason: string;
}) => {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error("Provide a reason for the plan assignment");
  const current = await getBillingAccount(input.tenantId);
  const now = new Date().toISOString();
  const trialStartedOn = kenyaDate();
  const next: BillingAccount = current ? {
    ...current,
    tenantName: input.tenantName,
    ownerUserId: input.ownerUserId,
    ownerUsername: input.ownerUsername,
    planCode: input.planCode,
    pendingPlanCode: null,
    override: null,
    updatedAt: now,
  } : {
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    ownerUserId: input.ownerUserId,
    ownerUsername: input.ownerUsername,
    planCode: input.planCode,
    trialStartedOn,
    trialEndsOn: addBillingDays(trialStartedOn, 13),
    paidThrough: null,
    cancelledAt: null,
    pendingPlanCode: null,
    termsVersion: input.termsVersion,
    privacyVersion: input.privacyVersion,
    acceptedBy: input.actorId,
    acceptedAt: now,
    override: null,
    createdAt: now,
    updatedAt: now,
  };
  const audit: BillingAudit = {
    id: randomUUID(),
    tenantId: input.tenantId,
    action: current ? "billing_plan_assigned" : "billing_account_initialized",
    actorId: input.actorId,
    reason,
    before: current ? JSON.stringify({ planCode: current.planCode, pendingPlanCode: current.pendingPlanCode, override: current.override }) : "null",
    after: JSON.stringify({ planCode: next.planCode, pendingPlanCode: null, override: null }),
    createdAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: {
      TableName: TABLE_NAME,
      Item: { ...accountKey(input.tenantId), accessPartition: "PLATFORM#BILLING", accessSort: input.tenantId, entityType: "billing_account", ...next },
      ConditionExpression: current ? "attribute_exists(partitionKey)" : "attribute_not_exists(partitionKey)",
    } },
    { Put: {
      TableName: TABLE_NAME,
      Item: { partitionKey: `TENANT#${input.tenantId}`, sortKey: `BILLING#AUDIT#${now}#${audit.id}`, entityType: "billing_audit", ...audit },
      ConditionExpression: "attribute_not_exists(partitionKey)",
    } },
  ] }));
  return next;
};

const listByPrefix = async <T>(tenantId: string, prefix: string) => {
  const response = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "partitionKey = :pk AND begins_with(sortKey, :prefix)",
    ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":prefix": prefix },
    ScanIndexForward: false,
  }));
  return (response.Items ?? []).map((item) => clean<T>(item)!);
};

export const listBillingPayments = (tenantId: string) => listByPrefix<BillingPayment>(tenantId, "BILLING#PAYMENT#");
export const listBillingDocuments = (tenantId: string) => listByPrefix<BillingDocument>(tenantId, "BILLING#DOCUMENT#");
export const listBillingAudits = (tenantId: string) => listByPrefix<BillingAudit>(tenantId, "BILLING#AUDIT#");

const normalizeMpesaReference = (value: string) => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,16}$/.test(normalized)) throw new Error("Enter a valid M-Pesa transaction code");
  return normalized;
};

const documentNumber = (kind: BillingDocumentKind, now: string, id: string) =>
  `TMK-${kind === "invoice" ? "INV" : "RCT"}-${now.slice(0, 7).replace("-", "")}-${id.slice(0, 8).toUpperCase()}`;

export const submitBillingPayment = async (account: BillingAccount, input: {
  planCode: PlanCode;
  amountKes: number;
  mpesaReference: string;
  paidOn: string;
  submittedBy: string;
}) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) || input.paidOn > kenyaDate()) throw new Error("Payment date must be a valid date that is not in the future");
  const expected = effectivePlan({ ...account, planCode: input.planCode }).monthlyPriceKes;
  if (!Number.isSafeInteger(input.amountKes) || input.amountKes !== expected) throw new Error(`Payment amount must be KES ${expected.toLocaleString("en-KE")}`);
  const mpesaReference = normalizeMpesaReference(input.mpesaReference);
  const now = new Date().toISOString();
  const id = randomUUID();
  const invoiceId = randomUUID();
  const payment: BillingPayment = {
    id,
    tenantId: account.tenantId,
    tenantName: account.tenantName,
    planCode: input.planCode,
    amountKes: input.amountKes,
    mpesaReference,
    paidOn: input.paidOn,
    status: "submitted",
    submittedBy: input.submittedBy,
    submittedAt: now,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
  };
  const invoice: BillingDocument = {
    id: invoiceId,
    number: documentNumber("invoice", now, invoiceId),
    tenantId: account.tenantId,
    kind: "invoice",
    planCode: input.planCode,
    planName: PLANS[input.planCode].name,
    amountKes: input.amountKes,
    issuedOn: kenyaDate(),
    paymentId: id,
    externalEtimsReference: null,
    notice: "Non-tax billing document. This is not a KRA tax invoice and does not replace an eTIMS invoice.",
    createdAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...paymentKey(account.tenantId, id), accessPartition: "PLATFORM#BILLING_PAYMENT", accessSort: `${now}#${id}`, entityType: "billing_payment", ...payment }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { partitionKey: `BILLING_PAYMENT_REF#${mpesaReference}`, sortKey: "CLAIM", entityType: "billing_payment_reference", tenantId: account.tenantId, paymentId: id, createdAt: now }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...documentKey(account.tenantId, invoiceId), entityType: "billing_document", ...invoice }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return payment;
};

export const getBillingPayment = async (tenantId: string, id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: paymentKey(tenantId, id) }));
  return clean<BillingPayment>(response.Item);
};

export const confirmBillingPayment = async (tenantId: string, paymentId: string, reviewerId: string) => {
  const [account, payment] = await Promise.all([requireBillingAccount(tenantId), getBillingPayment(tenantId, paymentId)]);
  if (!payment) throw new Error("Payment submission was not found");
  if (payment.status === "confirmed") return payment;
  if (payment.status !== "submitted") throw new Error("Only submitted payments can be confirmed");
  const today = kenyaDate();
  const periodStartsOn = account.paidThrough && account.paidThrough >= today ? addBillingDays(account.paidThrough, 1) : today;
  const paidThrough = addBillingDays(addBillingMonth(periodStartsOn), -1);
  const now = new Date().toISOString();
  const receiptId = randomUUID();
  const confirmed: BillingPayment = { ...payment, status: "confirmed", reviewedBy: reviewerId, reviewedAt: now };
  const receipt: BillingDocument = {
    id: receiptId,
    number: documentNumber("receipt", now, receiptId),
    tenantId,
    kind: "receipt",
    planCode: payment.planCode,
    planName: PLANS[payment.planCode].name,
    amountKes: payment.amountKes,
    issuedOn: today,
    paymentId,
    externalEtimsReference: null,
    notice: "Payment receipt only. This is not a KRA tax invoice and does not replace an eTIMS invoice.",
    createdAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...paymentKey(tenantId, paymentId), accessPartition: "PLATFORM#BILLING_PAYMENT", accessSort: `${payment.submittedAt}#${paymentId}`, entityType: "billing_payment", ...confirmed }, ConditionExpression: "#status = :submitted", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":submitted": "submitted" } } },
    { Update: { TableName: TABLE_NAME, Key: accountKey(tenantId), UpdateExpression: "SET planCode = :plan, paidThrough = :paidThrough, pendingPlanCode = :none, cancelledAt = :none, updatedAt = :now", ExpressionAttributeValues: { ":plan": payment.planCode, ":paidThrough": paidThrough, ":none": null, ":now": now } } },
    { Put: { TableName: TABLE_NAME, Item: { ...documentKey(tenantId, receiptId), entityType: "billing_document", ...receipt }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return confirmed;
};

export const rejectBillingPayment = async (tenantId: string, paymentId: string, reviewerId: string, reason: string) => {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error("Provide a rejection reason");
  const response = await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: paymentKey(tenantId, paymentId),
    UpdateExpression: "SET #status = :rejected, reviewedBy = :reviewer, reviewedAt = :now, rejectionReason = :reason",
    ConditionExpression: "#status = :submitted",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":submitted": "submitted", ":rejected": "rejected", ":reviewer": reviewerId, ":now": new Date().toISOString(), ":reason": trimmed },
    ReturnValues: "ALL_NEW",
  }));
  return clean<BillingPayment>(response.Attributes)!;
};

export const cancelBillingSubscription = async (tenantId: string) => {
  const now = new Date().toISOString();
  const response = await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: accountKey(tenantId),
    UpdateExpression: "SET cancelledAt = :now, updatedAt = :now",
    ExpressionAttributeValues: { ":now": now },
    ReturnValues: "ALL_NEW",
  }));
  return clean<BillingAccount>(response.Attributes)!;
};

export const scheduleBillingPlan = async (tenantId: string, planCode: PlanCode) => {
  const account = await requireBillingAccount(tenantId);
  if (account.planCode === planCode) return account;
  const now = new Date().toISOString();
  const response = await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: accountKey(tenantId),
    UpdateExpression: "SET pendingPlanCode = :plan, updatedAt = :now",
    ExpressionAttributeValues: { ":plan": planCode, ":now": now },
    ReturnValues: "ALL_NEW",
  }));
  return clean<BillingAccount>(response.Attributes)!;
};

export const listPlatformBillingAccounts = async () => {
  const accounts: BillingAccount[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: "accessPartition = :partition",
      ExpressionAttributeValues: { ":partition": "PLATFORM#BILLING" },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    accounts.push(...(response.Items ?? []).map((item) => clean<BillingAccount>(item)!));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return accounts;
};

export const setBillingOverride = async (tenantId: string, override: BillingOverride, actorId: string) => {
  const account = await requireBillingAccount(tenantId);
  const now = new Date().toISOString();
  const next = { ...account, override, updatedAt: now };
  const audit: BillingAudit = {
    id: randomUUID(), tenantId, action: "billing_override_updated", actorId, reason: override.reason,
    before: JSON.stringify(account.override), after: JSON.stringify(override), createdAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...accountKey(tenantId), accessPartition: "PLATFORM#BILLING", accessSort: tenantId, entityType: "billing_account", ...next } } },
    { Put: { TableName: TABLE_NAME, Item: { partitionKey: `TENANT#${tenantId}`, sortKey: `BILLING#AUDIT#${now}#${audit.id}`, entityType: "billing_audit", ...audit } } },
  ] }));
  return next;
};

export const attachEtimsReference = async (tenantId: string, documentId: string, reference: string) => {
  const normalized = reference.trim();
  if (normalized.length < 3 || normalized.length > 100) throw new Error("Enter a valid eTIMS reference");
  const response = await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: documentKey(tenantId, documentId),
    UpdateExpression: "SET externalEtimsReference = :reference",
    ConditionExpression: "attribute_exists(partitionKey)",
    ExpressionAttributeValues: { ":reference": normalized },
    ReturnValues: "ALL_NEW",
  }));
  return clean<BillingDocument>(response.Attributes)!;
};

export const billingAccountView = (account: BillingAccount) => ({
  ...account,
  status: billingStatus(account),
  plan: effectivePlan(account),
  graceEndsOn: addBillingDays(account.paidThrough ?? account.trialEndsOn, 1),
});
