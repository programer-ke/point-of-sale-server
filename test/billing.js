const assert = require("node:assert/strict");
const { buildSchema } = require("graphql");
const { addBillingMonth, billingStatus, effectivePlan, nextBillingPayment, PLANS } = require("../dist/domain/billing");
const { MUTATION_POLICY, applyBillingPolicies } = require("../dist/domain/billing-policy");
const { typeDefs } = require("../dist/graphql/schema");

const account = (updates = {}) => ({
  tenantId: "tenant-1", tenantName: "Market", ownerUserId: "owner", ownerUsername: "owner@example.com",
  planCode: "biashara", trialStartedOn: "2026-08-01", trialEndsOn: "2026-08-14", paidThrough: null,
  cancelledAt: null, pendingPlanCode: null, termsVersion: "v1", privacyVersion: "v1", acceptedAt: "2026-08-01T00:00:00Z",
  acceptedBy: "owner", override: null, offer: null, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", ...updates,
});

assert.equal(PLANS.biashara.activeUserLimit, 5);
assert.equal(PLANS.biashara.activeStoreLimit, 1);
assert.equal(PLANS.biashara.monthlyPriceKes, 800);
assert.equal(PLANS.biashara_growth.monthlyPriceKes, 2000);
assert.equal(PLANS.biashara_growth.activeUserLimit, 10);
assert.equal(PLANS.biashara_growth.activeStoreLimit, 3);
assert.deepEqual(PLANS.biashara_growth.capabilities, ["multi_store", "vat_accounting"]);
assert.equal(PLANS.biashara_plus.monthlyPriceKes, 5000);
assert.equal(PLANS.biashara_plus.activeUserLimit, 30);
assert.equal(PLANS.biashara_plus.activeStoreLimit, 10);
assert.equal(addBillingMonth("2026-01-31"), "2026-02-28");
assert.equal(addBillingMonth("2028-01-31"), "2028-02-29");
assert.equal(billingStatus(account(), "2026-08-14"), "trialing");
assert.equal(billingStatus(account(), "2026-08-15"), "past_due");
assert.equal(billingStatus(account(), "2026-08-16"), "restricted");
assert.equal(billingStatus(account({ paidThrough: "2026-09-30" }), "2026-09-30"), "active");
assert.equal(billingStatus(account({ cancelledAt: "2026-08-01T00:00:00Z" }), "2026-08-16"), "cancelled");
assert.equal(billingStatus(account({ override: { exempt: true, reason: "Partner", updatedAt: "2026-08-01", updatedBy: "admin" } }), "2027-01-01"), "exempt");
assert.deepEqual(effectivePlan(account({ override: { activeUserLimit: 8, monthlyPriceKes: 1200, reason: "Custom", updatedAt: "2026-08-01", updatedBy: "admin" } })).activeUserLimit, 8);
const trialCharge = nextBillingPayment(account({ planCode: "biashara_growth" }), "2026-08-04");
assert.equal(trialCharge.dueOn, "2026-08-15");
assert.equal(trialCharge.periodStartsOn, "2026-08-15");
assert.equal(trialCharge.periodEndsOn, "2026-09-14");
assert.equal(trialCharge.amountKes, 2000);
const launchOffer = { id: "offer-1", label: "Launch offer", pricePercent: 70, durationMonths: 6, remainingPayments: 6, startsOn: "2026-08-15", reason: "Launch", assignedAt: "2026-08-04", assignedBy: "admin" };
const offeredCharge = nextBillingPayment(account({ planCode: "biashara_growth", pendingPlanCode: "biashara_plus", offer: launchOffer }), "2026-08-04");
assert.equal(offeredCharge.planCode, "biashara_plus", "the scheduled plan determines the upcoming payment");
assert.equal(offeredCharge.baseAmountKes, 5000);
assert.equal(offeredCharge.amountKes, 3500, "a 70% price offer charges 70% of the normal rate");
assert.equal(offeredCharge.offerRemainingPayments, 6);
assert.equal(nextBillingPayment(account({ offer: { ...launchOffer, remainingPayments: 0 } }), "2026-08-04").amountKes, 800, "a consumed offer no longer changes the charge");

const mutationFields = Object.keys(buildSchema(typeDefs).getMutationType().getFields()).sort();
assert.deepEqual(Object.keys(MUTATION_POLICY).sort(), mutationFields, "Every GraphQL mutation must have an explicit billing policy");

async function policyTests() {
  process.env.BILLING_ENFORCEMENT_ENABLED = "true";
  const billingRepository = require("../dist/repositories/billing-repository");
  const supply = require("../dist/repositories/supply-chain-repository");
  const tenants = require("../dist/repositories/tenant-repository");
  const cognito = require("../dist/services/cognito");
  let currentAccount = account();
  billingRepository.requireBillingAccount = async () => currentAccount;
  billingRepository.acquireBillingCapacityLock = async () => async () => {};
  supply.listStores = async () => [{ id: "store-1", status: "active" }];
  tenants.listTenantMemberships = async () => Array.from({ length: 5 }, (_, index) => ({ username: `user-${index}` }));
  cognito.getCognitoUser = async () => ({ status: "CONFIRMED" });
  const wrapped = applyBillingPolicies({
    Query: { products: async () => ["ok"], platformBusinesses: async () => ["platform"] },
    Mutation: {
      createBusiness: async () => "created",
      completeSale: async () => "sold",
      updateBusinessDetails: async () => "updated",
      createStore: async () => "store",
      inviteUser: async () => "user",
      confirmBillingPayment: async () => "confirmed",
    },
  });
  const staff = { auth: { id: "staff", username: "staff", roles: ["staff"], activeRole: "staff", tenantId: "tenant-1" } };
  const admin = { auth: { id: "admin", username: "admin", roles: ["admin"], activeRole: "admin", tenantId: "tenant-1" } };
  currentAccount = account({ trialEndsOn: "2026-01-01" });
  await assert.rejects(() => wrapped.Query.products(null, {}, staff), (error) => error.extensions?.code === "SUBSCRIPTION_RESTRICTED");
  assert.deepEqual(await wrapped.Query.products(null, {}, admin), ["ok"], "restricted admins retain read access");
  await assert.rejects(() => wrapped.Mutation.completeSale(null, {}, admin), (error) => error.extensions?.code === "SUBSCRIPTION_RESTRICTED");
  currentAccount = account({ trialStartedOn: kenyaDate(), trialEndsOn: addBillingMonth(kenyaDate()) });
  await assert.rejects(() => wrapped.Mutation.updateBusinessDetails(null, { vatRegistered: true }, admin), (error) => error.extensions?.code === "FEATURE_NOT_INCLUDED");
  await assert.rejects(() => wrapped.Mutation.createStore(null, {}, admin), (error) => error.extensions?.code === "PLAN_LIMIT_REACHED");
  await assert.rejects(() => wrapped.Mutation.inviteUser(null, {}, admin), (error) => error.extensions?.code === "PLAN_LIMIT_REACHED");
  const platform = { auth: { id: "platform", username: "platform", roles: ["superadmin"], activeRole: "superadmin" } };
  assert.deepEqual(await wrapped.Query.platformBusinesses(null, {}, platform), ["platform"]);
  assert.equal(await wrapped.Mutation.confirmBillingPayment(null, {}, platform), "confirmed");
  process.env.BILLING_ENFORCEMENT_ENABLED = "false";
}

const { kenyaDate } = require("../dist/domain/billing");
policyTests().then(() => console.log("billing tests passed")).catch((error) => { console.error(error); process.exitCode = 1; });
