const assert = require("node:assert/strict");
const repository = require("../dist/repositories/pos-repository.js");
repository.listProducts = async () => [{ id: "1" }];
const sales = [
  { id: "sale-1", createdBy: "staff-1", createdByName: "Staff One" },
  { id: "sale-2", createdBy: "staff-2", createdByName: "Staff Two" },
];
repository.listSales = async () => sales;
repository.listSalesByStaff = async (staffId) => sales.filter((sale) => sale.createdBy === staffId);
repository.getSale = async (id) => sales.find((sale) => sale.id === id) ?? null;
repository.getStaffProfiles = async () => new Map();
const cognito = require("../dist/services/cognito.js");
cognito.listCognitoUsers = async () => [];
const { createApolloServer } = require("../dist/app.js");

async function main() {
  const server = createApolloServer();
  await server.start();

  const staffContext = {
    auth: {
      id: "staff-1",
      username: "staff@example.com",
      roles: ["staff"],
      activeRole: "staff",
    },
  };

  const denied = await server.executeOperation(
    { query: "query { users { id } }" },
    { contextValue: staffContext },
  );
  assert.equal(denied.body.kind, "single");
  assert.equal(denied.body.singleResult.errors[0].extensions.code, "FORBIDDEN");

  const allowed = await server.executeOperation(
    { query: "query { products { id } }" },
    { contextValue: staffContext },
  );
  assert.equal(allowed.body.kind, "single");
  assert.equal(allowed.body.singleResult.errors, undefined);
  assert.equal(allowed.body.singleResult.data.products[0].id, "1");

  const personalSales = await server.executeOperation(
    { query: "query { sales { id createdBy } }" },
    { contextValue: staffContext },
  );
  assert.equal(personalSales.body.kind, "single");
  assert.deepEqual(JSON.parse(JSON.stringify(personalSales.body.singleResult.data.sales)), [
    { id: "sale-1", createdBy: "staff-1" },
  ]);

  const deniedReceipt = await server.executeOperation(
    { query: "query { sale(id: \"sale-2\") { id } }" },
    { contextValue: staffContext },
  );
  assert.equal(deniedReceipt.body.kind, "single");
  assert.equal(deniedReceipt.body.singleResult.errors[0].extensions.code, "FORBIDDEN");

  const ownReceipt = await server.executeOperation(
    { query: "query { sale(id: \"sale-1\") { id } }" },
    { contextValue: staffContext },
  );
  assert.equal(ownReceipt.body.kind, "single");
  assert.equal(ownReceipt.body.singleResult.errors, undefined);

  const adminContext = {
    auth: { id: "admin-1", username: "admin@example.com", roles: ["admin"], activeRole: "admin" },
  };
  const allAdminSales = await server.executeOperation(
    { query: "query { sales { id } }" },
    { contextValue: adminContext },
  );
  assert.equal(allAdminSales.body.kind, "single");
  assert.equal(allAdminSales.body.singleResult.data.sales.length, 2);

  const personalAdminSales = await server.executeOperation(
    { query: "query { sales(personal: false) { id } }" },
    { contextValue: { auth: { ...adminContext.auth, id: "staff-1", roles: ["admin", "staff"], activeRole: "staff" } } },
  );
  assert.equal(personalAdminSales.body.kind, "single");
  assert.deepEqual(JSON.parse(JSON.stringify(personalAdminSales.body.singleResult.data.sales)), [{ id: "sale-1" }]);

  const dualRoleStaffDenied = await server.executeOperation(
    { query: "query { users { id } }" },
    { contextValue: { auth: { ...adminContext.auth, roles: ["admin", "staff"], activeRole: "staff" } } },
  );
  assert.equal(dualRoleStaffDenied.body.kind, "single");
  assert.equal(dualRoleStaffDenied.body.singleResult.errors[0].extensions.code, "FORBIDDEN");

  await server.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
