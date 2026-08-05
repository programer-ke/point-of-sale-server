import { createHash, randomBytes, randomUUID } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { callbackTokenHash, mpesaPhoneFingerprint, normalizeC2bConfirmation, normalizeStkCallback, type MpesaEnvironment, type MpesaPaymentSource, type MpesaScope, type MpesaTransactionType, type NormalizedMpesaPaymentEvent } from "../domain/mpesa";
import { decryptMpesaCredentials, encryptMpesaCredentials, getMpesaAccessToken, registerC2bUrls, type EncryptedMpesaCredentials, type MpesaCredentials } from "../services/mpesa";

const tenantKey = (tenantId: string, value: string) => `TENANT#${tenantId}#${value}`;
const configKey = (tenantId: string, scope: MpesaScope, storeId?: string | null) => ({ partitionKey: tenantKey(tenantId, `MPESA_CONFIG#${scope === "business" ? "BUSINESS" : `STORE#${storeId}`}`), sortKey: "PROFILE" });
const callbackKey = (token: string) => ({ partitionKey: `MPESA_CALLBACK#${callbackTokenHash(token)}`, sortKey: "CONFIG" });
const callbackHashKey = (hash: string) => ({ partitionKey: `MPESA_CALLBACK#${hash}`, sortKey: "CONFIG" });
const shortcodeKey = (environment: MpesaEnvironment, shortcode: string) => ({ partitionKey: `MPESA_SHORTCODE#${environment}#${shortcode}`, sortKey: "CLAIM" });
const paymentKey = (receiptNumber: string) => ({ partitionKey: `MPESA_PAYMENT#${receiptNumber}`, sortKey: "PAYMENT" });
const receiptClaimKey = (receiptNumber: string) => ({ partitionKey: `MPESA_RECEIPT_CLAIM#${receiptNumber}`, sortKey: "CLAIM" });
const intentKey = (tenantId: string, id: string) => ({ partitionKey: tenantKey(tenantId, `MPESA_INTENT#${id}`), sortKey: "INTENT" });
const checkoutKey = (checkoutRequestId: string) => ({ partitionKey: `MPESA_CHECKOUT#${checkoutRequestId}`, sortKey: "INTENT" });
const strip = <T>(item?: Record<string, unknown>) => { if (!item) return null; const { partitionKey: _pk, sortKey: _sk, accessPartition: _ap, accessSort: _as, entityType: _et, tenantId: _tenantId, ...value } = item; return value as T; };

export type MpesaConnectionStatus = "testing" | "verified" | "failed";
export type C2bRegistrationStatus = "not_requested" | "registering" | "registered" | "failed";

export interface MpesaConfigurationRecord extends EncryptedMpesaCredentials {
  id: string;
  tenantId: string;
  scope: MpesaScope;
  storeId?: string | null;
  environment: MpesaEnvironment;
  shortcode: string;
  transactionType: MpesaTransactionType;
  stkEnabled: boolean;
  c2bEnabled: boolean;
  enabled: boolean;
  callbackToken: string;
  consumerKeyLast4: string;
  connectionStatus: MpesaConnectionStatus;
  connectionTestedAt?: string | null;
  connectionMessage: string;
  c2bRegistrationStatus: C2bRegistrationStatus;
  c2bRegistrationAttemptedAt?: string | null;
  c2bRegistrationMessage: string;
  providerRequestId?: string | null;
  providerResponseCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MpesaConfigurationView {
  id: string;
  scope: MpesaScope;
  storeId?: string | null;
  environment: MpesaEnvironment;
  shortcode: string;
  transactionType: MpesaTransactionType;
  stkEnabled: boolean;
  c2bEnabled: boolean;
  enabled: boolean;
  credentialsSaved: boolean;
  passkeySaved: boolean;
  consumerKeyLast4: string;
  connectionStatus: MpesaConnectionStatus;
  connectionTestedAt?: string | null;
  connectionMessage: string;
  c2bRegistrationStatus: C2bRegistrationStatus;
  c2bRegistrationAttemptedAt?: string | null;
  c2bRegistrationMessage: string;
  providerRequestId?: string | null;
  providerResponseCode?: string | null;
  callbackUrls: { stk: string; validation: string; confirmation: string };
  createdAt: string;
  updatedAt: string;
}

export interface MpesaPaymentRecord {
  id: string;
  tenantId: string;
  configurationId: string;
  scope: MpesaScope;
  storeId?: string | null;
  environment: MpesaEnvironment;
  shortcode: string;
  receiptNumber: string;
  amountKes: number;
  transactionAt: string;
  receivedAt: string;
  phoneHash?: string | null;
  phoneLast4?: string | null;
  checkoutRequestId?: string | null;
  merchantRequestId?: string | null;
  intentId?: string | null;
  evidenceSources: MpesaPaymentSource[];
  status: "unassigned" | "processing" | "assigned" | "review_required" | "resolved";
  conflictReasons: string[];
  saleId?: string | null;
  orderNumber?: string | null;
  resolution?: string | null;
  resolutionReason?: string | null;
  resolvedAt?: string | null;
  updatedAt: string;
}

export interface MpesaCheckoutIntentRecord {
  id: string;
  tenantId: string;
  configurationId: string;
  storeId: string;
  actor: { id: string; name: string; employeeCode?: string; role?: "admin" | "staff" };
  saleInput: Record<string, unknown>;
  saleTotal: number;
  amountKes: number;
  phoneHash: string;
  phoneLast4: string;
  status: "initiating" | "pending" | "paid" | "failed" | "expired" | "review_required" | "completed";
  checkoutRequestId?: string | null;
  merchantRequestId?: string | null;
  resultCode?: string | null;
  resultDescription?: string | null;
  paymentId?: string | null;
  saleId?: string | null;
  orderNumber?: string | null;
  createdAt: string;
  expiresAt: number;
  updatedAt: string;
}

const callbackBaseUrl = () => (process.env.MPESA_CALLBACK_BASE_URL ?? "").replace(/\/$/, "");
export const configurationCallbackUrls = (configuration: Pick<MpesaConfigurationRecord, "callbackToken">) => {
  const base = callbackBaseUrl();
  if (!base) throw new Error("M-Pesa callback base URL is not configured");
  const root = `${base}/public/mpesa/callback/${configuration.callbackToken}`;
  return { stk: `${root}/stk`, validation: `${root}/validation`, confirmation: `${root}/confirmation` };
};

const view = (configuration: MpesaConfigurationRecord): MpesaConfigurationView => ({
  id: configuration.id, scope: configuration.scope, storeId: configuration.storeId, environment: configuration.environment,
  shortcode: configuration.shortcode, transactionType: configuration.transactionType, stkEnabled: configuration.stkEnabled,
  c2bEnabled: configuration.c2bEnabled, enabled: configuration.enabled, credentialsSaved: true,
  passkeySaved: Boolean(configuration.passkeyCiphertext), consumerKeyLast4: configuration.consumerKeyLast4,
  connectionStatus: configuration.connectionStatus, connectionTestedAt: configuration.connectionTestedAt,
  connectionMessage: configuration.connectionMessage, c2bRegistrationStatus: configuration.c2bRegistrationStatus,
  c2bRegistrationAttemptedAt: configuration.c2bRegistrationAttemptedAt, c2bRegistrationMessage: configuration.c2bRegistrationMessage,
  providerRequestId: configuration.providerRequestId, providerResponseCode: configuration.providerResponseCode, callbackUrls: configurationCallbackUrls(configuration),
  createdAt: configuration.createdAt, updatedAt: configuration.updatedAt,
});

export const getMpesaConfiguration = async (tenantId: string, scope: MpesaScope, storeId?: string | null) => strip<MpesaConfigurationRecord>((await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: configKey(tenantId, scope, storeId) }))).Item);
export const getMpesaConfigurationView = async (tenantId: string, scope: MpesaScope, storeId?: string | null) => { const value = await getMpesaConfiguration(tenantId, scope, storeId); return value ? view(value) : null; };
export const getEffectiveMpesaConfiguration = async (tenantId: string, storeId: string, allowStoreOverride: boolean) => {
  if (allowStoreOverride) {
    const store = await getMpesaConfiguration(tenantId, "store", storeId);
    if (store?.enabled) return store;
  }
  const business = await getMpesaConfiguration(tenantId, "business");
  return business?.enabled ? business : null;
};

const safeMessage = (error: unknown) => error instanceof Error ? error.message.slice(0, 200) : "Safaricom request failed";
const persistConfiguration = (configuration: MpesaConfigurationRecord) => dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...configKey(configuration.tenantId, configuration.scope, configuration.storeId), accessPartition: tenantKey(configuration.tenantId, "MPESA_CONFIG"), accessSort: `${configuration.scope}#${configuration.storeId ?? "business"}`, entityType: "mpesa_configuration", ...configuration } }));

