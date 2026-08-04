import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { billingStatus, effectivePlan, kenyaDate, type BillingStatus, type PlanCode } from "../domain/billing";
import { getBusinessSettings } from "./pos-repository";
import { getBillingAccount, getBillingPayment, listBillingPayments, type BillingPayment, type PaymentStatus } from "./billing-repository";
import { getTenantRecord, listTenantMemberships } from "./tenant-repository";
import { listStores } from "./supply-chain-repository";
import { getCognitoUser } from "../services/cognito";

export interface PlatformBusinessSummary {
  tenantId: string;
  tenantName: string;
  normalizedName: string;
  billingConfigured: boolean;
  planCode: PlanCode | null;
  planName: string | null;
  subscriptionStatus: BillingStatus | "unconfigured";
  monthlyPriceKes: number;
  activeUsers: number;
  activeStores: number;
  pendingPayments: number;
  pendingPaymentAmountKes: number;
  trialEndsOn: string | null;
  paidThrough: string | null;
  billingContactEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformMetrics {
  activeBusinesses: number;
  trialingBusinesses: number;
  pastDueBusinesses: number;
  restrictedBusinesses: number;
  unconfiguredBusinesses: number;
  projectedMrrKes: number;
  trialPipelineKes: number;
  collectedThisMonthKes: number;
  collectedAllTimeKes: number;
  pendingPayments: number;
  pendingPaymentAmountKes: number;
  calculatedAt: string;
}

type CursorKey = Record<string, unknown>;
const summaryKey = (tenantId: string) => ({ partitionKey: `PLATFORM#BUSINESS#${tenantId}`, sortKey: "SUMMARY" });
const metricsKey = { partitionKey: "PLATFORM#METRICS", sortKey: "CURRENT" };
const encodeCursor = (value?: CursorKey) => value ? Buffer.from(JSON.stringify(value)).toString("base64url") : null;
const decodeCursor = (value?: string | null): CursorKey | undefined => {
  if (!value) return undefined;
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as CursorKey; }
  catch { throw new Error("The pagination cursor is invalid"); }
};
const clean = <T>(item?: Record<string, unknown>): T | null => {
  if (!item) return null;
  const { partitionKey: _pk, sortKey: _sk, accessPartition: _ap, accessSort: _as, entityType: _type, ...value } = item;
  return value as T;
};
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-KE");

export const getPlatformBusinessSummary = async (tenantId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: summaryKey(tenantId) }));
  return clean<PlatformBusinessSummary>(response.Item);
};

export const refreshPlatformBusinessSummary = async (tenantId: string) => {
  const [tenant, account, memberships, stores, payments] = await Promise.all([
    getTenantRecord(tenantId), getBillingAccount(tenantId), listTenantMemberships(tenantId), listStores(tenantId), listBillingPayments(tenantId),
  ]);
  if (!tenant && !account) throw new Error("Business was not found");
  const users = await Promise.all(memberships.map(({ username }) => getCognitoUser(username)));
  const tenantName = tenant?.name ?? account!.tenantName;
  const pending = payments.filter((payment) => payment.status === "submitted");
  const plan = account ? effectivePlan(account) : null;
  const now = new Date().toISOString();
  const summary: PlatformBusinessSummary = {
    tenantId,
    tenantName,
    normalizedName: normalizeName(tenantName),
    billingConfigured: Boolean(account),
    planCode: account?.planCode ?? null,
    planName: plan?.name ?? null,
    subscriptionStatus: account ? billingStatus(account) : "unconfigured",
    monthlyPriceKes: plan?.monthlyPriceKes ?? 0,
    activeUsers: users.filter((user) => user.status !== "DISABLED").length,
    activeStores: stores.filter((store) => store.status === "active").length,
    pendingPayments: pending.length,
    pendingPaymentAmountKes: pending.reduce((sum, payment) => sum + payment.amountKes, 0),
    trialEndsOn: account?.trialEndsOn ?? null,
    paidThrough: account?.paidThrough ?? null,
    billingContactEmail: account?.billingContactEmail || account?.ownerUsername || "",
    createdAt: tenant?.createdAt ?? account!.createdAt,
    updatedAt: now,
  };
  await dynamoDB.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...summaryKey(tenantId), accessPartition: "PLATFORM#BUSINESS", accessSort: `${summary.normalizedName}#${tenantId}`, entityType: "platform_business_summary", ...summary },
  }));
  return summary;
};

