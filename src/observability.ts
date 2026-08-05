import type { ApolloServerPlugin } from "@apollo/server";
import type { GraphQLError } from "graphql";
import type { GraphQLContext } from "./auth";

export type LogLevel = "info" | "warn" | "error";

export interface ObservabilityContext {
  requestId?: string;
  idempotencyKey?: string;
  lambdaRequestId?: string;
  operation?: string;
  rootField?: string;
  tenantId?: string;
  userId?: string;
  kind?: string;
  entityId?: string;
  notificationEvent?: string;
  providerMessageId?: string;
  recipientRef?: string;
  region?: string;
  resource?: string;
}

type LogFields = ObservabilityContext & {
  durationMs?: number;
  outcome?: "succeeded" | "rejected" | "failed";
  critical?: boolean;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  statusCode?: number;
};

const SAFE_FIELDS = new Set<keyof LogFields>([
  "requestId", "idempotencyKey", "lambdaRequestId", "operation", "rootField", "tenantId", "userId",
  "durationMs", "outcome", "critical", "errorName", "errorMessage",
  "errorStack", "kind", "statusCode", "entityId", "notificationEvent",
  "providerMessageId", "recipientRef", "region", "resource",
]);

const cleanText = (value: string, limit: number) =>
  value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);

const safeFields = (fields: LogFields): Record<string, string | number | boolean> => {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELDS.has(key as keyof LogFields) || value === undefined || value === null || value === "") continue;
    if (typeof value === "string") result[key] = cleanText(value, key === "errorStack" ? 4_000 : 500);
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "boolean") result[key] = value;
  }
  return result;
};

export const logEvent = (level: LogLevel, event: string, fields: LogFields = {}) => {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: process.env.SERVICE_NAME || "biasharakit-server",
    event: cleanText(event, 120),
    ...safeFields(fields),
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
};

const errorDetails = (error: unknown, includeStack: boolean): Pick<LogFields, "errorName" | "errorMessage" | "errorStack"> => {
  if (!(error instanceof Error)) return { errorName: "UnknownError" };
  return {
    errorName: error.name || "Error",
    ...(includeStack ? { errorMessage: cleanText(error.message, 500) } : {}),
    ...(includeStack && error.stack ? { errorStack: cleanText(error.stack, 4_000) } : {}),
  };
};

const expectedAwsErrors = new Set([
  "ConditionalCheckFailedException",
  "TransactionCanceledException",
]);

export const isUnexpectedError = (error: unknown): boolean => {
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError) return true;
  if (!(error instanceof Error)) return true;
  const awsError = error as Error & {
    $metadata?: { httpStatusCode?: number };
    $retryable?: unknown;
    CancellationReasons?: Array<{ Code?: string }>;
  };
  if (
    awsError.$retryable
    || (awsError.$metadata?.httpStatusCode && awsError.$metadata.httpStatusCode >= 500)
    || awsError.CancellationReasons?.some(({ Code }) => /(?:InternalServer|ProvisionedThroughput|Throttl)/i.test(Code ?? ""))
  ) return true;
  if (expectedAwsErrors.has(error.name)) return false;
  return /(?:AccessDenied|CredentialsProvider|InternalServer|MessageRejected|ResourceNotFound|ServiceUnavailable|Throttl|Timeout|Networking|UnrecognizedClient|ECONN|ENOTFOUND)/i.test(error.name);
};

export const logOperationFailure = (
  operation: string,
  error: unknown,
  context: ObservabilityContext & Pick<LogFields, "durationMs"> = {},
) => {
  const critical = isUnexpectedError(error);
  logEvent(critical ? "error" : "warn", "critical_operation_failed", {
    ...context,
    operation,
    outcome: critical ? "failed" : "rejected",
    critical,
    ...errorDetails(error, critical),
  });
};

export const observeCriticalOperation = async <T>(
  operation: string,
  context: ObservabilityContext,
  work: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    const result = await work();
    logEvent("info", "critical_operation_succeeded", {
      ...context,
      operation,
      outcome: "succeeded",
      critical: false,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logOperationFailure(operation, error, { ...context, durationMs: Date.now() - startedAt });
    throw error;
  }
};

const errorCode = (error: GraphQLError) => String(error.extensions?.code ?? "INTERNAL_SERVER_ERROR");
const expectedGraphqlCodes = new Set([
  "BAD_REQUEST", "BAD_USER_INPUT", "FORBIDDEN", "GRAPHQL_PARSE_FAILED",
  "GRAPHQL_VALIDATION_FAILED", "UNAUTHENTICATED",
]);

export const observabilityPlugin = (): ApolloServerPlugin<GraphQLContext> => ({
  async requestDidStart(requestContext) {
    const startedAt = Date.now();
    let operation = "anonymous";
    let rootField = "unknown";
    let errors: readonly GraphQLError[] = [];
    requestContext.contextValue.observability ??= {};
    return {
      async didResolveOperation(requestContext) {
        const root = requestContext.operation?.selectionSet.selections.find((selection) => selection.kind === "Field");
        rootField = root?.kind === "Field" ? root.name.value : "unknown";
        operation = requestContext.operationName || rootField;
        requestContext.contextValue.observability.operation = operation;
        requestContext.contextValue.observability.rootField = rootField;
      },
      async didEncounterErrors(requestContext) {
        errors = requestContext.errors;
      },
      async willSendResponse(requestContext) {
        const context = requestContext.contextValue;
        const unexpected = errors.find((error) =>
          !expectedGraphqlCodes.has(errorCode(error)) && isUnexpectedError(error.originalError ?? error),
        );
        const outcome = errors.length === 0 ? "succeeded" : unexpected ? "failed" : "rejected";
        logEvent(unexpected ? "error" : errors.length ? "warn" : "info", "graphql_request_completed", {
          ...context.observability,
          operation,
          rootField,
          tenantId: context.auth?.tenantId,
          userId: context.auth?.id,
          durationMs: Date.now() - startedAt,
          outcome,
          critical: false,
          ...(unexpected ? errorDetails(unexpected.originalError ?? unexpected, true) : errors[0] ? { errorName: errorCode(errors[0]) } : {}),
        });
        if (requestContext.response.body.kind === "single") {
          requestContext.response.body.singleResult.errors = requestContext.response.body.singleResult.errors?.map((error) => ({
            ...error,
            extensions: { ...error.extensions, requestId: context.observability.requestId },
          }));
        }
      },
    };
  },
});
