import { GraphQLError } from "graphql";

export type PlanCode = "biashara" | "biashara_growth" | "biashara_plus";
export type BillingInterval = "monthly" | "annual";
export type PlanCapability = "multi_store" | "vat_accounting" | "mpesa_api" | "mpesa_store_overrides";
export type BillingStatus = "trialing" | "active" | "past_due" | "restricted" | "exempt" | "cancelled";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  monthlyPriceKes: number;
  activeUserLimit: number | null;
  activeStoreLimit: number | null;
  vatAccounting: boolean;
  multiStore: boolean;
  capabilities: PlanCapability[];
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

export interface BillingOffer {
  id: string;
  promotionId?: string | null;
  label: string;
  pricePercent: number;
  durationMonths: number;
  remainingPayments: number;
  billingInterval?: BillingInterval;
  planCode?: PlanCode;
  startsOn: string;
  reason: string;
  assignedAt: string;
  assignedBy: string;
}

export interface BillingAccount {
  tenantId: string;
  tenantName: string;
  ownerUserId: string;
  ownerUsername: string;
  billingContactName: string;
  billingContactEmail: string;
  billingContactPhone: string;
  planCode: PlanCode;
  billingInterval?: BillingInterval;
  trialStartedOn: string;
  trialEndsOn: string;
  paidThrough: string | null;
  cancelledAt: string | null;
  pendingPlanCode: PlanCode | null;
  pendingBillingInterval?: BillingInterval | null;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  acceptedBy: string;
  override: BillingOverride | null;
  offer: BillingOffer | null;
  createdAt: string;
  updatedAt: string;
}

export const TERMS_VERSION = "2026-08-03";
export const PRIVACY_VERSION = "2026-08-04";

