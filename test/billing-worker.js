const assert = require("node:assert/strict");

process.env.AWS_DYNAMODB_TABLE = "test-table";

const billingRepository = require("../dist/repositories/billing-repository.js");
const tenantRepository = require("../dist/repositories/tenant-repository.js");
const platformRepository = require("../dist/repositories/platform-repository.js");
const cognito = require("../dist/services/cognito.js");
const billingEmail = require("../dist/services/billing-email.js");
const database = require("../dist/config/db.js");

billingRepository.listPlatformBillingAccounts = async () => [{
  tenantId: "tenant-1",
  ownerUsername: "owner@example.com",
  trialEndsOn: "2026-08-04",
  paidThrough: null,
  billingInterval: "monthly",
  pendingBillingInterval: null,
  override: null,
  cancelledAt: null,
}];
billingRepository.listBillingPayments = async () => [];
tenantRepository.listTenantMemberships = async () => [];
platformRepository.refreshPlatformBusinessSummary = async () => {};
platformRepository.refreshPlatformMetrics = async () => {};
cognito.getCognitoUser = async () => ({ email: "owner@example.com" });
billingEmail.sendBillingEmail = async () => {
  const error = new Error("SES rejected the test message");
  error.name = "MessageRejected";
  throw error;
};

async function main() {
  const commands = [];
  database.dynamoDB.send = async (command) => {
    commands.push(command.constructor.name);
    return {};
  };

  const records = [];
  const originalError = console.error;
  console.error = (value) => records.push(JSON.parse(value));
  try {
    const { processBillingReminders } = require("../dist/services/billing-worker.js");
    await assert.rejects(
      () => processBillingReminders("2026-08-05"),
      (error) => error.name === "BillingReminderDeliveryError",
    );
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(commands, ["QueryCommand", "QueryCommand", "QueryCommand", "PutCommand", "DeleteCommand"], "credit expiry and settlement checks run before reminder delivery");
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "critical_operation_failed");
  assert.equal(records[0].operation, "billing_reminder_delivery");
  assert.equal(records[0].tenantId, "tenant-1");
  assert.equal(records[0].critical, true);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
