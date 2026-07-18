const assert = require("node:assert/strict");

process.env.TRUST_API_GATEWAY_JWT_AUTHORIZER = "true";

const {
  contextFromApiGatewayEvent,
  requireRole,
} = require("../dist/auth.js");

async function main() {
  const context = await contextFromApiGatewayEvent({
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: "user-1",
            username: "user@example.com",
            "cognito:groups": "[admin staff]",
          },
        },
      },
    },
  });

  assert.deepEqual(context.auth.roles, ["admin", "staff"]);
  assert.equal(requireRole(context, ["admin"]).id, "user-1");
  assert.throws(
    () => requireRole({ auth: { ...context.auth, roles: ["staff"] } }, ["admin"]),
    /permission/,
  );
  await assert.rejects(() => contextFromApiGatewayEvent({}), /Authentication/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
