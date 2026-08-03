import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";

export type GeneratedCodeKind = "CATEGORY" | "EMPLOYEE" | "PRODUCT" | "STORE" | "SUPPLIER";

const prefixes: Record<GeneratedCodeKind, string> = {
  CATEGORY: "CAT",
  EMPLOYEE: "EMP",
  PRODUCT: "PRD",
  STORE: "STR",
  SUPPLIER: "SUP",
};

/** Allocate a short, human-readable code that is unique within a tenant and entity kind. */
export const nextTenantCode = async (tenantId: string, kind: GeneratedCodeKind) => {
  const response = await dynamoDB.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      partitionKey: `TENANT#${tenantId}#SEQUENCE#${kind}`,
      sortKey: "COUNTER",
    },
    UpdateExpression: "SET entityType = :entityType, tenantId = :tenantId ADD #value :increment",
    ExpressionAttributeNames: { "#value": "value" },
    ExpressionAttributeValues: {
      ":entityType": "code_sequence",
      ":tenantId": tenantId,
      ":increment": 1,
    },
    ReturnValues: "UPDATED_NEW",
  }));
  const value = response.Attributes?.value;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Unable to generate ${kind.toLowerCase()} code`);
  }
  return `${prefixes[kind]}-${String(value).padStart(6, "0")}`;
};
