const assert = require("node:assert/strict");
const { dynamoDB } = require("../dist/config/db.js");
const cognito = require("../dist/services/cognito.js");
const platform = require("../dist/repositories/platform-repository.js");

let cognitoCalls = 0;
cognito.getCognitoUser = async () => { cognitoCalls += 1; throw new Error("directory listing must not load Cognito users"); };
const today = new Date().toISOString().slice(0, 10);
const inThreeDays = (() => { const value = new Date(`${today}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + 3); return value.toISOString().slice(0, 10); })();
const thisMonth = `${today.slice(0, 8)}02T09:00:00Z`;

const summary = (tenantId, tenantName, updates = {}) => ({
  partitionKey: `PLATFORM#BUSINESS#${tenantId}`, sortKey: "SUMMARY", accessPartition: "PLATFORM#BUSINESS", accessSort: `${tenantName.toLowerCase()}#${tenantId}`,
  entityType: "platform_business_summary", tenantId, tenantName, normalizedName: tenantName.toLowerCase(),
  planCode: "biashara", planName: "Biashara", subscriptionStatus: "active", monthlyPriceKes: 1000, activeUsers: 2, activeStores: 1,
  pendingPayments: 0, pendingPaymentAmountKes: 0, trialEndsOn: "2026-08-14", paidThrough: "2026-09-30", billingContactEmail: "owner@example.com",
  createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-04T00:00:00Z", ...updates,
});

async function main() {
  let commands = [];
  dynamoDB.send = async (command) => {
    commands.push(command);
    if (command.constructor.name === "QueryCommand") return { Items: [summary("tenant-1", "Acacia"), summary("tenant-2", "Beta", { planCode: "biashara_growth", planName: "Biashara Growth" })], LastEvaluatedKey: { partitionKey: "cursor" } };
    if (command.constructor.name === "GetCommand") return { Item: summary("12345678-1234-1234-1234-123456789012", "Exact Shop") };
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const page = await platform.listPlatformBusinessPage({ first: 2 });
  assert.equal(page.items.length, 2);
  assert.ok(page.nextCursor);
  assert.equal(commands.length, 1, "a directory page should issue one indexed query");
  assert.equal(commands[0].input.IndexName, "AccessIndex");
  assert.equal(commands[0].input.ExpressionAttributeValues[":partition"], "PLATFORM#BUSINESS");
  assert.equal(cognitoCalls, 0, "directory listing must not fan out to Cognito");

  commands = [];
  const exact = await platform.listPlatformBusinessPage({ first: 25, search: "12345678-1234-1234-1234-123456789012" });
  assert.equal(exact.items[0].tenantName, "Exact Shop");
  assert.equal(commands[0].constructor.name, "GetCommand", "exact tenant lookup should use a direct key read");

  let storedMetrics;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "PutCommand") { storedMetrics = command.input.Item; return {}; }
    const partition = command.input.ExpressionAttributeValues?.[":partition"];
    if (partition === "PLATFORM#BUSINESS") return { Items: [
      summary("tenant-1", "Active", { subscriptionStatus: "active", monthlyPriceKes: 5000 }),
      summary("tenant-2", "Trial", { subscriptionStatus: "trialing", monthlyPriceKes: 2500, trialEndsOn: inThreeDays, paidThrough: null }),
      summary("tenant-3", "Restricted", { subscriptionStatus: "restricted", monthlyPriceKes: 1000, paidThrough: null }),
    ] };
    if (partition === "PLATFORM#BILLING_PAYMENT#confirmed") return { Items: [
      { entityType: "billing_payment", amountKes: 2500, reviewedAt: thisMonth },
      { entityType: "billing_payment", amountKes: 1000, reviewedAt: "2026-07-30T09:00:00Z" },
    ] };
    if (partition === "PLATFORM#BILLING_PAYMENT#submitted") return { Items: [{ entityType: "billing_payment", amountKes: 5000 }] };
    throw new Error(`Unexpected metrics command ${command.constructor.name}`);
  };
  const metrics = await platform.refreshPlatformMetrics();
  assert.equal(metrics.activeBusinesses, 1);
  assert.equal(metrics.projectedMrrKes, 5000, "MRR includes active subscriptions only");
  assert.equal(metrics.trialPipelineKes, 2500);
  assert.equal(metrics.expiringTrials, 1);
  assert.equal(metrics.collectedThisMonthKes, 2500);
  assert.equal(metrics.collectedAllTimeKes, 3500);
  assert.equal(metrics.pendingPaymentAmountKes, 5000);
  assert.equal(storedMetrics.entityType, "platform_metrics");
  console.log("platform repository tests passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