export const saveMpesaConfiguration = async (tenantId: string, input: {
  scope: MpesaScope; storeId?: string | null; environment: MpesaEnvironment; shortcode: string; transactionType: MpesaTransactionType;
  stkEnabled: boolean; c2bEnabled: boolean; consumerKey: string; consumerSecret: string; passkey?: string | null;
}, allowStoreOverride: boolean) => {
  if (input.scope === "store" && !allowStoreOverride) throw new Error("Store-level M-Pesa configurations require Biashara Plus");
  if (input.scope === "store" && !input.storeId) throw new Error("Select a store for this M-Pesa configuration");
  if (!/^\d{5,12}$/.test(input.shortcode.trim())) throw new Error("M-Pesa shortcode must contain 5 to 12 digits");
  if (!input.stkEnabled && !input.c2bEnabled) throw new Error("Enable STK Push or incoming C2B payments");
  const credentials: MpesaCredentials = { consumerKey: input.consumerKey.trim(), consumerSecret: input.consumerSecret.trim(), passkey: input.passkey?.trim() || undefined };
  if (!credentials.consumerKey || !credentials.consumerSecret) throw new Error("Consumer key and consumer secret are required");
  if (input.stkEnabled && !credentials.passkey) throw new Error("An STK passkey is required when STK Push is enabled");
  const current = await getMpesaConfiguration(tenantId, input.scope, input.storeId);
  const id = current?.id ?? randomUUID();
  const now = new Date().toISOString();
  const encrypted = await encryptMpesaCredentials(credentials, tenantId, id);
  const configuration: MpesaConfigurationRecord = {
    id, tenantId, scope: input.scope, storeId: input.scope === "store" ? input.storeId : null,
    environment: input.environment, shortcode: input.shortcode.trim(), transactionType: input.transactionType,
    stkEnabled: input.stkEnabled, c2bEnabled: input.c2bEnabled, enabled: false,
    callbackToken: current?.callbackToken ?? randomBytes(32).toString("base64url"), consumerKeyLast4: credentials.consumerKey.slice(-4),
    connectionStatus: "testing", connectionTestedAt: null, connectionMessage: "Testing credentials",
    c2bRegistrationStatus: input.c2bEnabled ? "registering" : "not_requested", c2bRegistrationAttemptedAt: null,
    c2bRegistrationMessage: input.c2bEnabled ? "Waiting for credential verification" : "C2B callbacks are not enabled",
    providerRequestId: null, providerResponseCode: null, ...encrypted, createdAt: current?.createdAt ?? now, updatedAt: now,
  };
  const existingClaim = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: shortcodeKey(configuration.environment, configuration.shortcode) }));
  if (existingClaim.Item && existingClaim.Item.configurationId !== id) throw new Error("This M-Pesa shortcode is already connected to another configuration");
  const shortcodeChanged = Boolean(current && (current.environment !== configuration.environment || current.shortcode !== configuration.shortcode));
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...configKey(tenantId, configuration.scope, configuration.storeId), accessPartition: tenantKey(tenantId, "MPESA_CONFIG"), accessSort: `${configuration.scope}#${configuration.storeId ?? "business"}`, entityType: "mpesa_configuration", ...configuration } } },
    { Put: { TableName: TABLE_NAME, Item: { ...callbackKey(configuration.callbackToken), entityType: "mpesa_callback_lookup", tenantId, configurationId: id, scope: configuration.scope, storeId: configuration.storeId }, ConditionExpression: current ? undefined : "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...shortcodeKey(configuration.environment, configuration.shortcode), entityType: "mpesa_shortcode_claim", tenantId, configurationId: id }, ConditionExpression: existingClaim.Item ? undefined : "attribute_not_exists(partitionKey)" } },
    ...(shortcodeChanged ? [{ Delete: { TableName: TABLE_NAME, Key: shortcodeKey(current!.environment, current!.shortcode), ConditionExpression: "configurationId = :configurationId", ExpressionAttributeValues: { ":configurationId": id } } }] : []),
  ] }));
  return testAndRegisterMpesaConfiguration(configuration);
};

