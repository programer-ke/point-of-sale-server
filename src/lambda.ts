import {
  handlers,
  startServerAndCreateLambdaHandler,
} from "@as-integrations/aws-lambda";
import { createApolloServer } from "./app";
import { TABLE_NAME, verifyAwsConnection } from "./config/db";
import { contextFromApiGatewayEvent } from "./auth";

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
  return apolloHandler(...args);
};
