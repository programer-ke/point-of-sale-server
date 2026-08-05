import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { mpesaApiBaseUrl, type MpesaEnvironment, type MpesaTransactionType } from "../domain/mpesa";

const kms = new KMSClient({});
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface MpesaCredentials {
  consumerKey: string;
  consumerSecret: string;
  passkey?: string;
}

export interface EncryptedMpesaCredentials {
  consumerKeyCiphertext: string;
  consumerSecretCiphertext: string;
  passkeyCiphertext?: string | null;
}

const encryptionContext = (tenantId: string, configurationId: string) => ({ tenantId, configurationId, purpose: "mpesa_credentials" });
const keyId = () => {
  const value = process.env.MPESA_KMS_KEY_ID?.trim();
  if (!value) throw new Error("M-Pesa credential encryption is not configured");
  return value;
};

const encryptValue = async (value: string, tenantId: string, configurationId: string) => {
  const response = await kms.send(new EncryptCommand({ KeyId: keyId(), Plaintext: Buffer.from(value), EncryptionContext: encryptionContext(tenantId, configurationId) }));
  if (!response.CiphertextBlob) throw new Error("Unable to encrypt M-Pesa credentials");
  return Buffer.from(response.CiphertextBlob).toString("base64");
};

const decryptValue = async (value: string, tenantId: string, configurationId: string) => {
  const response = await kms.send(new DecryptCommand({ CiphertextBlob: Buffer.from(value, "base64"), EncryptionContext: encryptionContext(tenantId, configurationId) }));
  if (!response.Plaintext) throw new Error("Unable to decrypt M-Pesa credentials");
  return Buffer.from(response.Plaintext).toString("utf8");
};

export const encryptMpesaCredentials = async (credentials: MpesaCredentials, tenantId: string, configurationId: string): Promise<EncryptedMpesaCredentials> => {
  const [consumerKeyCiphertext, consumerSecretCiphertext, passkeyCiphertext] = await Promise.all([
    encryptValue(credentials.consumerKey, tenantId, configurationId),
    encryptValue(credentials.consumerSecret, tenantId, configurationId),
    credentials.passkey ? encryptValue(credentials.passkey, tenantId, configurationId) : Promise.resolve(null),
  ]);
  return { consumerKeyCiphertext, consumerSecretCiphertext, passkeyCiphertext };
};

export const decryptMpesaCredentials = async (credentials: EncryptedMpesaCredentials, tenantId: string, configurationId: string): Promise<MpesaCredentials> => {
  const [consumerKey, consumerSecret, passkey] = await Promise.all([
    decryptValue(credentials.consumerKeyCiphertext, tenantId, configurationId),
    decryptValue(credentials.consumerSecretCiphertext, tenantId, configurationId),
    credentials.passkeyCiphertext ? decryptValue(credentials.passkeyCiphertext, tenantId, configurationId) : Promise.resolve(undefined),
  ]);
  return { consumerKey, consumerSecret, passkey };
};

