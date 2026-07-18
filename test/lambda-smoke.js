const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.AWS_DYNAMODB_TABLE = "test-table";

const database = require("../dist/config/db.js");
database.verifyAwsConnection = async () => true;

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
  },
  body: JSON.stringify({ query: "query SmokeTest { __typename }" }),
  isBase64Encoded: false,
};

async function main() {
  const result = await handler(event, {}, () => {});

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), {
    data: { __typename: "Query" },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
