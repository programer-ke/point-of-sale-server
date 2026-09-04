import { randomUUID } from "node:crypto";
import { BatchWriteCommand, DeleteCommand, PutCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { addBillingDays, billingStatus, type BillingAccount } from "../domain/billing";
import { deleteCognitoUser } from "../services/cognito";
import { accountKey, type BillingAudit } from "./billing-repository";
import { listTenantMemberships } from "./tenant-repository";
import { forfeitBillingCredits } from "./billing-credit-repository";

export type LifecycleNotice = { key: string; subject: string; message: string };

const dayDifference = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const auditItem = (audit: BillingAudit) => ({ partitionKey: `TENANT#${audit.tenantId}`, sortKey: `BILLING#AUDIT#${audit.createdAt}#${audit.id}`, entityType: "billing_audit", ...audit });

export const advanceAccountLifecycle = async (account: BillingAccount, today: string): Promise<{ account: BillingAccount; notice: LifecycleNotice | null; purge: boolean }> => {
  if (account.suspendedAt || (account.workspaceState ?? "active") === "deleted") return { account, notice: null, purge: false };
  if ((account.workspaceState ?? "active") === "deleting") return { account, notice: null, purge: true };
  const status = billingStatus(account, today);
  if (status !== "restricted" && status !== "cancelled") {
    if (account.delinquentSince || account.archivedAt || account.deletionScheduledOn || (account.workspaceState ?? "active") !== "active") {
      const now = new Date().toISOString();
      await dynamoDB.send(new UpdateCommand({ TableName: TABLE_NAME, Key: accountKey(account.tenantId), UpdateExpression: "SET workspaceState = :active, delinquentSince = :none, archivedAt = :none, deletionScheduledOn = :none, updatedAt = :now", ExpressionAttributeValues: { ":active": "active", ":none": null, ":now": now } }));
      return { account: { ...account, workspaceState: "active", delinquentSince: null, archivedAt: null, deletionScheduledOn: null, updatedAt: now }, notice: null, purge: false };
    }
    return { account, notice: null, purge: false };
  }
  if (!account.delinquentSince) {
    const now = new Date().toISOString();
    await dynamoDB.send(new UpdateCommand({ TableName: TABLE_NAME, Key: accountKey(account.tenantId), UpdateExpression: "SET delinquentSince = :today, workspaceState = :active, updatedAt = :now", ExpressionAttributeValues: { ":today": today, ":active": "active", ":now": now } }));
    return { account: { ...account, delinquentSince: today, workspaceState: "active", updatedAt: now }, notice: { key: "defaulted", subject: "BiasharaKit payment defaulted", message: "The payment grace period has ended. Administrators can still open Billing, reports, and exports. The workspace will be archived in 30 days unless the charge is settled." }, purge: false };
  }
  const defaultDays = dayDifference(account.delinquentSince, today);
  if ((account.workspaceState ?? "active") === "active" && defaultDays >= 30) {
    const now = new Date().toISOString(); const deletionScheduledOn = addBillingDays(today, 60);
    const audit: BillingAudit = { id: randomUUID(), tenantId: account.tenantId, action: "workspace_archived", actorId: "billing-worker", reason: "Payment remained defaulted for 30 days", before: JSON.stringify({ workspaceState: account.workspaceState ?? "active", delinquentSince: account.delinquentSince }), after: JSON.stringify({ workspaceState: "archived", archivedAt: now, deletionScheduledOn }), createdAt: now };
    await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: TABLE_NAME, Key: accountKey(account.tenantId), UpdateExpression: "SET workspaceState = :archived, archivedAt = :now, deletionScheduledOn = :deleteOn, updatedAt = :now", ConditionExpression: "delinquentSince = :since AND (attribute_not_exists(workspaceState) OR workspaceState = :active)", ExpressionAttributeValues: { ":archived": "archived", ":now": now, ":deleteOn": deletionScheduledOn, ":since": account.delinquentSince, ":active": "active" } } },
      { Put: { TableName: TABLE_NAME, Item: auditItem(audit), ConditionExpression: "attribute_not_exists(sortKey)" } },
    ] }));
    return { account: { ...account, workspaceState: "archived", archivedAt: now, deletionScheduledOn, updatedAt: now }, notice: { key: "archived", subject: "BiasharaKit workspace archived", message: `The workspace is archived. Administrators can use Billing to settle the account and restore access before ${deletionScheduledOn}; after that date operational data will be deleted.` }, purge: false };
  }
  if ((account.workspaceState ?? "active") === "active" && (defaultDays === 23 || defaultDays === 29)) return { account, notice: { key: `archive-${30 - defaultDays}`, subject: `BiasharaKit workspace archives in ${30 - defaultDays} day${30 - defaultDays === 1 ? "" : "s"}`, message: "Settle the subscription to keep the workspace. Export any records you need before archival." }, purge: false };
  if ((account.workspaceState ?? "active") === "archived" && account.deletionScheduledOn) {
    const remaining = dayDifference(today, account.deletionScheduledOn);
    if (remaining <= 0) {
      const now = new Date().toISOString();
      const audit: BillingAudit = { id: randomUUID(), tenantId: account.tenantId, action: "workspace_deletion_started", actorId: "billing-worker", reason: "The archived recovery period ended", before: JSON.stringify({ workspaceState: "archived", deletionScheduledOn: account.deletionScheduledOn }), after: JSON.stringify({ workspaceState: "deleting" }), createdAt: now };
      await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
        { Update: { TableName: TABLE_NAME, Key: accountKey(account.tenantId), UpdateExpression: "SET workspaceState = :deleting, updatedAt = :now", ConditionExpression: "workspaceState = :archived AND deletionScheduledOn = :scheduled", ExpressionAttributeValues: { ":deleting": "deleting", ":archived": "archived", ":scheduled": account.deletionScheduledOn, ":now": now } } },
        { Put: { TableName: TABLE_NAME, Item: auditItem(audit), ConditionExpression: "attribute_not_exists(sortKey)" } },
      ] }));
      return { account: { ...account, workspaceState: "deleting", updatedAt: now }, notice: { key: "deleting", subject: "BiasharaKit workspace deletion started", message: "The archived recovery period ended and workspace deletion has started. Required billing and audit records will be retained securely." }, purge: true };
    }
    if ([30, 7, 1].includes(remaining)) return { account, notice: { key: `delete-${remaining}`, subject: `BiasharaKit workspace deletes in ${remaining} day${remaining === 1 ? "" : "s"}`, message: "Settle the subscription from Billing before the deletion date to restore the workspace. Operational data cannot be recovered after deletion." }, purge: false };
  }
  return { account, notice: null, purge: false };
};