export const listPlatformBusinessPage = async (input: { first?: number; after?: string | null; search?: string | null; planCode?: PlanCode | null; status?: string | null; billingConfigured?: boolean | null }) => {
  const first = Math.min(Math.max(input.first ?? 25, 1), 100);
  const search = input.search?.trim() ?? "";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(search)) {
    const item = await getPlatformBusinessSummary(search);
    const matches = item && (input.planCode == null || item.planCode === input.planCode) && (input.status == null || item.subscriptionStatus === input.status) && (input.billingConfigured == null || item.billingConfigured === input.billingConfigured);
    return { items: matches ? [item] : [], nextCursor: null };
  }
  const items: PlatformBusinessSummary[] = [];
  let exclusiveStartKey = decodeCursor(input.after);
  let lastEvaluatedKey: CursorKey | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: search ? "accessPartition = :partition AND begins_with(accessSort, :search)" : "accessPartition = :partition",
      ExpressionAttributeValues: search ? { ":partition": "PLATFORM#BUSINESS", ":search": normalizeName(search) } : { ":partition": "PLATFORM#BUSINESS" },
      ExclusiveStartKey: exclusiveStartKey,
      Limit: first,
    }));
    for (const raw of response.Items ?? []) {
      const item = clean<PlatformBusinessSummary>(raw)!;
      if (input.planCode != null && item.planCode !== input.planCode) continue;
      if (input.status != null && item.subscriptionStatus !== input.status) continue;
      if (input.billingConfigured != null && item.billingConfigured !== input.billingConfigured) continue;
      items.push(item);
      if (items.length === first) break;
    }
    lastEvaluatedKey = response.LastEvaluatedKey;
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (items.length < first && exclusiveStartKey);
  return { items, nextCursor: encodeCursor(lastEvaluatedKey) };
};

const queryAllPayments = async (status: PaymentStatus) => {
  const payments: BillingPayment[] = [];
  let exclusiveStartKey: CursorKey | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME, IndexName: "AccessIndex", KeyConditionExpression: "accessPartition = :partition",
      ExpressionAttributeValues: { ":partition": `PLATFORM#BILLING_PAYMENT#${status}` }, ExclusiveStartKey: exclusiveStartKey,
    }));
    payments.push(...(response.Items ?? []).map((item) => clean<BillingPayment>(item)!));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return payments;
};

export const listPlatformPaymentPage = async (input: { first?: number; after?: string | null; status?: PaymentStatus | null; from?: string | null; to?: string | null; tenantId?: string | null; reference?: string | null }) => {
  const first = Math.min(Math.max(input.first ?? 25, 1), 100);
  const reference = input.reference?.trim().toUpperCase();
  if (reference) {
    const claim = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: { partitionKey: `BILLING_PAYMENT_REF#${reference}`, sortKey: "CLAIM" } }));
    const tenantId = claim.Item?.tenantId as string | undefined; const paymentId = claim.Item?.paymentId as string | undefined;
    if (!tenantId || !paymentId) return { items: [], nextCursor: null };
    const payment = await getBillingPayment(tenantId, paymentId);
    return { items: payment ? [payment] : [], nextCursor: null };
  }
  const status = input.status ?? "submitted";
  const items: BillingPayment[] = [];
  let exclusiveStartKey = decodeCursor(input.after);
  let lastEvaluatedKey: CursorKey | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME, IndexName: "AccessIndex", KeyConditionExpression: "accessPartition = :partition",
      ExpressionAttributeValues: { ":partition": `PLATFORM#BILLING_PAYMENT#${status}` }, ExclusiveStartKey: exclusiveStartKey, Limit: first, ScanIndexForward: false,
    }));
    for (const raw of response.Items ?? []) {
      const item = clean<BillingPayment>(raw)!;
      if (input.tenantId && item.tenantId !== input.tenantId) continue;
      if (input.from && item.paidOn < input.from) continue;
      if (input.to && item.paidOn > input.to) continue;
      items.push(item); if (items.length === first) break;
    }
    lastEvaluatedKey = response.LastEvaluatedKey; exclusiveStartKey = response.LastEvaluatedKey;
  } while (items.length < first && exclusiveStartKey);
  return { items, nextCursor: encodeCursor(lastEvaluatedKey) };
};