const testAndRegisterMpesaConfiguration = async (configuration: MpesaConfigurationRecord) => {
  const now = new Date().toISOString();
  const credentials = await decryptMpesaCredentials(configuration, configuration.tenantId, configuration.id);
  try {
    await getMpesaAccessToken(configuration.id, configuration.environment, credentials, true);
    configuration.connectionStatus = "verified"; configuration.connectionTestedAt = now; configuration.connectionMessage = "Credentials verified"; configuration.enabled = true;
  } catch (error) {
    configuration.connectionStatus = "failed"; configuration.connectionTestedAt = now; configuration.connectionMessage = safeMessage(error); configuration.enabled = false;
    configuration.c2bRegistrationStatus = configuration.c2bEnabled ? "failed" : "not_requested";
    configuration.c2bRegistrationMessage = configuration.c2bEnabled ? "Credential verification failed before C2B registration" : "C2B callbacks are not enabled";
    configuration.updatedAt = now; await persistConfiguration(configuration); return view(configuration);
  }
  if (configuration.c2bEnabled) {
    configuration.c2bRegistrationAttemptedAt = now;
    try {
      const urls = configurationCallbackUrls(configuration);
      const result = await registerC2bUrls({ configurationId: configuration.id, environment: configuration.environment, credentials, shortcode: configuration.shortcode, validationUrl: urls.validation, confirmationUrl: urls.confirmation });
      configuration.c2bRegistrationStatus = "registered"; configuration.c2bRegistrationMessage = result.message; configuration.providerRequestId = result.requestId; configuration.providerResponseCode = result.responseCode;
    } catch (error) {
      configuration.c2bRegistrationStatus = "failed"; configuration.c2bRegistrationMessage = safeMessage(error);
    }
  } else {
    configuration.c2bRegistrationStatus = "not_requested"; configuration.c2bRegistrationMessage = "C2B callbacks are not enabled";
  }
  configuration.updatedAt = now; await persistConfiguration(configuration); return view(configuration);
};

