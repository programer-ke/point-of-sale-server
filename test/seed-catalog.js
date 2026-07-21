const assert = require("node:assert/strict");
const { buildMvpSeed } = require("../dist/seed/mvp-catalog.js");

const seed = buildMvpSeed();
assert.equal(seed.categories.length, 10);
assert.equal(seed.products.length, 200);
assert.equal(new Set(seed.products.map(({ sku }) => sku)).size, 200);
assert.equal(new Set(seed.products.map(({ barcode }) => barcode)).size, 200);
assert.ok(seed.products.every(({ sellingPrice, buyingPrice, baseUnit }) => sellingPrice > 0 && buyingPrice > 0 && buyingPrice < sellingPrice && baseUnit));
assert.ok(seed.products.every((product) => !("initialStock" in product) && !("minStock" in product)), "seed products must not create opening stock");
assert.equal(seed.supplyChain.suppliers.length, 3);
assert.equal(seed.supplyChain.supplierProducts.length, 12);
assert.deepEqual(seed.supplyChain.purchaseOrders.map(({ status }) => status), ["completed", "partially_received", "issued", "draft"]);
assert.equal(new Set(seed.supplyChain.suppliers.map(({ code }) => code)).size, seed.supplyChain.suppliers.length);
assert.equal(new Set(seed.supplyChain.purchaseOrders.map(({ key }) => key)).size, seed.supplyChain.purchaseOrders.length);
const productSkus = new Set(seed.products.map(({ sku }) => sku));
const supplierCodes = new Set(seed.supplyChain.suppliers.map(({ code }) => code));
assert.ok(seed.supplyChain.supplierProducts.every(({ supplierCode, productSku, purchaseQuantity }) => supplierCodes.has(supplierCode) && productSkus.has(productSku) && purchaseQuantity > 0));
assert.ok(seed.supplyChain.purchaseOrders.flatMap(({ lines }) => lines).every(({ productSku, orderedPurchaseQuantity }) => productSkus.has(productSku) && orderedPurchaseQuantity > 0));

for (const { barcode } of seed.products) {
  assert.match(barcode, /^616\d{10}$/);
  const digits = [...barcode].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  assert.equal(digits[12], (10 - (sum % 10)) % 10, `${barcode} must have a valid EAN-13 checksum`);
}
