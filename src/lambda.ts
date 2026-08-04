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
    context: async ({ event }) => contextFromApiGatewayEvent(event),
  },
);

export const handler = async (...args: Parameters<typeof apolloHandler>) => {
  const [event] = args;
  if (event.requestContext.http.method === "OPTIONS") {
    // The explicit unauthenticated API Gateway preflight route uses this same
    // integration. Stop here so Apollo's CSRF protection never evaluates an
    // intentionally body-less browser preflight request. API Gateway adds the
    // configured Access-Control-Allow-* response headers.
    return { statusCode: 204, body: "" };
  }
  await ensureDatabaseReady();
  if (event.requestContext.http.method === "GET" && event.rawPath === "/public/billing-promotions") {
    let planCode;
    try {
      planCode = validatePlanCode(event.queryStringParameters?.planCode ?? "");
    } catch {
      return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Select a valid plan" }) };
    }
    try {
      const promotions = await listEligibleBillingPromotions("new_accounts", planCode);
      return {
        statusCode: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify(promotions.map(({ id, name, description, pricePercent, durationMonths, planCodes, startsOn, endsOn }) => ({ id, name, description, pricePercent, durationMonths, planCodes, startsOn, endsOn }))),
      };
    } catch (error) {
      console.error(JSON.stringify({ event: "public_billing_promotions_failed", errorName: error instanceof Error ? error.name : "UnknownError" }));
      return { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Promotions are temporarily unavailable" }) };
    }
  }
  return apolloHandler(...args);
};

export const billingHandler = async () => {
  validateBillingEnvironment();
  await ensureDatabaseReady();
  return processBillingReminders();
};
