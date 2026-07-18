const assert = require("node:assert/strict");

process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const repository = require("../dist/repositories/pos-repository.js");

const product = {
  PK: "PRODUCT#product-1",
  SK: "PROFILE",
  GSI1PK: "CATALOG#PRODUCT",
  GSI1SK: "tea#product-1",
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
  PK: "PRODUCT#product-2",
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
      if (command.input.Key.PK === "SETTINGS#BUSINESS") return {};
      return { Item: command.input.Key.PK === "PRODUCT#product-2" ? secondProduct : product };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    if (command.constructor.name === "QueryCommand") return { Items: [product, secondProduct] };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };

  const sale = await repository.completeSale(
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
    "product-1",
    { price: 60 },
    { id: "admin", name: "Admin" },
  );
  assert.equal(belowCostProduct.price, 60, "below-cost prices warn in the UI but remain valid");
  assert.match(transaction[1].Put.Item.reason, /Selling price changed from 125.00 to 60.00/);
  assert.equal(sale.items[0].price, 125, "product price updates must not rewrite completed sales");

  const firstPage = await repository.getProductPage({ limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.totalCount, 2);
  assert.ok(firstPage.nextCursor, "a further product page must have a cursor");
  const secondPage = await repository.getProductPage({ limit: 1, cursor: firstPage.nextCursor });
  assert.equal(secondPage.items[0].id, "product-2");
  const searchPage = await repository.getProductPage({ search: "coffee", limit: 20 });
  assert.deepEqual(searchPage.items.map(({ id }) => id), ["product-2"]);

  const adjusted = await repository.adjustStocks(
    [{ productId: "product-1", delta: 2 }, { productId: "product-2", delta: -1 }],
    "Monthly count",
    { id: "admin", name: "Admin" },
  );
  assert.deepEqual(adjusted.map(({ stock }) => stock), [7, 7]);
  assert.equal(transaction.length, 4, "all stock changes and audit events must commit together");

  await assert.rejects(
    () => repository.adjustStock("product-1", -6, "damaged", { id: "admin", name: "Admin" }),
    /below zero/,
  );
  await assert.rejects(
    () => repository.completeSale({ paymentMethod: "cash", amountTendered: 1_000, items: [{ productId: "product-1", quantity: 6 }] }, { id: "cashier", name: "Cashier" }),
    /only 5 units/,
  );
  await assert.rejects(
    () => repository.completeSale({ paymentMethod: "cash", amountTendered: 100, items: [{ productId: "product-1", quantity: 1 }] }, { id: "cashier", name: "Cashier" }),
    /at least the amount due/,
  );
  await assert.rejects(
    () => repository.completeSale({ paymentMethod: "mpesa", mpesaReference: "BAD", items: [{ productId: "product-1", quantity: 1 }] }, { id: "cashier", name: "Cashier" }),
    /valid M-Pesa transaction code/,
  );

  const promoted = { ...product, promotionPrice: 100 };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.PK.startsWith("PAYMENT#") || command.input.Key.PK === "SETTINGS#BUSINESS") return {};
      return { Item: promoted };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const mpesaSale = await repository.completeSale(
    { paymentMethod: "mpesa", mpesaReference: "QGH1234567", items: [{ productId: "product-1", quantity: 2 }] },
    { id: "cashier", name: "Cashier Name" },
  );
  assert.equal(mpesaSale.subtotal, 250);
  assert.equal(mpesaSale.discount, 50);
  assert.equal(mpesaSale.totalAmount, 200);
  assert.equal(mpesaSale.paymentReference, "QGH1234567");
  assert.equal(mpesaSale.createdByName, "Cashier Name");
  assert.equal(transaction[transaction.length - 1].Put.Item.PK, "PAYMENT#MPESA#QGH1234567");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return command.input.Key.PK.startsWith("PAYMENT#") ? { Item: { saleId: "existing-sale" } } : { Item: promoted };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  await assert.rejects(
    () => repository.completeSale({ paymentMethod: "mpesa", mpesaReference: "QGH1234567", items: [{ productId: "product-1", quantity: 1 }] }, { id: "cashier", name: "Cashier" }),
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
  const defaults = await repository.getBusinessSettings();
  assert.equal(defaults.businessName, "Tomkondi Supermarket");
  const settings = await repository.updateBusinessSettings(
    { businessName: "Test Market", address: "Nairobi", phone: "+254700000000", email: "hello@example.com", thankYouMessage: "Asante sana", returnPolicy: "Goods once sold cannot be returned." },
    { id: "admin", name: "Admin" },
  );
  assert.equal(settings.thankYouMessage, "Asante sana");
  assert.equal(transaction.length, 2, "settings update and its audit event must be atomic");

  const legacyProfile = {
    PK: "USER#cashier-1",
    SK: "PROFILE",
    entityType: "staff_profile",
    userId: "cashier-1",
    employeeCode: "EMP-001",
    jobTitle: "Cashier",
    phone: "+254700000000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: legacyProfile };
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  assert.equal((await repository.getStaffProfile("cashier-1")).department, "", "legacy staff profiles remain readable");
  const updatedProfile = await repository.upsertStaffProfile("cashier-1", {
    employeeCode: "EMP-001",
    jobTitle: "Cashier",
    department: "  Front   End  ",
    phone: "+254700000000",
  });
  assert.equal(updatedProfile.department, "Front End");
  assert.equal(transaction[0].Put.Item.department, "Front End");

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
      if (partition === "CATALOG#PRODUCT") return { Items: [product] };
      if (partition === "SALE") return { Items: [saleFor("cashier-1", 125), saleFor("cashier-2", 250)] };
      if (partition === "AUDIT") return { Items: [] };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const staffDashboard = await repository.dashboardSummary(1, "cashier-1");
  assert.equal(staffDashboard.revenue, 125);
  assert.equal(staffDashboard.salesCount, 1);
  assert.equal(staffDashboard.cashierPerformance.length, 1);
  const staffSales = await repository.listSalesByStaff("cashier-1", 100);
  assert.deepEqual(staffSales.map(({ createdBy }) => createdBy), ["cashier-1"]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
