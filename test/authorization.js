const assert = require("node:assert/strict");
const repository = require("../dist/repositories/pos-repository.js");
repository.listProducts = async () => [{ id: "1" }];
const sales = [
  { id: "sale-1", createdBy: "staff-1", createdByName: "Staff One" },
  { id: "sale-2", createdBy: "staff-2", createdByName: "Staff Two" },
];
repository.listSales = async () => sales;
repository.listSalesByStaff = async (_tenantId, staffId) => sales.filter((sale) => sale.createdBy === staffId);
repository.getSale = async (_tenantId, id) => sales.find((sale) => sale.id === id) ?? null;
repository.getStaffProfiles = async () => new Map();
repository.getStaffProfile = async () => ({ storeId: "store-1", storeName: "Main Store" });
const supply = require("../dist/repositories/supply-chain-repository.js");
supply.listStores = async () => [{ id: "store-1", code: "MAIN", name: "Main Store", status: "active" }];
supply.getStore = async () => ({ id: "store-1", code: "MAIN", name: "Main Store", status: "active" });
supply.storeStock = async () => [];
const cognito = require("../dist/services/cognito.js");
cognito.getCognitoUser = async (username) => ({ id: username.startsWith("staff-1") ? "staff-1" : "staff-2", username, name: username });
const tenants = require("../dist/repositories/tenant-repository.js");
tenants.listTenantMemberships = async () => [
  { userId: "staff-1", username: "staff-1@example.com", roles: ["staff"] },
  { userId: "staff-2", username: "staff-2@example.com", roles: ["staff"] },
];
const { createApolloServer } = require("../dist/app.js");

async function main() {
  const server = createApolloServer();
  await server.start();

  const schemaContract = await server.executeOperation({ query: `query SchemaContract {
    dashboard: __type(name: "DashboardSummary") { fields { name } }
    stock: __type(name: "StockReportProduct") { fields { name } }
    report: __type(name: "ReportProduct") { fields { name } }
    mutation: __type(name: "Mutation") { fields { name } }
  }` });
  assert.equal(schemaContract.body.kind, "single");
  const schemaFields = JSON.parse(JSON.stringify(schemaContract.body.singleResult.data));
  assert.ok(schemaFields.dashboard.fields.some(({ name }) => name === "averageSale"));
  assert.ok(!schemaFields.stock.fields.some(({ name }) => name === "averageSale"));
  assert.ok(schemaFields.report.fields.some(({ name }) => name === "savings"));
  for (const mutation of ["updateCategory", "deleteCategory", "createStore", "createSupplier", "createPurchaseOrder", "receivePurchaseOrder"]) {
    assert.ok(schemaFields.mutation.fields.some(({ name }) => name === mutation), `${mutation} must be available`);
  }

  const staffContext = {
    auth: {
      id: "staff-1",
      username: "staff@example.com",
      roles: ["staff"],
      activeRole: "staff",
      tenantId: "tenant-1",
    },
  };

  const denied = await server.executeOperation(
    { query: "query { users { id } }" },
    { contextValue: staffContext },
  );
  assert.equal(denied.body.kind, "single");
  assert.equal(denied.body.singleResult.errors[0].extensions.code, "FORBIDDEN");

  const deniedCategoryUpdate = await server.executeOperation(
    { query: `mutation { updateCategory(id: "category-1", code: "BEV", name: "Beverages") { id } }` },
    { contextValue: staffContext },
  );
  assert.equal(deniedCategoryUpdate.body.kind, "single");
  assert.equal(deniedCategoryUpdate.body.singleResult.errors[0].extensions.code, "FORBIDDEN");

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
    auth: { id: "admin-1", username: "admin@example.com", roles: ["admin"], activeRole: "admin", tenantId: "tenant-1" },
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
