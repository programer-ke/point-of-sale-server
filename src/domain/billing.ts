import { GraphQLError } from "graphql";

export type PlanCode = "biashara" | "biashara_plus";
export type BillingStatus = "trialing" | "active" | "past_due" | "restricted" | "exempt" | "cancelled";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  monthlyPriceKes: number;
  activeUserLimit: number | null;
  activeStoreLimit: number | null;
  vatAccounting: boolean;
  multiStore: boolean;
}

export interface BillingOverride {
  monthlyPriceKes?: number | null;
  activeUserLimit?: number | null;
  activeStoreLimit?: number | null;
  vatAccounting?: boolean | null;
  multiStore?: boolean | null;
  exempt?: boolean | null;
  expiresOn?: string | null;
  reason: string;
  updatedAt: string;
  updatedBy: string;
}

export interface BillingAccount {
  tenantId: string;
  tenantName: string;
  ownerUserId: string;
  ownerUsername: string;
  planCode: PlanCode;
  trialStartedOn: string;
  trialEndsOn: string;
  paidThrough: string | null;
  cancelledAt: string | null;
  pendingPlanCode: PlanCode | null;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  acceptedBy: string;
  override: BillingOverride | null;
  createdAt: string;
  updatedAt: string;
}

export const TERMS_VERSION = "2026-08-03";
export const PRIVACY_VERSION = "2026-08-03";

export const PLANS: Record<PlanCode, PlanDefinition> = {
  biashara: {
    code: "biashara",
    name: "Biashara",
    monthlyPriceKes: 1_000,
    activeUserLimit: 5,
    activeStoreLimit: 1,
    vatAccounting: false,
    multiStore: false,
  },
  biashara_plus: {
    code: "biashara_plus",
    name: "Biashara Plus",
    monthlyPriceKes: 1_500,
    activeUserLimit: null,
    activeStoreLimit: null,
    vatAccounting: true,
    multiStore: true,
  },
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const parseDate = (value: string) => {
  if (!DATE_PATTERN.test(value)) throw new Error("Billing date must use YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error("Billing date is invalid");
  return date;
};

export const kenyaDate = (value = new Date()) =>
  new Date(value.valueOf() + 3 * 60 * 60 * 1_000).toISOString().slice(0, 10);

export const addBillingDays = (value: string, days: number) => {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const addBillingMonth = (value: string) => {
  const source = parseDate(value);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
};

export const overrideIsActive = (override: BillingOverride | null, today = kenyaDate()) =>
  Boolean(override && (!override.expiresOn || override.expiresOn >= today));

export const effectivePlan = (account: BillingAccount, today = kenyaDate()): PlanDefinition => {
  const base = PLANS[account.planCode];
  const override = overrideIsActive(account.override, today) ? account.override : null;
  return {
    ...base,
    monthlyPriceKes: override?.monthlyPriceKes ?? base.monthlyPriceKes,
    activeUserLimit: override?.activeUserLimit === undefined ? base.activeUserLimit : override.activeUserLimit,
    activeStoreLimit: override?.activeStoreLimit === undefined ? base.activeStoreLimit : override.activeStoreLimit,
    vatAccounting: override?.vatAccounting ?? base.vatAccounting,
    multiStore: override?.multiStore ?? base.multiStore,
  };
};

export const billingStatus = (account: BillingAccount, today = kenyaDate()): BillingStatus => {
  if (overrideIsActive(account.override, today) && account.override?.exempt) return "exempt";
  const accessEndsOn = account.paidThrough ?? account.trialEndsOn;
  if (today <= accessEndsOn) return account.paidThrough ? "active" : "trialing";
  if (today <= addBillingDays(accessEndsOn, 1)) return "past_due";
  return account.cancelledAt ? "cancelled" : "restricted";
};

export const validatePlanCode = (value: string): PlanCode => {
  if (value !== "biashara" && value !== "biashara_plus") throw new Error("Select Biashara or Biashara Plus");
  return value;
};

export const subscriptionError = () => new GraphQLError(
  "This workspace is restricted because its trial or subscription has expired. A business administrator can renew it from Billing.",
  { extensions: { code: "SUBSCRIPTION_RESTRICTED" } },
);

export const featureError = (feature: string) => new GraphQLError(
  `${feature} is available on Biashara Plus. Upgrade the workspace from Billing to continue.`,
  { extensions: { code: "FEATURE_NOT_INCLUDED", feature, requiredPlan: "biashara_plus" } },
);

export const limitError = (resource: "users" | "stores", limit: number) => new GraphQLError(
  `Biashara supports up to ${limit} active ${resource}. Upgrade to Biashara Plus to add more.`,
  { extensions: { code: "PLAN_LIMIT_REACHED", resource, limit, requiredPlan: "biashara_plus" } },
);
