const assert = require("node:assert/strict");

process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const billingRepository = require("../dist/repositories/billing-repository.js");
const { attemptCreditSettlement, issueBillingCredit, platformRevenueReport } = require("../dist/repositories/billing-credit-repository.js");

const account = { partitionKey: "TENANT#tenant-1", sortKey: "BILLING#ACCOUNT", entityType: "billing_account", tenantId: "tenant-1" };
const charge = (updates) => ({
  partitionKey: "TENANT#tenant-1", sortKey: `BILLING#CHARGE#${updates.id}`, entityType: "billing_charge", tenantId: "tenant-1", tenantName: "Market",
  status: "settled", settlementKind: "cash_and_credit", planCode: "biashara", planName: "Biashara", billingInterval: "monthly", billingMonths: 1,
  listAmountKes: 100, customPriceAdjustmentKes: 10, annualDiscountKes: 5, promotionDiscountKes: 15, creditAppliedKes: 20, cashAmountKes: 50, netRevenueKes: 50,
  periodStartsOn: "2026-01-01", periodEndsOn: "2026-01-03", dueOn: "2026-01-01", offerId: "offer-1", promotionId: "promo-1", promotionLabel: "Launch",
  paymentId: "payment-1", issuedAt: "2026-01-01T08:00:00.000Z", settledAt: "2026-01-01T09:00:00.000Z", ...updates,
});
const event = (id, type, amountKes, createdAt) => ({ partitionKey: "TENANT#tenant-1", sortKey: `BILLING#CREDIT_EVENT#${createdAt}#${id}`, entityType: "billing_credit_event", id, tenantId: "tenant-1", creditId: "credit-1", type, amountKes, actorId: "admin", reason: "test", chargeId: null, paymentId: null, requestId: null, createdAt });

