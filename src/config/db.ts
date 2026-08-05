import {
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";
import { logEvent } from "../observability";

dotenv.config({ quiet: true });

const awsConfig = {
  region: process.env.AWS_REGION || "us-east-1",
};

export const dynamoDBClient = new DynamoDBClient(awsConfig);
export const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient);

const configuredTableName = process.env.AWS_DYNAMODB_TABLE;

if (process.env.NODE_ENV === "production" && !configuredTableName) {
  throw new Error("AWS_DYNAMODB_TABLE is required in production");
}

export const TABLE_NAME = configuredTableName || "pos_system";

export const verifyAwsConnection = async () => {
  const region = process.env.AWS_REGION || "us-east-1";

  try {
    const result = await dynamoDBClient.send(
      new DescribeTableCommand({ TableName: TABLE_NAME }),
    );

    logEvent("info", "dynamodb_connection_ready", { resource: TABLE_NAME, region, kind: result.Table?.TableStatus });

    return true;
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      logEvent("warn", "dynamodb_table_not_found", { resource: TABLE_NAME, region, errorName: error.name });
      return false;
    }

    if (
      error.name === "UnrecognizedClientException" ||
      error.name === "InvalidSignatureException" ||
      error.name === "CredentialsProviderError"
    ) {
      logEvent("error", "dynamodb_credentials_invalid", { resource: TABLE_NAME, region, errorName: error.name });
      return false;
    }

    if (error.name === "AccessDeniedException") {
      logEvent("error", "dynamodb_access_denied", { resource: TABLE_NAME, region, errorName: error.name });
      return false;
    }

    logEvent("error", "dynamodb_connection_failed", { resource: TABLE_NAME, region, errorName: error instanceof Error ? error.name : "UnknownError" });
    return false;
  }
};

export default {
  dynamoDB,
  dynamoDBClient,
  TABLE_NAME,
  verifyAwsConnection,
};
