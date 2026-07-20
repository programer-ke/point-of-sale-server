const assert = require("node:assert/strict");

process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const repository = require("../dist/repositories/pos-repository.js");
const tenantId = "tenant-1";

const product = {
  partitionKey: "PRODUCT#product-1",
  sortKey: "PROFILE",
  accessPartition: "CATALOG#PRODUCT",
  accessSort: "tea#product-1",
  entityType: "product",
  id: "product-1",
  name: "Tea",
  description: "Black tea",
  sku: "TEA-1",
  barcode: "123456789",
  categoryId: "category-1",
  categoryName: "Beverages",
  price: 125,
  cost: 80,
  stock: 5,
  minStock: 1,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const secondProduct = {
  ...product,
  partitionKey: "PRODUCT#product-2",
  id: "product-2",
  name: "Coffee",
  sku: "COFFEE-1",
  barcode: "987654321",
  stock: 8,
};

async function main() {
  let transaction;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.partitionKey.endsWith("SETTINGS#BUSINESS")) return {};
      return { Item: command.input.Key.partitionKey.endsWith("PRODUCT#product-2") ? secondProduct : product };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    if (command.constructor.name === "QueryCommand") return { Items: [product, secondProduct] };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };

  const sale = await repository.completeSale(
    tenantId,
    {
      customerName: "Walk-in",
      paymentMethod: "cash",
      amountTendered: 300,
      items: [{ productId: "product-1", quantity: 2 }],
    },
    { id: "cashier-1", name: "Cashier Name", employeeCode: "EMP-001", department: "Front End" },
  );

  assert.equal(sale.items[0].price, 125, "server price must be authoritative");
  assert.equal(sale.totalAmount, 250);
  assert.equal(sale.amountTendered, 300);
  assert.equal(sale.changeDue, 50);
  assert.equal(sale.cashierDisplayName, "Cashier (EMP-001)");
  assert.equal(sale.sellerDepartment, "Front End", "sales must retain the seller department at checkout time");
  assert.equal(sale.receiptBranding.businessName, "Tomkondi Supermarket");
  assert.equal(transaction.length, 3, "stock update, audit event, and receipt must be atomic");
  assert.match(transaction[0].Update.ConditionExpression, /stock.*>=/);
  assert.equal(transaction[2].Put.Item.orderNumber, sale.orderNumber);

  const belowCostProduct = await repository.updateProduct(
    tenantId,
    "product-1",
    { price: 60 },
    { id: "admin", name: "Admin" },
  );
  assert.equal(belowCostProduct.price, 60, "below-cost prices warn in the UI but remain valid");
  assert.match(transaction[1].Put.Item.reason, /Selling price changed from 125.00 to 60.00/);
  assert.equal(sale.items[0].price, 125, "product price updates must not rewrite completed sales");

  const firstPage = await repository.getProductPage(tenantId, { limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.totalCount, 2);
  assert.ok(firstPage.nextCursor, "a further product page must have a cursor");
  const secondPage = await repository.getProductPage(tenantId, { limit: 1, cursor: firstPage.nextCursor });
  assert.equal(secondPage.items[0].id, "product-2");
  const searchPage = await repository.getProductPage(tenantId, { search: "coffee", limit: 20 });
  assert.deepEqual(searchPage.items.map(({ id }) => id), ["product-2"]);

  const adjusted = await repository.adjustStocks(
    tenantId,
    [{ productId: "product-1", delta: 2 }, { productId: "product-2", delta: -1 }],
    "Monthly count",
    { id: "admin", name: "Admin" },
  );
  assert.deepEqual(adjusted.map(({ stock }) => stock), [7, 7]);
  assert.equal(transaction.length, 4, "all stock changes and audit events must commit together");

  await assert.rejects(
    () => repository.adjustStock(tenantId, "product-1", -6, "damaged", { id: "admin", name: "Admin" }),
    /below zero/,
  );
  await assert.rejects(
    () => repository.completeSale(tenantId, { paymentMethod: "cash", amountTendered: 1_000, items: [{ productId: "product-1", quantity: 6 }] }, { id: "cashier", name: "Cashier" }),
    /only 5 units/,
  );
  await assert.rejects(
    () => repository.completeSale(tenantId, { paymentMethod: "cash", amountTendered: 100, items: [{ productId: "product-1", quantity: 1 }] }, { id: "cashier", name: "Cashier" }),
    /at least the amount due/,
  );
  await assert.rejects(
    () => repository.completeSale(tenantId, { paymentMethod: "mpesa", mpesaReference: "BAD", items: [{ productId: "product-1", quantity: 1 }] }, { id: "cashier", name: "Cashier" }),
    /valid M-Pesa transaction code/,
  );

  const promoted = { ...product, promotionPrice: 100 };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.partitionKey.includes("PAYMENT#") || command.input.Key.partitionKey.endsWith("SETTINGS#BUSINESS")) return {};
      return { Item: promoted };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const mpesaSale = await repository.completeSale(
    tenantId,
    { paymentMethod: "mpesa", mpesaReference: "QGH1234567", items: [{ productId: "product-1", quantity: 2 }] },
    { id: "cashier", name: "Cashier Name" },
  );
  assert.equal(mpesaSale.subtotal, 250);
  assert.equal(mpesaSale.discount, 50);
  assert.equal(mpesaSale.totalAmount, 200);
  assert.equal(mpesaSale.paymentReference, "QGH1234567");
  assert.equal(mpesaSale.createdByName, "Cashier Name");
  assert.equal(transaction[transaction.length - 1].Put.Item.partitionKey, "TENANT#tenant-1#PAYMENT#MPESA#QGH1234567");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return command.input.Key.partitionKey.includes("PAYMENT#") ? { Item: { saleId: "existing-sale" } } : { Item: promoted };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  await assert.rejects(
    () => repository.completeSale(tenantId, { paymentMethod: "mpesa", mpesaReference: "QGH1234567", items: [{ productId: "product-1", quantity: 1 }] }, { id: "cashier", name: "Cashier" }),
    /already been used/,
  );

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return {};
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const defaults = await repository.getBusinessSettings(tenantId);
  assert.equal(defaults.businessName, "Tomkondi Supermarket");
  const settings = await repository.updateBusinessSettings(
    tenantId,
    { businessName: "Test Market", address: "Nairobi", phone: "+254700000000", email: "hello@example.com", thankYouMessage: "Asante sana", returnPolicy: "Goods once sold cannot be returned." },
    { id: "admin", name: "Admin" },
  );
  assert.equal(settings.thankYouMessage, "Asante sana");
  assert.deepEqual(settings.departments, ["Management", "Sales", "Inventory"]);
  assert.equal(transaction.length, 2, "settings update and its audit event must be atomic");
  assert.ok(transaction[0].Update, "branding must update only its own fields instead of replacing departments");

  const departmentValues = await repository.updateDepartments(
    tenantId,
    ["Management", "Sales"],
    ["Management", "Customer   Support"],
    { id: "admin", name: "Admin" },
    [{ userId: "cashier-1", from: "Sales", to: "Customer Support" }],
  );
  assert.deepEqual(departmentValues, ["Management", "Customer Support"]);
  assert.equal(transaction.length, 3, "department and assigned staff renames must be atomic with their audit event");
  assert.equal(transaction[0].Update.ConditionExpression, "departments = :current");
  assert.equal(transaction[1].Update.ExpressionAttributeValues[":next"], "Customer Support");
  await assert.rejects(
    () => repository.updateDepartments(tenantId, ["Management"], [], { id: "admin", name: "Admin" }),
    /at least one department/,
  );

  const category = {
    partitionKey: "TENANT#tenant-1#CATEGORY#category-1",
    sortKey: "PROFILE",
    accessPartition: "TENANT#tenant-1#CATALOG#CATEGORY",
    accessSort: "beverages#category-1",
    entityType: "category",
    tenantId,
    id: "category-1",
    code: "BEV",
    name: "Beverages",
    description: "Drinks",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: category };
    if (command.constructor.name === "QueryCommand") return { Items: [product, secondProduct] };
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const updatedCategory = await repository.updateCategory(
    tenantId,
    "category-1",
    { code: "DRINK", name: "Drinks", description: "Hot and cold drinks" },
    { id: "admin", name: "Admin" },
  );
  assert.equal(updatedCategory.code, "DRINK");
  assert.equal(transaction.length, 6, "category, lookup, products, and audit must update atomically");
  assert.equal(transaction.filter(({ Update }) => Update?.UpdateExpression.includes("categoryName")).length, 2);
  await assert.rejects(
    () => repository.deleteCategory(tenantId, "category-1", { id: "admin", name: "Admin" }),
    /Move this category's products/,
  );
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: category };
    if (command.constructor.name === "QueryCommand") return { Items: [] };
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  await repository.deleteCategory(tenantId, "category-1", { id: "admin", name: "Admin" });
  assert.equal(transaction.length, 3, "unused category, lookup, and audit must delete atomically");

  const profile = {
    partitionKey: "USER#cashier-1",
    sortKey: "PROFILE",
    entityType: "staff_profile",
    userId: "cashier-1",
    employeeCode: "EMP-001",
    jobTitle: "Cashier",
    phone: "+254700000000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: profile };
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  assert.equal((await repository.getStaffProfile(tenantId, "cashier-1")).department, "");
  const updatedProfile = await repository.upsertStaffProfile(tenantId, "cashier-1", {
    employeeCode: "EMP-001",
    jobTitle: "Cashier",
    department: "  Front   End  ",
    phone: "+254700000000",
  });
  assert.equal(updatedProfile.department, "Front End");
  assert.equal(transaction[0].Put.Item.department, "Front End");

  let batchCount = 0;
  dynamoDB.send = async (command) => {
    assert.equal(command.constructor.name, "BatchGetCommand");
    batchCount += 1;
    const keys = command.input.RequestItems["test-table"].Keys;
    assert.ok(keys.length <= 100, "DynamoDB batch reads must not exceed 100 keys");
    return { Responses: { "test-table": keys.map((key) => ({ ...key, userId: key.partitionKey.split("USER#")[1], employeeCode: "EMP", jobTitle: "Cashier", department: "Sales", phone: "" })) } };
  };
  const manyProfiles = await repository.getStaffProfiles(tenantId, Array.from({ length: 101 }, (_, index) => `staff-${index}`));
  assert.equal(manyProfiles.size, 101);
  assert.equal(batchCount, 2, "staff profile reads must be chunked across DynamoDB batch limits");

  const saleFor = (cashierId, amount) => ({
    id: `sale-${cashierId}`,
    orderNumber: `SALE-${cashierId}`,
    customerName: "Cash customer",
    items: [{ productId: "product-1", productName: "Tea", sku: "TEA-1", barcode: "123", quantity: 1, price: amount, cost: 50, total: amount }],
    subtotal: amount,
    tax: 0,
    discount: 0,
    totalAmount: amount,
    status: "completed",
    paymentMethod: "cash",
    paymentStatus: "paid",
    createdBy: cashierId,
    createdByName: cashierId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "QueryCommand") {
      const partition = command.input.ExpressionAttributeValues[":pk"];
      if (partition.endsWith("CATALOG#PRODUCT")) return { Items: [product] };
      if (partition.endsWith("SALE")) return { Items: [saleFor("cashier-1", 125), saleFor("cashier-2", 250)] };
      if (partition.endsWith("AUDIT")) return { Items: [] };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const staffDashboard = await repository.dashboardSummary(tenantId, 1, "cashier-1");
  assert.equal(staffDashboard.revenue, 125);
  assert.equal(staffDashboard.salesCount, 1);
  assert.equal(staffDashboard.cashierPerformance.length, 1);
  const staffSales = await repository.listSalesByStaff(tenantId, "cashier-1", 100);
  assert.deepEqual(staffSales.map(({ createdBy }) => createdBy), ["cashier-1"]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