const retainedTypes = new Set(["billing_account", "billing_payment", "billing_document", "billing_audit", "billing_credit", "billing_credit_event", "billing_charge"]);

export const purgeTenantDataPage = async (account: BillingAccount) => {
  const memberships = await listTenantMemberships(account.tenantId);
  const membershipBatch = memberships.slice(0, 50);
  for (const membership of membershipBatch) {
    try { await deleteCognitoUser(membership.username); }
    catch (error) { if (!(error instanceof Error) || error.name !== "UserNotFoundException") throw error; }
    await dynamoDB.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { partitionKey: `IDENTITY#${membership.userId}`, sortKey: "MEMBERSHIP" } }));
  }
  if (memberships.length > membershipBatch.length) {
    return { complete: false, deleted: membershipBatch.length };
  }
  const cursor = (account as BillingAccount & { purgeCursor?: Record<string, unknown> | null }).purgeCursor ?? undefined;
  const response = await dynamoDB.send(new ScanCommand({
    TableName: TABLE_NAME,
    ProjectionExpression: "partitionKey, sortKey, entityType, tenantId",
    FilterExpression: "tenantId = :tenantId OR begins_with(partitionKey, :prefix)",
    ExpressionAttributeValues: { ":tenantId": account.tenantId, ":prefix": `TENANT#${account.tenantId}` },
    ExclusiveStartKey: cursor,
    Limit: 200,
  }));
  const deletable = (response.Items ?? []).filter((item) => !retainedTypes.has(String(item.entityType ?? "")) && !(item.partitionKey === `TENANT#${account.tenantId}` && item.sortKey === "PROFILE"));
  for (let index = 0; index < deletable.length; index += 25) {
    let pending = deletable.slice(index, index + 25).map((item) => ({ DeleteRequest: { Key: { partitionKey: item.partitionKey, sortKey: item.sortKey } } }));
    for (let attempt = 0; pending.length > 0 && attempt < 5; attempt += 1) {
      const batch = await dynamoDB.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: pending } }));
      pending = (batch.UnprocessedItems?.[TABLE_NAME] ?? []).flatMap((item) => item.DeleteRequest?.Key ? [{ DeleteRequest: { Key: { partitionKey: item.DeleteRequest.Key.partitionKey, sortKey: item.DeleteRequest.Key.sortKey } } }] : []);
    }
    if (pending.length > 0) throw new Error(`Failed to purge ${pending.length} tenant record(s) after retries`);
  }
  const now = new Date().toISOString();
  if (response.LastEvaluatedKey) {
    await dynamoDB.send(new UpdateCommand({ TableName: TABLE_NAME, Key: accountKey(account.tenantId), UpdateExpression: "SET workspaceState = :deleting, purgeCursor = :cursor, updatedAt = :now", ExpressionAttributeValues: { ":deleting": "deleting", ":cursor": response.LastEvaluatedKey, ":now": now } }));
    return { complete: false, deleted: deletable.length };
  }
  await forfeitBillingCredits(account.tenantId);
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Update: { TableName: TABLE_NAME, Key: accountKey(account.tenantId), UpdateExpression: "SET workspaceState = :deleted, tenantName = :deletedName, ownerUserId = :redacted, ownerUsername = :redacted, billingContactName = :redacted, billingContactEmail = :redactedEmail, billingContactPhone = :empty, creditBalanceKes = :zero, updatedAt = :now REMOVE purgeCursor", ExpressionAttributeValues: { ":deleted": "deleted", ":deletedName": `Deleted business ${account.tenantId.slice(0, 8)}`, ":redacted": "deleted", ":redactedEmail": `deleted+${account.tenantId}@invalid.local`, ":empty": "", ":zero": 0, ":now": now } } },
    { Delete: { TableName: TABLE_NAME, Key: { partitionKey: `TENANT#${account.tenantId}`, sortKey: "PROFILE" } } },
    { Delete: { TableName: TABLE_NAME, Key: { partitionKey: `PLATFORM#BUSINESS#${account.tenantId}`, sortKey: "SUMMARY" } } },
    { Put: { TableName: TABLE_NAME, Item: { partitionKey: `PLATFORM#DELETED_BUSINESS#${account.tenantId}`, sortKey: "TOMBSTONE", entityType: "deleted_business_tombstone", tenantId: account.tenantId, deletedAt: now, billingRecordsRetainUntil: addBillingDays(now.slice(0, 10), 5 * 366) }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return { complete: true, deleted: deletable.length };
};
