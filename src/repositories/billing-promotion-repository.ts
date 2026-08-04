import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { addBillingDays, kenyaDate, validatePlanCode, type PlanCode } from "../domain/billing";
import { requireBillingAccount, setBillingOffer } from "./billing-repository";

export type BillingPromotionAudience = "new_accounts" | "existing_accounts" | "all_accounts";

export interface BillingPromotion {
  id: string;
  name: string;
  description: string;
  pricePercent: number;
  durationMonths: number;
  audience: BillingPromotionAudience;
  planCodes: PlanCode[];
  startsOn: string;
  endsOn: string;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export type BillingPromotionInput = Pick<BillingPromotion, "name" | "description" | "pricePercent" | "durationMonths" | "audience" | "planCodes" | "startsOn" | "endsOn" | "enabled">;

const promotionKey = (id: string) => ({ partitionKey: `PLATFORM#BILLING_PROMOTION#${id}`, sortKey: "PROMOTION" });
const clean = (item?: Record<string, unknown>): BillingPromotion | null => {
  if (!item) return null;
  const { partitionKey: _pk, sortKey: _sk, accessPartition: _ap, accessSort: _as, entityType: _type, ...promotion } = item;
  return promotion as unknown as BillingPromotion;
};

const validateAudience = (value: string): BillingPromotionAudience => {
  if (value !== "new_accounts" && value !== "existing_accounts" && value !== "all_accounts") throw new Error("Select a valid promotion audience");
  return value;
};

const validateInput = (input: BillingPromotionInput): BillingPromotionInput => {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new Error("Promotion name must be between 2 and 80 characters");
  if (description.length < 2 || description.length > 240) throw new Error("Promotion description must be between 2 and 240 characters");
  if (!Number.isInteger(input.pricePercent) || input.pricePercent < 1 || input.pricePercent > 100) throw new Error("Promotion price percentage must be between 1 and 100");
  if (!Number.isInteger(input.durationMonths) || input.durationMonths < 1 || input.durationMonths > 24) throw new Error("Promotion duration must be between 1 and 24 monthly payments");
  addBillingDays(input.startsOn, 0); addBillingDays(input.endsOn, 0);
  if (input.endsOn < input.startsOn) throw new Error("Promotion end date must be on or after its start date");
  const planCodes = [...new Set(input.planCodes.map(validatePlanCode))];
  if (planCodes.length === 0) throw new Error("Select at least one eligible plan");
  return {
    name,
    description,
    pricePercent: input.pricePercent,
    durationMonths: input.durationMonths,
    audience: validateAudience(input.audience),
    planCodes,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    enabled: input.enabled,
  };
};

export const getBillingPromotion = async (id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: promotionKey(id) }));
  return clean(response.Item);
};

export const listBillingPromotions = async () => {
  const promotions: BillingPromotion[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: "accessPartition = :partition",
      ExpressionAttributeValues: { ":partition": "PLATFORM#BILLING_PROMOTION" },
      ExclusiveStartKey: exclusiveStartKey,
      ScanIndexForward: false,
    }));
    promotions.push(...(response.Items ?? []).map((item) => clean(item)!).filter(Boolean));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return promotions;
};

export const promotionIsEligible = (promotion: BillingPromotion, audience: Exclude<BillingPromotionAudience, "all_accounts">, planCode: PlanCode, today = kenyaDate()) =>
  promotion.enabled
  && promotion.startsOn <= today
  && promotion.endsOn >= today
  && (promotion.audience === "all_accounts" || promotion.audience === audience)
  && promotion.planCodes.includes(planCode);

export const listEligibleBillingPromotions = async (audience: Exclude<BillingPromotionAudience, "all_accounts">, planCode: PlanCode) =>
  (await listBillingPromotions())
    .filter((promotion) => promotionIsEligible(promotion, audience, planCode))
    .sort((left, right) => left.pricePercent - right.pricePercent || left.endsOn.localeCompare(right.endsOn));

export const saveBillingPromotion = async (id: string | null, rawInput: BillingPromotionInput, actorId: string) => {
  const input = validateInput(rawInput);
  const now = new Date().toISOString();
  const existing = id ? await getBillingPromotion(id) : null;
  if (id && !existing) throw new Error("Promotion was not found");
  const promotion: BillingPromotion = {
    id: existing?.id ?? randomUUID(),
    ...input,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
  await dynamoDB.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...promotionKey(promotion.id), accessPartition: "PLATFORM#BILLING_PROMOTION", accessSort: `${promotion.createdAt}#${promotion.id}`, entityType: "billing_promotion", ...promotion },
    ConditionExpression: existing ? "attribute_exists(partitionKey)" : "attribute_not_exists(partitionKey)",
  }));
  return promotion;
};

export const setBillingPromotionEnabled = async (id: string, enabled: boolean, actorId: string) => {
  const promotion = await getBillingPromotion(id);
  if (!promotion) throw new Error("Promotion was not found");
  return saveBillingPromotion(id, { ...promotion, enabled }, actorId);
};

export const applyBillingPromotion = async (tenantId: string, promotionId: string, audience: Exclude<BillingPromotionAudience, "all_accounts">, actorId: string) => {
  const [account, promotion] = await Promise.all([requireBillingAccount(tenantId), getBillingPromotion(promotionId)]);
  if ((account.pendingBillingInterval ?? account.billingInterval ?? "monthly") === "annual") throw new Error("Promotional offers apply to monthly billing only");
  if (!promotion || !promotionIsEligible(promotion, audience, account.pendingPlanCode ?? account.planCode)) throw new Error("This promotion is no longer available for the selected plan");
  if (account.offer?.promotionId === promotion.id && account.offer.remainingPayments > 0) return account;
  if (account.offer?.remainingPayments) throw new Error("This workspace already has an active promotional offer");
  return setBillingOffer(tenantId, {
    label: promotion.name,
    pricePercent: promotion.pricePercent,
    durationMonths: promotion.durationMonths,
    startsOn: audience === "new_accounts" ? addBillingDays(account.trialEndsOn, 1) : kenyaDate(),
    reason: `Activated from platform promotion ${promotion.id}`,
    promotionId: promotion.id,
  }, actorId);
};