export const testMpesaConfiguration = async (tenantId: string, scope: MpesaScope, storeId?: string | null) => {
  const configuration = await getMpesaConfiguration(tenantId, scope, storeId); if (!configuration) throw new Error("M-Pesa configuration not found");
  configuration.connectionStatus = "testing"; configuration.connectionMessage = "Testing credentials"; configuration.c2bRegistrationStatus = configuration.c2bEnabled ? "registering" : "not_requested"; configuration.updatedAt = new Date().toISOString(); await persistConfiguration(configuration);
  return testAndRegisterMpesaConfiguration(configuration);
};

export const registerMpesaCallbacks = async (tenantId: string, scope: MpesaScope, storeId?: string | null) => {
  const configuration = await getMpesaConfiguration(tenantId, scope, storeId); if (!configuration) throw new Error("M-Pesa configuration not found");
  if (!configuration.c2bEnabled) throw new Error("Enable incoming C2B payments first");
  if (configuration.connectionStatus !== "verified") throw new Error("Verify M-Pesa credentials before registering callbacks");
  const credentials = await decryptMpesaCredentials(configuration, tenantId, configuration.id); const now = new Date().toISOString();
  configuration.c2bRegistrationStatus = "registering"; configuration.c2bRegistrationAttemptedAt = now; configuration.updatedAt = now; await persistConfiguration(configuration);
  try { const urls = configurationCallbackUrls(configuration); const result = await registerC2bUrls({ configurationId: configuration.id, environment: configuration.environment, credentials, shortcode: configuration.shortcode, validationUrl: urls.validation, confirmationUrl: urls.confirmation }); configuration.c2bRegistrationStatus = "registered"; configuration.c2bRegistrationMessage = result.message; configuration.providerRequestId = result.requestId; configuration.providerResponseCode = result.responseCode; }
  catch (error) { configuration.c2bRegistrationStatus = "failed"; configuration.c2bRegistrationMessage = safeMessage(error); }
  configuration.updatedAt = new Date().toISOString(); await persistConfiguration(configuration); return view(configuration);
};

