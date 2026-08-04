const assert = require("node:assert/strict");
const { promotionIsEligible } = require("../dist/repositories/billing-promotion-repository");

const promotion = {
  id: "black-friday", name: "Black Friday", description: "Pay less for three renewals", pricePercent: 70,
  durationMonths: 3, audience: "new_accounts", planCodes: ["biashara", "biashara_growth"],
  billingIntervals: ["monthly"],
  startsOn: "2026-11-20", endsOn: "2026-11-30", enabled: true,
  createdAt: "2026-08-04", createdBy: "admin", updatedAt: "2026-08-04", updatedBy: "admin",
};

assert.equal(promotionIsEligible(promotion, "new_accounts", "biashara", "monthly", "2026-11-20"), true);
assert.equal(promotionIsEligible(promotion, "new_accounts", "biashara_growth", "monthly", "2026-11-30"), true);
assert.equal(promotionIsEligible(promotion, "existing_accounts", "biashara", "monthly", "2026-11-25"), false, "audience targeting is enforced");
assert.equal(promotionIsEligible(promotion, "new_accounts", "biashara_plus", "monthly", "2026-11-25"), false, "plan targeting is enforced");
assert.equal(promotionIsEligible(promotion, "new_accounts", "biashara", "annual", "2026-11-25"), false, "billing frequency targeting is enforced");
assert.equal(promotionIsEligible(promotion, "new_accounts", "biashara", "monthly", "2026-12-01"), false, "expired promotions are hidden");
assert.equal(promotionIsEligible({ ...promotion, audience: "all_accounts" }, "existing_accounts", "biashara", "monthly", "2026-11-25"), true);
assert.equal(promotionIsEligible({ ...promotion, enabled: false }, "new_accounts", "biashara", "monthly", "2026-11-25"), false);

console.log("billing promotion tests passed");
