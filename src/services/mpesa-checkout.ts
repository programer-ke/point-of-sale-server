import { GraphQLError } from "graphql";
import { mpesaWholeAmount, normalizeMpesaPhone } from "../domain/mpesa";
import { effectiveProductPrice, getBusinessCheckoutSettings, getProduct, regularVariantPrice, completeSale, type SaleRecord } from "../repositories/pos-repository";
import {
  claimMpesaPayment, configurationCallbackUrls, createMpesaIntent, getEffectiveMpesaConfiguration,
  getMpesaIntent, getMpesaPayment, putCheckoutAlias, releaseMpesaPayment, updateMpesaIntent, type MpesaCheckoutIntentRecord,
  type MpesaPaymentRecord,
} from "../repositories/mpesa-repository";
import { decryptMpesaCredentials, queryStkPush, requestStkPush } from "./mpesa";
import { mpesaPhoneFingerprint } from "../domain/mpesa";

export interface MpesaSaleInput {
  storeId: string;
  customerName?: string | null;
  items: Array<{ productId: string; variantId?: string | null; quantity: number; expectedCatalogPrice?: number | null; unitPriceOverride?: number | null; priceOverrideReason?: string | null }>;
  requestId: string;
}

export interface MpesaActor { id: string; name: string; employeeCode?: string; role?: "admin" | "staff" }

const quoteSale = async (tenantId: string, input: MpesaSaleInput, actor: MpesaActor) => {
  if (!input.items.length) throw new Error("Add at least one product to the sale");
  const [productRecords, checkoutSettings] = await Promise.all([
    Promise.all([...new Set(input.items.map((item) => item.productId))].map((id) => getProduct(tenantId, id))),
    getBusinessCheckoutSettings(tenantId),
  ]);
  const products = new Map(productRecords.filter(Boolean).map((product) => [product!.id, product!]));
  let total = 0;
  const priceChanges: Array<{ productId: string; productName: string; variantId: string; variantName: string; previousPrice: number; currentPrice: number }> = [];
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error("Sale quantities must be positive whole numbers");
    const product = products.get(item.productId); if (!product || product.status !== "active") throw new Error("One or more products are unavailable");
    const variants = product.saleVariants.filter((variant) => variant.status === "active"); const variant = variants.find((value) => value.id === item.variantId) ?? (!item.variantId ? variants[0] : undefined); if (!variant) throw new Error(`${product.name} sale variant is unavailable`);
    const authoritative = variants[0]?.id === variant.id ? effectiveProductPrice(product) : regularVariantPrice(product, variant.id);
    if (item.expectedCatalogPrice != null && item.expectedCatalogPrice !== authoritative) priceChanges.push({ productId: product.id, productName: product.name, variantId: variant.id, variantName: variant.name, previousPrice: item.expectedCatalogPrice, currentPrice: authoritative });
    const requested = item.unitPriceOverride;
    if (requested != null && requested !== authoritative) {
      if (!Number.isFinite(requested) || requested < 0 || Math.round(requested * 100) / 100 !== requested) throw new Error("Price overrides must be non-negative amounts with at most two decimal places");
      if (!item.priceOverrideReason?.trim()) throw new Error("Enter a price override reason");
      if (actor.role !== "admin" && !checkoutSettings.allowStaffPriceOverrides) throw new Error("Staff price overrides are disabled");
      if (actor.role !== "admin" && requested > authoritative) throw new Error("Staff cannot increase prices at checkout");
      const minimum = Math.round(authoritative * (1 - checkoutSettings.maxStaffPriceDiscountPercent / 100) * 100) / 100;
      if (actor.role !== "admin" && requested < minimum) throw new Error(`Staff markdown exceeds the ${checkoutSettings.maxStaffPriceDiscountPercent}% limit`);
    }
    total += (requested != null ? requested : authoritative) * item.quantity;
  }
  if (priceChanges.length) throw new GraphQLError("One or more basket prices changed. Review the updated totals before requesting payment.", { extensions: { code: "PRICE_CHANGED", priceChanges } });
  return Math.round(total * 100) / 100;
};