export const disableMpesaConfiguration = async (tenantId: string, scope: MpesaScope, storeId?: string | null) => {
  const configuration = await getMpesaConfiguration(tenantId, scope, storeId); if (!configuration) throw new Error("M-Pesa configuration not found");
  configuration.enabled = false; configuration.updatedAt = new Date().toISOString(); await persistConfiguration(configuration); return view(configuration);
};

export const regenerateMpesaCallbackToken = async (tenantId: string, scope: MpesaScope, storeId?: string | null) => {
  const configuration = await getMpesaConfiguration(tenantId, scope, storeId); if (!configuration) throw new Error("M-Pesa configuration not found");
  const oldToken = configuration.callbackToken; configuration.callbackToken = randomBytes(32).toString("base64url");
  configuration.c2bRegistrationStatus = configuration.c2bEnabled ? "failed" : "not_requested";
  configuration.c2bRegistrationAttemptedAt = null; configuration.providerRequestId = null; configuration.providerResponseCode = null;
  configuration.c2bRegistrationMessage = configuration.c2bEnabled ? "Callback token changed; register the new C2B URLs" : "C2B callbacks are not enabled";
  configuration.updatedAt = new Date().toISOString();
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...configKey(configuration.tenantId, configuration.scope, configuration.storeId), accessPartition: tenantKey(configuration.tenantId, "MPESA_CONFIG"), accessSort: `${configuration.scope}#${configuration.storeId ?? "business"}`, entityType: "mpesa_configuration", ...configuration } } },
    { Put: { TableName: TABLE_NAME, Item: { ...callbackKey(configuration.callbackToken), entityType: "mpesa_callback_lookup", tenantId, configurationId: configuration.id, scope: configuration.scope, storeId: configuration.storeId }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Delete: { TableName: TABLE_NAME, Key: callbackKey(oldToken), ConditionExpression: "configurationId = :configurationId", ExpressionAttributeValues: { ":configurationId": configuration.id } } },
  ] }));
  return view(configuration);
};

export const createMpesaIntent = async (intent: MpesaCheckoutIntentRecord) => {
  await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...intentKey(intent.tenantId, intent.id), accessPartition: tenantKey(intent.tenantId, "MPESA_INTENT"), accessSort: `${intent.createdAt}#${intent.id}`, entityType: "mpesa_intent", ...intent }, ConditionExpression: "attribute_not_exists(partitionKey)" })); return intent;
};
export const getMpesaIntent = async (tenantId: string, id: string) => {
  const intent = strip<MpesaCheckoutIntentRecord>((await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: intentKey(tenantId, id) }))).Item);
  if (intent && ["initiating", "pending"].includes(intent.status) && intent.expiresAt <= Math.floor(Date.now() / 1_000)) intent.status = "expired";
  return intent;
};
export const updateMpesaIntent = async (intent: MpesaCheckoutIntentRecord) => { intent.updatedAt = new Date().toISOString(); await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...intentKey(intent.tenantId, intent.id), accessPartition: tenantKey(intent.tenantId, "MPESA_INTENT"), accessSort: `${intent.createdAt}#${intent.id}`, entityType: "mpesa_intent", ...intent } })); return intent; };
export const putCheckoutAlias = (intent: MpesaCheckoutIntentRecord) => intent.checkoutRequestId ? dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...checkoutKey(intent.checkoutRequestId), entityType: "mpesa_checkout_lookup", tenantId: intent.tenantId, intentId: intent.id }, ConditionExpression: "attribute_not_exists(partitionKey)" })) : Promise.resolve();
export const intentByCheckoutRequest = async (checkoutRequestId: string) => { const alias = (await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: checkoutKey(checkoutRequestId) }))).Item; return alias ? getMpesaIntent(String(alias.tenantId), String(alias.intentId)) : null; };

