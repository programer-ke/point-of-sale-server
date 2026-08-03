import type { GraphQLContext } from "../auth";
import { forbiddenError } from "../auth";
import { getCognitoUser } from "../services/cognito";
import { getBusinessSettings } from "../repositories/pos-repository";
import { listStores } from "../repositories/supply-chain-repository";
import { listTenantMemberships } from "../repositories/tenant-repository";
import { acquireBillingCapacityLock, billingEnforcementEnabled, requireBillingAccount } from "../repositories/billing-repository";
import { billingStatus, effectivePlan, featureError, limitError, subscriptionError } from "./billing";

export type MutationClass = "onboarding" | "operational" | "safe_settings" | "billing" | "platform";

export const MUTATION_POLICY: Record<string, MutationClass> = {
  createBusiness: "onboarding",
  inviteUser: "operational", resendUserInvitation: "operational", updateUserRoles: "operational", setUserEnabled: "operational",
  updateStaffEmail: "operational", deleteStaffUser: "operational", updateMyProfile: "operational", updateStaffProfile: "operational",
  updateBusinessSettings: "safe_settings", updateBusinessDetails: "safe_settings", updateBusinessReceiptSettings: "safe_settings",
  updateBusinessCheckoutSettings: "safe_settings", updateBusinessMeasurementSettings: "safe_settings",
  createCategory: "operational", updateCategory: "operational", deleteCategory: "operational", createProduct: "operational",
  updateProduct: "operational", archiveProduct: "operational", completeSale: "operational", createStore: "operational", updateStore: "operational",
  createSupplier: "operational", updateSupplier: "operational", upsertSupplierProduct: "operational", removeSupplierProduct: "operational",
  upsertStorePolicy: "operational", createPurchaseOrder: "operational", updatePurchaseOrder: "operational", issuePurchaseOrder: "operational",
  sendPurchaseOrderEmail: "operational", closePurchaseOrder: "operational", cancelPurchaseOrder: "operational", receivePurchaseOrder: "operational",
  writeOffLot: "operational", countInventoryLot: "operational", createStockTransfer: "operational", dispatchStockTransfer: "operational",
  receiveStockTransfer: "operational", cancelStockTransfer: "operational", createStockRequisition: "operational", decideStockRequisition: "operational",
  convertStockRequisition: "operational", createStocktake: "operational", completeStocktake: "operational", cancelStocktake: "operational",
  openCashShift: "operational", recordCashMovement: "operational", closeCashShift: "operational", markNotificationRead: "operational",
  markAllNotificationsRead: "operational", createSupplierInvoice: "operational", recordSupplierPayment: "operational", voidSupplierPayment: "operational",
  submitBillingPayment: "billing", scheduleBillingPlan: "billing", cancelBillingSubscription: "billing",
  confirmBillingPayment: "platform", rejectBillingPayment: "platform", assignPlatformBillingPlan: "platform", updateBillingOverride: "platform", attachBillingEtimsReference: "platform",
};

const platformQueries = new Set(["platformBillingAccounts", "platformBillingAccount", "platformBillingConfiguration"]);
const accessQueries = new Set(["subscriptionAccess"]);
const billingQueries = new Set(["billingOverview"]);
const accountingQueries = new Set(["accountingSummary", "supplierInvoices", "unbilledGoodsReceipts"]);
const multiStoreMutations = new Set([
  "createStockTransfer", "dispatchStockTransfer", "receiveStockTransfer", "cancelStockTransfer",
  "createStockRequisition", "decideStockRequisition", "convertStockRequisition",
]);
const accountingMutations = new Set(["createSupplierInvoice", "recordSupplierPayment", "voidSupplierPayment"]);
const capacityResource = (field: string, args: Record<string, unknown>): "users" | "stores" | null => {
  if (field === "inviteUser" || (field === "setUserEnabled" && args.enabled === true)) return "users";
  if (field === "createStore" || (field === "updateStore" && args.status === "active")) return "stores";
  return null;
};

const tenantId = (context: GraphQLContext) => {
  if (!context.auth.tenantId) throw forbiddenError();
  return context.auth.tenantId;
};

const enforceSubscriptionAccess = async (context: GraphQLContext, allowRestrictedAdmin: boolean) => {
  if (!billingEnforcementEnabled()) return null;
  const account = await requireBillingAccount(tenantId(context));
  const status = billingStatus(account);
  if ((status === "restricted" || status === "cancelled") && !(allowRestrictedAdmin && context.auth.activeRole === "admin")) {
    throw subscriptionError();
  }
  return account;
};

