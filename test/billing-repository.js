const assert = require("node:assert/strict");

process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const repository = require("../dist/repositories/billing-repository.js");

const existing = {
  tenantId: "tenant-1", tenantName: "Market", ownerUserId: "owner", ownerUsername: "owner@example.com",
  planCode: "biashara", trialStartedOn: "2026-08-01", trialEndsOn: "2026-08-14", paidThrough: "2026-09-30",
  cancelledAt: null, pendingPlanCode: "biashara_plus", termsVersion: "v1", privacyVersion: "v1", acceptedBy: "owner",
  acceptedAt: "2026-08-01", override: { exempt: true, reason: "old exception", updatedBy: "admin", updatedAt: "2026-08-01" },
  createdAt: "2026-08-01", updatedAt: "2026-08-01",
};

async function main() {
  const commands = [];
  dynamoDB.send = async (command) => {
    commands.push(command);
    if (command.constructor.name === "GetCommand") return { Item: { partitionKey: "TENANT#tenant-1", sortKey: "BILLING#ACCOUNT", entityType: "billing_account", ...existing } };
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected ${command.constructor.name}`);
  };

  const result = await repository.assignPlatformBillingPlan({
    tenantId: "tenant-1", tenantName: "Market", ownerUserId: "owner", ownerUsername: "owner@example.com",
    planCode: "biashara_plus", termsVersion: "v2", privacyVersion: "v2", actorId: "superadmin", reason: "Move to standard Plus plan",
  });
  assert.equal(result.planCode, "biashara_plus");
  assert.equal(result.pendingPlanCode, null);
  assert.equal(result.override, null);
  assert.equal(result.paidThrough, "2026-09-30", "assigning a plan must preserve paid-through date");
  assert.equal(result.billingContactEmail, "owner@example.com", "legacy accounts receive a safe billing-contact fallback");
  const transaction = commands.find((command) => command.constructor.name === "TransactWriteCommand").input.TransactItems;
  assert.equal(transaction[0].Put.ConditionExpression, "attribute_exists(partitionKey)");
  assert.equal(transaction[1].Put.Item.action, "billing_plan_assigned");
  assert.equal(transaction[1].Put.Item.reason, "Move to standard Plus plan");
  assert.match(transaction[1].Put.Item.before, /old exception/);

  commands.length = 0;
  const offered = await repository.setBillingOffer("tenant-1", { label: "Launch offer", pricePercent: 70, durationMonths: 6, startsOn: "2026-10-01", reason: "Approved launch promotion" }, "superadmin");
  assert.equal(offered.offer.pricePercent, 70);
  assert.equal(offered.offer.remainingPayments, 6);
  const offerTransaction = commands.find((command) => command.constructor.name === "TransactWriteCommand").input.TransactItems;
  assert.equal(offerTransaction[1].Put.Item.action, "billing_offer_assigned");
  assert.match(offerTransaction[0].Put.ConditionExpression, /updatedAt/, "offer claims must reject concurrent account changes");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: { partitionKey: "TENANT#tenant-1", sortKey: "BILLING#ACCOUNT", entityType: "billing_account", ...existing, offer: offered.offer } };
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  await assert.rejects(
    () => repository.setBillingOffer("tenant-1", { label: "Second offer", pricePercent: 50, durationMonths: 2, startsOn: "2026-10-01", reason: "Attempt to stack offers" }, "superadmin"),
    /already has an active promotional offer/,
    "an account cannot stack or replace an active promotion",
  );

  commands.length = 0;
  dynamoDB.send = async (command) => {
    commands.push(command);
    if (command.constructor.name === "QueryCommand") return { Items: [] };
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const payment = await repository.submitBillingPayment({ ...existing, paidThrough: "2099-09-30", pendingBillingInterval: "annual", override: null, offer: null }, { mpesaReference: "SAMPLE1234", paidOn: "2026-08-04", submittedBy: "owner" });
  assert.equal(payment.planCode, "biashara_plus", "the pending plan is charged without accepting a client-selected plan");
  assert.equal(payment.billingInterval, "annual");
  assert.equal(payment.amountKes, 54000, "the server calculates the exact annual amount with a 10% discount");
  assert.equal(payment.baseAmountKes, 60000);
  assert.equal(payment.annualDiscountKes, 6000);
  assert.equal(payment.promotionCreditKes, 0);
  assert.equal(payment.periodStartsOn, "2099-10-01", "early payment starts after the paid-through date");
  assert.equal(payment.periodEndsOn, "2100-09-30", "annual payment covers twelve calendar months");
  const paymentTransaction = commands.find((command) => command.constructor.name === "TransactWriteCommand").input.TransactItems;
  const invoice = paymentTransaction[2].Put.Item;
  assert.equal(invoice.baseAmountKes, 60000, "the invoice snapshots the undiscounted plan amount");
  assert.equal(invoice.annualDiscountKes, 6000, "the invoice snapshots the annual discount separately");
  assert.equal(invoice.promotionCreditKes, 0);

  commands.length = 0;
  const credits = [
    { id: "no-expiry", remainingAmountKes: 200, status: "available", expiresOn: null, issuedAt: "2026-01-01" },
    { id: "later-expiry", remainingAmountKes: 200, status: "available", expiresOn: "2099-12-31", issuedAt: "2026-01-01" },
    { id: "expired", remainingAmountKes: 1000, status: "available", expiresOn: "2020-01-01", issuedAt: "2020-01-01" },
    { id: "early-expiry", remainingAmountKes: 300, status: "available", expiresOn: "2099-11-30", issuedAt: "2026-02-01" },
  ].map((credit) => ({ partitionKey: "TENANT#tenant-1", sortKey: `BILLING#CREDIT#${credit.id}`, entityType: "billing_credit", tenantId: "tenant-1", originalAmountKes: credit.remainingAmountKes, ...credit }));
  dynamoDB.send = async (command) => {
    commands.push(command);
    if (command.constructor.name === "QueryCommand") return command.input.ExpressionAttributeValues[":prefix"] === "BILLING#CREDIT#" ? { Items: credits } : { Items: [] };
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const creditedPayment = await repository.submitBillingPayment({ ...existing, planCode: "biashara", pendingPlanCode: null, paidThrough: "2099-09-30", pendingBillingInterval: null, billingInterval: "monthly", override: null, offer: null, creditBalanceKes: 1700 }, { mpesaReference: "SAMPLE5678", paidOn: "2026-08-04", submittedBy: "owner" });
  assert.equal(creditedPayment.creditAppliedKes, 700);
  assert.equal(creditedPayment.amountKes, 100, "cash submission is only for the balance after credit");
  assert.deepEqual(creditedPayment.creditAllocations.map(({ creditId }) => creditId), ["early-expiry", "later-expiry", "no-expiry"], "credits apply by earliest expiry and then issue date");
  const creditedTransaction = commands.find((command) => command.constructor.name === "TransactWriteCommand").input.TransactItems;
  assert.equal(creditedTransaction.filter((item) => item.ConditionCheck).length, 3, "credit snapshots are conditionally checked to prevent concurrent double application");
  const paymentLock = creditedTransaction.find((item) => item.Put?.Item?.entityType === "billing_payment_lock");
  assert.match(paymentLock.Put.ConditionExpression, /attribute_not_exists/, "only one submitted payment can reserve credit at a time");

  commands.length = 0;
  dynamoDB.send = async (command) => {
    commands.push(command);
    if (command.constructor.name === "GetCommand") return { Item: { partitionKey: "TENANT#tenant-1", sortKey: `BILLING#PAYMENT#${creditedPayment.id}`, entityType: "billing_payment", ...creditedPayment } };
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const rejected = await repository.rejectBillingPayment("tenant-1", creditedPayment.id, "reviewer", "Reference could not be verified");
  assert.deepEqual(rejected.creditAllocations, creditedPayment.creditAllocations, "rejection keeps credit reserved against the open charge");
  const rejectionTransaction = commands.find((command) => command.constructor.name === "TransactWriteCommand").input.TransactItems;
  assert.equal(rejectionTransaction.length, 2, "rejection changes the evidence status and releases only the submission lock");

  commands.length = 0;
  dynamoDB.send = async (command) => {
    commands.push(command);
    if (command.constructor.name === "QueryCommand") return { Items: [{ partitionKey: "TENANT#tenant-1", sortKey: `BILLING#PAYMENT#${rejected.id}`, entityType: "billing_payment", ...rejected }] };
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const corrected = await repository.submitBillingPayment({ ...existing, planCode: "biashara", pendingPlanCode: null, paidThrough: "2099-09-30", pendingBillingInterval: null, billingInterval: "monthly", override: null, offer: null, creditBalanceKes: 1700 }, { mpesaReference: "SAMPLE9012", paidOn: "2026-08-04", submittedBy: "owner" });
  assert.equal(corrected.id, rejected.id, "corrected evidence reuses the original charge and invoice");
  assert.equal(corrected.previousRejections.length, 1, "the rejected evidence remains recorded on the payment fact");
  const correctionTransaction = commands.find((command) => command.constructor.name === "TransactWriteCommand").input.TransactItems;
  assert.equal(correctionTransaction.some((item) => item.Put?.Item?.entityType === "billing_document"), false);
  assert.equal(correctionTransaction.some((item) => item.Put?.Item?.entityType === "billing_charge"), false);
  assert.equal(correctionTransaction.some((item) => item.Put?.Item?.type === "reserved"), false, "an existing reservation is not duplicated");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