const configByCallbackHash = async (hash: string) => {
  const lookup = (await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: callbackHashKey(hash) }))).Item;
  if (!lookup) return null;
  const config = await getMpesaConfiguration(String(lookup.tenantId), String(lookup.scope) as MpesaScope, lookup.storeId ? String(lookup.storeId) : null);
  return config?.id === lookup.configurationId ? config : null;
};

const deliveryId = (source: string, payload: unknown) => createHash("sha256").update(`${source}:${JSON.stringify(payload)}`).digest("hex");
const recordDelivery = async (configuration: MpesaConfigurationRecord, source: string, payload: unknown, result: string, providerIdentifiers: Record<string, string> = {}) => {
  const id = deliveryId(source, payload); const now = new Date().toISOString();
  try {
    await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { partitionKey: `MPESA_DELIVERY#${id}`, sortKey: "DELIVERY", entityType: "mpesa_callback_delivery", tenantId: configuration.tenantId, configurationId: configuration.id, source, result, providerIdentifiers, receivedAt: now, lastReceivedAt: now, replayCount: 0, expiresAt: Math.floor(Date.now() / 1_000) + 90 * 24 * 60 * 60 }, ConditionExpression: "attribute_not_exists(partitionKey)" })); return true;
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
    await dynamoDB.send(new UpdateCommand({ TableName: TABLE_NAME, Key: { partitionKey: `MPESA_DELIVERY#${id}`, sortKey: "DELIVERY" }, UpdateExpression: "SET lastReceivedAt = :now ADD replayCount :one", ExpressionAttributeValues: { ":now": now, ":one": 1 } }));
    return false;
  }
};

const mergePayment = async (configuration: MpesaConfigurationRecord, event: NormalizedMpesaPaymentEvent, intent?: MpesaCheckoutIntentRecord | null) => {
  const existingItem = (await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: paymentKey(event.receiptNumber) }))).Item;
  const existing = strip<MpesaPaymentRecord>(existingItem);
  const fingerprint: { phoneHash?: string; phoneLast4?: string } = event.phone ? mpesaPhoneFingerprint(event.phone) : {};
  const now = new Date().toISOString();
  if (!existing) {
    const payment: MpesaPaymentRecord = { id: randomUUID(), tenantId: configuration.tenantId, configurationId: configuration.id, scope: configuration.scope, storeId: configuration.storeId, environment: configuration.environment, shortcode: configuration.shortcode, receiptNumber: event.receiptNumber, amountKes: event.amountKes, transactionAt: event.transactionAt, receivedAt: now, ...fingerprint, checkoutRequestId: event.checkoutRequestId, merchantRequestId: event.merchantRequestId, intentId: intent?.id, evidenceSources: [event.source], status: "unassigned", conflictReasons: [], updatedAt: now };
    try { await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: TABLE_NAME, Item: { ...paymentKey(payment.receiptNumber), accessPartition: tenantKey(payment.tenantId, "MPESA_PAYMENT"), accessSort: `${payment.receivedAt}#${payment.receiptNumber}`, entityType: "mpesa_payment", ...payment }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
      { Put: { TableName: TABLE_NAME, Item: { ...receiptClaimKey(payment.receiptNumber), entityType: "mpesa_receipt_claim", tenantId: payment.tenantId, paymentId: payment.id, evidence: "verified", createdAt: now }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    ] })); return payment; }
    catch (error) {
      if ((error as { name?: string }).name !== "TransactionCanceledException" && (error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
      const concurrent = await getMpesaPayment(event.receiptNumber);
      if (concurrent) return mergePayment(configuration, event, intent);
      payment.status = "review_required"; payment.conflictReasons = ["Receipt was already claimed by another payment record"];
      try {
        await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...paymentKey(payment.receiptNumber), accessPartition: tenantKey(payment.tenantId, "MPESA_PAYMENT"), accessSort: `${payment.receivedAt}#${payment.receiptNumber}`, entityType: "mpesa_payment", ...payment }, ConditionExpression: "attribute_not_exists(partitionKey)" }));
        return payment;
      } catch (putError) {
        if ((putError as { name?: string }).name !== "ConditionalCheckFailedException") throw putError;
        return mergePayment(configuration, event, intent);
      }
    }
  }
  const conflicts = [...existing.conflictReasons];
  if (existing.tenantId !== configuration.tenantId) conflicts.push("Receipt was reported for another business");
  if (existing.environment !== configuration.environment) conflicts.push("Environment differs between callbacks");
  if (existing.shortcode !== event.shortcode) conflicts.push("Shortcode differs between callbacks");
  if (existing.amountKes !== event.amountKes) conflicts.push("Amount differs between callbacks");
  if (Math.abs(new Date(existing.transactionAt).valueOf() - new Date(event.transactionAt).valueOf()) > 5 * 60_000) conflicts.push("Transaction time differs between callbacks");
  if (existing.phoneHash && fingerprint.phoneHash && existing.phoneHash !== fingerprint.phoneHash) conflicts.push("Payer phone differs between callbacks");
  const next: MpesaPaymentRecord = { ...existing, ...(!existing.phoneHash ? fingerprint : {}), checkoutRequestId: existing.checkoutRequestId ?? event.checkoutRequestId, merchantRequestId: existing.merchantRequestId ?? event.merchantRequestId, intentId: existing.intentId ?? intent?.id, evidenceSources: [...new Set([...existing.evidenceSources, event.source])], conflictReasons: [...new Set(conflicts)], status: conflicts.length && existing.status !== "assigned" ? "review_required" : existing.status, updatedAt: now };
  try {
    await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...paymentKey(next.receiptNumber), accessPartition: tenantKey(next.tenantId, "MPESA_PAYMENT"), accessSort: `${next.receivedAt}#${next.receiptNumber}`, entityType: "mpesa_payment", ...next }, ConditionExpression: "updatedAt = :expected", ExpressionAttributeValues: { ":expected": existing.updatedAt } }));
    return next;
  } catch (error) {
    if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
    return mergePayment(configuration, event, intent);
  }
};