export const PLANS: Record<PlanCode, PlanDefinition> = {
  biashara: {
    code: "biashara",
    name: "Biashara",
    monthlyPriceKes: 800,
    activeUserLimit: 5,
    activeStoreLimit: 1,
    vatAccounting: false,
    multiStore: false,
    capabilities: [],
  },
  biashara_growth: {
    code: "biashara_growth",
    name: "Biashara Growth",
    monthlyPriceKes: 2_000,
    activeUserLimit: 10,
    activeStoreLimit: 3,
    vatAccounting: true,
    multiStore: true,
    capabilities: ["multi_store", "vat_accounting", "mpesa_api"],
  },
  biashara_plus: {
    code: "biashara_plus",
    name: "Biashara Plus",
    monthlyPriceKes: 5_000,
    activeUserLimit: 30,
    activeStoreLimit: 10,
    vatAccounting: true,
    multiStore: true,
    capabilities: ["multi_store", "vat_accounting", "mpesa_api", "mpesa_store_overrides"],
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

export const addBillingMonths = (value: string, months: number) => {
  if (!Number.isInteger(months) || months < 1) throw new Error("Billing months must be a positive whole number");
  const source = parseDate(value);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const targetMonth = month + months;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
};

export const ANNUAL_DISCOUNT_PERCENT = 10;
export const annualPriceKes = (monthlyPriceKes: number) => Math.round(monthlyPriceKes * 12 * (100 - ANNUAL_DISCOUNT_PERCENT) / 100);
export const validateBillingInterval = (value: string): BillingInterval => {
  if (value !== "monthly" && value !== "annual") throw new Error("Select monthly or annual billing");
  return value;
};

export const billingGraceDays = (account: BillingAccount) =>
  (account.pendingBillingInterval ?? account.billingInterval ?? "monthly") === "annual" ? 7 : 1;

export const overrideIsActive = (override: BillingOverride | null, today = kenyaDate()) =>
  Boolean(override && (!override.expiresOn || override.expiresOn >= today));

export const effectivePlan = (account: BillingAccount, today = kenyaDate()): PlanDefinition => {
  const base = PLANS[account.planCode];
  const override = overrideIsActive(account.override, today) ? account.override : null;
  const vatAccounting = override?.vatAccounting ?? base.vatAccounting;
  const multiStore = override?.multiStore ?? base.multiStore;
  return {
    ...base,
    monthlyPriceKes: override?.monthlyPriceKes ?? base.monthlyPriceKes,
    activeUserLimit: override?.activeUserLimit === undefined ? base.activeUserLimit : override.activeUserLimit,
    activeStoreLimit: override?.activeStoreLimit === undefined ? base.activeStoreLimit : override.activeStoreLimit,
    vatAccounting,
    multiStore,
    capabilities: [
      multiStore ? "multi_store" : null,
      vatAccounting ? "vat_accounting" : null,
      base.capabilities.includes("mpesa_api") ? "mpesa_api" : null,
      base.capabilities.includes("mpesa_store_overrides") ? "mpesa_store_overrides" : null,
    ].filter((value): value is PlanCapability => Boolean(value)),
  };
};

export const billingStatus = (account: BillingAccount, today = kenyaDate()): BillingStatus => {
  if (overrideIsActive(account.override, today) && account.override?.exempt) return "exempt";
  const accessEndsOn = account.paidThrough ?? account.trialEndsOn;
  if (today <= accessEndsOn) return account.paidThrough ? "active" : "trialing";
  if (today <= addBillingDays(accessEndsOn, billingGraceDays(account))) return "past_due";
  return account.cancelledAt ? "cancelled" : "restricted";
};

export interface NextBillingPayment {
  planCode: PlanCode;
  planName: string;
  dueOn: string;
  periodStartsOn: string;
  periodEndsOn: string;
  baseAmountKes: number;
  amountKes: number;
  billingInterval: BillingInterval;
  billingMonths: number;
  savingsKes: number;
  annualDiscountKes: number;
  promotionCreditKes: number;
  offerId: string | null;
  offerLabel: string | null;
  offerPricePercent: number | null;
  offerRemainingPayments: number;
}

export const nextBillingPayment = (account: BillingAccount, today = kenyaDate()): NextBillingPayment => {
  const accessEndsOn = account.paidThrough ?? account.trialEndsOn;
  const dueOn = addBillingDays(accessEndsOn, 1);
  const withinGrace = today <= addBillingDays(accessEndsOn, billingGraceDays(account));
  const periodStartsOn = dueOn >= today || withinGrace ? dueOn : today;
  const planCode = account.pendingPlanCode ?? account.planCode;
  const plan = effectivePlan({ ...account, planCode }, periodStartsOn);
  const billingInterval = account.pendingBillingInterval ?? account.billingInterval ?? "monthly";
  const billingMonths = billingInterval === "annual" ? 12 : 1;
  const periodEndsOn = addBillingDays(addBillingMonths(periodStartsOn, billingMonths), -1);
  const offerInterval = account.offer?.billingInterval ?? "monthly";
  const offer = account.offer && account.offer.remainingPayments > 0 && offerInterval === billingInterval && (!account.offer.planCode || account.offer.planCode === planCode) && periodStartsOn >= account.offer.startsOn ? account.offer : null;
  const baseAmountKes = plan.monthlyPriceKes * billingMonths;
  const intervalAmountKes = billingInterval === "annual" ? annualPriceKes(plan.monthlyPriceKes) : plan.monthlyPriceKes;
  const annualDiscountKes = baseAmountKes - intervalAmountKes;
  const amountKes = offer ? Math.round(intervalAmountKes * offer.pricePercent / 100) : intervalAmountKes;
  const promotionCreditKes = intervalAmountKes - amountKes;
  return {
    planCode,
    planName: plan.name,
    dueOn,
    periodStartsOn,
    periodEndsOn,
    baseAmountKes,
    amountKes,
    billingInterval,
    billingMonths,
    savingsKes: baseAmountKes - amountKes,
    annualDiscountKes,
    promotionCreditKes,
    offerId: offer?.id ?? null,
    offerLabel: offer?.label ?? null,
    offerPricePercent: offer?.pricePercent ?? null,
    offerRemainingPayments: offer?.remainingPayments ?? 0,
  };
};

export const validatePlanCode = (value: string): PlanCode => {
  if (value !== "biashara" && value !== "biashara_growth" && value !== "biashara_plus") throw new Error("Select a valid BiasharaKit plan");
  return value;
};

export const subscriptionError = () => new GraphQLError(
  "This workspace is restricted because its trial or subscription has expired. A business administrator can renew it from Billing.",
  { extensions: { code: "SUBSCRIPTION_RESTRICTED" } },
);

export const featureError = (feature: string) => new GraphQLError(
  `${feature} is available on Biashara Plus. Upgrade the workspace from Billing to continue.`,
  { extensions: { code: "FEATURE_NOT_INCLUDED", feature, requiredPlan: "biashara_growth" } },
);

export const limitError = (resource: "users" | "stores", limit: number) => new GraphQLError(
  `Your plan supports up to ${limit} active ${resource}. Upgrade or request a custom limit to add more.`,
  { extensions: { code: "PLAN_LIMIT_REACHED", resource, limit, requiredPlan: "biashara_growth" } },
);
