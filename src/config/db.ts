import {
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";

dotenv.config();

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
  TABLE_NAME,
  verifyAwsConnection,
};