export const handleMpesaCallback = async (token: string, kind: "stk" | "validation" | "confirmation", payload: unknown) => {
  const configuration = await configByCallbackHash(callbackTokenHash(token)); if (!configuration) throw new Error("Unknown M-Pesa callback");
  if (kind !== "stk" && (!configuration.c2bEnabled || configuration.c2bRegistrationStatus !== "registered")) throw new Error("C2B callbacks are not active for this configuration");
  if (kind === "validation") {
    const event = normalizeC2bConfirmation(payload);
    if (event.shortcode !== configuration.shortcode) throw new Error("C2B shortcode does not match this callback configuration");
    await recordDelivery(configuration, kind, payload, "accepted", { receiptNumber: event.receiptNumber });
    return { accepted: true, configuration, payment: null, intent: null };
  }
  if (kind === "stk") {
    const result = normalizeStkCallback(payload, configuration.shortcode); const duplicate = !(await recordDelivery(configuration, kind, payload, result.resultCode === 0 ? "paid" : "failed", { checkoutRequestId: result.checkoutRequestId, merchantRequestId: result.merchantRequestId, ...(result.payment ? { receiptNumber: result.payment.receiptNumber } : {}) }));
    const intent = await intentByCheckoutRequest(result.checkoutRequestId);
    if (intent && result.resultCode !== 0) { intent.status = "failed"; intent.resultCode = String(result.resultCode); intent.resultDescription = result.resultDescription; await updateMpesaIntent(intent); }
    if (!result.payment) return { accepted: true, duplicate, configuration, payment: null, intent };
    const payment = await mergePayment(configuration, result.payment, intent);
    if (intent) { intent.status = intent.expiresAt <= Math.floor(Date.now() / 1_000) ? "expired" : payment.status === "review_required" ? "review_required" : "paid"; intent.paymentId = payment.id; await updateMpesaIntent(intent); }
    return { accepted: true, duplicate, configuration, payment, intent };
  }
  const event = normalizeC2bConfirmation(payload); if (event.shortcode !== configuration.shortcode) throw new Error("C2B shortcode does not match this callback configuration");
  const duplicate = !(await recordDelivery(configuration, kind, payload, "paid", { receiptNumber: event.receiptNumber })); const payment = await mergePayment(configuration, event);
  const intent = payment.checkoutRequestId ? await intentByCheckoutRequest(payment.checkoutRequestId) : null;
  return { accepted: true, duplicate, configuration, payment, intent };
};

