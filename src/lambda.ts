import {
  handlers,
  startServerAndCreateLambdaHandler,
} from "@as-integrations/aws-lambda";
import { createApolloServer } from "./app";
import { TABLE_NAME, verifyAwsConnection } from "./config/db";
import { contextFromApiGatewayEvent } from "./auth";

const databaseReady = verifyAwsConnection().then((isReady) => {
  if (!isReady) {
    throw new Error(`DynamoDB table "${TABLE_NAME}" is not available`);
  }
});

const apolloHandler = startServerAndCreateLambdaHandler(
  createApolloServer(),
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event }) => contextFromApiGatewayEvent(event),
  },
);

export const handler = async (...args: Parameters<typeof apolloHandler>) => {
  await databaseReady;
  return apolloHandler(...args);
};