export const refreshPlatformMetrics = async () => {
  const summaries: PlatformBusinessSummary[] = [];
  let cursor: string | null = null;
  do { const page = await listPlatformBusinessPage({ first: 100, after: cursor }); summaries.push(...page.items); cursor = page.nextCursor; } while (cursor);
  const [confirmed, submitted] = await Promise.all([queryAllPayments("confirmed"), queryAllPayments("submitted")]);
  const month = kenyaDate().slice(0, 7);
  const metrics: PlatformMetrics = {
    activeBusinesses: summaries.filter((item) => item.subscriptionStatus === "active").length,
    trialingBusinesses: summaries.filter((item) => item.subscriptionStatus === "trialing").length,
    pastDueBusinesses: summaries.filter((item) => item.subscriptionStatus === "past_due").length,
    restrictedBusinesses: summaries.filter((item) => item.subscriptionStatus === "restricted" || item.subscriptionStatus === "cancelled").length,
    unconfiguredBusinesses: summaries.filter((item) => !item.billingConfigured).length,
    projectedMrrKes: summaries.filter((item) => item.subscriptionStatus === "active").reduce((sum, item) => sum + item.monthlyPriceKes, 0),
    trialPipelineKes: summaries.filter((item) => item.subscriptionStatus === "trialing").reduce((sum, item) => sum + item.monthlyPriceKes, 0),
    collectedThisMonthKes: confirmed.filter((payment) => (payment.reviewedAt ?? "").startsWith(month)).reduce((sum, payment) => sum + payment.amountKes, 0),
    collectedAllTimeKes: confirmed.reduce((sum, payment) => sum + payment.amountKes, 0),
    pendingPayments: submitted.length,
    pendingPaymentAmountKes: submitted.reduce((sum, payment) => sum + payment.amountKes, 0),
    calculatedAt: new Date().toISOString(),
  };
  await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...metricsKey, entityType: "platform_metrics", ...metrics } }));
  return metrics;
};

export const getPlatformMetrics = async () => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: metricsKey }));
  return clean<PlatformMetrics>(response.Item) ?? refreshPlatformMetrics();
};

export const platformBusinessMetadata = async (tenantId: string) => {
  const [summary, settings, memberships, stores] = await Promise.all([
    getPlatformBusinessSummary(tenantId), getBusinessSettings(tenantId), listTenantMemberships(tenantId), listStores(tenantId),
  ]);
  if (!summary) throw new Error("Business directory metadata is missing; run the platform billing migration");
  const admins = await Promise.all(memberships.filter(({ roles }) => roles.includes("admin")).map(async (membership) => {
    const user = await getCognitoUser(membership.username);
    return { id: user.id, name: user.name, email: user.email, status: user.status };
  }));
  return {
    summary,
    businessContact: { name: settings?.businessName ?? summary.tenantName, email: settings?.email ?? "", phone: settings?.phone ?? "", address: settings?.address ?? "" },
    admins,
    stores: stores.map(({ id, code, name, address, status }) => ({ id, code, name, address, status })),
  };
};
