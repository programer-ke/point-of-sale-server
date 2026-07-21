const assert = require("node:assert/strict");
const { buildMvpSeed } = require("../dist/seed/mvp-catalog.js");

const seed = buildMvpSeed();
assert.equal(seed.categories.length, 15);
assert.equal(seed.products.length, 200);
assert.equal(new Set(seed.products.map(({ sku }) => sku)).size, 200);
assert.equal(new Set(seed.products.map(({ barcode }) => barcode)).size, 200);
assert.ok(seed.products.every(({ sellingPrice, buyingPrice, baseUnit }) => sellingPrice > 0 && buyingPrice > 0 && buyingPrice < sellingPrice && baseUnit));
assert.ok(seed.products.every((product) => !("initialStock" in product) && !("minStock" in product)), "seed products must not create opening stock");
assert.equal(seed.supplyChain.suppliers.length, 3);
assert.equal(seed.supplyChain.supplierProducts.length, 12);
assert.equal(seed.supplyChain.stores.length, 3);
assert.equal(seed.supplyChain.storePolicies.length, 9);
assert.equal(seed.supplyChain.purchaseOrders.length, 5);
assert.deepEqual(new Set(seed.supplyChain.purchaseOrders.map(({ status }) => status)), new Set(["completed", "partially_received", "issued", "draft"]));
assert.deepEqual(seed.supplyChain.transfers.map(({ status }) => status), ["completed", "dispatched", "draft"]);
assert.equal(new Set(seed.supplyChain.suppliers.map(({ code }) => code)).size, seed.supplyChain.suppliers.length);
assert.equal(new Set(seed.supplyChain.stores.map(({ code }) => code)).size, seed.supplyChain.stores.length);
assert.equal(new Set(seed.supplyChain.purchaseOrders.map(({ key }) => key)).size, seed.supplyChain.purchaseOrders.length);
assert.equal(new Set(seed.supplyChain.transfers.map(({ key }) => key)).size, seed.supplyChain.transfers.length);
const productSkus = new Set(seed.products.map(({ sku }) => sku));
const supplierCodes = new Set(seed.supplyChain.suppliers.map(({ code }) => code));
const storeCodes = new Set(seed.supplyChain.stores.map(({ code }) => code));
const categoriesByCode = new Map(seed.categories.map((category) => [category.code, category]));
assert.ok(seed.categories.some(({ parentCode }) => parentCode), "seed must demonstrate nested categories");
assert.ok(seed.categories.some(({ parentCode }) => parentCode && categoriesByCode.get(parentCode)?.parentCode), "seed must demonstrate at least three category levels");
assert.ok(seed.categories.every(({ parentCode }) => !parentCode || categoriesByCode.has(parentCode)), "every parent category must exist");
assert.ok(seed.supplyChain.supplierProducts.every(({ supplierCode, productSku, purchaseQuantity }) => supplierCodes.has(supplierCode) && productSkus.has(productSku) && purchaseQuantity > 0));
assert.ok(seed.supplyChain.storePolicies.every(({ storeCode, productSku, reorderPoint, targetQuantity }) => storeCodes.has(storeCode) && productSkus.has(productSku) && reorderPoint >= 0 && targetQuantity >= reorderPoint));
assert.ok(seed.supplyChain.purchaseOrders.every(({ storeCode }) => storeCodes.has(storeCode)));
assert.ok(seed.supplyChain.purchaseOrders.flatMap(({ lines }) => lines).every(({ productSku, orderedPurchaseQuantity, expiryDays }) => productSkus.has(productSku) && orderedPurchaseQuantity > 0 && (expiryDays == null || expiryDays >= 0)));
assert.ok(seed.supplyChain.purchaseOrders.flatMap(({ lines }) => lines).some(({ expiryDays }) => expiryDays === 0), "seed must include stock expiring today");
assert.ok(seed.supplyChain.transfers.every(({ fromStoreCode, toStoreCode }) => storeCodes.has(fromStoreCode) && storeCodes.has(toStoreCode) && fromStoreCode !== toStoreCode));

for (const { barcode } of seed.products) {
  assert.match(barcode, /^616\d{10}$/);
  const digits = [...barcode].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  assert.equal(digits[12], (10 - (sum % 10)) % 10, `${barcode} must have a valid EAN-13 checksum`);
}
