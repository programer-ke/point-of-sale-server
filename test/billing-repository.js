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
  const transaction = commands.find((command) => command.constructor.name === "TransactWriteCommand").input.TransactItems;
  assert.equal(transaction[0].Put.ConditionExpression, "attribute_exists(partitionKey)");
  assert.equal(transaction[1].Put.Item.action, "billing_plan_assigned");
  assert.equal(transaction[1].Put.Item.reason, "Move to standard Plus plan");
  assert.match(transaction[1].Put.Item.before, /old exception/);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
