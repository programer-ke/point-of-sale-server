const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.AWS_DYNAMODB_TABLE = "test-table";
process.env.TRUST_API_GATEWAY_JWT_AUTHORIZER = "true";

const database = require("../dist/config/db.js");
database.verifyAwsConnection = async () => true;
database.dynamoDB.send = async () => ({ Item: {
  partitionKey: "IDENTITY#test-user-id",
  sortKey: "MEMBERSHIP",
  userId: "test-user-id",
  username: "test-user",
  tenantId: "test-tenant",
  tenantName: "Test Business",
  roles: ["staff"],
} });

const mpesaRepository = require("../dist/repositories/mpesa-repository.js");
mpesaRepository.handleMpesaCallback = async () => ({ accepted: true, payment: null, intent: null });

const { handler } = require("../dist/lambda.js");

const event = {
  version: "2.0",
  routeKey: "POST /graphql",
  rawPath: "/graphql",
  rawQueryString: "",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
  },
  requestContext: {
    accountId: "test",
    apiId: "test",
    domainName: "test.execute-api.us-east-1.amazonaws.com",
    domainPrefix: "test",
    http: {
      method: "POST",
      path: "/graphql",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "lambda-smoke-test",
    },
    requestId: "test",
    routeKey: "POST /graphql",
    stage: "$default",
    time: "18/Jul/2026:00:00:00 +0000",
    timeEpoch: 0,
    authorizer: {
      jwt: {
        claims: {
          sub: "test-user-id",
          username: "test-user",
          "cognito:groups": ["staff"],
        },
        scopes: [],
      },
    },
  },
  body: JSON.stringify({ query: "query SmokeTest { __typename }" }),
  isBase64Encoded: false,
};

async function main() {
  const preflight = await handler({
    ...event,
    routeKey: "OPTIONS /{proxy+}",
    requestContext: {
      ...event.requestContext,
      routeKey: "OPTIONS /{proxy+}",
      http: { ...event.requestContext.http, method: "OPTIONS" },
      authorizer: undefined,
    },
    body: undefined,
  }, {}, () => {});
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["x-request-id"], "test");

  const publicPromotions = await handler({
    ...event,
    routeKey: "GET /public/billing-promotions",
    rawPath: "/public/billing-promotions",
    queryStringParameters: { planCode: "biashara" },
    requestContext: {
      ...event.requestContext,
      routeKey: "GET /public/billing-promotions",
      http: { ...event.requestContext.http, method: "GET", path: "/public/billing-promotions" },
      authorizer: undefined,
    },
    body: undefined,
  }, {}, () => {});
  assert.equal(publicPromotions.statusCode, 200, "signup promotion reads must not require Cognito");
  assert.equal(publicPromotions.headers["x-request-id"], "test");
  assert.deepEqual(JSON.parse(publicPromotions.body), []);

  const callbackToken = "A".repeat(48);
  const mpesaCallback = await handler({
    ...event,
    routeKey: "POST /public/mpesa/callback/{token}/{kind}",
    rawPath: `/public/mpesa/callback/${callbackToken}/confirmation`,
    requestContext: {
      ...event.requestContext,
      routeKey: "POST /public/mpesa/callback/{token}/{kind}",
      http: { ...event.requestContext.http, method: "POST", path: `/public/mpesa/callback/${callbackToken}/confirmation` },
      authorizer: undefined,
    },
    body: JSON.stringify({ TransID: "TEST123456" }),
  }, {}, () => {});
  assert.equal(mpesaCallback.statusCode, 200, "only the explicit high-entropy M-Pesa callback route may bypass Cognito");
  assert.equal(mpesaCallback.headers["x-request-id"], "test");
  assert.deepEqual(JSON.parse(mpesaCallback.body), { ResultCode: 0, ResultDesc: "Received" });

  const result = await handler(event, {}, () => {});

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["x-request-id"], "test");
  assert.deepEqual(JSON.parse(result.body), {
    data: { __typename: "Query" },
  });

  const invalid = await handler({ ...event, body: JSON.stringify({ query: "query Broken { missingField }" }) }, { awsRequestId: "lambda-test" }, () => {});
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers["x-request-id"], "test");
  assert.equal(JSON.parse(invalid.body).errors[0].extensions.requestId, "test");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