export const listRecentMpesaPayments = async (tenantId: string, configurationId: string, amountKes?: number | null, minutes = 30) => {
  const from = new Date(Date.now() - minutes * 60_000).toISOString(); const response = await dynamoDB.send(new QueryCommand({ TableName: TABLE_NAME, IndexName: "AccessIndex", KeyConditionExpression: "accessPartition = :pk AND accessSort >= :from", ExpressionAttributeValues: { ":pk": tenantKey(tenantId, "MPESA_PAYMENT"), ":from": from }, ScanIndexForward: false }));
  return (response.Items ?? []).map((item) => strip<MpesaPaymentRecord>(item)!).filter((payment) => payment.configurationId === configurationId && payment.status === "unassigned").sort((a, b) => Number(b.amountKes === amountKes) - Number(a.amountKes === amountKes));
};
export const listMpesaPayments = async (tenantId: string, limit = 100) => { const response = await dynamoDB.send(new QueryCommand({ TableName: TABLE_NAME, IndexName: "AccessIndex", KeyConditionExpression: "accessPartition = :pk", ExpressionAttributeValues: { ":pk": tenantKey(tenantId, "MPESA_PAYMENT") }, ScanIndexForward: false, Limit: Math.min(limit, 500) })); return (response.Items ?? []).map((item) => strip<MpesaPaymentRecord>(item)!); };
export const getMpesaPayment = async (receiptNumber: string) => strip<MpesaPaymentRecord>((await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: paymentKey(receiptNumber) }))).Item);
export const claimMpesaPayment = async (tenantId: string, receiptNumber: string) => {
  const now = new Date().toISOString();
  try {
    await dynamoDB.send(new UpdateCommand({ TableName: TABLE_NAME, Key: paymentKey(receiptNumber), UpdateExpression: "SET #status = :processing, updatedAt = :now", ConditionExpression: "tenantId = :tenant AND #status = :unassigned", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":processing": "processing", ":unassigned": "unassigned", ":tenant": tenantId, ":now": now } }));
    return getMpesaPayment(receiptNumber);
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") return null;
    throw error;
  }
};
export const assignMpesaPayment = async (payment: MpesaPaymentRecord, sale: { id: string; orderNumber: string }) => { payment.status = "assigned"; payment.saleId = sale.id; payment.orderNumber = sale.orderNumber; payment.updatedAt = new Date().toISOString(); await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...paymentKey(payment.receiptNumber), accessPartition: tenantKey(payment.tenantId, "MPESA_PAYMENT"), accessSort: `${payment.receivedAt}#${payment.receiptNumber}`, entityType: "mpesa_payment", ...payment } })); return payment; };
export const releaseMpesaPayment = async (payment: MpesaPaymentRecord, reason?: string) => { payment.status = reason ? "review_required" : "unassigned"; if (reason) payment.conflictReasons = [...new Set([...payment.conflictReasons, reason])]; payment.updatedAt = new Date().toISOString(); await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...paymentKey(payment.receiptNumber), accessPartition: tenantKey(payment.tenantId, "MPESA_PAYMENT"), accessSort: `${payment.receivedAt}#${payment.receiptNumber}`, entityType: "mpesa_payment", ...payment } })); };
export const resolveMpesaPayment = async (tenantId: string, receiptNumber: string, resolution: string, reason: string) => { const payment = await getMpesaPayment(receiptNumber); if (!payment || payment.tenantId !== tenantId) throw new Error("M-Pesa payment not found"); if (!/^(refunded|external_sale|ignored)$/.test(resolution)) throw new Error("Select a valid resolution"); if (reason.trim().length < 3) throw new Error("Enter a reconciliation reason"); payment.status = "resolved"; payment.resolution = resolution; payment.resolutionReason = reason.trim(); payment.resolvedAt = new Date().toISOString(); payment.updatedAt = payment.resolvedAt; await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...paymentKey(payment.receiptNumber), accessPartition: tenantKey(payment.tenantId, "MPESA_PAYMENT"), accessSort: `${payment.receivedAt}#${payment.receiptNumber}`, entityType: "mpesa_payment", ...payment } })); return payment; };
