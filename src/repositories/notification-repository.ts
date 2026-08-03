import { createHash } from "node:crypto";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";

export interface NotificationRecord {
  id: string;
  type: "stock_requisition_created" | "stock_requisition_decided" | "billing";
  title: string;
  message: string;
  actionPath: string;
  readAt?: string | null;
  createdAt: string;
}

type NotificationInput = Omit<NotificationRecord, "id" | "readAt" | "createdAt"> & {
  eventKey: string;
};

const notificationId = (userId: string, eventKey: string) =>
  createHash("sha256").update(`${userId}:${eventKey}`).digest("hex").slice(0, 32);
const notificationKey = (tenantId: string, userId: string, id: string) => ({
  partitionKey: `TENANT#${tenantId}#NOTIFICATION#${userId}#${id}`,
  sortKey: "PROFILE",
});
const notificationCollection = (tenantId: string, userId: string) =>
  `TENANT#${tenantId}#USER#${userId}#NOTIFICATION`;

const clean = (item?: Record<string, unknown>): NotificationRecord | null => {
  if (!item) return null;
  const {
    partitionKey: _partitionKey,
    sortKey: _sortKey,
    accessPartition: _accessPartition,
    accessSort: _accessSort,
    entityType: _entityType,
    tenantId: _tenantId,
    userId: _userId,
    expiresAt: _expiresAt,
    ...notification
  } = item;
  return notification as unknown as NotificationRecord;
};

export const createNotification = async (
  tenantId: string,
  userId: string,
  input: NotificationInput,
) => {
  const id = notificationId(userId, input.eventKey);
  const createdAt = new Date().toISOString();
  const notification: NotificationRecord = {
    id,
    type: input.type,
    title: input.title,
    message: input.message,
    actionPath: input.actionPath,
    readAt: null,
    createdAt,
  };
  try {
    await dynamoDB.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...notificationKey(tenantId, userId, id),
        accessPartition: notificationCollection(tenantId, userId),
        accessSort: `${createdAt}#${id}`,
        entityType: "notification",
        tenantId,
        userId,
        ...notification,
        expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
      },
      ConditionExpression: "attribute_not_exists(partitionKey)",
    }));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
  }
  return notification;
};

export const listNotifications = async (tenantId: string, userId: string, limit = 20) => {
  const response = await dynamoDB.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: "AccessIndex",
    KeyConditionExpression: "accessPartition = :partition",
    ExpressionAttributeValues: { ":partition": notificationCollection(tenantId, userId) },
    ScanIndexForward: false,
    Limit: Math.min(Math.max(limit, 1), 50),
  }));
  return (response.Items ?? []).map((item) => clean(item)!).filter(Boolean);
};

export const markNotificationRead = async (tenantId: string, userId: string, id: string) => {
  const readAt = new Date().toISOString();
  const response = await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: notificationKey(tenantId, userId, id),
    UpdateExpression: "SET readAt = :readAt",
    ConditionExpression: "attribute_exists(partitionKey) AND tenantId = :tenantId AND userId = :userId",
    ExpressionAttributeValues: { ":readAt": readAt, ":tenantId": tenantId, ":userId": userId },
    ReturnValues: "ALL_NEW",
  }));
  const notification = clean(response.Attributes);
  if (!notification) throw new Error("Notification not found");
  return notification;
};

export const markAllNotificationsRead = async (tenantId: string, userId: string) => {
  const items: Array<{ id: string }> = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: "accessPartition = :partition",
      FilterExpression: "attribute_not_exists(readAt) OR readAt = :empty",
      ExpressionAttributeValues: {
        ":partition": notificationCollection(tenantId, userId),
        ":empty": null,
      },
      ExclusiveStartKey: cursor,
    }));
    items.push(...(response.Items ?? []).map((item) => ({ id: String(item.id) })));
    cursor = response.LastEvaluatedKey;
  } while (cursor);

  const readAt = new Date().toISOString();
  for (let index = 0; index < items.length; index += 20) {
    await Promise.all(items.slice(index, index + 20).map(({ id }) =>
      dynamoDB.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: notificationKey(tenantId, userId, id),
        UpdateExpression: "SET readAt = :readAt",
        ConditionExpression: "tenantId = :tenantId AND userId = :userId",
        ExpressionAttributeValues: { ":readAt": readAt, ":tenantId": tenantId, ":userId": userId },
      })),
    ));
  }
  return true;
};
