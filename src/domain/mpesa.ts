import { createHash } from "node:crypto";

export type MpesaEnvironment = "sandbox" | "production";
export type MpesaScope = "business" | "store";
export type MpesaPaymentSource = "stk" | "c2b";
export type MpesaTransactionType = "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";

export const normalizeMpesaPhone = (input: string) => {
  const digits = input.trim().replace(/[\s()-]/g, "").replace(/^\+/, "");
  const normalized = digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  if (!/^254(?:7|1)\d{8}$/.test(normalized)) throw new Error("Enter a valid Kenyan M-Pesa phone number");
  return normalized;
};

export const mpesaPhoneFingerprint = (phone: string) => ({
  phoneHash: createHash("sha256").update(normalizeMpesaPhone(phone)).digest("hex"),
  phoneLast4: normalizeMpesaPhone(phone).slice(-4),
});

export const mpesaWholeAmount = (saleTotal: number) => {
  if (!Number.isFinite(saleTotal) || saleTotal <= 0) throw new Error("M-Pesa amount must be greater than zero");
  return Math.ceil(saleTotal);
};

export const normalizeMpesaReference = (value: string) => {
  const reference = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,16}$/.test(reference)) throw new Error("Enter a valid M-Pesa transaction code");
  return reference;
};

export const mpesaApiBaseUrl = (environment: MpesaEnvironment) => environment === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

export const callbackTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };

export interface NormalizedMpesaPaymentEvent {
  source: MpesaPaymentSource;
  receiptNumber: string;
  amountKes: number;
  transactionAt: string;
  shortcode: string;
  phone?: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
}

export interface NormalizedStkResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: number;
  resultDescription: string;
  payment?: NormalizedMpesaPaymentEvent;
}

const kenyaTransactionTime = (value: unknown) => {
  const digits = text(value);
  if (!/^\d{14}$/.test(digits)) throw new Error("Invalid M-Pesa transaction time");
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}+03:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) throw new Error("Invalid M-Pesa transaction time");
  return date.toISOString();
};

export const normalizeStkCallback = (payload: unknown, shortcode: string): NormalizedStkResult => {
  const callback = record(record(record(payload).Body).stkCallback);
  const checkoutRequestId = text(callback.CheckoutRequestID);
  const merchantRequestId = text(callback.MerchantRequestID);
  const resultCode = number(callback.ResultCode);
  if (!checkoutRequestId || !merchantRequestId || resultCode == null) throw new Error("Invalid STK callback payload");
  const result: NormalizedStkResult = { checkoutRequestId, merchantRequestId, resultCode, resultDescription: text(callback.ResultDesc).slice(0, 200) };
  if (resultCode !== 0) return result;
  const items = Array.isArray(record(callback.CallbackMetadata).Item) ? record(callback.CallbackMetadata).Item as unknown[] : [];
  const metadata = new Map(items.map((item) => { const value = record(item); return [text(value.Name), value.Value]; }));
  const receiptNumber = normalizeMpesaReference(text(metadata.get("MpesaReceiptNumber")));
  const amountKes = number(metadata.get("Amount"));
  if (amountKes == null || amountKes <= 0) throw new Error("Invalid STK payment amount");
  const rawPhone = text(metadata.get("PhoneNumber"));
  result.payment = {
    source: "stk",
    receiptNumber,
    amountKes,
    transactionAt: kenyaTransactionTime(metadata.get("TransactionDate")),
    shortcode,
    ...(rawPhone ? { phone: normalizeMpesaPhone(rawPhone) } : {}),
    checkoutRequestId,
    merchantRequestId,
  };
  return result;
};

export const normalizeC2bConfirmation = (payload: unknown): NormalizedMpesaPaymentEvent => {
  const value = record(payload);
  const receiptNumber = normalizeMpesaReference(text(value.TransID));
  const amountKes = number(value.TransAmount);
  const shortcode = text(value.BusinessShortCode);
  if (amountKes == null || amountKes <= 0 || !/^\d{5,12}$/.test(shortcode)) throw new Error("Invalid C2B confirmation payload");
  const rawPhone = text(value.MSISDN);
  return {
    source: "c2b",
    receiptNumber,
    amountKes,
    transactionAt: kenyaTransactionTime(value.TransTime),
    shortcode,
    ...(rawPhone ? { phone: normalizeMpesaPhone(rawPhone) } : {}),
  };
};
