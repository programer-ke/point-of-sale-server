const assert = require("node:assert/strict");
process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const supply = require("../dist/repositories/supply-chain-repository.js");
const measurements = require("../dist/domain/measurements.js");
const tenantId = "tenant-1";
const now = "2026-07-20T10:00:00.000Z";
const store = { id: "store-1", code: "MAIN", name: "Main Store", address: "", status: "active", createdAt: now, updatedAt: now };
const supplier = { id: "supplier-1", code: "SUP", name: "Supplier", contactName: "", phone: "", email: "", address: "", status: "active", createdAt: now, updatedAt: now };
const product = { id: "product-1", name: "Tea", sku: "TEA", baseUnit: "each", stockUnit: "each", tracksExpiry: true, status: "active" };
const supplierProduct = { supplierId: supplier.id, productId: product.id, supplierSku: "TEA-CASE", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", unitsPerPurchaseUnit: 12, lastPurchasePrice: 960, preferred: true, updatedAt: now };

const assertUsesEveryExpressionValue = (operation, label) => {
  const expressions = [operation.UpdateExpression, operation.ConditionExpression].filter(Boolean).join(" ");
  for (const placeholder of Object.keys(operation.ExpressionAttributeValues ?? {})) {
    assert.ok(expressions.includes(placeholder), `${label} supplies unused expression value ${placeholder}`);
  }
};

async function main() {
  assert.equal(measurements.convertMeasurementToBaseUnits(0.5, "kilogram", "gram"), 500, "500 g must be represented exactly beneath a kilogram stock unit");
  assert.equal(measurements.convertMeasurementToBaseUnits(2.5, "kilogram", "gram"), 2500, "fractional kilogram sale quantities must remain exact");
  assert.equal(measurements.convertMeasurementToBaseUnits(2, "tonne", "gram"), 2000000, "supplier tonnes must convert to exact weight inventory");
  assert.throws(() => measurements.convertMeasurementToBaseUnits(1, "litre", "gram"), /not compatible/, "measurement dimensions must not be mixed");
  let transaction;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input.Key.partitionKey;
      if (key.includes("IDEMPOTENCY#")) return {};
      if (key.includes("SUPPLIER_PRODUCT#")) return { Item: supplierProduct };
      if (key.includes("SUPPLIER#")) return { Item: supplier };
      if (key.includes("STORE#")) return { Item: store };
      if (key.includes("PRODUCT#")) return { Item: product };
      return {};
    }
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const po = await supply.createPurchaseOrder(tenantId, {
    supplierId: supplier.id, storeId: store.id, notes: "Weekly replenishment", lines: [{
      productId: "product-1", productName: "Tea", supplierSku: "TEA-CASE", purchaseUnit: "carton",
      unitsPerPurchaseUnit: 12, orderedPurchaseQuantity: 2, pricePerPurchaseUnit: 960,
    }],
  }, { id: "admin", name: "Admin" }, "request-po-1");
  assert.equal(po.status, "draft");
  assert.equal(po.totalAmount, 1920);
  assert.equal(transaction.length, 2, "PO and idempotency record must be atomic");
  const storedPo = transaction[0].Put.Item;

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: storedPo };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const issued = await supply.setPurchaseOrderStatus(tenantId, po.id, "issue", "");
  assert.equal(issued.status, "issued");
  assert.match(transaction[0].Put.ConditionExpression, /updatedAt/, "PO state changes must reject concurrent stale writes");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.partitionKey.includes("IDEMPOTENCY#")) return {};
      if (command.input.Key.partitionKey.includes("PO#")) return { Item: issued };
      if (command.input.Key.partitionKey.includes("PRODUCT#")) return { Item: product };
      return {};
    }
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  await assert.rejects(() => supply.receivePurchaseOrder(tenantId, po.id, "DN-1", "INV-1", [{
    purchaseOrderLineId: po.lines[0].id, deliveredBaseQuantity: 12, acceptedBaseQuantity: 12, damagedBaseQuantity: 0, rejectedBaseQuantity: 0, actualPricePerPurchaseUnit: 960,
  }], { id: "admin", name: "Admin" }, "receive-1"), /requires an expiry date/);
  await assert.rejects(() => supply.receivePurchaseOrder(tenantId, po.id, "DN-1", "INV-1", [{
    purchaseOrderLineId: po.lines[0].id, batchNumber: "OVER", expiryDate: "2027-01-01",
    deliveredBaseQuantity: 25, acceptedBaseQuantity: 25, damagedBaseQuantity: 0, rejectedBaseQuantity: 0, actualPricePerPurchaseUnit: 960,
  }], { id: "admin", name: "Admin" }, "receive-over"), /exceeds the outstanding/);
  const receipt = await supply.receivePurchaseOrder(tenantId, po.id, "DN-1", "INV-1", [{
    purchaseOrderLineId: po.lines[0].id, batchNumber: "B-1", expiryDate: "2027-01-01",
    deliveredBaseQuantity: 12, acceptedBaseQuantity: 10, damagedBaseQuantity: 1, rejectedBaseQuantity: 1, actualPricePerPurchaseUnit: 960,
  }], { id: "admin", name: "Admin" }, "receive-2");
  assert.equal(receipt.lines[0].unitCost, 80);
  assert.equal(receipt.lines[0].acceptedBaseQuantity, 10);
  assert.equal(transaction.filter((item) => item.Put?.Item?.entityType === "inventory_lot").length, 1, "accepted stock creates exactly one lot");
  assert.equal(transaction.find((item) => item.Put?.Item?.entityType === "inventory_lot").Put.Item.remainingQuantity, 10);

  const activeLot = { id: "lot-early", storeId: store.id, productId: "product-1", productName: "Tea", batchNumber: "B-1", expiryDate: "2026-09-01", receivedQuantity: 10, remainingQuantity: 10, unitCost: 80, origin: "supplier_receipt", status: "active", receivedAt: "2026-07-01T00:00:00.000Z", updatedAt: now };
  const laterLot = { ...activeLot, id: "lot-later", batchNumber: "B-2", expiryDate: "2026-12-01", remainingQuantity: 10, receivedAt: "2026-07-02T00:00:00.000Z" };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "QueryCommand") return { Items: [laterLot, activeLot] };
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const allocations = await supply.allocateLots(tenantId, store.id, [{ productId: "product-1", quantity: 12 }]);
  assert.deepEqual(allocations.get("product-1").map(({ lot, quantity }) => [lot.id, quantity]), [["lot-early", 10], ["lot-later", 2]], "FEFO must consume the earliest expiry first");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.partitionKey.includes("IDEMPOTENCY#")) return {};
      return { Item: activeLot };
    }
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const movement = await supply.writeOffLot(tenantId, activeLot.id, 2, "damage", "Broken packaging", { id: "admin", name: "Admin" }, "writeoff-1");
  assert.equal(movement.quantity, -2);
  assert.equal(transaction.length, 3, "lot decrement, movement, and idempotency record must be atomic");
  assert.match(transaction[0].Update.ConditionExpression, /remainingQuantity/);

  const destination = { ...store, id: "store-2", code: "WEST", name: "West Store" };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input.Key.partitionKey;
      if (key.includes("IDEMPOTENCY#")) return {};
      if (key.includes("STORE#store-2")) return { Item: destination };
      if (key.includes("STORE#store-1")) return { Item: store };
      if (key.includes("PRODUCT#")) return { Item: product };
      return {};
    }
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const requisition = await supply.createRequisition(tenantId, { fromStoreId: store.id, toStoreId: destination.id, notes: "Top up shelves", lines: [{ productId: product.id, quantity: 6 }] }, { id: "staff-1", name: "Staff" }, "req-1");
  assert.equal(requisition.status, "requested");
  const storedRequisition = transaction[0].Put.Item;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: storedRequisition };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const approved = await supply.decideRequisition(tenantId, requisition.id, "approve", "Stock available", { id: "admin", name: "Admin" });
  assert.equal(approved.status, "approved");
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return command.input.Key.partitionKey.includes("IDEMPOTENCY#") ? {} : { Item: approved };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const transfer = await supply.convertRequisitionToTransfer(tenantId, requisition.id, { id: "admin", name: "Admin" }, "req-convert-1");
  assert.equal(transfer.status, "draft");
  assert.equal(transfer.fromStoreId, store.id);
  assert.equal(transaction.filter((item) => item.Put?.Item?.entityType === "stock_transfer").length, 1);

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return command.input.Key.partitionKey.includes("IDEMPOTENCY#") ? {} : { Item: transfer };
    if (command.constructor.name === "QueryCommand") return { Items: [activeLot] };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected ${command.constructor.name}`);
  };
  const dispatched = await supply.dispatchTransfer(tenantId, transfer.id, { id: "admin", name: "Admin" }, "dispatch-1");
  assert.equal(dispatched.status, "dispatched");
  const transferLotUpdate = transaction.find((item) => item.Update?.Key?.partitionKey.includes("LOT#"))?.Update;
  assert.ok(transferLotUpdate, "dispatch must decrement the allocated source lot");
  assertUsesEveryExpressionValue(transferLotUpdate, "transfer lot decrement");
  assertUsesEveryExpressionValue(supply.lotDecrement(tenantId, activeLot, activeLot.remainingQuantity, now).Update, "fully exhausted lot decrement");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
