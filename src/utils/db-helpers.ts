import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME, Keys } from "../config/db";
import { randomUUID } from "crypto";

import { ListTablesCommand } from "@aws-sdk/client-dynamodb";

export const testConnection = async (): Promise<boolean> => {
  try {
    const command = new ListTablesCommand({ Limit: 1 });
    await dynamoDB.send(command);
    console.log("✅ DynamoDB connection successful!");
    return true;
  } catch (error) {
    console.error("❌ DynamoDB connection failed:", error);
    return false;
  }
};

// Generic function to get an item by PK and SK
export const getItem = async (PK: string, SK: string) => {
  const params = {
    TableName: TABLE_NAME,
    Key: { PK, SK },
  };

  const result = await dynamoDB.send(new GetCommand(params));
  return result.Item;
};

// Generic function to put an item
export const putItem = async (item: any) => {
  const params = {
    TableName: TABLE_NAME,
    Item: item,
  };

  await dynamoDB.send(new PutCommand(params));
  return item;
};

// Generic function to query items by PK
export const queryItems = async (PK: string, SK?: string) => {
  const params: any = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "#PK = :pk",
    ExpressionAttributeNames: {
      "#PK": "PK",
    },
    ExpressionAttributeValues: {
      ":pk": PK,
    },
  };

  if (SK) {
    params.KeyConditionExpression += " AND #SK = :sk";
    params.ExpressionAttributeNames!["#SK"] = "SK";
    params.ExpressionAttributeValues[":sk"] = SK;
  }

  const result = await dynamoDB.send(new QueryCommand(params));
  return result.Items;
};

// Generic function to query using GSI
export const queryGSI = async (indexName: string, pk: string, sk?: string) => {
  const indexKeys = getIndexKeys(indexName);
  const params: any = {
    TableName: TABLE_NAME,
    IndexName: indexName,
    KeyConditionExpression: "#PK = :pk",
    ExpressionAttributeNames: {
      "#PK": indexKeys.pk,
    },
    ExpressionAttributeValues: {
      ":pk": pk,
    },
  };

  if (sk) {
    params.KeyConditionExpression += " AND #SK = :sk";
    params.ExpressionAttributeNames!["#SK"] = indexKeys.sk;
    params.ExpressionAttributeValues[":sk"] = sk;
  }

  const result = await dynamoDB.send(new QueryCommand(params));
  return result.Items;
};

// Generic function to query using GSI with an SK prefix
export const queryGSIBySortKeyPrefix = async (
  indexName: string,
  pk: string,
  skPrefix: string,
) => {
  const indexKeys = getIndexKeys(indexName);
  const params = {
    TableName: TABLE_NAME,
    IndexName: indexName,
    KeyConditionExpression: "#PK = :pk AND begins_with(#SK, :skPrefix)",
    ExpressionAttributeNames: {
      "#PK": indexKeys.pk,
      "#SK": indexKeys.sk,
    },
    ExpressionAttributeValues: {
      ":pk": pk,
      ":skPrefix": skPrefix,
    },
  };

  const result = await dynamoDB.send(new QueryCommand(params));
  return result.Items;
};

const getIndexKeys = (indexName: string) => {
  if (indexName === "GSI1") {
    return { pk: "GSI1PK", sk: "GSI1SK" };
  }

  if (indexName === "GSI2") {
    return { pk: "GSI2PK", sk: "GSI2SK" };
  }

  return { pk: "PK", sk: "SK" };
};

// Create user
export const createUser = async (userData: any) => {
  const userId = randomUUID();
  const now = new Date().toISOString();

  const item = {
    PK: Keys.user(userId).PK,
    SK: Keys.user(userId).SK,
    GSI1PK: `USER#role`,
    GSI1SK: `${userData.role}#${userId}`,
    GSI2PK: `TENANT#${userData.tenantId}`,
    GSI2SK: `USER#${userId}`,
    entityType: "user",
    id: userId,
    ...userData,
    createdAt: now,
    updatedAt: now,
  };

  // Also store by email for lookups
  const emailItem = {
    PK: Keys.userByEmail(userData.email).PK,
    SK: Keys.userByEmail(userData.email).SK,
    entityType: "user_email_index",
    userId: userId,
    createdAt: now,
  };

  const params = {
    TransactItems: [
      { Put: { TableName: TABLE_NAME, Item: item } },
      { Put: { TableName: TABLE_NAME, Item: emailItem } },
    ],
  };

  await dynamoDB.send(new TransactWriteCommand(params));
  return item;
};

