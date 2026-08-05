import {
  handlers,
  startServerAndCreateLambdaHandler,
} from "@as-integrations/aws-lambda";
import { createApolloServer } from "./app";
import { TABLE_NAME, verifyAwsConnection } from "./config/db";
import { contextFromApiGatewayEvent } from "./auth";
import { processBillingReminders } from "./services/billing-worker";
import { validateBillingEnvironment } from "./repositories/billing-repository";
import { validatePlanCode } from "./domain/billing";
import { listEligibleBillingPromotions } from "./repositories/billing-promotion-repository";
import { validateBillingInterval } from "./domain/billing";
import { handleMpesaCallback } from "./repositories/mpesa-repository";
import { finalizeIntentPayment } from "./services/mpesa-checkout";
import { logEvent, observeCriticalOperation } from "./observability";

let databaseReady: Promise<void> | undefined;
const ensureDatabaseReady = () => {
  databaseReady ??= verifyAwsConnection().then((isReady) => {
    if (!isReady) {
      throw new Error(`DynamoDB table "${TABLE_NAME}" is not available`);
    }
  });
  return databaseReady;
};

const apolloHandler = startServerAndCreateLambdaHandler(
  createApolloServer(),
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event, context }) => contextFromApiGatewayEvent(event, {
      requestId: event.requestContext.requestId,
      lambdaRequestId: context.awsRequestId,
    }),
  },
);

export const handler = async (...args: Parameters<typeof apolloHandler>) => {
  const [event, lambdaContext] = args;
  const requestId = event.requestContext.requestId;
  const observability = { requestId, lambdaRequestId: lambdaContext.awsRequestId };
  const withRequestId = <T extends object>(response: T): T & { headers: Record<string, string | number | boolean> } => ({
    ...response,
    headers: { ...((response as { headers?: Record<string, string | number | boolean> }).headers), "x-request-id": requestId },
  });
  if (event.requestContext.http.method === "OPTIONS") {
    // The explicit unauthenticated API Gateway preflight route uses this same
    // integration. Stop here so Apollo's CSRF protection never evaluates an
    // intentionally body-less browser preflight request. API Gateway adds the
    // configured Access-Control-Allow-* response headers.
    return withRequestId({ statusCode: 204, body: "" });
  }
  await ensureDatabaseReady();
  const callbackMatch = event.requestContext.http.method === "POST" ? event.rawPath.match(/^\/public\/mpesa\/callback\/([A-Za-z0-9_-]{40,64})\/(stk|validation|confirmation)$/) : null;
  if (callbackMatch) {
    const headers = { "content-type": "application/json", "cache-control": "no-store" };
    try {
      const payload = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : {};
      const result = await observeCriticalOperation("mpesa_callback", { ...observability, kind: callbackMatch[2] }, () =>
        handleMpesaCallback(callbackMatch[1], callbackMatch[2] as "stk" | "validation" | "confirmation", payload));
      if (result.payment && result.intent?.status === "paid" && result.payment.status === "unassigned") {
        await observeCriticalOperation("mpesa_sale_finalization", observability, () => finalizeIntentPayment(result.intent!, result.payment!));
      }
      return withRequestId({ statusCode: 200, headers, body: JSON.stringify(callbackMatch[2] === "validation" ? { ResultCode: 0, ResultDesc: "Accepted" } : { ResultCode: 0, ResultDesc: "Received" }) });
    } catch (error) {
      return withRequestId({ statusCode: error instanceof SyntaxError ? 400 : 404, headers, body: JSON.stringify({ ResultCode: 1, ResultDesc: "Unable to process callback" }) });
    }
  }
  if (event.requestContext.http.method === "GET" && event.rawPath === "/public/billing-promotions") {
    let planCode; let billingInterval;
    try {
      planCode = validatePlanCode(event.queryStringParameters?.planCode ?? "");
      billingInterval = validateBillingInterval(event.queryStringParameters?.billingInterval ?? "monthly");
    } catch {
      return withRequestId({ statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Select a valid plan" }) });
    }
    try {
      const promotions = await listEligibleBillingPromotions("new_accounts", planCode, billingInterval);
      return withRequestId({
        statusCode: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify(promotions.map(({ id, name, description, pricePercent, durationMonths, planCodes, billingIntervals, startsOn, endsOn }) => ({ id, name, description, pricePercent, durationMonths, planCodes, billingIntervals, startsOn, endsOn }))),
      });
    } catch (error) {
      logEvent("error", "public_billing_promotions_failed", { ...observability, errorName: error instanceof Error ? error.name : "UnknownError" });
      return withRequestId({ statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Promotions are temporarily unavailable" }) });
    }
  }
  const response = await apolloHandler(...args);
  if (!response) throw new Error("Apollo Lambda handler returned no response");
  return withRequestId(response);
};

export const billingHandler = async (_event: unknown, context: { awsRequestId?: string } = {}) => {
  validateBillingEnvironment();
  await ensureDatabaseReady();
  return observeCriticalOperation("billing_worker", { lambdaRequestId: context.awsRequestId }, () => processBillingReminders());
};
