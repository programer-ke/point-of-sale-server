const assert = require("node:assert/strict");

process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const repository = require("../dist/repositories/tenant-repository.js");

async function main() {
  dynamoDB.send = async (command) => {
    assert.equal(command.constructor.name, "QueryCommand");
    assert.equal(command.input.IndexName, "AccessIndex");
    assert.equal(
      command.input.ExpressionAttributeValues[":partition"],
      "TENANT#tenant-1#MEMBER",
      "the membership query must define the placeholder used by its key expression",
    );
    assert.equal(command.input.ExpressionAttributeValues[":pk"], undefined);
    return {
      Items: [{
        partitionKey: "IDENTITY#user-1",
        sortKey: "MEMBERSHIP",
        accessPartition: "TENANT#tenant-1#MEMBER",
        accessSort: "user-1",
        entityType: "tenant_membership",
        userId: "user-1",
        username: "owner@example.com",
        tenantId: "tenant-1",
        tenantName: "Test Shop",
        roles: ["admin", "staff"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    };
  };

  const memberships = await repository.listTenantMemberships("tenant-1");
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].userId, "user-1");
  assert.equal("partitionKey" in memberships[0], false);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
