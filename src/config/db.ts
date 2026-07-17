import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  type CreateTableCommandInput,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

const awsConfig = {
  region: process.env.AWS_REGION || "us-east-1",
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
};

export const dynamoDBClient = new DynamoDBClient(awsConfig);
export const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

export const s3 = new S3Client(awsConfig);

// SINGLE TABLE NAME
export const TABLE_NAME = process.env.AWS_DYNAMODB_TABLE || "pos_system";

// Key helpers for building PK and SK
export const Keys = {
  // User keys
  user: (userId: string) => ({
    PK: `USER#${userId}`,
    SK: `PROFILE#${userId}`,
  }),
  userByEmail: (email: string) => ({
    PK: `USER#email`,
    SK: `EMAIL#${email}`,
  }),

  // Staff keys (staff are also users but with role="staff")
  staff: (staffId: string) => ({
    PK: `STAFF#${staffId}`,
    SK: `PROFILE#${staffId}`,
  }),

  // Product keys
  product: (productId: string) => ({
    PK: `PRODUCT#${productId}`,
    SK: `PRODUCT#${productId}`,
  }),
  productBySku: (sku: string) => ({
    PK: `PRODUCT#sku`,
    SK: `SKU#${sku}`,
  }),

  // Category keys
  category: (categoryId: string) => ({
    PK: `CATEGORY#${categoryId}`,
    SK: `CATEGORY#${categoryId}`,
  }),

  // Order keys
  order: (orderId: string) => ({
    PK: `ORDER#${orderId}`,
    SK: `ORDER#${orderId}`,
  }),
  orderByCustomer: (customerId: string, orderId: string) => ({
    PK: `CUSTOMER#${customerId}`,
    SK: `ORDER#${orderId}`,
  }),
  orderByDate: (date: string, orderId: string) => ({
    PK: `ORDER#date`,
    SK: `DATE#${date}#ORDER#${orderId}`,
  }),

  // Customer keys
  customer: (customerId: string) => ({
    PK: `CUSTOMER#${customerId}`,
    SK: `PROFILE#${customerId}`,
  }),
  customerByEmail: (email: string) => ({
    PK: `CUSTOMER#email`,
    SK: `EMAIL#${email}`,
  }),
  customerByPhone: (phone: string) => ({
    PK: `CUSTOMER#phone`,
    SK: `PHONE#${phone}`,
  }),

  // Inventory keys
  inventory: (productId: string, location: string) => ({
    PK: `INVENTORY#${productId}`,
    SK: `LOCATION#${location}`,
  }),
  inventoryByLocation: (location: string, productId: string) => ({
    PK: `LOCATION#${location}`,
    SK: `PRODUCT#${productId}`,
  }),

  // Activity/Log keys
  activity: (entityId: string, timestamp: string) => ({
    PK: `ACTIVITY#${entityId}`,
    SK: `TIMESTAMP#${timestamp}`,
  }),

  // Tenant/Settings keys
  tenant: (tenantId: string) => ({
    PK: `TENANT#${tenantId}`,
    SK: `SETTINGS#${tenantId}`,
  }),
};

// Single Table Schema
export const createSingleTable = async () => {
  const params: CreateTableCommandInput = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" }, // Partition Key
      { AttributeName: "SK", KeyType: "RANGE" }, // Sort Key
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "GSI1PK", AttributeType: "S" },
      { AttributeName: "GSI1SK", AttributeType: "S" },
      { AttributeName: "GSI2PK", AttributeType: "S" },
      { AttributeName: "GSI2SK", AttributeType: "S" },
      { AttributeName: "email", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      // GSI1: For querying by email, status, etc.
      {
        IndexName: "GSI1",
        KeySchema: [
          { AttributeName: "GSI1PK", KeyType: "HASH" },
          { AttributeName: "GSI1SK", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "ALL",
        },
      },
      // GSI2: For time-based queries (orders by date, etc.)
      {
        IndexName: "GSI2",
        KeySchema: [
          { AttributeName: "GSI2PK", KeyType: "HASH" },
          { AttributeName: "GSI2SK", KeyType: "RANGE" },
        ],
        Projection: {
          ProjectionType: "ALL",
        },
      },
      // GSI3: For email lookups (users & customers)
      {
        IndexName: "EmailIndex",
        KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
        Projection: {
          ProjectionType: "ALL",
        },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  };

  try {
    await dynamoDBClient.send(new CreateTableCommand(params));
    console.log(`✅ Created single table: ${TABLE_NAME}`);
  } catch (error: any) {
    if (error.name === "ResourceInUseException") {
      console.log(`ℹ️ Table ${TABLE_NAME} already exists`);
    } else {
      console.error(`❌ Failed to create ${TABLE_NAME}:`, error);
      throw error;
    }
  }
};

// Initialize Database
export const initializeDatabase = async () => {
  if (process.env.NODE_ENV === "development") {
    await createSingleTable();
    console.log("📊 Single table ready for use");
  }
};

export const verifyAwsConnection = async () => {
  const region = process.env.AWS_REGION || "us-east-1";

  try {
    const result = await dynamoDBClient.send(
      new DescribeTableCommand({ TableName: TABLE_NAME }),
    );

    console.log(
      `AWS DynamoDB connected: table "${TABLE_NAME}" is ${result.Table?.TableStatus} in ${region}`,
    );

    return true;
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      console.warn(
        `AWS credentials worked, but DynamoDB table "${TABLE_NAME}" was not found in ${region}`,
      );
      return false;
    }

    if (
      error.name === "UnrecognizedClientException" ||
      error.name === "InvalidSignatureException" ||
      error.name === "CredentialsProviderError"
    ) {
      console.error(
        "AWS credentials are invalid or missing. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env",
      );
      return false;
    }

    if (error.name === "AccessDeniedException") {
      console.error(
        `AWS credentials were accepted, but they do not have permission to describe DynamoDB table "${TABLE_NAME}"`,
      );
      return false;
    }

    console.error("AWS DynamoDB connection check failed:", error);
    return false;
  }
};

export default {
  dynamoDB,
  dynamoDBClient,
  s3,
  TABLE_NAME,
  Keys,
  initializeDatabase,
  verifyAwsConnection,
};
