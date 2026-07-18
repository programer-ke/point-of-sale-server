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
      return { Item: command.input.Key.PK === "PRODUCT#product-2" ? secondProduct : product };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };

  const sale = await repository.completeSale(
    {
      customerName: "Walk-in",
      paymentMethod: "cash",
      items: [{ productId: "product-1", quantity: 2 }],
    },
    { id: "cashier-1", name: "Cashier" },
  );

  assert.equal(sale.items[0].price, 125, "server price must be authoritative");
  assert.equal(sale.totalAmount, 250);
  assert.equal(transaction.length, 3, "stock update, audit event, and receipt must be atomic");
  assert.match(transaction[0].Update.ConditionExpression, /stock.*>=/);
  assert.equal(transaction[2].Put.Item.orderNumber, sale.orderNumber);

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
    () => repository.completeSale({ paymentMethod: "cash", items: [{ productId: "product-1", quantity: 6 }] }, { id: "cashier", name: "Cashier" }),
    /only 5 units/,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
