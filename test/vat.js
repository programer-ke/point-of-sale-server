const assert = require("node:assert/strict");
const { inclusiveVatBreakdown, vatApplies, vatRateBasisPoints, withholdingVatMinor } = require("../dist/domain/vat.js");

assert.deepEqual(inclusiveVatBreakdown(11_600, "standard", "2026-08-02"), {
  grossMinor: 11_600,
  taxableMinor: 10_000,
  vatMinor: 1_600,
  rateBasisPoints: 1_600,
});
assert.deepEqual(inclusiveVatBreakdown(11_600, "zero_rated", "2026-08-02"), {
  grossMinor: 11_600,
  taxableMinor: 11_600,
  vatMinor: 0,
  rateBasisPoints: 0,
});
assert.deepEqual(inclusiveVatBreakdown(11_600, "exempt", "2026-08-02"), {
  grossMinor: 11_600,
  taxableMinor: 0,
  vatMinor: 0,
  rateBasisPoints: 0,
});
assert.equal(vatRateBasisPoints("standard", "2026-08-02"), 1_600);
assert.equal(vatApplies({ vatRegistered: true, vatEffectiveFrom: "2026-08-02" }, "2026-08-01"), false);
assert.equal(vatApplies({ vatRegistered: true, vatEffectiveFrom: "2026-08-02" }, "2026-08-02"), true);
assert.equal(withholdingVatMinor(11_600, 10_000, 11_600, true), 200, "full standard-rated settlement withholds 2% of taxable value");
assert.equal(withholdingVatMinor(5_800, 10_000, 11_600, true), 100, "partial settlement withholds proportionally");
assert.equal(withholdingVatMinor(11_600, 10_000, 11_600, false), 0, "non-appointed businesses do not withhold VAT");
