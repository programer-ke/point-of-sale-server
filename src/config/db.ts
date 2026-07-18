import {
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

const awsConfig = {
  region: process.env.AWS_REGION || "us-east-1",
};

export const dynamoDBClient = new DynamoDBClient(awsConfig);
export const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

export const s3 = new S3Client(awsConfig);

const configuredTableName = process.env.AWS_DYNAMODB_TABLE;

if (process.env.NODE_ENV === "production" && !configuredTableName) {
  throw new Error("AWS_DYNAMODB_TABLE is required in production");
}

export const TABLE_NAME = configuredTableName || "pos_system";

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
        "AWS credentials are invalid or missing. Check the configured AWS credential provider.",
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
  verifyAwsConnection,
};
