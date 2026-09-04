const assert = require("node:assert/strict");
process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db");
const tenantRepository = require("../dist/repositories/tenant-repository");
const cognito = require("../dist/services/cognito");
const { advanceAccountLifecycle, purgeTenantDataPage } = require("../dist/repositories/account-lifecycle-repository");
const { resumeLifecycleDates } = require("../dist/repositories/billing-credit-repository");

const account = (updates = {}) => ({
  tenantId: "tenant-1", tenantName: "Market", ownerUserId: "owner", ownerUsername: "owner@example.com", planCode: "biashara", billingInterval: "monthly",
  trialStartedOn: "2026-07-01", trialEndsOn: "2026-07-14", paidThrough: null, cancelledAt: null, pendingPlanCode: null, pendingBillingInterval: null,
  termsVersion: "v1", privacyVersion: "v1", acceptedAt: "2026-07-01", acceptedBy: "owner", override: null, offer: null, creditBalanceKes: 0,
  workspaceState: "active", delinquentSince: null, archivedAt: null, deletionScheduledOn: null, suspendedAt: null, createdAt: "2026-07-01", updatedAt: "2026-07-01", ...updates,
});

async function main() {
  const commands = [];
  dynamoDB.send = async (command) => { commands.push(command); return {}; };
  const started = await advanceAccountLifecycle(account(), "2026-08-01");
  assert.equal(started.account.delinquentSince, "2026-08-01");
  assert.equal(started.notice.key, "defaulted");
  assert.equal(commands[0].constructor.name, "UpdateCommand");

  commands.length = 0;
  const warning = await advanceAccountLifecycle(account({ delinquentSince: "2026-08-01" }), "2026-08-24");
  assert.equal(warning.notice.key, "archive-7");
  assert.equal(commands.length, 0);

  const archived = await advanceAccountLifecycle(account({ delinquentSince: "2026-08-01" }), "2026-08-31");
  assert.equal(archived.account.workspaceState, "archived");
  assert.equal(archived.account.deletionScheduledOn, "2026-10-30");
  assert.equal(commands[0].constructor.name, "TransactWriteCommand");

  commands.length = 0;
  const suspended = await advanceAccountLifecycle(account({ delinquentSince: "2026-08-01", suspendedAt: "2026-08-10" }), "2026-09-20");
  assert.equal(suspended.notice, null);
  assert.equal(commands.length, 0, "suspension pauses archival and deletion transitions");

  const resumedDefault = resumeLifecycleDates(account({ delinquentSince: "2026-08-01", suspendedAt: "2026-08-10T08:00:00.000Z" }), "2026-08-20");
  assert.equal(resumedDefault.delinquentSince, "2026-08-11", "reactivation shifts the default timer by the suspended duration");
  const resumedArchive = resumeLifecycleDates(account({ workspaceState: "archived", archivedAt: "2026-08-05T08:00:00.000Z", deletionScheduledOn: "2026-10-04", suspendedAt: "2026-08-10T08:00:00.000Z" }), "2026-08-20");
  assert.equal(resumedArchive.deletionScheduledOn, "2026-10-14", "reactivation shifts the archive deletion deadline");

  commands.length = 0;
  dynamoDB.send = async (command) => { commands.push(command); return {}; };
  const deleting = await advanceAccountLifecycle(account({ workspaceState: "archived", delinquentSince: "2026-07-01", archivedAt: "2026-07-31T08:00:00.000Z", deletionScheduledOn: "2026-09-29" }), "2026-09-29");
  assert.equal(deleting.account.workspaceState, "deleting", "access is revoked before tenant records are purged");
  assert.equal(deleting.purge, true);
  assert.equal(commands[0].constructor.name, "TransactWriteCommand");

  commands.length = 0;
  tenantRepository.listTenantMemberships = async () => [];
  cognito.deleteCognitoUser = async () => {};
  dynamoDB.send = async (command) => {
    commands.push(command);
    if (command.constructor.name === "ScanCommand") return { Items: [
      { partitionKey: "TENANT#tenant-1", sortKey: "PROFILE", entityType: "tenant", tenantId: "tenant-1" },
      { partitionKey: "TENANT#tenant-1", sortKey: "STORE#one", entityType: "store", tenantId: "tenant-1" },
    ] };
    if (command.constructor.name === "BatchWriteCommand") return { UnprocessedItems: {} };
    if (command.constructor.name === "QueryCommand") return { Items: [] };
    if (command.constructor.name === "TransactWriteCommand") return {};
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const purged = await purgeTenantDataPage(account({ workspaceState: "archived" }));
  assert.equal(purged.complete, true);
  const batch = commands.find((command) => command.constructor.name === "BatchWriteCommand").input.RequestItems["test-table"];
  assert.equal(batch.length, 1, "operational records are deleted in bounded batches");
  assert.equal(batch[0].DeleteRequest.Key.sortKey, "STORE#one");
  const final = commands.filter((command) => command.constructor.name === "TransactWriteCommand").at(-1).input.TransactItems;
  assert.ok(final.some((item) => item.Delete?.Key.sortKey === "PROFILE"), "the live tenant profile is removed only after the scan completes");
  assert.ok(final.some((item) => item.Delete?.Key.partitionKey === "PLATFORM#BUSINESS#tenant-1"), "the platform directory entry is removed");
  assert.ok(final.some((item) => item.Put?.Item.entityType === "deleted_business_tombstone"), "a minimal retention tombstone is written");
}

main().then(() => console.log("account lifecycle tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
