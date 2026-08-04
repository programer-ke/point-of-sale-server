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
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
