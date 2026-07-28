const assert = require("node:assert/strict");
process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const notifications = require("../dist/repositories/notification-repository.js");

async function main() {
  const commands = [];
  dynamoDB.send = async (command) => { commands.push(command); return {}; };
  const created = await notifications.createNotification("tenant-1", "user-1", {
    eventKey: "requisition:req-1:requested",
    type: "stock_requisition_created",
    title: "New request",
    message: "REQ-1 was requested.",
    actionPath: "/dashboard/requests",
  });
  assert.equal(commands[0].input.Item.userId, "user-1");
  assert.equal(commands[0].input.Item.tenantId, "tenant-1");
  assert.ok(commands[0].input.Item.expiresAt > Math.floor(Date.now() / 1000) + 89 * 86400);
  const firstId = created.id;

  dynamoDB.send = async () => { const error = new Error("duplicate"); error.name = "ConditionalCheckFailedException"; throw error; };
  const duplicate = await notifications.createNotification("tenant-1", "user-1", {
    eventKey: "requisition:req-1:requested",
    type: "stock_requisition_created",
    title: "New request",
    message: "REQ-1 was requested.",
    actionPath: "/dashboard/requests",
  });
  assert.equal(duplicate.id, firstId, "event notifications must use deterministic recipient-scoped IDs");

  let readCommand;
  dynamoDB.send = async (command) => {
    readCommand = command;
    return { Attributes: {
      ...command.input.Key, tenantId: "tenant-1", userId: "user-1", id: firstId,
      type: "stock_requisition_created", title: "New request", message: "Message",
      actionPath: "/dashboard/requests", readAt: "2026-07-28T12:00:00.000Z",
      createdAt: "2026-07-28T10:00:00.000Z",
    } };
  };
  await notifications.markNotificationRead("tenant-1", "user-1", firstId);
  assert.match(readCommand.input.Key.partitionKey, /TENANT#tenant-1#NOTIFICATION#user-1/);
  assert.match(readCommand.input.ConditionExpression, /tenantId.*userId/);

  let queryCount = 0; let updateCount = 0;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "QueryCommand") {
      queryCount += 1;
      return { Items: [{ id: "n-1" }, { id: "n-2" }] };
    }
    updateCount += 1;
    assert.match(command.input.Key.partitionKey, /TENANT#tenant-1#NOTIFICATION#user-1/);
    return {};
  };
  assert.equal(await notifications.markAllNotificationsRead("tenant-1", "user-1"), true);
  assert.equal(queryCount, 1);
  assert.equal(updateCount, 2);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
