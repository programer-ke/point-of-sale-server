const assert = require("node:assert/strict");
const { MEASUREMENT_UNITS, convertMeasurementToBaseUnits } = require("../dist/domain/measurements.js");
const { validateProductUnits, productUnitsToSaleVariants } = require("../dist/domain/product-units.js");

const allowed = new Set([...Object.keys(MEASUREMENT_UNITS), "pair", "dozen", "pack", "tray", "crate", "carton", "case", "pallet"]);
const egg = { id: "egg", labelCode: "each", name: "Egg", parentUnitId: null, multiplier: 1, quantityInBaseUnits: 1, sellable: true, purchasable: true, sellingPrice: 15, sku: "", barcode: "", status: "active" };
const units = validateProductUnits([
  egg,
  { ...egg, id: "dozen", labelCode: "dozen", name: "Dozen", parentUnitId: "egg", multiplier: 12, quantityInBaseUnits: null, sellingPrice: 170 },
  { ...egg, id: "tray", labelCode: "tray", name: "Tray", parentUnitId: "egg", multiplier: 30, quantityInBaseUnits: null, sellingPrice: 400 },
  { ...egg, id: "carton", labelCode: "carton", name: "Carton", parentUnitId: "tray", multiplier: 12, quantityInBaseUnits: null, sellingPrice: 4_500 },
], allowed);

assert.deepEqual(units.map(({ quantityInBaseUnits }) => quantityInBaseUnits), [1, 12, 30, 360]);
assert.deepEqual(productUnitsToSaleVariants(units).map(({ quantityInBaseUnits }) => quantityInBaseUnits), [1, 12, 30, 360]);
assert.equal(convertMeasurementToBaseUnits(1, "kilogram", "gram"), 1_000);
assert.equal(MEASUREMENT_UNITS.crate, undefined, "crate contents must be product-specific, not a universal measurement");
assert.equal(MEASUREMENT_UNITS.pair, undefined, "pair contents must be product-specific, not a universal measurement");
assert.throws(() => validateProductUnits([
  { ...egg, id: "a", parentUnitId: "b" },
  { ...egg, id: "b", parentUnitId: "a" },
], allowed), /cycle/);
assert.throws(() => validateProductUnits([{ ...egg, labelCode: "bucket" }], allowed), /not enabled/);
assert.throws(() => validateProductUnits([{ ...egg, quantityInBaseUnits: Number.MAX_SAFE_INTEGER, multiplier: 2 }, { ...egg, id: "too-large", parentUnitId: "egg", multiplier: 2, quantityInBaseUnits: null }], allowed), /safe|whole base quantity/);