async function main() {
  dynamoDB.send = async (command) => {
    if (command.constructor.name !== "QueryCommand") throw new Error(`Unexpected ${command.constructor.name}`);
    if (command.input.IndexName === "AccessIndex") return { Items: [account] };
    const prefix = command.input.ExpressionAttributeValues[":prefix"];
    if (prefix === "BILLING#CHARGE#") return { Items: [
      charge({ id: "current" }),
      charge({ id: "future", offerId: null, promotionId: null, promotionLabel: null, creditAppliedKes: 0, cashAmountKes: 90, netRevenueKes: 90, periodStartsOn: "2026-02-01", periodEndsOn: "2026-02-02", settledAt: "2026-01-02T09:00:00.000Z" }),
    ] };
    if (prefix === "BILLING#CREDIT_EVENT#") return { Items: [
      event("issued", "issued", 100, "2026-01-01T08:00:00.000Z"),
      event("applied", "applied", 20, "2026-01-02T08:00:00.000Z"),
      event("expired", "expired", 10, "2026-01-03T08:00:00.000Z"),
      event("later", "issued", 50, "2026-01-04T08:00:00.000Z"),
    ] };
    if (prefix === "BILLING#PAYMENT#") return { Items: [{ partitionKey: "TENANT#tenant-1", sortKey: "BILLING#PAYMENT#payment-1", entityType: "billing_payment", id: "payment-1", tenantId: "tenant-1", status: "confirmed", amountKes: 50, paidOn: "2026-01-01", reviewedAt: "2026-01-01T09:00:00.000Z" }] };
    throw new Error(`Unexpected query prefix ${prefix}`);
  };

  const report = await platformRevenueReport("2026-01-01", "2026-01-03");
  assert.equal(report.rows.length, 1, "future service is excluded from current recognized rows");
  assert.equal(report.summary.listPriceRevenueKes, 100);
  assert.equal(report.summary.customPriceAdjustmentKes, 10);
  assert.equal(report.summary.annualDiscountKes, 5);
  assert.equal(report.summary.promotionDiscountKes, 15);
  assert.equal(report.summary.creditImpactKes, 20);
  assert.equal(report.summary.recognizedRevenueKes, 50);
  assert.equal(report.summary.cashCollectedKes, 50);
  assert.equal(report.summary.deferredRevenueKes, 90, "settled future service remains deferred at report end");
  assert.equal(report.summary.creditsIssuedKes, 100);
  assert.equal(report.summary.creditsAppliedKes, 20);
  assert.equal(report.summary.creditsExpiredOrVoidedKes, 10);
  assert.equal(report.summary.outstandingCreditKes, 70, "outstanding credit is reconstructed as of the report end date");
  assert.equal(report.summary.promotionRedemptions, 1, "redemptions are counted on settlement, not once per recognition period");

  const firstDay = await platformRevenueReport("2026-01-01", "2026-01-01");
  assert.equal(firstDay.rows[0].recognizedListAmountKes, 33);
  assert.equal(firstDay.rows[0].recognizedRevenueKes, 16, "cumulative integer allocation uses whole KES and reconciles over the service period");

  const input = { amountKes: 100, expiresOn: null, reason: "Service recovery", customerMessage: "Welcome back", requestId: "request-1234" };
  const requestHash = JSON.stringify({ amountKes: 100, expiresOn: null, reason: "Service recovery", customerMessage: "Welcome back" });
  dynamoDB.send = async (command) => {
    if (command.constructor.name !== "GetCommand") throw new Error(`Unexpected ${command.constructor.name}`);
    if (command.input.Key.sortKey.startsWith("BILLING#CREDIT_REQUEST#")) return { Item: { creditId: "credit-id", requestHash } };
    return { Item: { partitionKey: "TENANT#tenant-1", sortKey: "BILLING#CREDIT#credit-id", entityType: "billing_credit", id: "credit-id", tenantId: "tenant-1", originalAmountKes: 100, remainingAmountKes: 100, status: "available", expiresOn: null, reason: "Service recovery", customerMessage: "Welcome back", issuedBy: "admin", requestId: "request-1234", issuedAt: "2026-01-01T08:00:00.000Z", updatedAt: "2026-01-01T08:00:00.000Z" } };
  };
  const retried = await issueBillingCredit("tenant-1", input, "admin");
  assert.equal(retried.idempotent, true);
  assert.equal(retried.credit.id, "credit-id");
  await assert.rejects(() => issueBillingCredit("tenant-1", { ...input, amountKes: 101 }, "admin"), /already used with different details/, "an idempotency key cannot be reused for different credit details");
  await assert.rejects(() => issueBillingCredit("tenant-1", { ...input, amountKes: 10.5, requestId: "request-5678" }, "admin"), /whole-KES|between KES/, "credits require a positive whole-KES amount");

  const openPayment = { id: "payment-open", tenantId: "tenant-1", tenantName: "Market", planCode: "biashara", billingInterval: "monthly", billingMonths: 1, amountKes: 500, baseAmountKes: 800, annualDiscountKes: 0, promotionCreditKes: 0, customPriceAdjustmentKes: 0, creditAppliedKes: 300, creditAllocations: [{ creditId: "credit-old", amountKes: 300, remainingBeforeKes: 300 }], chargeId: "charge-open", periodStartsOn: "2026-01-01", periodEndsOn: "2026-01-31", offerId: null, offerPricePercent: null, offerLabel: null, mpesaReference: "REJECTED1", paidOn: "2026-01-01", status: "rejected", submittedBy: "owner", submittedAt: "2026-01-01T08:00:00.000Z", reviewedBy: "admin", reviewedAt: "2026-01-01T09:00:00.000Z", rejectionReason: "Not found" };
  billingRepository.listBillingPayments = async () => [openPayment];
  const creditItems = [
    { id: "credit-old", originalAmountKes: 300, remainingAmountKes: 300, status: "available", expiresOn: "2026-01-01", issuedAt: "2025-12-01T08:00:00.000Z" },
    { id: "credit-new", originalAmountKes: 500, remainingAmountKes: 500, status: "available", expiresOn: null, issuedAt: "2026-01-02T08:00:00.000Z" },
  ].map((credit) => ({ partitionKey: "TENANT#tenant-1", sortKey: `BILLING#CREDIT#${credit.id}`, entityType: "billing_credit", tenantId: "tenant-1", reason: "test", customerMessage: "", issuedBy: "admin", requestId: credit.id, updatedAt: credit.issuedAt, ...credit }));
  let settlementTransaction;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "QueryCommand") return { Items: creditItems };
    if (command.constructor.name === "TransactWriteCommand") { settlementTransaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const settled = await attemptCreditSettlement("tenant-1", "admin", { tenantId: "tenant-1", tenantName: "Market", ownerUserId: "owner", ownerUsername: "owner@example.com", billingContactName: "Owner", billingContactEmail: "owner@example.com", billingContactPhone: "", planCode: "biashara", billingInterval: "monthly", trialStartedOn: "2025-01-01", trialEndsOn: "2025-01-14", paidThrough: null, cancelledAt: null, pendingPlanCode: null, pendingBillingInterval: null, termsVersion: "v1", privacyVersion: "v1", acceptedAt: "2025-01-01", acceptedBy: "owner", override: null, offer: null, creditBalanceKes: 800, workspaceState: "archived", delinquentSince: "2025-01-16", archivedAt: "2025-02-15", deletionScheduledOn: "2026-12-01", suspendedAt: null, createdAt: "2025-01-01", updatedAt: "2026-01-01" });
  assert.equal(settled.id, "charge-open", "new credit settles the existing open charge instead of creating a duplicate");
  assert.equal(settled.creditAppliedKes, 800);
  assert.equal(settled.cashAmountKes, 0);
  assert.ok(settlementTransaction.some((item) => item.Update?.Key?.sortKey === "BILLING#CHARGE#charge-open" && item.Update.ExpressionAttributeValues[":settled"] === "settled"));
  assert.ok(settlementTransaction.some((item) => item.Update?.Key?.sortKey === "BILLING#ACCOUNT" && item.Update.ExpressionAttributeValues[":active"] === "active"), "credit settlement restores archived access");
}

main().then(() => console.log("billing credit report tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
