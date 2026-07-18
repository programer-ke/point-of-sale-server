import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import type { UserRole } from "../auth";

export interface TenantMembership {
  userId: string;
  username: string;
  tenantId: string;
  tenantName: string;
  roles: UserRole[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantRecord {
  id: string;
  name: string;
  ownerUserId: string;
  status: "active";
  createdAt: string;
  updatedAt: string;
}

const membershipKey = (userId: string) => ({ partitionKey: `IDENTITY#${userId}`, sortKey: "MEMBERSHIP" });
const tenantKey = (tenantId: string) => ({ partitionKey: `TENANT#${tenantId}`, sortKey: "PROFILE" });
const memberIndex = (tenantId: string, userId: string) => ({
  accessPartition: `TENANT#${tenantId}#MEMBER`,
  accessSort: userId,
});
const clean = <T>(item?: Record<string, unknown>): T | null => {
  if (!item) return null;
  const { partitionKey: _partitionKey, sortKey: _sortKey, accessPartition: _accessPartition, accessSort: _accessSort, entityType: _type, ...value } = item;
  return value as T;
};

export const getTenantMembership = async (userId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: membershipKey(userId) }));
  return clean<TenantMembership>(response.Item);
};

export const getTenantRecord = async (tenantId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: tenantKey(tenantId) }));
  return clean<TenantRecord>(response.Item);
};

export const listTenantMemberships = async (tenantId: string) => {
  const response = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "AccessIndex",
    KeyConditionExpression: "accessPartition = :partition",
    ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}#MEMBER` },
  }));
  return (response.Items ?? []).map((item) => clean<TenantMembership>(item)!);
};

export const createTenant = async (input: { name: string; ownerUserId: string; ownerUsername: string }) => {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) throw new Error("Business name must be between 2 and 100 characters");
  const existing = await getTenantMembership(input.ownerUserId);
  if (existing) throw new Error("This account already belongs to a business");
  const id = randomUUID();
  const now = new Date().toISOString();
  const tenant: TenantRecord = { id, name, ownerUserId: input.ownerUserId, status: "active", createdAt: now, updatedAt: now };
  const membership: TenantMembership = {
    userId: input.ownerUserId,
    username: input.ownerUsername,
    tenantId: id,
    tenantName: name,
    roles: ["admin", "staff"],
    createdAt: now,
    updatedAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...tenantKey(id), entityType: "tenant", ...tenant }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...membershipKey(input.ownerUserId), ...memberIndex(id, input.ownerUserId), entityType: "tenant_membership", ...membership }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return { tenant, membership };
};

export const putTenantMembership = async (input: Omit<TenantMembership, "createdAt" | "updatedAt">) => {
  const current = await getTenantMembership(input.userId);
  if (current && current.tenantId !== input.tenantId) throw new Error("This Cognito user already belongs to another business");
  const now = new Date().toISOString();
  const membership: TenantMembership = { ...input, createdAt: current?.createdAt ?? now, updatedAt: now };
  await dynamoDB.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...membershipKey(input.userId), ...memberIndex(input.tenantId, input.userId), entityType: "tenant_membership", ...membership },
  }));
  return membership;
};

export const updateTenantMembershipRoles = async (userId: string, tenantId: string, roles: UserRole[]) => {
  const current = await getTenantMembership(userId);
  if (!current || current.tenantId !== tenantId) throw new Error("Staff user was not found in this business");
  return putTenantMembership({ ...current, roles });
};

export const deleteTenantMembership = async (userId: string, tenantId: string) => {
  const current = await getTenantMembership(userId);
  if (!current || current.tenantId !== tenantId) throw new Error("Staff user was not found in this business");
  await dynamoDB.send(new DeleteCommand({ TableName: TABLE_NAME, Key: membershipKey(userId) }));
};