export const initiateMpesaStk = async (tenantId: string, allowStoreOverride: boolean, input: MpesaSaleInput & { phone: string }, actor: MpesaActor) => {
  const previous = await getMpesaIntent(tenantId, input.requestId); if (previous) return previous;
  const configuration = await getEffectiveMpesaConfiguration(tenantId, input.storeId, allowStoreOverride);
  if (!configuration || configuration.connectionStatus !== "verified" || !configuration.stkEnabled) throw new Error("STK Push is not configured for this store");
  const phone = normalizeMpesaPhone(input.phone); const saleTotal = await quoteSale(tenantId, input, actor); const amountKes = mpesaWholeAmount(saleTotal); const now = new Date().toISOString();
  const { phone: _phone, ...inputWithoutPhone } = input;
  const intent: MpesaCheckoutIntentRecord = { id: input.requestId, tenantId, configurationId: configuration.id, storeId: input.storeId, actor, saleInput: { ...inputWithoutPhone, paymentMethod: "mpesa", mpesaReference: null }, saleTotal, amountKes, ...mpesaPhoneFingerprint(phone), status: "initiating", createdAt: now, expiresAt: Math.floor(Date.now() / 1_000) + 300, updatedAt: now };
  await createMpesaIntent(intent);
  try {
    const credentials = await decryptMpesaCredentials(configuration, tenantId, configuration.id); const urls = configurationCallbackUrls(configuration);
    const result = await requestStkPush({ configurationId: configuration.id, environment: configuration.environment, credentials, shortcode: configuration.shortcode, transactionType: configuration.transactionType, callbackUrl: urls.stk, phone, amountKes, accountReference: input.requestId });
    intent.status = "pending"; intent.checkoutRequestId = result.checkoutRequestId; intent.merchantRequestId = result.merchantRequestId; intent.resultCode = result.responseCode; intent.resultDescription = result.message; await updateMpesaIntent(intent); await putCheckoutAlias(intent); return intent;
  } catch (error) {
    intent.status = "failed"; intent.resultDescription = error instanceof Error ? error.message.slice(0, 200) : "Unable to send STK prompt"; await updateMpesaIntent(intent); return intent;
  }
};

export const refreshMpesaStk = async (tenantId: string, intentId: string) => {
  const intent = await getMpesaIntent(tenantId, intentId); if (!intent) throw new Error("M-Pesa checkout intent not found");
  if (!intent.checkoutRequestId || intent.status !== "pending") return intent;
  const configuration = await getEffectiveMpesaConfiguration(tenantId, intent.storeId, true); if (!configuration || configuration.id !== intent.configurationId) throw new Error("M-Pesa configuration is unavailable");
  const credentials = await decryptMpesaCredentials(configuration, tenantId, configuration.id); const result = await queryStkPush({ configurationId: configuration.id, environment: configuration.environment, credentials, shortcode: configuration.shortcode, checkoutRequestId: intent.checkoutRequestId }); intent.resultCode = result.resultCode; intent.resultDescription = result.resultDescription;
  if (result.resultCode && result.resultCode !== "0") intent.status = "failed"; return updateMpesaIntent(intent);
};

export const finalizeMpesaPayment = async (tenantId: string, payment: MpesaPaymentRecord, saleInput: MpesaSaleInput, actor: MpesaActor): Promise<SaleRecord> => {
  const total = await quoteSale(tenantId, saleInput, actor); if (mpesaWholeAmount(total) !== payment.amountKes) throw new Error("M-Pesa payment amount does not match this sale");
  const claimed = await claimMpesaPayment(tenantId, payment.receiptNumber); if (!claimed) throw new Error("M-Pesa payment is no longer available");
  try {
    const sale = await completeSale(tenantId, { ...saleInput, customerName: saleInput.customerName ?? undefined, paymentMethod: "mpesa", mpesaReference: null, verifiedMpesa: { paymentId: payment.id, receiptNumber: payment.receiptNumber, amountKes: payment.amountKes, evidenceSources: payment.evidenceSources, phoneLast4: payment.phoneLast4 } }, actor);
    return sale;
  } catch (error) {
    await releaseMpesaPayment(payment, error instanceof Error ? error.message.slice(0, 200) : "Sale finalization failed"); throw error;
  }
};

export const finalizeIntentPayment = async (intent: MpesaCheckoutIntentRecord, payment: MpesaPaymentRecord) => {
  if (intent.status === "completed") return null;
  try { const sale = await finalizeMpesaPayment(intent.tenantId, payment, intent.saleInput as unknown as MpesaSaleInput, intent.actor); intent.status = "completed"; intent.saleId = sale.id; intent.orderNumber = sale.orderNumber; await updateMpesaIntent(intent); return sale; }
  catch (error) { intent.status = "review_required"; intent.resultDescription = error instanceof Error ? error.message.slice(0, 200) : "Payment received but sale could not be completed"; await updateMpesaIntent(intent); return null; }
};

export const attachMpesaPayment = async (tenantId: string, allowStoreOverride: boolean, receiptNumber: string, input: MpesaSaleInput, actor: MpesaActor) => {
  const [payment, configuration] = await Promise.all([getMpesaPayment(receiptNumber), getEffectiveMpesaConfiguration(tenantId, input.storeId, allowStoreOverride)]);
  if (!payment || payment.tenantId !== tenantId || payment.status !== "unassigned" || payment.conflictReasons.length || !configuration || payment.configurationId !== configuration.id) throw new Error("M-Pesa payment is not available for this store");
  return finalizeMpesaPayment(tenantId, payment, input, actor);
};
