const assert = require("node:assert/strict");

process.env.AWS_DYNAMODB_TABLE = "test-table";
const { dynamoDB } = require("../dist/config/db.js");
const repository = require("../dist/repositories/pos-repository.js");
const { previewCatalogImport } = require("../dist/graphql/resolvers.js");
const tenantId = "tenant-1";

const assertExpressionBindingsMatch = (operation, label) => {
  const expression = [operation.KeyConditionExpression, operation.FilterExpression, operation.UpdateExpression, operation.ConditionExpression, operation.ProjectionExpression].filter(Boolean).join(" ");
  const referencedValues = [...new Set(expression.match(/:[A-Za-z0-9_]+/g) ?? [])].sort();
  const suppliedValues = Object.keys(operation.ExpressionAttributeValues ?? {}).sort();
  assert.deepEqual(suppliedValues, referencedValues, `${label} expression values must exactly match its placeholders`);
  const referencedNames = [...new Set(expression.match(/#[A-Za-z0-9_]+/g) ?? [])].sort();
  const suppliedNames = Object.keys(operation.ExpressionAttributeNames ?? {}).sort();
  assert.deepEqual(suppliedNames, referencedNames, `${label} expression names must exactly match its placeholders`);
};

const assertNoUndefined = (value, path = "transaction") => {
  assert.notEqual(value, undefined, `${path} must not contain undefined values`);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => assertNoUndefined(item, `${path}.${key}`));
};

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
  sellingPrice: 125,
  buyingPrice: 80,
  baseUnit: "each",
  stockUnit: "each",
  tracksExpiry: false,
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
};
const cashShift = { id: "shift-1", storeId: "store-1", storeName: "Main Store", cashierId: "cashier-1", cashierName: "Cashier Name", status: "open", openingFloat: 500, cashSalesTotal: 0, cashInTotal: 0, cashOutTotal: 0, openedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const store = { id: "store-1", code: "MAIN", name: "Main Store", address: "Nairobi", receiptBusinessName: "Main Market", receiptAddress: "", receiptPhone: "", receiptEmail: "", receiptFooter: "", receiptReturnPolicy: "", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const lot = {
  partitionKey: "TENANT#tenant-1#LOT#lot-1", sortKey: "PROFILE", accessPartition: "TENANT#tenant-1#INVENTORY#ACTIVE",
  accessSort: "store-1#9999-12-31#2026-01-01#lot-1", id: "lot-1", storeId: "store-1", productId: "product-1",
  productName: "Tea", batchNumber: "BATCH-1", expiryDate: null, receivedQuantity: 5, remainingQuantity: 5,
  unitCost: 80, origin: "supplier_receipt", status: "active", receivedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

async function main() {
  let transaction;
  let checkoutPolicy;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.partitionKey.includes("IDEMPOTENCY#")) return {};
      if (command.input.Key.partitionKey.includes("CASH_SHIFT_OPEN#")) return { Item: { shiftId: cashShift.id } };
      if (command.input.Key.partitionKey.endsWith(`CASH_SHIFT#${cashShift.id}`)) return { Item: cashShift };
      if (command.input.Key.partitionKey.includes("STORE#")) return { Item: store };
      if (command.input.Key.partitionKey.endsWith("SETTINGS#BUSINESS")) return {};
      if (command.input.Key.partitionKey.endsWith("SETTINGS#CHECKOUT")) return checkoutPolicy ? { Item: checkoutPolicy } : {};
      return { Item: command.input.Key.partitionKey.endsWith("PRODUCT#product-2") ? secondProduct : product };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    if (command.constructor.name === "QueryCommand") {
      if (command.input.ExpressionAttributeValues[":pk"].includes("INVENTORY#ACTIVE")) return { Items: [lot] };
      const start = command.input.ExclusiveStartKey ? 1 : 0;
      const items = [product, secondProduct].slice(start, start + command.input.Limit);
      return { Items: items, LastEvaluatedKey: start + items.length < 2 ? { partitionKey: product.partitionKey, sortKey: product.sortKey, accessPartition: product.accessPartition, accessSort: product.accessSort } : undefined };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };

  const sale = await repository.completeSale(
    tenantId,
    {
      customerName: "Walk-in",
      storeId: "store-1",
      paymentMethod: "cash",
      amountTendered: 300,
      requestId: "sale-1",
      items: [{ productId: "product-1", quantity: 2 }],
    },
    { id: "cashier-1", name: "Cashier Name", employeeCode: "EMP-001", storeName: "Main Store" },
  );

  assert.equal(sale.items[0].price, 125, "server price must be authoritative");
  assert.equal(sale.totalAmount, 250);
  assert.equal(sale.amountTendered, 300);
  assert.equal(sale.changeDue, 50);
  assert.equal(sale.cashierDisplayName, "Cashier (EMP-001)");
  assert.equal(sale.storeName, "Main Store", "sales must retain the selling store at checkout time");
  assert.equal(sale.receiptBranding.businessName, "Main Market");
  assert.equal(sale.receiptBranding.storeName, "Main Store");
  assert.equal("priceBeforeOverride" in sale.items[0], false, "ordinary sale items must omit optional override fields instead of storing undefined values");
  assert.equal("priceOverrideReason" in sale.items[0], false, "ordinary sale items must be safe to marshal to DynamoDB");
  assert.equal(transaction.length, 5, "lot update, movement, receipt, cash shift, and idempotency must be atomic");
  assertNoUndefined(transaction);
  assert.match(transaction[0].Update.ConditionExpression, /remainingQuantity.*>=/);
  for (const placeholder of Object.keys(transaction[0].Update.ExpressionAttributeValues)) {
    assert.match(`${transaction[0].Update.UpdateExpression} ${transaction[0].Update.ConditionExpression}`, new RegExp(placeholder.replace(":", "\\:")), `lot decrement must use ${placeholder}`);
  }
  assert.equal(transaction[2].Put.Item.orderNumber, sale.orderNumber);

  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "cash", amountTendered: 300, items: [{ productId: "product-1", quantity: 1, expectedCatalogPrice: 100 }], requestId: "sale-stale-price" }, { id: "cashier-1", name: "Cashier" }),
    (error) => error.extensions?.code === "PRICE_CHANGED" && error.extensions.priceChanges[0].currentPrice === 125,
    "checkout must reject a catalog price that changed after the basket was built",
  );

  const adminOverride = await repository.completeSale(
    tenantId,
    { storeId: "store-1", paymentMethod: "cash", amountTendered: 300, items: [{ productId: "product-1", quantity: 1, unitPriceOverride: 100, priceOverrideReason: "Customer goodwill" }], requestId: "sale-admin-override" },
    { id: "cashier-1", name: "Admin", role: "admin" },
  );
  assert.equal(adminOverride.items[0].price, 100);
  assert.equal(adminOverride.items[0].priceBeforeOverride, 125);
  assert.equal(adminOverride.items[0].priceOverrideReason, "Customer goodwill");
  assert.ok(transaction.some((item) => item.Put?.Item?.action === "checkout.price_overrides.applied"), "price overrides must add an audit event to the sale transaction");

  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "cash", amountTendered: 300, items: [{ productId: "product-1", quantity: 1, unitPriceOverride: 115, priceOverrideReason: "Approved markdown" }], requestId: "sale-disabled-override" }, { id: "cashier-1", name: "Cashier", role: "staff" }),
    /markdowns are disabled/,
  );
  checkoutPolicy = { enabledPaymentMethods: ["cash", "mpesa"], defaultPaymentMethod: "cash", requireCustomerName: true, allowStaffPriceOverrides: true, maxStaffPriceDiscountPercent: 10, updatedAt: new Date().toISOString() };
  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "cash", amountTendered: 300, items: [{ productId: "product-1", quantity: 1 }], requestId: "sale-customer-required" }, { id: "cashier-1", name: "Cashier", role: "staff" }),
    /Customer name is required/,
  );
  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", customerName: "Customer", paymentMethod: "cash", amountTendered: 300, items: [{ productId: "product-1", quantity: 1, unitPriceOverride: 100, priceOverrideReason: "Too much" }], requestId: "sale-over-cap" }, { id: "cashier-1", name: "Cashier", role: "staff" }),
    /exceeds the 10% limit/,
  );
  const staffOverride = await repository.completeSale(
    tenantId,
    { storeId: "store-1", customerName: "Customer", paymentMethod: "cash", amountTendered: 300, items: [{ productId: "product-1", quantity: 1, unitPriceOverride: 115, priceOverrideReason: "Loyalty markdown" }], requestId: "sale-staff-override" },
    { id: "cashier-1", name: "Cashier", role: "staff" },
  );
  assert.equal(staffOverride.totalAmount, 115);
  checkoutPolicy = { ...checkoutPolicy, enabledPaymentMethods: ["mpesa"], defaultPaymentMethod: "mpesa", requireCustomerName: false };
  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "cash", amountTendered: 300, items: [{ productId: "product-1", quantity: 1 }], requestId: "sale-disabled-payment" }, { id: "cashier-1", name: "Cashier", role: "staff" }),
    /payment method is disabled/,
  );
  checkoutPolicy = undefined;

  await assert.rejects(
    () => repository.updateProduct(tenantId, "product-1", { sellingPrice: 60 }, { id: "admin", name: "Admin" }),
    /Use Adjust prices/,
  );
  const belowCostProduct = await repository.adjustProductPrices(
    tenantId,
    "product-1",
    { lines: [{ productUnitId: "product-1-default", newPrice: 60 }], effectiveAt: "2026-01-01T00:00:00.000Z", reason: "Supplier cost review", requestId: "price-now" },
    { id: "admin", name: "Admin" },
  );
  assert.equal(belowCostProduct.sellingPrice, 60, "below-cost prices warn in the UI but remain valid");
  assert.match(transaction[1].Put.Item.reason, /125.00 to 60.00/);
  assert.equal(sale.items[0].price, 125, "product price updates must not rewrite completed sales");

  const scheduled = await repository.adjustProductPrices(
    tenantId,
    "product-1",
    { lines: [{ productUnitId: "product-1-default", newPrice: 150 }], effectiveAt: "2099-01-01T00:00:00.000Z", reason: "Future supplier increase", requestId: "price-future" },
    { id: "admin", name: "Admin" },
  );
  assert.equal(repository.pendingPriceAdjustment(scheduled)?.lines[0].newPrice, 150);
  assert.equal(repository.regularVariantPrice(scheduled, "product-1-default", new Date("2100-01-01T00:00:00.000Z")), 150);
  product.priceAdjustment = scheduled.priceAdjustment;
  const cancelled = await repository.cancelProductPriceAdjustment(tenantId, "product-1", "Labels are not ready", { id: "admin", name: "Admin" }, "price-cancel");
  assert.equal(cancelled.priceAdjustment, undefined);
  assert.match(transaction[1].Put.Item.reason, /cancelled adjustment/);
  delete product.priceAdjustment;

  const firstPage = await repository.getProductPage(tenantId, { limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.totalCount, 2);
  assert.ok(firstPage.nextCursor, "a further product page must have a cursor");
  const secondPage = await repository.getProductPage(tenantId, { limit: 1, cursor: firstPage.nextCursor });
  assert.equal(secondPage.items[0].id, "product-2");
  const searchPage = await repository.getProductPage(tenantId, { search: "coffee", limit: 20 });
  assert.deepEqual(searchPage.items.map(({ id }) => id), ["product-2"]);

  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "cash", amountTendered: 1_000, items: [{ productId: "product-1", quantity: 6 }], requestId: "sale-insufficient" }, { id: "cashier", name: "Cashier" }),
    /Insufficient sellable stock/,
  );
  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "cash", amountTendered: 100, items: [{ productId: "product-1", quantity: 1 }], requestId: "sale-tender" }, { id: "cashier-1", name: "Cashier" }),
    /at least the amount due/,
  );
  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "mpesa", mpesaReference: "BAD", items: [{ productId: "product-1", quantity: 1 }], requestId: "sale-bad-mpesa" }, { id: "cashier", name: "Cashier" }),
    /valid M-Pesa transaction code/,
  );

  const promoted = { ...product, promotionPrice: 100 };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.partitionKey.includes("PAYMENT#") || command.input.Key.partitionKey.includes("IDEMPOTENCY#") || command.input.Key.partitionKey.endsWith("SETTINGS#BUSINESS")) return {};
      if (command.input.Key.partitionKey.includes("STORE#")) return { Item: store };
      return { Item: promoted };
    }
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    if (command.constructor.name === "QueryCommand") return { Items: [lot] };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const mpesaSale = await repository.completeSale(
    tenantId,
    { storeId: "store-1", paymentMethod: "mpesa", mpesaReference: "QGH1234567", items: [{ productId: "product-1", quantity: 2 }], requestId: "sale-mpesa" },
    { id: "cashier", name: "Cashier Name" },
  );
  assert.equal(mpesaSale.subtotal, 250);
  assert.equal(mpesaSale.discount, 50);
  assert.equal(mpesaSale.totalAmount, 200);
  assert.equal(mpesaSale.paymentReference, "QGH1234567");
  assert.equal(mpesaSale.createdByName, "Cashier Name");
  assert(transaction.some((item) => item.Put?.Item?.partitionKey === "TENANT#tenant-1#PAYMENT#MPESA#QGH1234567"));
  assert(transaction.some((item) => item.Put?.Item?.partitionKey === "MPESA_RECEIPT_CLAIM#QGH1234567"), "manual M-Pesa must claim the receipt globally");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      if (command.input.Key.partitionKey.includes("IDEMPOTENCY#")) return {};
      if (command.input.Key.partitionKey.includes("STORE#")) return { Item: store };
      if (command.input.Key.partitionKey.endsWith("SETTINGS#BUSINESS")) return {};
      return command.input.Key.partitionKey.includes("PAYMENT#") ? { Item: { saleId: "existing-sale" } } : { Item: promoted };
    }
    if (command.constructor.name === "QueryCommand") return { Items: [lot] };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  await assert.rejects(
    () => repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "mpesa", mpesaReference: "QGH1234567", items: [{ productId: "product-1", quantity: 1 }], requestId: "sale-duplicate-mpesa" }, { id: "cashier", name: "Cashier" }),
    /already been used/,
  );

  const rice = { ...product, name: "Rice", baseUnit: "gram", stockUnit: "kilogram", sellingPrice: 80, saleVariants: [
    { id: "rice-500g", name: "500 g", sku: "RICE-500", barcode: "500500", quantityInBaseUnits: 500, sellingPrice: 80, status: "active" },
    { id: "rice-1kg", name: "1 kg", sku: "RICE-1KG", barcode: "10001000", quantityInBaseUnits: 1000, sellingPrice: 150, status: "active" },
  ] };
  const riceLot = { ...lot, productName: "Rice", receivedQuantity: 2000, remainingQuantity: 2000, unitCost: 0.1 };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input.Key.partitionKey;
      if (key.includes("IDEMPOTENCY#") || key.endsWith("SETTINGS#BUSINESS")) return {};
      if (key.includes("CASH_SHIFT_OPEN#")) return { Item: { shiftId: cashShift.id } };
      if (key.endsWith(`CASH_SHIFT#${cashShift.id}`)) return { Item: cashShift };
      if (key.includes("STORE#")) return { Item: store };
      return { Item: rice };
    }
    if (command.constructor.name === "QueryCommand") return { Items: [riceLot] };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const weighedSale = await repository.completeSale(tenantId, { storeId: "store-1", paymentMethod: "cash", amountTendered: 200, items: [{ productId: rice.id, variantId: "rice-500g", quantity: 2 }], requestId: "sale-rice" }, { id: "cashier-1", name: "Cashier" });
  assert.equal(weighedSale.totalAmount, 160);
  assert.equal(weighedSale.items[0].inventoryQuantity, 1000, "two 500 g variants must consume 1,000 gram inventory units");
  assert.equal(transaction[0].Update.ExpressionAttributeValues[":quantity"], 1000);

  const service = { ...product, id: "service-1", itemType: "service", name: "Bandaging", sku: "SVC-1", barcode: "", buyingPrice: 0, sellingPrice: 250, saleVariants: [{ id: "service-1-default", name: "Service", sku: "SVC-1", barcode: "", quantityInBaseUnits: 1, sellingPrice: 250, status: "active" }], serviceComponents: [{ productId: product.id, productName: product.name, quantity: 2, stockUnit: "each" }] };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input.Key.partitionKey;
      if (key.includes("IDEMPOTENCY#") || key.endsWith("SETTINGS#BUSINESS")) return {};
      if (key.includes("CASH_SHIFT_OPEN#")) return { Item: { shiftId: cashShift.id } };
      if (key.endsWith(`CASH_SHIFT#${cashShift.id}`)) return { Item: cashShift };
      if (key.includes("STORE#")) return { Item: store };
      return { Item: key.endsWith("PRODUCT#service-1") ? service : product };
    }
    if (command.constructor.name === "QueryCommand") return { Items: [lot] };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const serviceSale = await repository.completeSale(tenantId, { storeId: store.id, paymentMethod: "cash", amountTendered: 500, items: [{ productId: service.id, quantity: 2 }], requestId: "sale-service" }, { id: "cashier-1", name: "Cashier" });
  assert.equal(serviceSale.items[0].inventoryQuantity, 0, "a service has no stock of its own");
  assert.equal(serviceSale.items[0].consumedComponents[0].quantity, 4, "service materials scale with the sold quantity");
  assert.equal(serviceSale.items[0].cost, 160, "service COGS comes from consumed product lots");
  assert.equal(transaction.find((item) => item.Put?.Item?.entityType === "stock_movement").Put.Item.type, "service_consumption");
  assert.equal(transaction[0].Update.ExpressionAttributeValues[":quantity"], 4);

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") {
      const key = command.input.Key.partitionKey;
      if (key.includes("IDEMPOTENCY#") || key.endsWith("SETTINGS#BUSINESS")) return {};
      if (key.endsWith("PRODUCT#service-1")) return { Item: service };
      return { Item: { ...product, status: "inactive" } };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  await assert.rejects(() => repository.completeSale(tenantId, { storeId: store.id, paymentMethod: "cash", amountTendered: 500, items: [{ productId: service.id, quantity: 1 }], requestId: "sale-service-archived-component" }, { id: "cashier-1", name: "Cashier" }), /service materials are unavailable/);

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return {};
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const openedShift = await repository.openCashShift(tenantId, { id: "store-1", name: "Main Store" }, 500, { id: "cashier-1", name: "Cashier Name" }, "open-shift-1");
  assert.equal(openedShift.status, "open");
  assert.equal(transaction.length, 3, "shift, open-shift lookup, and idempotency must be atomic");
  const storedShift = transaction[0].Put.Item;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return command.input.Key.partitionKey.includes("IDEMPOTENCY#") ? {} : { Item: storedShift };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const closedShift = await repository.closeCashShift(tenantId, openedShift.id, 510, { id: "cashier-1", name: "Cashier Name" }, "close-shift-1");
  assert.equal(closedShift.expectedCash, 500);
  assert.equal(closedShift.variance, 10);
  assert.equal(transaction.length, 3, "shift close, open lookup removal, and idempotency must be atomic");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return {};
    if (command.constructor.name === "TransactWriteCommand") {
      transaction = command.input.TransactItems;
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const defaults = await repository.getBusinessSettings(tenantId);
  assert.equal(defaults.businessName, "My Business");
  const settings = await repository.updateBusinessSettings(
    tenantId,
    { businessName: "Test Market", address: "Nairobi", phone: "+254700000000", email: "hello@example.com", thankYouMessage: "Asante sana", returnPolicy: "Goods once sold cannot be returned." },
    { id: "admin", name: "Admin" },
  );
  assert.equal(settings.thankYouMessage, "Asante sana");
  assert.equal(transaction.length, 2, "settings update and its audit event must be atomic");
  assert.ok(transaction[0].Update, "branding must update only its own fields");
  assertExpressionBindingsMatch(transaction[0].Update, "settings update");
  await repository.updateBusinessReceiptSettings(tenantId, { thankYouMessage: "Karibu tena", returnPolicy: "Returns with receipt" }, { id: "admin", name: "Admin" });
  assert.match(transaction[0].Update.UpdateExpression, /thankYouMessage/);
  assert.doesNotMatch(transaction[0].Update.UpdateExpression, /businessName/, "receipt saves must not overwrite business details");
  const checkoutDefaults = await repository.getBusinessCheckoutSettings(tenantId);
  assert.deepEqual(checkoutDefaults.enabledPaymentMethods, ["cash", "mpesa"]);
  assert.equal(checkoutDefaults.allowStaffPriceOverrides, false);
  const checkoutSettings = await repository.updateBusinessCheckoutSettings(tenantId, { enabledPaymentMethods: ["mpesa"], defaultPaymentMethod: "mpesa", requireCustomerName: true, allowStaffPriceOverrides: true, maxStaffPriceDiscountPercent: 12.5 }, { id: "admin", name: "Admin" });
  assert.deepEqual(checkoutSettings.enabledPaymentMethods, ["mpesa"]);
  assert.equal(checkoutSettings.maxStaffPriceDiscountPercent, 12.5);
  assert.equal(transaction[0].Put.Item.entityType, "checkout_settings");
  await assert.rejects(() => repository.updateBusinessCheckoutSettings(tenantId, { enabledPaymentMethods: [], defaultPaymentMethod: "cash", requireCustomerName: false, allowStaffPriceOverrides: false, maxStaffPriceDiscountPercent: 10 }, { id: "admin", name: "Admin" }), /at least one/);

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

  const childCategory = { ...category, id: "category-2", code: "TEA", name: "Tea", parentId: "category-1", parentName: "Beverages" };
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return command.input.Key.partitionKey.includes("LOOKUP#CATEGORY") ? {} : { Item: category };
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const createdChild = await repository.createCategory(tenantId, { code: "TEA", name: "Tea", description: "Tea products", parentId: category.id, status: "active" }, { id: "admin", name: "Admin" });
  assert.equal(createdChild.parentId, category.id);
  assert.equal(createdChild.parentName, category.name);
  assert.equal(transaction[0].Put.Item.parentId, category.id, "category hierarchy must be stored on the category record");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "UpdateCommand") return { Attributes: { value: 7 } };
    if (command.constructor.name === "GetCommand") return {};
    if (command.constructor.name === "TransactWriteCommand") { transaction = command.input.TransactItems; return {}; }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const generatedCategory = await repository.createCategory(tenantId, { code: "", name: "Generated", description: "", status: "active" }, { id: "admin", name: "Admin" });
  assert.equal(generatedCategory.code, "CAT-000007", "blank category codes must use the tenant sequence");
  assert.equal(transaction[1].Put.Item.partitionKey, "TENANT#tenant-1#LOOKUP#CATEGORY#CAT-000007");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: category };
    if (command.constructor.name === "QueryCommand") return { Items: [category, childCategory] };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  await assert.rejects(
    () => repository.updateCategory(tenantId, category.id, { code: category.code, name: category.name, description: category.description, parentId: childCategory.id }, { id: "admin", name: "Admin" }),
    /descendants/,
    "a category must not be moved under its own child",
  );

  let categoryQuery = 0;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return { Item: category };
    if (command.constructor.name === "QueryCommand") return { Items: categoryQuery++ === 0 ? [] : [childCategory] };
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  await assert.rejects(
    () => repository.deleteCategory(tenantId, category.id, { id: "admin", name: "Admin" }),
    /child categories/,
    "parent categories must not be deleted while children still reference them",
  );

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
  assert.equal((await repository.getStaffProfile(tenantId, "cashier-1")).storeId, undefined);
  const updatedProfile = await repository.upsertStaffProfile(tenantId, "cashier-1", {
    employeeCode: "EMP-001",
    jobTitle: "Cashier",
    storeId: "store-1",
    storeName: "Main Store",
    phone: "+254700000000",
  });
  assert.equal(updatedProfile.storeName, "Main Store");
  assert.equal(transaction[0].Put.Item.storeId, "store-1");

  let batchCount = 0;
  dynamoDB.send = async (command) => {
    assert.equal(command.constructor.name, "BatchGetCommand");
    batchCount += 1;
    const keys = command.input.RequestItems["test-table"].Keys;
    assert.ok(keys.length <= 100, "DynamoDB batch reads must not exceed 100 keys");
    return { Responses: { "test-table": keys.map((key) => ({ ...key, userId: key.partitionKey.split("USER#")[1], employeeCode: "EMP", jobTitle: "Cashier", storeId: "store-1", storeName: "Main Store", phone: "" })) } };
  };
  const manyProfiles = await repository.getStaffProfiles(tenantId, Array.from({ length: 101 }, (_, index) => `staff-${index}`));
  assert.equal(manyProfiles.size, 101);
  assert.equal(batchCount, 2, "staff profile reads must be chunked across DynamoDB batch limits");

  dynamoDB.send = async (command) => {
    if (command.constructor.name === "GetCommand") return {};
    if (command.constructor.name === "QueryCommand") {
      const partition = command.input.ExpressionAttributeValues[":pk"];
      if (partition.endsWith("CATALOG#PRODUCT")) return { Items: [product] };
      if (partition.endsWith("CATALOG#CATEGORY")) return { Items: [{ id: "health", name: "Health", code: "HEALTH", description: "", parentId: null, status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01" }] };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };
  const importPreview = await previewCatalogImport(tenantId, [
    { rowNumber: 2, itemType: "product", name: "Bandage", categoryPath: "Health > First Aid", sku: "BANDAGE", barcode: "", sellingPrice: 50, description: "", stockUnit: "each", buyingPrice: 20, tracksExpiry: false },
    { rowNumber: 3, itemType: "service", name: "Bandaging", categoryPath: "Health > First Aid", sku: "SERVICE-1", barcode: "", sellingPrice: 250, description: "", stockUnit: "each" },
    { rowNumber: 4, itemType: "product", name: "Duplicate tea", categoryPath: "Health", sku: "TEA-1", barcode: "", sellingPrice: 100, description: "", stockUnit: "each" },
  ]);
  assert.deepEqual(importPreview.categoriesToCreate, ["Health > First Aid"]);
  assert.equal(importPreview.importableRows, 1);
  assert.match(importPreview.rows[1].errors.join(" "), /stock fields blank/);
  assert.match(importPreview.rows[2].errors.join(" "), /already exists/);

  const reportService = { ...product, id: "service-report", itemType: "service", name: "Consultation", sku: "CONSULT", barcode: "", buyingPrice: 0, stockUnit: "each", baseUnit: "each", saleVariants: [{ id: "service-report-default", name: "Service", sku: "CONSULT", barcode: "", quantityInBaseUnits: 1, sellingPrice: 300, status: "active" }], serviceComponents: [] };
  const serviceReportSale = { id: "sale-service-report", orderNumber: "SALE-SERVICE", customerName: "Cash customer", items: [{ productId: reportService.id, productName: reportService.name, sku: reportService.sku, barcode: "", variantId: reportService.saleVariants[0].id, variantName: "Service", quantityInBaseUnits: 1, inventoryQuantity: 0, quantity: 2, price: 300, cost: 50, total: 600 }], subtotal: 600, tax: 0, discount: 0, totalAmount: 600, status: "completed", paymentMethod: "cash", paymentStatus: "paid", createdBy: "cashier-1", createdByName: "Cashier", storeId: store.id, storeName: store.name, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z" };
  dynamoDB.send = async (command) => {
    if (command.constructor.name !== "QueryCommand") throw new Error(`Unexpected command ${command.constructor.name}`);
    const partition = command.input.ExpressionAttributeValues[":pk"];
    if (partition.endsWith("CATALOG#PRODUCT")) return { Items: [product, reportService] };
    if (partition.endsWith("SALE")) return { Items: [serviceReportSale] };
    if (partition.endsWith("AUDIT")) return { Items: [] };
    if (partition.endsWith("STORE")) return { Items: [store] };
    if (partition.includes("INVENTORY#ACTIVE")) return { Items: [lot] };
    if (partition.includes("#POLICY")) return { Items: [] };
    throw new Error(`Unexpected query ${partition}`);
  };
  const reportWithService = await repository.businessReport(tenantId, { from: "2026-08-01", to: "2026-08-31", storeId: store.id });
  assert.equal(reportWithService.topProducts.find(({ productId }) => productId === reportService.id).units, 2, "services must contribute sold units to sales reports");
  assert.equal(reportWithService.stockProducts.some(({ productId }) => productId === reportService.id), false, "services must stay out of stock reports");

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
  let lastQuery;
  dynamoDB.send = async (command) => {
    if (command.constructor.name === "QueryCommand") {
      lastQuery = command.input;
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
  await repository.listSales(tenantId, 100, { to: "2026-07-20" });
  assert.match(lastQuery.KeyConditionExpression, /accessSort <= :to/);
  assertExpressionBindingsMatch(lastQuery, "upper-bounded sales query");
  await repository.listSalesByStaff(tenantId, "cashier-1", 100, { to: "2026-07-20" });
  assert.match(lastQuery.KeyConditionExpression, /accessSort <= :to/);
  assertExpressionBindingsMatch(lastQuery, "upper-bounded staff sales query");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