const request = async <T>(url: string, init: RequestInit, timeoutMs = 10_000): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof body.errorMessage === "string" ? body.errorMessage : typeof body.error_description === "string" ? body.error_description : "Safaricom rejected the request";
      throw new Error(message.slice(0, 200));
    }
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("Safaricom did not respond in time");
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const getMpesaAccessToken = async (configurationId: string, environment: MpesaEnvironment, credentials: MpesaCredentials, force = false) => {
  const cached = tokenCache.get(configurationId);
  if (!force && cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const authorization = Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64");
  const response = await request<{ access_token?: string; expires_in?: string }>(`${mpesaApiBaseUrl(environment)}/oauth/v1/generate?grant_type=client_credentials`, { method: "GET", headers: { authorization: `Basic ${authorization}` } });
  if (!response.access_token) throw new Error("Safaricom did not return an access token");
  const expiresIn = Math.max(60, Number(response.expires_in ?? 3599));
  tokenCache.set(configurationId, { token: response.access_token, expiresAt: Date.now() + expiresIn * 1_000 });
  return response.access_token;
};

const authorizedPost = async <T>(configurationId: string, environment: MpesaEnvironment, credentials: MpesaCredentials, path: string, body: object) => {
  const token = await getMpesaAccessToken(configurationId, environment, credentials);
  return request<T>(`${mpesaApiBaseUrl(environment)}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
};

const timestamp = () => new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const stkPassword = (shortcode: string, passkey: string, value: string) => Buffer.from(`${shortcode}${passkey}${value}`).toString("base64");

export const requestStkPush = async (input: {
  configurationId: string;
  environment: MpesaEnvironment;
  credentials: MpesaCredentials;
  shortcode: string;
  transactionType: MpesaTransactionType;
  callbackUrl: string;
  phone: string;
  amountKes: number;
  accountReference: string;
}) => {
  if (!input.credentials.passkey) throw new Error("An STK passkey is required");
  const value = timestamp();
  const response = await authorizedPost<Record<string, unknown>>(input.configurationId, input.environment, input.credentials, "/mpesa/stkpush/v1/processrequest", {
    BusinessShortCode: input.shortcode,
    Password: stkPassword(input.shortcode, input.credentials.passkey, value),
    Timestamp: value,
    TransactionType: input.transactionType,
    Amount: input.amountKes,
    PartyA: input.phone,
    PartyB: input.shortcode,
    PhoneNumber: input.phone,
    CallBackURL: input.callbackUrl,
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: "BiasharaKit sale",
  });
  const checkoutRequestId = String(response.CheckoutRequestID ?? "");
  const merchantRequestId = String(response.MerchantRequestID ?? "");
  if (!checkoutRequestId || !merchantRequestId || String(response.ResponseCode ?? "") !== "0") throw new Error(String(response.ResponseDescription ?? "Safaricom did not accept the STK request").slice(0, 200));
  return { checkoutRequestId, merchantRequestId, responseCode: String(response.ResponseCode), message: String(response.CustomerMessage ?? response.ResponseDescription ?? "STK prompt sent") };
};

export const queryStkPush = async (input: { configurationId: string; environment: MpesaEnvironment; credentials: MpesaCredentials; shortcode: string; checkoutRequestId: string }) => {
  if (!input.credentials.passkey) throw new Error("An STK passkey is required");
  const value = timestamp();
  const response = await authorizedPost<Record<string, unknown>>(input.configurationId, input.environment, input.credentials, "/mpesa/stkpushquery/v1/query", {
    BusinessShortCode: input.shortcode,
    Password: stkPassword(input.shortcode, input.credentials.passkey, value),
    Timestamp: value,
    CheckoutRequestID: input.checkoutRequestId,
  });
  return { resultCode: String(response.ResultCode ?? response.ResponseCode ?? ""), resultDescription: String(response.ResultDesc ?? response.ResponseDescription ?? "Status unavailable").slice(0, 200) };
};

export const registerC2bUrls = async (input: { configurationId: string; environment: MpesaEnvironment; credentials: MpesaCredentials; shortcode: string; validationUrl: string; confirmationUrl: string }) => {
  const response = await authorizedPost<Record<string, unknown>>(input.configurationId, input.environment, input.credentials, "/mpesa/c2b/v1/registerurl", {
    ShortCode: input.shortcode,
    ResponseType: "Completed",
    ConfirmationURL: input.confirmationUrl,
    ValidationURL: input.validationUrl,
  });
  const responseCode = String(response.ResponseCode ?? "");
  if (responseCode !== "0") throw new Error(String(response.ResponseDescription ?? "C2B URL registration failed").slice(0, 200));
  return { responseCode, message: String(response.ResponseDescription ?? "C2B callbacks registered").slice(0, 200), requestId: String(response.OriginatorCoversationID ?? response.ConversationID ?? "") };
};