// Create product
export const createProduct = async (productData: any) => {
  const productId = randomUUID();
  const now = new Date().toISOString();

  const item = {
    PK: Keys.product(productId).PK,
    SK: Keys.product(productId).SK,
    GSI1PK: `PRODUCT#category`,
    GSI1SK: `${productData.category}#${productId}`,
    GSI2PK: `TENANT#${productData.tenantId}`,
    GSI2SK: `PRODUCT#${productId}`,
    entityType: "product",
    id: productId,
    ...productData,
    createdAt: now,
    updatedAt: now,
  };

  // Store by SKU
  const skuItem = {
    PK: Keys.productBySku(productData.sku).PK,
    SK: Keys.productBySku(productData.sku).SK,
    entityType: "product_sku_index",
    productId: productId,
    createdAt: now,
  };

  const params = {
    TransactItems: [
      { Put: { TableName: TABLE_NAME, Item: item } },
      { Put: { TableName: TABLE_NAME, Item: skuItem } },
    ],
  };

  await dynamoDB.send(new TransactWriteCommand(params));
  return item;
};

// Create order
export const createOrder = async (orderData: any) => {
  const orderId = randomUUID();
  const now = new Date().toISOString();
  const dateKey = now.split("T")[0]; // YYYY-MM-DD

  const item = {
    PK: Keys.order(orderId).PK,
    SK: Keys.order(orderId).SK,
    GSI1PK: `ORDER#status`,
    GSI1SK: `${orderData.status}#${orderId}`,
    GSI2PK: Keys.orderByDate(dateKey, orderId).PK,
    GSI2SK: Keys.orderByDate(dateKey, orderId).SK,
    entityType: "order",
    id: orderId,
    ...orderData,
    createdAt: now,
    updatedAt: now,
  };

  // If customer exists, link order to customer
  if (orderData.customerId) {
    const customerOrderItem = {
      PK: Keys.orderByCustomer(orderData.customerId, orderId).PK,
      SK: Keys.orderByCustomer(orderData.customerId, orderId).SK,
      entityType: "customer_order_link",
      orderId: orderId,
      createdAt: now,
    };

    const params = {
      TransactItems: [
        { Put: { TableName: TABLE_NAME, Item: item } },
        { Put: { TableName: TABLE_NAME, Item: customerOrderItem } },
      ],
    };

    await dynamoDB.send(new TransactWriteCommand(params));
  } else {
    await putItem(item);
  }

  return item;
};

// Helper to get user by email
export const getUserByEmail = async (email: string) => {
  const result = await getItem(
    Keys.userByEmail(email).PK,
    Keys.userByEmail(email).SK,
  );

  if (!result) return null;

  const user = await getItem(
    Keys.user(result.userId).PK,
    Keys.user(result.userId).SK,
  );

  return user;
};

// Helper to get users by role
export const getUsersByRole = async (role: "admin" | "staff" | "manager") => {
  const result = await queryGSIBySortKeyPrefix("GSI1", "USER#role", `${role}#`);
  return result?.filter((item) => item.entityType === "user") || [];
};

// Helper to get admins and staff
export const getAdminsAndStaff = async () => {
  const [admins, staff] = await Promise.all([
    getUsersByRole("admin"),
    getUsersByRole("staff"),
  ]);

  return [...admins, ...staff];
};

// Helper to get all products by tenant
export const getProductsByTenant = async (tenantId: string) => {
  const result = await queryGSI("GSI2", `TENANT#${tenantId}`, undefined);

  return result?.filter((item) => item.entityType === "product") || [];
};

// Helper to get orders by status
export const getOrdersByStatus = async (status: string) => {
  const result = await queryGSI("GSI1", `ORDER#status`, `${status}#`);
  return result || [];
};

export default {
  getItem,
  putItem,
  queryItems,
  queryGSI,
  queryGSIBySortKeyPrefix,
  createUser,
  createProduct,
  createOrder,
  getUserByEmail,
  getUsersByRole,
  getAdminsAndStaff,
  getProductsByTenant,
  getOrdersByStatus,
};
