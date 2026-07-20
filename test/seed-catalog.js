const assert = require("node:assert/strict");
const { buildMvpSeed } = require("../dist/seed/mvp-catalog.js");

const seed = buildMvpSeed();
assert.equal(seed.categories.length, 10);
assert.equal(seed.products.length, 200);
assert.equal(new Set(seed.products.map(({ sku }) => sku)).size, 200);
assert.equal(new Set(seed.products.map(({ barcode }) => barcode)).size, 200);
assert.ok(seed.products.every(({ sellingPrice, buyingPrice, baseUnit }) => sellingPrice > 0 && buyingPrice > 0 && buyingPrice < sellingPrice && baseUnit));
assert.ok(seed.products.every((product) => !("initialStock" in product) && !("minStock" in product)), "seed products must not create opening stock");

for (const { barcode } of seed.products) {
  assert.match(barcode, /^616\d{10}$/);
  const digits = [...barcode].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  assert.equal(digits[12], (10 - (sum % 10)) % 10, `${barcode} must have a valid EAN-13 checksum`);
}
