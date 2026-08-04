const assert = require("node:assert/strict");

process.env.TRUST_API_GATEWAY_JWT_AUTHORIZER = "true";
const { dynamoDB } = require("../dist/config/db.js");
let membershipItem = {
  partitionKey: "IDENTITY#user-1",
  sortKey: "MEMBERSHIP",
  entityType: "tenant_membership",
  userId: "user-1",
  username: "user@example.com",
  tenantId: "test-tenant",
  tenantName: "Test Business",
  roles: ["admin", "staff"],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
dynamoDB.send = async () => ({ Item: membershipItem });

const {
  contextFromApiGatewayEvent,
  requireIdentity,
  requirePlatformAdmin,
  requireRole,
} = require("../dist/auth.js");
const { assertPlatformAdminCanDisable } = require("../dist/services/cognito.js");

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
  assert.equal(context.auth.activeRole, "admin");
  assert.equal(context.auth.tenantId, "test-tenant");
  assert.equal(requireRole(context, ["admin"]).id, "user-1");
  assert.throws(
    () => requireRole({ auth: { ...context.auth, roles: ["staff"], activeRole: "staff" } }, ["admin"]),
    /permission/,
  );
  const staffMode = await contextFromApiGatewayEvent({
    headers: { "x-biasharakit-role": "staff" },
    requestContext: { authorizer: { jwt: { claims: {
      sub: "user-1",
      username: "user@example.com",
      "cognito:groups": "[admin staff]",
    } } } },
  });
  assert.equal(staffMode.auth.activeRole, "staff");
  assert.throws(() => requireRole(staffMode, ["admin"]), /permission/);
  await assert.rejects(
    () => contextFromApiGatewayEvent({
      headers: { "x-biasharakit-role": "admin" },
      requestContext: { authorizer: { jwt: { claims: {
        sub: "staff-only",
        username: "staff@example.com",
        "cognito:groups": "[staff]",
      } } } },
    }),
    /permission/,
  );
  membershipItem = undefined;
  const onboarding = await contextFromApiGatewayEvent({
    requestContext: { authorizer: { jwt: { claims: {
      sub: "new-owner",
      username: "owner@example.com",
    } } } },
  });
  assert.equal(requireIdentity(onboarding).id, "new-owner");
  assert.equal(onboarding.auth.tenantId, undefined);
  assert.throws(() => requireRole(onboarding, ["staff"]), /permission/);

  const platform = await contextFromApiGatewayEvent({
    requestContext: { authorizer: { jwt: { claims: {
      sub: "platform-admin", username: "platform@example.com", "cognito:groups": "[superadmin]",
    } } } },
  });
  assert.equal(platform.auth.activeRole, "superadmin");
  assert.equal(requirePlatformAdmin(platform).id, "platform-admin");
  assert.throws(() => requireRole(platform, ["admin"]), /permission/);
  assert.throws(() => assertPlatformAdminCanDisable("platform@example.com", "platform@example.com", [{ username: "platform@example.com", status: "CONFIRMED" }]), /own platform/);
  assert.throws(() => assertPlatformAdminCanDisable("only@example.com", "operator@example.com", [{ username: "only@example.com", status: "CONFIRMED" }]), /retain at least one/);
  assert.doesNotThrow(() => assertPlatformAdminCanDisable("second@example.com", "first@example.com", [{ username: "first@example.com", status: "CONFIRMED" }, { username: "second@example.com", status: "CONFIRMED" }]));

  membershipItem = {
    partitionKey: "IDENTITY#user-1",
    sortKey: "MEMBERSHIP",
    entityType: "tenant_membership",
    userId: "user-1",
    username: "user@example.com",
    tenantId: "tenant-from-membership",
    tenantName: "Another Business",
    roles: ["staff"],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const membershipScoped = await contextFromApiGatewayEvent({
    requestContext: { authorizer: { jwt: { claims: {
      sub: "user-1",
      username: "user@example.com",
      "cognito:groups": "[admin staff]",
    } } } },
  });
  assert.equal(membershipScoped.auth.tenantId, "tenant-from-membership");
  assert.deepEqual(membershipScoped.auth.roles, ["staff"]);
  assert.equal(membershipScoped.auth.activeRole, "staff");
  assert.throws(() => requireRole(membershipScoped, ["admin"]), /permission/);
  await assert.rejects(
    () => contextFromApiGatewayEvent({
      headers: { "x-biasharakit-role": "owner" },
      requestContext: { authorizer: { jwt: { claims: {
        sub: "user-1",
        username: "user@example.com",
        "cognito:groups": "[admin staff]",
      } } } },
    }),
    /permission/,
  );
  await assert.rejects(() => contextFromApiGatewayEvent({}), /Authentication/);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