const enabledUserCount = async (tenant: string) => {
  const memberships = await listTenantMemberships(tenant);
  const users = await Promise.all(memberships.map(({ username }) => getCognitoUser(username)));
  return users.filter((user) => user.status !== "DISABLED").length;
};

const enforceCapabilities = async (field: string, args: Record<string, unknown>, context: GraphQLContext) => {
  if (!billingEnforcementEnabled()) return;
  const id = tenantId(context);
  const account = await requireBillingAccount(id);
  const plan = effectivePlan(account);
  if (multiStoreMutations.has(field) && !plan.multiStore) throw featureError("Multi-store workflows");
  if (accountingMutations.has(field) && !plan.vatAccounting) throw featureError("VAT and accounting");
  if ((field === "updateBusinessSettings" || field === "updateBusinessDetails") && args.vatRegistered === true && !plan.vatAccounting) {
    throw featureError("VAT and accounting");
  }
  if ((field === "inviteUser" || field === "updateStaffProfile") && Array.isArray(args.storeIds) && new Set([args.storeId, ...args.storeIds].filter(Boolean)).size > 1 && !plan.multiStore) {
    throw featureError("Multi-store staff access");
  }
  if (field === "createStore" && plan.activeStoreLimit !== null) {
    const count = (await listStores(id)).filter((store) => store.status === "active").length;
    if (count >= plan.activeStoreLimit) throw limitError("stores", plan.activeStoreLimit);
  }
  if (field === "updateStore" && args.status === "active" && plan.activeStoreLimit !== null) {
    const stores = await listStores(id);
    const target = stores.find((store) => store.id === args.id);
    if (target?.status !== "active" && stores.filter((store) => store.status === "active").length >= plan.activeStoreLimit) throw limitError("stores", plan.activeStoreLimit);
  }
  if ((field === "inviteUser" || (field === "setUserEnabled" && args.enabled === true)) && plan.activeUserLimit !== null) {
    if (await enabledUserCount(id) >= plan.activeUserLimit) throw limitError("users", plan.activeUserLimit);
  }
};

type ResolverCollection = { Query: object; Mutation: object };
type Resolver = (parent: unknown, args: Record<string, unknown>, context: GraphQLContext, info: unknown) => unknown;

export const applyBillingPolicies = <T extends ResolverCollection>(resolvers: T): T => {
  const query = Object.fromEntries(Object.entries(resolvers.Query).map(([field, value]) => [field, async (parent: unknown, args: Record<string, unknown>, context: GraphQLContext, info: unknown) => {
    const resolver = value as Resolver;
    if (!platformQueries.has(field) && !accessQueries.has(field)) {
      const account = await enforceSubscriptionAccess(context, true);
      if (billingQueries.has(field) && context.auth.activeRole !== "admin") throw forbiddenError();
      if (account && accountingQueries.has(field) && !effectivePlan(account).vatAccounting) throw featureError("VAT and accounting");
    }
    return resolver(parent, args, context, info);
  }]));
  const mutation = Object.fromEntries(Object.entries(resolvers.Mutation).map(([field, value]) => {
    const resolver = value as Resolver;
    const classification = MUTATION_POLICY[field];
    if (!classification) throw new Error(`GraphQL mutation ${field} has no billing policy classification`);
    return [field, async (parent: unknown, args: Record<string, unknown>, context: GraphQLContext, info: unknown) => {
      const resource = billingEnforcementEnabled() ? capacityResource(field, args) : null;
      let release: (() => Promise<void>) | null = null;
      try {
        if (resource) release = await acquireBillingCapacityLock(tenantId(context), resource);
        if (classification === "operational") await enforceSubscriptionAccess(context, false);
        if (classification === "safe_settings" || classification === "billing") await enforceSubscriptionAccess(context, true);
        if (classification === "operational" || classification === "safe_settings") await enforceCapabilities(field, args, context);
        return await resolver(parent, args, context, info);
      } finally {
        await release?.();
      }
    }];
  }));
  return { ...resolvers, Query: query, Mutation: mutation } as unknown as T;
};

export const validateBiasharaDowngrade = async (tenant: string) => {
  const [settings, stores, users] = await Promise.all([getBusinessSettings(tenant), listStores(tenant), enabledUserCount(tenant)]);
  if (settings.vatRegistered) throw new Error("Disable VAT before downgrading to Biashara");
  if (stores.filter((store) => store.status === "active").length > 1) throw new Error("Deactivate extra stores before downgrading to Biashara");
  if (users > 5) throw new Error("Disable extra users before downgrading to Biashara");
};
