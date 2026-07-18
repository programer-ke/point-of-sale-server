const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.AWS_DYNAMODB_TABLE = "test-table";

const { handler } = require("../lambda-package/dist/lambda.js");

const preflightEvent = {
  version: "2.0",
  routeKey: "OPTIONS /{proxy+}",
  rawPath: "/graphql",
  rawQueryString: "",
  headers: {},
  requestContext: {
    http: { method: "OPTIONS", path: "/graphql", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "bundle-smoke" },
  },
  isBase64Encoded: false,
};

async function main() {
  assert.equal(typeof handler, "function", "bundle must export the configured Lambda handler");
  const response = await handler(preflightEvent, {}, () => {});
  assert.equal(response.statusCode, 204);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
