const assert = require("node:assert/strict");
process.env.AWS_DYNAMODB_TABLE = "test-table";
const tenants = require("../dist/repositories/tenant-repository.js");
const notificationRepository = require("../dist/repositories/notification-repository.js");
const created = [];
tenants.listTenantMemberships = async () => [
  { userId: "requester", roles: ["staff"] },
  { userId: "admin-1", roles: ["admin"] },
  { userId: "admin-2", roles: ["admin", "staff"] },
];
tenants.getTenantMembership = async (userId) => ({ userId, roles: ["staff"] });
notificationRepository.createNotification = async (tenantId, userId, input) => {
  created.push({ tenantId, userId, input });
  return input;
};
const { notifyAdminsOfRequisition, notifyRequesterOfDecision } = require("../dist/graphql/resolvers.js");

async function main() {
  await notifyAdminsOfRequisition("tenant-1", "requester", {
    id: "req-1", requisitionNumber: "REQ-1", requestedByName: "Staff",
    fromStoreName: "Warehouse", toStoreName: "Main",
  });
  assert.deepEqual(created.map(({ userId }) => userId).sort(), ["admin-1", "admin-2"]);
  assert.ok(created.every(({ input }) => input.eventKey === "requisition:req-1:requested"));

  created.length = 0;
  await notifyRequesterOfDecision("tenant-1", {
    id: "req-1", requisitionNumber: "REQ-1", requestedBy: "requester",
    status: "rejected", decisionReason: "No stock",
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].userId, "requester");
  assert.equal(created[0].input.actionPath, "/staff/supply/requisitions");
  assert.match(created[0].input.message, /No stock/);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
