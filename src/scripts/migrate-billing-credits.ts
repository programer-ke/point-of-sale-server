import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME, verifyAwsConnection } from "../config/db";
import { billingStatus, kenyaDate, PLANS } from "../domain/billing";
import { listBillingPayments, listPlatformBillingAccounts } from "../repositories/billing-repository";
import { listBillingCharges } from "../repositories/billing-credit-repository";
import { refreshPlatformBusinessSummary, refreshPlatformMetrics } from "../repositories/platform-repository";

const dryRun = process.argv.includes("--dry-run");

const main = async () => {
  if (!(await verifyAwsConnection())) throw new Error("DynamoDB is unavailable");
  const accounts = await listPlatformBillingAccounts();
  let accountsUpdated = 0; let chargesCreated = 0;
  for (const account of accounts) {
    const today = kenyaDate();
    const defaulted = billingStatus(account, today) === "restricted" || billingStatus(account, today) === "cancelled";
    if (!dryRun) await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { partitionKey: `TENANT#${account.tenantId}`, sortKey: "BILLING#ACCOUNT" },
      UpdateExpression: "SET creditBalanceKes = if_not_exists(creditBalanceKes, :zero), workspaceState = if_not_exists(workspaceState, :active), delinquentSince = if_not_exists(delinquentSince, :delinquent), archivedAt = if_not_exists(archivedAt, :none), deletionScheduledOn = if_not_exists(deletionScheduledOn, :none), suspendedAt = if_not_exists(suspendedAt, :none), suspendedBy = if_not_exists(suspendedBy, :none), suspensionReason = if_not_exists(suspensionReason, :none)",
      ExpressionAttributeValues: { ":zero": 0, ":active": "active", ":delinquent": defaulted ? today : null, ":none": null },
    }));
    accountsUpdated += 1;
    const [payments, existingCharges] = await Promise.all([listBillingPayments(account.tenantId), listBillingCharges(account.tenantId)]);
    const submittedPayment = payments.find(({ status }) => status === "submitted");
    if (!dryRun && submittedPayment) {
      try { await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { partitionKey: `TENANT#${account.tenantId}`, sortKey: "BILLING#PAYMENT_PENDING", entityType: "billing_payment_lock", tenantId: account.tenantId, paymentId: submittedPayment.id, createdAt: submittedPayment.submittedAt }, ConditionExpression: "attribute_not_exists(partitionKey)" })); }
      catch (error) { if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error; }
    }
    const existing = new Set(existingCharges.map(({ paymentId }) => paymentId).filter(Boolean));
    for (const payment of payments.filter(({ status }) => status === "confirmed" || status === "submitted")) {
      if (existing.has(payment.id)) continue;
      const issuedAt = payment.submittedAt;
      const charge = {
        id: payment.id, tenantId: account.tenantId, tenantName: payment.tenantName, status: payment.status === "confirmed" ? "settled" : "open",
        settlementKind: payment.status === "confirmed" ? "cash" : null, planCode: payment.planCode, planName: PLANS[payment.planCode].name,
        billingInterval: payment.billingInterval ?? "monthly", billingMonths: payment.billingMonths ?? 1,
        listAmountKes: (payment.baseAmountKes ?? payment.amountKes) + (payment.customPriceAdjustmentKes ?? 0), customPriceAdjustmentKes: payment.customPriceAdjustmentKes ?? 0,
        annualDiscountKes: payment.annualDiscountKes ?? 0, promotionDiscountKes: payment.promotionCreditKes ?? 0,
        creditAppliedKes: payment.creditAppliedKes ?? 0, cashAmountKes: payment.amountKes, netRevenueKes: payment.amountKes,
        periodStartsOn: payment.periodStartsOn ?? payment.paidOn, periodEndsOn: payment.periodEndsOn ?? account.paidThrough ?? payment.paidOn,
        dueOn: payment.periodStartsOn ?? payment.paidOn, offerId: payment.offerId ?? null, promotionId: null, promotionLabel: payment.offerLabel ?? null,
        paymentId: payment.id, issuedAt, settledAt: payment.status === "confirmed" ? payment.reviewedAt ?? issuedAt : null,
      };
      if (!dryRun) {
        try { await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { partitionKey: `TENANT#${account.tenantId}`, sortKey: `BILLING#CHARGE#${payment.id}`, entityType: "billing_charge", ...charge }, ConditionExpression: "attribute_not_exists(sortKey)" })); }
        catch (error) { if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error; }
      }
      chargesCreated += 1;
    }
    if (!dryRun) await refreshPlatformBusinessSummary(account.tenantId);
  }
  if (!dryRun) await refreshPlatformMetrics();
  console.log(JSON.stringify({ dryRun, accounts: accounts.length, accountsUpdated, chargesCreated }));
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
