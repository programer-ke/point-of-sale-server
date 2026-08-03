const assert = require("node:assert/strict");
process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const { nextTenantCode } = require("../dist/repositories/code-generator.js");

async function main() {
  const values = new Map();
  dynamoDB.send = async (command) => {
    assert.equal(command.constructor.name, "UpdateCommand");
    assert.match(command.input.UpdateExpression, /ADD #value :increment/);
    const key = command.input.Key.partitionKey;
    const value = (values.get(key) ?? 0) + command.input.ExpressionAttributeValues[":increment"];
    values.set(key, value);
    return { Attributes: { value } };
  };

  assert.equal(await nextTenantCode("tenant-1", "CATEGORY"), "CAT-000001");
  assert.equal(await nextTenantCode("tenant-1", "EMPLOYEE"), "EMP-000001");
  assert.equal(await nextTenantCode("tenant-1", "PRODUCT"), "PRD-000001");
  assert.equal(await nextTenantCode("tenant-1", "STORE"), "STR-000001");
  assert.equal(await nextTenantCode("tenant-1", "SUPPLIER"), "SUP-000001");
  assert.equal(await nextTenantCode("tenant-1", "SUPPLIER"), "SUP-000002");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
