import { createHash, randomUUID } from "node:crypto";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";

export type Actor = { id: string; name: string };
export type EntityStatus = "active" | "inactive";

export interface StoreRecord {
  id: string;
  code: string;
  name: string;
  address: string;
  receiptBusinessName: string;
  receiptAddress: string;
  receiptPhone: string;
  receiptEmail: string;
  receiptFooter: string;
  receiptReturnPolicy: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierRecord {
  id: string;
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierProductRecord {
  supplierId: string;
  productId: string;
  supplierSku: string;
  purchaseUnit: string;
  unitsPerPurchaseUnit: number;
  lastPurchasePrice: number;
  preferred: boolean;
  updatedAt: string;
}

export interface StoreProductPolicyRecord {
  storeId: string;
  productId: string;
  reorderPoint: number;
  targetQuantity: number;
  updatedAt: string;
}

export interface PurchaseOrderLineRecord {
  id: string;
  productId: string;
  productName: string;
  supplierSku: string;
  purchaseUnit: string;
  unitsPerPurchaseUnit: number;
  orderedPurchaseQuantity: number;
  acceptedBaseQuantity: number;
  pricePerPurchaseUnit: number;
}

export type PurchaseOrderStatus = "draft" | "issued" | "partially_received" | "completed" | "closed" | "cancelled";
export interface PurchaseOrderRecord {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  storeId: string;
  storeName: string;
  status: PurchaseOrderStatus;
  expectedDeliveryDate?: string | null;
  notes: string;
  closeReason?: string | null;
  lines: PurchaseOrderLineRecord[];
  totalAmount: number;
  createdBy: string;
  createdByName: string;
  issuedAt?: string | null;
  receiptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptLineInput {
  purchaseOrderLineId: string;
  batchNumber?: string | null;
  expiryDate?: string | null;
  deliveredBaseQuantity: number;
  acceptedBaseQuantity: number;
  damagedBaseQuantity: number;
  rejectedBaseQuantity: number;
  actualPricePerPurchaseUnit: number;
}

export interface GoodsReceiptRecord {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  storeId: string;
  storeName: string;
  deliveryNote: string;
  invoiceNumber: string;
  lines: Array<ReceiptLineInput & { productId: string; productName: string; orderedPricePerPurchaseUnit: number; actualPricePerPurchaseUnit: number; priceVariance: number; unitCost: number; lotId?: string | null }>;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface InventoryLotRecord {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  supplierId?: string | null;
  receiptId?: string | null;
  batchNumber: string;
  expiryDate?: string | null;
  receivedQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  origin: "supplier_receipt" | "transfer";
  status: "active" | "exhausted";
  receivedAt: string;
  updatedAt: string;
}

export type StockMovementType = "receipt" | "sale" | "transfer_dispatch" | "transfer_receive" | "transfer_damage" | "transfer_shortage" | "damage" | "expiry" | "count_correction";
export interface StockMovementRecord {
  id: string;
  type: StockMovementType;
  storeId: string;
  productId: string;
  productName: string;
  lotId?: string | null;
  quantity: number;
  unitCost: number;
  reason: string;
  referenceId?: string | null;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export interface TransferLineRecord {
  productId: string;
  productName: string;
  quantity: number;
  allocations?: Array<{ lotId: string; quantity: number; unitCost: number; batchNumber: string; expiryDate?: string | null; supplierId?: string | null }>;
}

export interface StockTransferRecord {
  id: string;
  transferNumber: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  status: "draft" | "dispatched" | "completed" | "cancelled";
  notes: string;
  lines: TransferLineRecord[];
  createdBy: string;
  createdByName: string;
  dispatchedAt?: string | null;
  receivedAt?: string | null;
  receivedBy?: string | null;
  receivedByName?: string | null;
  receiptLines?: TransferReceiptLineRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface StockRequisitionRecord { id: string; requisitionNumber: string; fromStoreId: string; fromStoreName: string; toStoreId: string; toStoreName: string; status: "requested" | "approved" | "rejected" | "converted" | "cancelled"; notes: string; decisionReason?: string | null; lines: Array<{ productId: string; productName: string; quantity: number }>; requestedBy: string; requestedByName: string; decidedBy?: string | null; decidedByName?: string | null; transferId?: string | null; createdAt: string; updatedAt: string }

export interface TransferReceiptLineRecord {
  lotId: string;
  productId: string;
  productName: string;
  dispatchedQuantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  missingQuantity: number;
  reason: string;
  destinationLotId?: string | null;
}

export interface StocktakeLineRecord { lotId: string; productId: string; productName: string; batchNumber: string; expectedQuantity: number; countedQuantity?: number | null; variance?: number | null; unitCost: number }
export interface StocktakeSessionRecord { id: string; stocktakeNumber: string; storeId: string; storeName: string; name: string; status: "in_progress" | "completed" | "cancelled"; lines: StocktakeLineRecord[]; createdBy: string; createdByName: string; completedBy?: string | null; completedByName?: string | null; reason?: string | null; createdAt: string; completedAt?: string | null; updatedAt: string }

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalized = (value: string) => value.trim().replace(/\s+/g, " ");
const normalizedCode = (value: string) => normalized(value).toUpperCase();
const tenantKey = (tenantId: string, value: string) => `TENANT#${tenantId}#${value}`;
const key = (tenantId: string, kind: string, id: string, sortKey = "PROFILE") => ({ partitionKey: tenantKey(tenantId, `${kind}#${id}`), sortKey });
const collection = (tenantId: string, name: string) => tenantKey(tenantId, name);

const stripKeys = <T>(item?: Record<string, unknown>): T | null => {
  if (!item) return null;
  const { partitionKey: _pk, sortKey: _sk, accessPartition: _ap, accessSort: _as, entityType: _et, tenantId: _tenant, ...record } = item;
  return record as T;
};

const queryCollection = async <T>(tenantId: string, name: string, range?: { from?: string; to?: string; limit?: number; descending?: boolean }) => {
  const items: T[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: range?.from && range?.to
        ? "accessPartition = :pk AND accessSort BETWEEN :from AND :to"
        : "accessPartition = :pk",
      ExpressionAttributeValues: {
        ":pk": collection(tenantId, name),
        ...(range?.from ? { ":from": range.from } : {}),
        ...(range?.to ? { ":to": `${range.to}\uffff` } : {}),
      },
      ExclusiveStartKey: cursor,
      ScanIndexForward: !range?.descending,
      Limit: range?.limit ? Math.max(1, range.limit - items.length) : undefined,
    }));
    items.push(...(result.Items ?? []).map((item) => stripKeys<T>(item)!));
    cursor = range?.limit && items.length >= range.limit ? undefined : result.LastEvaluatedKey;
  } while (cursor);
  return items;
};

const get = async <T>(tenantId: string, kind: string, id: string, sortKey = "PROFILE") => {
  const result = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: key(tenantId, kind, id, sortKey) }));
  return stripKeys<T>(result.Item);
};

type CatalogProduct = { id: string; name: string; sku: string; baseUnit: string; tracksExpiry: boolean; status: EntityStatus };
const getCatalogProduct = (tenantId: string, id: string) => get<CatalogProduct>(tenantId, "PRODUCT", id);
const getSupplierProduct = (tenantId: string, supplierId: string, productId: string) => get<SupplierProductRecord>(tenantId, "SUPPLIER_PRODUCT", `${supplierId}#${productId}`);

export const stockMovementPut = (tenantId: string, movement: Omit<StockMovementRecord, "id" | "createdAt">, now: string) => {
  const id = randomUUID();
  return { Put: { TableName: TABLE_NAME, Item: {
    ...key(tenantId, "MOVEMENT", id, "EVENT"), accessPartition: collection(tenantId, "STOCK#MOVEMENT"),
    accessSort: `${now}#${id}`, entityType: "stock_movement", tenantId, id, ...movement, createdAt: now,
  } } };
};

const idempotencyKey = (tenantId: string, operation: string, requestId: string) => key(tenantId, `IDEMPOTENCY#${operation}`, requestId, "RESULT");
const requestHash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
export const existingIdempotentResult = async <T>(tenantId: string, operation: string, requestId: string, payload?: unknown) => {
  if (!requestId.trim() || requestId.length > 100) throw new Error("A valid idempotency key is required");
  const result = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: idempotencyKey(tenantId, operation, requestId) }));
  if (result.Item && payload !== undefined && result.Item.requestHash !== requestHash(payload)) throw new Error("This idempotency key was already used for a different request");
  return result.Item?.result as T | undefined;
};
const idempotencyPut = (tenantId: string, operation: string, requestId: string, payload: unknown, result: unknown) => ({ Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, operation, requestId), entityType: "idempotency", tenantId, requestHash: requestHash(payload), result, expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
export const commitIdempotent = async <T>(tenantId: string, operation: string, requestId: string, payload: unknown, result: T, transaction: NonNullable<TransactWriteCommandInput["TransactItems"]>) => {
  transaction.push(idempotencyPut(tenantId, operation, requestId, payload, result));
  try { await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction })); return result; }
  catch (error) {
    if (error instanceof Error && (error.name === "TransactionCanceledException" || error.name === "ConditionalCheckFailedException")) {
      const previous = await existingIdempotentResult<T>(tenantId, operation, requestId, payload);
      if (previous) return previous;
    }
    throw error;
  }
};

const validateCount = (value: number, label: string, allowZero = true) => {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} must be ${allowZero ? "zero or a positive" : "a positive"} whole number`);
};

export const listStores = (tenantId: string) => queryCollection<StoreRecord>(tenantId, "STORE");
export const getStore = (tenantId: string, id: string) => get<StoreRecord>(tenantId, "STORE", id);
export const createStore = async (tenantId: string, input: Pick<StoreRecord, "code" | "name" | "address"> & Partial<Pick<StoreRecord, "receiptBusinessName" | "receiptAddress" | "receiptPhone" | "receiptEmail" | "receiptFooter" | "receiptReturnPolicy">>, actor: Actor) => {
  const id = randomUUID(); const now = new Date().toISOString();
  const store: StoreRecord = { id, code: normalizedCode(input.code), name: normalized(input.name), address: normalized(input.address), receiptBusinessName: normalized(input.receiptBusinessName ?? ""), receiptAddress: normalized(input.receiptAddress ?? ""), receiptPhone: input.receiptPhone?.trim() ?? "", receiptEmail: input.receiptEmail?.trim().toLowerCase() ?? "", receiptFooter: normalized(input.receiptFooter ?? ""), receiptReturnPolicy: normalized(input.receiptReturnPolicy ?? ""), status: "active", createdAt: now, updatedAt: now };
  if (!store.code || !store.name) throw new Error("Store code and name are required");
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "STORE", id), accessPartition: collection(tenantId, "STORE"), accessSort: `${store.name.toLowerCase()}#${id}`, entityType: "store", tenantId, ...store }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "LOOKUP#STORE", store.code), entityType: "store_lookup", tenantId, storeId: id }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return store;
};

export const updateStore = async (tenantId: string, id: string, input: Partial<Pick<StoreRecord, "name" | "address" | "receiptBusinessName" | "receiptAddress" | "receiptPhone" | "receiptEmail" | "receiptFooter" | "receiptReturnPolicy" | "status">>) => {
  const current = await getStore(tenantId, id); if (!current) throw new Error("Store not found");
  if (input.status === "inactive" && current.status === "active") {
    const [lots, orders, transfers] = await Promise.all([listLots(tenantId, id), listPurchaseOrders(tenantId), listTransfers(tenantId)]);
    if (lots.some((lot) => lot.remainingQuantity > 0)) throw new Error("Move or write off this store's stock before deactivating it");
    if (orders.some((order) => order.storeId === id && (order.status === "draft" || order.status === "issued" || order.status === "partially_received"))) throw new Error("Close this store's open purchase orders before deactivating it");
    if (transfers.some((transfer) => (transfer.fromStoreId === id || transfer.toStoreId === id) && (transfer.status === "draft" || transfer.status === "dispatched"))) throw new Error("Complete this store's open transfers before deactivating it");
  }
  const next = { ...current, ...input, name: normalized(input.name ?? current.name), address: normalized(input.address ?? current.address), receiptBusinessName: normalized(input.receiptBusinessName ?? current.receiptBusinessName ?? ""), receiptAddress: normalized(input.receiptAddress ?? current.receiptAddress ?? ""), receiptPhone: (input.receiptPhone ?? current.receiptPhone ?? "").trim(), receiptEmail: (input.receiptEmail ?? current.receiptEmail ?? "").trim().toLowerCase(), receiptFooter: normalized(input.receiptFooter ?? current.receiptFooter ?? ""), receiptReturnPolicy: normalized(input.receiptReturnPolicy ?? current.receiptReturnPolicy ?? ""), updatedAt: new Date().toISOString() };
  await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...key(tenantId, "STORE", id), accessPartition: collection(tenantId, "STORE"), accessSort: `${next.name.toLowerCase()}#${id}`, entityType: "store", tenantId, ...next }, ConditionExpression: "attribute_exists(partitionKey)" }));
  return next;
};

export const listSuppliers = (tenantId: string) => queryCollection<SupplierRecord>(tenantId, "SUPPLIER");
export const getSupplier = (tenantId: string, id: string) => get<SupplierRecord>(tenantId, "SUPPLIER", id);
export const createSupplier = async (tenantId: string, input: Omit<SupplierRecord, "id" | "status" | "createdAt" | "updatedAt">) => {
  const id = randomUUID(); const now = new Date().toISOString();
  const supplier: SupplierRecord = { id, code: normalizedCode(input.code), name: normalized(input.name), contactName: normalized(input.contactName), phone: input.phone.trim(), email: input.email.trim().toLowerCase(), address: normalized(input.address), status: "active", createdAt: now, updatedAt: now };
  if (!supplier.code || !supplier.name) throw new Error("Supplier code and name are required");
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "SUPPLIER", id), accessPartition: collection(tenantId, "SUPPLIER"), accessSort: `${supplier.name.toLowerCase()}#${id}`, entityType: "supplier", tenantId, ...supplier }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "LOOKUP#SUPPLIER", supplier.code), entityType: "supplier_lookup", tenantId, supplierId: id }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return supplier;
};

export const updateSupplier = async (tenantId: string, id: string, input: Partial<Omit<SupplierRecord, "id" | "code" | "createdAt" | "updatedAt">>) => {
  const current = await getSupplier(tenantId, id); if (!current) throw new Error("Supplier not found");
  if (input.status === "inactive" && current.status === "active" && (await listPurchaseOrders(tenantId)).some((order) => order.supplierId === id && (order.status === "draft" || order.status === "issued" || order.status === "partially_received"))) throw new Error("Close this supplier's open purchase orders before deactivating it");
  const next = { ...current, ...input, name: normalized(input.name ?? current.name), contactName: normalized(input.contactName ?? current.contactName), address: normalized(input.address ?? current.address), email: (input.email ?? current.email).trim().toLowerCase(), phone: (input.phone ?? current.phone).trim(), updatedAt: new Date().toISOString() };
  await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...key(tenantId, "SUPPLIER", id), accessPartition: collection(tenantId, "SUPPLIER"), accessSort: `${next.name.toLowerCase()}#${id}`, entityType: "supplier", tenantId, ...next }, ConditionExpression: "attribute_exists(partitionKey)" }));
  return next;
};

export const listSupplierProducts = (tenantId: string, supplierId?: string) => {
  if (supplierId) return queryCollection<SupplierProductRecord>(tenantId, `SUPPLIER#${supplierId}#PRODUCT`);
  return listSuppliers(tenantId).then((suppliers) => Promise.all(suppliers.map((supplier) => queryCollection<SupplierProductRecord>(tenantId, `SUPPLIER#${supplier.id}#PRODUCT`))).then((values) => values.flat()));
};

export const upsertSupplierProduct = async (tenantId: string, input: SupplierProductRecord) => {
  validateCount(input.unitsPerPurchaseUnit, "Units per purchase unit", false);
  if (!Number.isFinite(input.lastPurchasePrice) || input.lastPurchasePrice < 0) throw new Error("Purchase price must be zero or greater");
  if (!normalized(input.supplierSku) || !normalized(input.purchaseUnit)) throw new Error("Supplier SKU and purchase unit are required");
  const now = new Date().toISOString();
  const record = { ...input, supplierSku: normalizedCode(input.supplierSku), purchaseUnit: normalized(input.purchaseUnit), updatedAt: now };
  const preferredKey = key(tenantId, "PREFERRED_SUPPLIER", record.productId);
  const [supplier, product, current, preferredLookup] = await Promise.all([
    getSupplier(tenantId, record.supplierId), getCatalogProduct(tenantId, record.productId),
    getSupplierProduct(tenantId, record.supplierId, record.productId),
    dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: preferredKey })).then((value) => value.Item),
  ]);
  if (!supplier || supplier.status !== "active") throw new Error("Select an active supplier");
  if (!product || product.status !== "active") throw new Error("Select an active product");
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  const skuLookup = key(tenantId, `LOOKUP#SUPPLIER_SKU#${record.supplierId}`, record.supplierSku);
  if (current?.supplierSku && current.supplierSku !== record.supplierSku) transaction.push({ Delete: { TableName: TABLE_NAME, Key: key(tenantId, `LOOKUP#SUPPLIER_SKU#${record.supplierId}`, current.supplierSku) } });
  if (!current || current.supplierSku !== record.supplierSku) transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...skuLookup, entityType: "supplier_sku_lookup", tenantId, productId: record.productId }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  if (record.preferred) {
    const previousSupplierId = preferredLookup?.supplierId as string | undefined;
    if (previousSupplierId && previousSupplierId !== record.supplierId) {
      const previous = await getSupplierProduct(tenantId, previousSupplierId, record.productId);
      if (previous) transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "SUPPLIER_PRODUCT", `${previous.supplierId}#${previous.productId}`), accessPartition: collection(tenantId, `SUPPLIER#${previous.supplierId}#PRODUCT`), accessSort: `${previous.productId}`, entityType: "supplier_product", tenantId, ...previous, preferred: false, updatedAt: now } } });
    }
    transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...preferredKey, entityType: "preferred_supplier", tenantId, supplierId: record.supplierId }, ...(previousSupplierId && previousSupplierId !== record.supplierId ? { ConditionExpression: "supplierId = :previous", ExpressionAttributeValues: { ":previous": previousSupplierId } } : !previousSupplierId ? { ConditionExpression: "attribute_not_exists(partitionKey)" } : {}) } });
  } else if (preferredLookup?.supplierId === record.supplierId) {
    transaction.push({ Delete: { TableName: TABLE_NAME, Key: preferredKey, ConditionExpression: "supplierId = :supplierId", ExpressionAttributeValues: { ":supplierId": record.supplierId } } });
  }
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "SUPPLIER_PRODUCT", `${record.supplierId}#${record.productId}`), accessPartition: collection(tenantId, `SUPPLIER#${record.supplierId}#PRODUCT`), accessSort: record.productId, entityType: "supplier_product", tenantId, ...record } } });
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return record;
};

export const listStorePolicies = (tenantId: string, storeId?: string) => storeId
  ? queryCollection<StoreProductPolicyRecord>(tenantId, `STORE#${storeId}#POLICY`)
  : listStores(tenantId).then((stores) => Promise.all(stores.map((store) => queryCollection<StoreProductPolicyRecord>(tenantId, `STORE#${store.id}#POLICY`))).then((values) => values.flat()));
export const upsertStorePolicy = async (tenantId: string, input: Omit<StoreProductPolicyRecord, "updatedAt">) => {
  validateCount(input.reorderPoint, "Reorder point"); validateCount(input.targetQuantity, "Target quantity");
  if (input.targetQuantity < input.reorderPoint) throw new Error("Target quantity must be at least the reorder point");
  const [store, product] = await Promise.all([getStore(tenantId, input.storeId), getCatalogProduct(tenantId, input.productId)]);
  if (!store || store.status !== "active") throw new Error("Select an active store");
  if (!product || product.status !== "active") throw new Error("Select an active product");
  const record = { ...input, updatedAt: new Date().toISOString() };
  await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...key(tenantId, "STORE_POLICY", `${input.storeId}#${input.productId}`), accessPartition: collection(tenantId, `STORE#${input.storeId}#POLICY`), accessSort: input.productId, entityType: "store_product_policy", tenantId, ...record } }));
  return record;
};

export const listLots = async (tenantId: string, storeId?: string, includeExhausted = false) => {
  const stores = storeId ? [{ id: storeId }] : await listStores(tenantId);
  const groups = await Promise.all(stores.map(async (store) => {
    const active = await queryCollection<InventoryLotRecord>(tenantId, `STORE#${store.id}#INVENTORY#ACTIVE`);
    return includeExhausted ? [...active, ...await queryCollection<InventoryLotRecord>(tenantId, `STORE#${store.id}#INVENTORY#LOT`)] : active;
  }));
  return groups.flat();
};
export const getLot = (tenantId: string, id: string) => get<InventoryLotRecord>(tenantId, "LOT", id);
export const sellableLots = async (tenantId: string, storeId: string, productId?: string, at = new Date()) => {
  const today = new Date(at.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return (await listLots(tenantId, storeId)).filter((lot) => lot.status === "active" && lot.remainingQuantity > 0 && (!productId || lot.productId === productId) && (!lot.expiryDate || lot.expiryDate >= today));
};

export const storeStock = async (tenantId: string, storeId: string) => {
  const [lots, policies] = await Promise.all([sellableLots(tenantId, storeId), listStorePolicies(tenantId, storeId)]);
  const byProduct = new Map<string, { productId: string; quantity: number; inventoryValue: number; reorderPoint: number; targetQuantity: number }>();
  for (const lot of lots) {
    const value = byProduct.get(lot.productId) ?? { productId: lot.productId, quantity: 0, inventoryValue: 0, reorderPoint: 0, targetQuantity: 0 };
    value.quantity += lot.remainingQuantity; value.inventoryValue = roundMoney(value.inventoryValue + lot.remainingQuantity * lot.unitCost); byProduct.set(lot.productId, value);
  }
  for (const policy of policies) {
    const value = byProduct.get(policy.productId) ?? { productId: policy.productId, quantity: 0, inventoryValue: 0, reorderPoint: 0, targetQuantity: 0 };
    value.reorderPoint = policy.reorderPoint; value.targetQuantity = policy.targetQuantity; byProduct.set(policy.productId, value);
  }
  return [...byProduct.values()].map((value) => ({ ...value, storeId, lowStock: value.quantity <= value.reorderPoint }));
};

export const listPurchaseOrders = (tenantId: string, range?: { from?: string; to?: string; limit?: number }) => queryCollection<PurchaseOrderRecord>(tenantId, "PURCHASE_ORDER", { ...range, limit: range?.limit ?? 200, descending: true });
export const getPurchaseOrder = (tenantId: string, id: string) => get<PurchaseOrderRecord>(tenantId, "PO", id);
type PurchaseOrderLineInput = { productId: string; orderedPurchaseQuantity: number; pricePerPurchaseUnit?: number | null };
const resolvePurchaseOrderLines = async (tenantId: string, supplierId: string, inputs: PurchaseOrderLineInput[], existing?: PurchaseOrderRecord) => {
  if (new Set(inputs.map((line) => line.productId)).size !== inputs.length) throw new Error("Each product can appear only once on a purchase order");
  return Promise.all(inputs.map(async (input) => {
    validateCount(input.orderedPurchaseQuantity, "Ordered quantity", false);
    const [product, supplierProduct] = await Promise.all([getCatalogProduct(tenantId, input.productId), getSupplierProduct(tenantId, supplierId, input.productId)]);
    if (!product || product.status !== "active") throw new Error("One or more purchase-order products are unavailable");
    if (!supplierProduct) throw new Error(`${product.name} is not configured for the selected supplier`);
    const pricePerPurchaseUnit = input.pricePerPurchaseUnit ?? supplierProduct.lastPurchasePrice;
    if (!Number.isFinite(pricePerPurchaseUnit) || pricePerPurchaseUnit < 0) throw new Error("Purchase price must be zero or greater");
    return { id: existing?.lines.find((line) => line.productId === input.productId)?.id ?? randomUUID(), productId: product.id, productName: product.name, supplierSku: supplierProduct.supplierSku, purchaseUnit: supplierProduct.purchaseUnit, unitsPerPurchaseUnit: supplierProduct.unitsPerPurchaseUnit, orderedPurchaseQuantity: input.orderedPurchaseQuantity, acceptedBaseQuantity: 0, pricePerPurchaseUnit };
  }));
};
export const createPurchaseOrder = async (tenantId: string, input: { supplierId: string; storeId: string; expectedDeliveryDate?: string | null; notes: string; lines: PurchaseOrderLineInput[] }, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<PurchaseOrderRecord>(tenantId, "create_po", requestId, input); if (previous) return previous;
  if (input.lines.length < 1 || input.lines.length > 40) throw new Error("A purchase order must contain 1 to 40 lines");
  const [supplier, store] = await Promise.all([getSupplier(tenantId, input.supplierId), getStore(tenantId, input.storeId)]);
  if (!supplier || supplier.status !== "active") throw new Error("Select an active supplier"); if (!store || store.status !== "active") throw new Error("Select an active store");
  const now = new Date().toISOString(); const id = randomUUID(); const lines = await resolvePurchaseOrderLines(tenantId, supplier.id, input.lines);
  const po: PurchaseOrderRecord = { id, orderNumber: `PO-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, supplierId: supplier.id, supplierName: supplier.name, storeId: store.id, storeName: store.name, status: "draft", expectedDeliveryDate: input.expectedDeliveryDate ?? null, notes: input.notes.trim(), lines, totalAmount: roundMoney(lines.reduce((sum, line) => sum + line.orderedPurchaseQuantity * line.pricePerPurchaseUnit, 0)), createdBy: actor.id, createdByName: actor.name, receiptCount: 0, createdAt: now, updatedAt: now };
  return commitIdempotent(tenantId, "create_po", requestId, input, po, [
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "PO", id), accessPartition: collection(tenantId, "PURCHASE_ORDER"), accessSort: `${now}#${id}`, entityType: "purchase_order", tenantId, ...po }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ]);
};

export const updatePurchaseOrder = async (tenantId: string, id: string, input: { supplierId: string; storeId: string; expectedDeliveryDate?: string | null; notes: string; lines: PurchaseOrderLineInput[] }) => {
  const current = await getPurchaseOrder(tenantId, id); if (!current) throw new Error("Purchase order not found"); if (current.status !== "draft") throw new Error("Only draft purchase orders can be edited");
  if (input.lines.length < 1 || input.lines.length > 40) throw new Error("A purchase order must contain 1 to 40 lines");
  const [supplier, store] = await Promise.all([getSupplier(tenantId, input.supplierId), getStore(tenantId, input.storeId)]); if (!supplier || supplier.status !== "active") throw new Error("Select an active supplier"); if (!store || store.status !== "active") throw new Error("Select an active store");
  const lines = await resolvePurchaseOrderLines(tenantId, supplier.id, input.lines, current);
  const next: PurchaseOrderRecord = { ...current, supplierId: supplier.id, supplierName: supplier.name, storeId: store.id, storeName: store.name, expectedDeliveryDate: input.expectedDeliveryDate ?? null, notes: input.notes.trim(), lines, totalAmount: roundMoney(lines.reduce((sum, line) => sum + line.orderedPurchaseQuantity * line.pricePerPurchaseUnit, 0)), updatedAt: new Date().toISOString() };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [putPurchaseOrder(tenantId, next, current.updatedAt)] })); return next;
};

const putPurchaseOrder = (tenantId: string, po: PurchaseOrderRecord, expectedUpdatedAt: string) => ({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "PO", po.id), accessPartition: collection(tenantId, "PURCHASE_ORDER"), accessSort: `${po.createdAt}#${po.id}`, entityType: "purchase_order", tenantId, ...po }, ConditionExpression: "attribute_exists(partitionKey) AND updatedAt = :expectedUpdatedAt", ExpressionAttributeValues: { ":expectedUpdatedAt": expectedUpdatedAt } } });
export const setPurchaseOrderStatus = async (tenantId: string, id: string, action: "issue" | "close" | "cancel", reason: string) => {
  const current = await getPurchaseOrder(tenantId, id); if (!current) throw new Error("Purchase order not found"); const now = new Date().toISOString();
  let next: PurchaseOrderRecord;
  if (action === "issue") { if (current.status !== "draft") throw new Error("Only draft purchase orders can be issued"); next = { ...current, status: "issued", issuedAt: now, updatedAt: now }; }
  else if (action === "cancel") { if (!(["draft", "issued"] as string[]).includes(current.status) || current.receiptCount > 0) throw new Error("Only purchase orders with no receipts can be cancelled"); next = { ...current, status: "cancelled", closeReason: reason.trim() || "Cancelled", updatedAt: now }; }
  else { if (!(current.status === "partially_received" || current.status === "issued")) throw new Error("Only open purchase orders can be closed"); if (reason.trim().length < 3) throw new Error("A close reason is required"); next = { ...current, status: "closed", closeReason: reason.trim(), updatedAt: now }; }
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [putPurchaseOrder(tenantId, next, current.updatedAt)] })); return next;
};

export const listGoodsReceipts = (tenantId: string, range?: { from?: string; to?: string; limit?: number }) => queryCollection<GoodsReceiptRecord>(tenantId, "GOODS_RECEIPT", { ...range, limit: range?.limit ?? 200, descending: true });
export const getGoodsReceipt = (tenantId: string, id: string) => get<GoodsReceiptRecord>(tenantId, "RECEIPT", id);
export const receivePurchaseOrder = async (tenantId: string, purchaseOrderId: string, deliveryNote: string, invoiceNumber: string, lines: ReceiptLineInput[], actor: Actor, requestId: string) => {
  const payload = { purchaseOrderId, deliveryNote, invoiceNumber, lines };
  const previous = await existingIdempotentResult<GoodsReceiptRecord>(tenantId, "receive_po", requestId, payload); if (previous) return previous;
  if (lines.length < 1 || lines.length > 40) throw new Error("A receipt must contain 1 to 40 batch lines");
  if (!deliveryNote.trim() && !invoiceNumber.trim()) throw new Error("A delivery note or supplier invoice number is required");
  const po = await getPurchaseOrder(tenantId, purchaseOrderId); if (!po || !(po.status === "issued" || po.status === "partially_received")) throw new Error("Purchase order is not open for receiving");
  const now = new Date().toISOString(); const today = now.slice(0, 10); const id = randomUUID(); const receiptLines: GoodsReceiptRecord["lines"] = []; const acceptedByLine = new Map<string, number>(); const latestPriceByProduct = new Map<string, number>(); const lotWrites: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  for (const input of lines) {
    [input.deliveredBaseQuantity, input.acceptedBaseQuantity, input.damagedBaseQuantity, input.rejectedBaseQuantity].forEach((value) => validateCount(value, "Receipt quantity"));
    if (input.deliveredBaseQuantity !== input.acceptedBaseQuantity + input.damagedBaseQuantity + input.rejectedBaseQuantity) throw new Error("Delivered quantity must equal accepted, damaged, and rejected quantities");
    const poLine = po.lines.find((line) => line.id === input.purchaseOrderLineId); if (!poLine) throw new Error("Purchase order line not found");
    if (!Number.isFinite(input.actualPricePerPurchaseUnit) || input.actualPricePerPurchaseUnit < 0) throw new Error("Actual supplier price must be zero or greater");
    const nextAccepted = (acceptedByLine.get(poLine.id) ?? 0) + input.acceptedBaseQuantity;
    const outstanding = poLine.orderedPurchaseQuantity * poLine.unitsPerPurchaseUnit - poLine.acceptedBaseQuantity;
    if (nextAccepted > outstanding) throw new Error(`${poLine.productName} receipt exceeds the outstanding ordered quantity`);
    const product = await getCatalogProduct(tenantId, poLine.productId);
    if (!product) throw new Error(`${poLine.productName} no longer exists`);
    if (input.acceptedBaseQuantity > 0 && product.tracksExpiry && !input.expiryDate) throw new Error(`${poLine.productName} requires an expiry date`);
    if (input.expiryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate) || Number.isNaN(Date.parse(`${input.expiryDate}T00:00:00Z`)))) throw new Error("Expiry dates must be valid YYYY-MM-DD dates");
    if (input.acceptedBaseQuantity > 0 && input.expiryDate && input.expiryDate < today) throw new Error(`${poLine.productName} cannot be accepted with an expired date`);
    acceptedByLine.set(poLine.id, nextAccepted);
    const previousActualPrice = latestPriceByProduct.get(poLine.productId); if (previousActualPrice !== undefined && previousActualPrice !== input.actualPricePerPurchaseUnit) throw new Error(`${poLine.productName} must use one actual price per receipt`);
    latestPriceByProduct.set(poLine.productId, input.actualPricePerPurchaseUnit);
    const unitCost = roundMoney(input.actualPricePerPurchaseUnit / poLine.unitsPerPurchaseUnit); let lotId: string | null = null;
    if (input.acceptedBaseQuantity > 0) {
      lotId = randomUUID(); const lot: InventoryLotRecord = { id: lotId, storeId: po.storeId, productId: poLine.productId, productName: poLine.productName, supplierId: po.supplierId, receiptId: id, batchNumber: normalized(input.batchNumber ?? "") || `GRN-${id.slice(0, 8).toUpperCase()}`, expiryDate: input.expiryDate ?? null, receivedQuantity: input.acceptedBaseQuantity, remainingQuantity: input.acceptedBaseQuantity, unitCost, origin: "supplier_receipt", status: "active", receivedAt: now, updatedAt: now };
      lotWrites.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "LOT", lotId), accessPartition: collection(tenantId, `STORE#${lot.storeId}#INVENTORY#ACTIVE`), accessSort: `${lot.expiryDate ?? "9999-12-31"}#${now}#${lotId}`, entityType: "inventory_lot", tenantId, ...lot }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, stockMovementPut(tenantId, { type: "receipt", storeId: po.storeId, productId: poLine.productId, productName: poLine.productName, lotId, quantity: input.acceptedBaseQuantity, unitCost, reason: `Receipt for ${po.orderNumber}`, referenceId: id, actorId: actor.id, actorName: actor.name }, now));
    }
    receiptLines.push({ ...input, productId: poLine.productId, productName: poLine.productName, orderedPricePerPurchaseUnit: poLine.pricePerPurchaseUnit, priceVariance: roundMoney(input.actualPricePerPurchaseUnit - poLine.pricePerPurchaseUnit), unitCost, lotId });
  }
  const nextLines = po.lines.map((line) => ({ ...line, acceptedBaseQuantity: line.acceptedBaseQuantity + (acceptedByLine.get(line.id) ?? 0) }));
  const complete = nextLines.every((line) => line.acceptedBaseQuantity >= line.orderedPurchaseQuantity * line.unitsPerPurchaseUnit);
  const nextPo: PurchaseOrderRecord = { ...po, lines: nextLines, receiptCount: po.receiptCount + 1, status: complete ? "completed" : "partially_received", updatedAt: now };
  const receipt: GoodsReceiptRecord = { id, receiptNumber: `GRN-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, purchaseOrderId: po.id, orderNumber: po.orderNumber, supplierId: po.supplierId, supplierName: po.supplierName, storeId: po.storeId, storeName: po.storeName, deliveryNote: deliveryNote.trim(), invoiceNumber: invoiceNumber.trim(), lines: receiptLines, createdBy: actor.id, createdByName: actor.name, createdAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [putPurchaseOrder(tenantId, nextPo, po.updatedAt), { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "RECEIPT", id), accessPartition: collection(tenantId, "GOODS_RECEIPT"), accessSort: `${now}#${id}`, entityType: "goods_receipt", tenantId, ...receipt }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, ...lotWrites];
  for (const [productId, actualPrice] of latestPriceByProduct) transaction.push({ Update: { TableName: TABLE_NAME, Key: key(tenantId, "SUPPLIER_PRODUCT", `${po.supplierId}#${productId}`), UpdateExpression: "SET lastPurchasePrice = :price, updatedAt = :now", ConditionExpression: "attribute_exists(partitionKey)", ExpressionAttributeValues: { ":price": actualPrice, ":now": now } } });
  if (transaction.length + 1 > 100) throw new Error("Receipt is too fragmented to commit atomically; split it into smaller receipts");
  return commitIdempotent(tenantId, "receive_po", requestId, payload, receipt, transaction);
};

export const allocateLots = async (tenantId: string, storeId: string, requirements: Array<{ productId: string; quantity: number }>) => {
  const lots = await sellableLots(tenantId, storeId);
  const allocations = new Map<string, Array<{ lot: InventoryLotRecord; quantity: number }>>();
  for (const requirement of requirements) {
    validateCount(requirement.quantity, "Quantity", false); let remaining = requirement.quantity;
    const candidates = lots.filter((lot) => lot.productId === requirement.productId).sort((a, b) => (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31") || a.receivedAt.localeCompare(b.receivedAt));
    const selected: Array<{ lot: InventoryLotRecord; quantity: number }> = [];
    for (const lot of candidates) { if (remaining === 0) break; const quantity = Math.min(remaining, lot.remainingQuantity); if (quantity > 0) selected.push({ lot, quantity }); remaining -= quantity; }
    if (remaining > 0) throw new Error("Insufficient sellable stock in the selected store"); allocations.set(requirement.productId, selected);
  }
  return allocations;
};

export const lotDecrement = (tenantId: string, lot: InventoryLotRecord, quantity: number, now: string) => ({ Update: { TableName: TABLE_NAME, Key: key(tenantId, "LOT", lot.id), UpdateExpression: quantity === lot.remainingQuantity ? "SET remainingQuantity = :zero, #status = :exhausted, updatedAt = :now, accessPartition = :archive, accessSort = :sort" : "SET remainingQuantity = remainingQuantity - :quantity, updatedAt = :now", ConditionExpression: "remainingQuantity >= :quantity AND #status = :active", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":quantity": quantity, ":zero": 0, ":active": "active", ":exhausted": "exhausted", ":now": now, ...(quantity === lot.remainingQuantity ? { ":archive": collection(tenantId, `STORE#${lot.storeId}#INVENTORY#LOT`), ":sort": `${now}#${lot.id}` } : {}) } } });

export const listMovements = (tenantId: string, range?: { from?: string; to?: string }) => queryCollection<StockMovementRecord>(tenantId, "STOCK#MOVEMENT", range);
export const writeOffLot = async (tenantId: string, lotId: string, quantity: number, type: "damage" | "expiry", reason: string, actor: Actor, requestId: string) => {
  const payload = { lotId, quantity, type, reason }; const previous = await existingIdempotentResult<StockMovementRecord>(tenantId, "writeoff", requestId, payload); if (previous) return previous;
  validateCount(quantity, "Write-off quantity", false); if (reason.trim().length < 3) throw new Error("A write-off reason is required");
  const lot = await getLot(tenantId, lotId); if (!lot || lot.status !== "active" || lot.remainingQuantity < quantity) throw new Error("Lot does not have enough stock");
  const now = new Date().toISOString(); const movement: StockMovementRecord = { id: randomUUID(), type, storeId: lot.storeId, productId: lot.productId, productName: lot.productName, lotId, quantity: -quantity, unitCost: lot.unitCost, reason: reason.trim(), referenceId: null, actorId: actor.id, actorName: actor.name, createdAt: now };
  return commitIdempotent(tenantId, "writeoff", requestId, payload, movement, [lotDecrement(tenantId, lot, quantity, now), { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "MOVEMENT", movement.id, "EVENT"), accessPartition: collection(tenantId, "STOCK#MOVEMENT"), accessSort: `${now}#${movement.id}`, entityType: "stock_movement", tenantId, ...movement } } }]);
};

export const countLot = async (tenantId: string, lotId: string, physicalQuantity: number, reason: string, actor: Actor, requestId: string) => {
  const payload = { lotId, physicalQuantity, reason }; const previous = await existingIdempotentResult<StockMovementRecord>(tenantId, "count", requestId, payload); if (previous) return previous;
  validateCount(physicalQuantity, "Physical quantity"); if (reason.trim().length < 3) throw new Error("A count reason is required");
  const lot = await getLot(tenantId, lotId); if (!lot) throw new Error("Lot not found"); const delta = physicalQuantity - lot.remainingQuantity; if (delta === 0) throw new Error("Physical quantity matches system quantity");
  const now = new Date().toISOString(); const status = physicalQuantity === 0 ? "exhausted" : "active"; const movement: StockMovementRecord = { id: randomUUID(), type: "count_correction", storeId: lot.storeId, productId: lot.productId, productName: lot.productName, lotId, quantity: delta, unitCost: lot.unitCost, reason: reason.trim(), referenceId: null, actorId: actor.id, actorName: actor.name, createdAt: now };
  return commitIdempotent(tenantId, "count", requestId, payload, movement, [{ Update: { TableName: TABLE_NAME, Key: key(tenantId, "LOT", lot.id), UpdateExpression: "SET remainingQuantity = :quantity, #status = :status, updatedAt = :now, accessPartition = :partition, accessSort = :sort", ConditionExpression: "remainingQuantity = :before", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":quantity": physicalQuantity, ":before": lot.remainingQuantity, ":status": status, ":now": now, ":partition": collection(tenantId, `STORE#${lot.storeId}#INVENTORY#${physicalQuantity ? "ACTIVE" : "LOT"}`), ":sort": physicalQuantity ? `${lot.expiryDate ?? "9999-12-31"}#${lot.receivedAt}#${lot.id}` : `${now}#${lot.id}` } } }, { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "MOVEMENT", movement.id, "EVENT"), accessPartition: collection(tenantId, "STOCK#MOVEMENT"), accessSort: `${now}#${movement.id}`, entityType: "stock_movement", tenantId, ...movement } } }]);
};

export const listTransfers = (tenantId: string, range?: { from?: string; to?: string; limit?: number }) => queryCollection<StockTransferRecord>(tenantId, "TRANSFER", { ...range, limit: range?.limit ?? 200, descending: true });
export const getTransfer = (tenantId: string, id: string) => get<StockTransferRecord>(tenantId, "TRANSFER", id);
export const listRequisitions = (tenantId: string, limit = 200) => queryCollection<StockRequisitionRecord>(tenantId, "REQUISITION", { limit, descending: true });
export const getRequisition = (tenantId: string, id: string) => get<StockRequisitionRecord>(tenantId, "REQUISITION", id);
const putRequisition = (tenantId: string, requisition: StockRequisitionRecord, expectedUpdatedAt?: string) => ({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "REQUISITION", requisition.id), accessPartition: collection(tenantId, "REQUISITION"), accessSort: `${requisition.createdAt}#${requisition.id}`, entityType: "stock_requisition", tenantId, ...requisition }, ...(expectedUpdatedAt ? { ConditionExpression: "updatedAt = :expected", ExpressionAttributeValues: { ":expected": expectedUpdatedAt } } : { ConditionExpression: "attribute_not_exists(partitionKey)" }) } });
export const createRequisition = async (tenantId: string, input: { fromStoreId: string; toStoreId: string; notes: string; lines: Array<{ productId: string; quantity: number }> }, actor: Actor, requestId: string) => { const previous = await existingIdempotentResult<StockRequisitionRecord>(tenantId, "create_requisition", requestId, input); if (previous) return previous; if (input.fromStoreId === input.toStoreId) throw new Error("Requisition stores must be different"); if (input.lines.length < 1 || input.lines.length > 40 || new Set(input.lines.map((line) => line.productId)).size !== input.lines.length) throw new Error("A requisition must contain 1 to 40 unique products"); input.lines.forEach((line) => validateCount(line.quantity, "Requested quantity", false)); const [from, to, products] = await Promise.all([getStore(tenantId, input.fromStoreId), getStore(tenantId, input.toStoreId), Promise.all(input.lines.map((line) => getCatalogProduct(tenantId, line.productId)))]); if (!from || !to || from.status !== "active" || to.status !== "active") throw new Error("Select two active stores"); if (products.some((product) => !product || product.status !== "active")) throw new Error("One or more requested products are unavailable"); const now = new Date().toISOString(); const id = randomUUID(); const requisition: StockRequisitionRecord = { id, requisitionNumber: `REQ-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, fromStoreId: from.id, fromStoreName: from.name, toStoreId: to.id, toStoreName: to.name, status: "requested", notes: input.notes.trim(), lines: input.lines.map((line, index) => ({ ...line, productName: products[index]!.name })), requestedBy: actor.id, requestedByName: actor.name, createdAt: now, updatedAt: now }; return commitIdempotent(tenantId, "create_requisition", requestId, input, requisition, [putRequisition(tenantId, requisition)]); };
export const decideRequisition = async (tenantId: string, id: string, decision: "approve" | "reject" | "cancel", reason: string, actor: Actor) => { const current = await getRequisition(tenantId, id); if (!current || current.status !== "requested") throw new Error("Only requested requisitions can be decided"); if ((decision === "reject" || decision === "cancel") && reason.trim().length < 3) throw new Error("A decision reason is required"); const next: StockRequisitionRecord = { ...current, status: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "cancelled", decisionReason: reason.trim() || null, decidedBy: actor.id, decidedByName: actor.name, updatedAt: new Date().toISOString() }; await dynamoDB.send(new TransactWriteCommand({ TransactItems: [putRequisition(tenantId, next, current.updatedAt)] })); return next; };
export const convertRequisitionToTransfer = async (tenantId: string, id: string, actor: Actor, requestId: string) => { const payload = { id }; const previous = await existingIdempotentResult<StockTransferRecord>(tenantId, "convert_requisition", requestId, payload); if (previous) return previous; const requisition = await getRequisition(tenantId, id); if (!requisition || requisition.status !== "approved") throw new Error("Only approved requisitions can become transfers"); const now = new Date().toISOString(); const transferId = randomUUID(); const transfer: StockTransferRecord = { id: transferId, transferNumber: `TR-${now.slice(0, 10).replaceAll("-", "")}-${transferId.slice(0, 8).toUpperCase()}`, fromStoreId: requisition.fromStoreId, fromStoreName: requisition.fromStoreName, toStoreId: requisition.toStoreId, toStoreName: requisition.toStoreName, status: "draft", notes: [requisition.notes, `From ${requisition.requisitionNumber}`].filter(Boolean).join("\n"), lines: requisition.lines, createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now }; const converted: StockRequisitionRecord = { ...requisition, status: "converted", transferId, updatedAt: now }; return commitIdempotent(tenantId, "convert_requisition", requestId, payload, transfer, [{ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "TRANSFER", transferId), accessPartition: collection(tenantId, "TRANSFER"), accessSort: `${now}#${transferId}`, entityType: "stock_transfer", tenantId, ...transfer }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, putRequisition(tenantId, converted, requisition.updatedAt)]); };
export const createTransfer = async (tenantId: string, input: { fromStoreId: string; toStoreId: string; notes: string; lines: Array<{ productId: string; quantity: number }> }, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<StockTransferRecord>(tenantId, "create_transfer", requestId, input); if (previous) return previous;
  if (input.fromStoreId === input.toStoreId) throw new Error("Transfer stores must be different"); if (input.lines.length < 1 || input.lines.length > 40) throw new Error("A transfer must contain 1 to 40 lines"); input.lines.forEach((line) => validateCount(line.quantity, "Transfer quantity", false));
  if (new Set(input.lines.map((line) => line.productId)).size !== input.lines.length) throw new Error("Each product can appear only once on a transfer");
  const [from, to] = await Promise.all([getStore(tenantId, input.fromStoreId), getStore(tenantId, input.toStoreId)]); if (!from || !to || from.status !== "active" || to.status !== "active") throw new Error("Select two active stores");
  const products = await Promise.all(input.lines.map((line) => getCatalogProduct(tenantId, line.productId))); if (products.some((product) => !product || product.status !== "active")) throw new Error("One or more transfer products are unavailable");
  const lines = input.lines.map((line, index) => ({ ...line, productName: products[index]!.name }));
  const now = new Date().toISOString(); const id = randomUUID(); const transfer: StockTransferRecord = { id, transferNumber: `TR-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, fromStoreId: from.id, fromStoreName: from.name, toStoreId: to.id, toStoreName: to.name, status: "draft", notes: input.notes.trim(), lines, createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now };
  return commitIdempotent(tenantId, "create_transfer", requestId, input, transfer, [{ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "TRANSFER", id), accessPartition: collection(tenantId, "TRANSFER"), accessSort: `${now}#${id}`, entityType: "stock_transfer", tenantId, ...transfer }, ConditionExpression: "attribute_not_exists(partitionKey)" } }]);
};

const putTransfer = (tenantId: string, transfer: StockTransferRecord, expectedUpdatedAt: string) => ({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "TRANSFER", transfer.id), accessPartition: collection(tenantId, "TRANSFER"), accessSort: `${transfer.createdAt}#${transfer.id}`, entityType: "stock_transfer", tenantId, ...transfer }, ConditionExpression: "attribute_exists(partitionKey) AND updatedAt = :expectedUpdatedAt", ExpressionAttributeValues: { ":expectedUpdatedAt": expectedUpdatedAt } } });
export const dispatchTransfer = async (tenantId: string, id: string, actor: Actor, requestId: string) => {
  const payload = { id }; const previous = await existingIdempotentResult<StockTransferRecord>(tenantId, "dispatch_transfer", requestId, payload); if (previous) return previous;
  const transfer = await getTransfer(tenantId, id); if (!transfer || transfer.status !== "draft") throw new Error("Only draft transfers can be dispatched"); const now = new Date().toISOString();
  const allocations = await allocateLots(tenantId, transfer.fromStoreId, transfer.lines.map(({ productId, quantity }) => ({ productId, quantity })));
  const nextLines = transfer.lines.map((line) => ({ ...line, allocations: allocations.get(line.productId)!.map(({ lot, quantity }) => ({ lotId: lot.id, quantity, unitCost: lot.unitCost, batchNumber: lot.batchNumber, expiryDate: lot.expiryDate, supplierId: lot.supplierId })) }));
  const next = { ...transfer, lines: nextLines, status: "dispatched" as const, dispatchedAt: now, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [putTransfer(tenantId, next, transfer.updatedAt)];
  for (const line of nextLines) for (const allocation of line.allocations ?? []) { const lot = (allocations.get(line.productId) ?? []).find((item) => item.lot.id === allocation.lotId)!.lot; transaction.push(lotDecrement(tenantId, lot, allocation.quantity, now), stockMovementPut(tenantId, { type: "transfer_dispatch", storeId: transfer.fromStoreId, productId: line.productId, productName: line.productName, lotId: lot.id, quantity: -allocation.quantity, unitCost: lot.unitCost, reason: `Dispatched ${transfer.transferNumber}`, referenceId: transfer.id, actorId: actor.id, actorName: actor.name }, now)); }
  if (transaction.length + 1 > 100) throw new Error("Transfer is too fragmented to dispatch atomically"); return commitIdempotent(tenantId, "dispatch_transfer", requestId, payload, next, transaction);
};

export const receiveTransfer = async (tenantId: string, id: string, receiptInput: Array<{ lotId: string; receivedQuantity: number; damagedQuantity: number; missingQuantity: number; reason: string }>, actor: Actor, requestId: string) => {
  const payload = { id, receiptInput }; const previous = await existingIdempotentResult<StockTransferRecord>(tenantId, "receive_transfer", requestId, payload); if (previous) return previous;
  const transfer = await getTransfer(tenantId, id); if (!transfer || transfer.status !== "dispatched") throw new Error("Only dispatched transfers can be received"); const now = new Date().toISOString();
  const allocations = transfer.lines.flatMap((line) => (line.allocations ?? []).map((allocation) => ({ ...allocation, productId: line.productId, productName: line.productName })));
  if (receiptInput.length !== allocations.length || new Set(receiptInput.map((line) => line.lotId)).size !== receiptInput.length) throw new Error("Provide one receipt result for every dispatched lot");
  const receiptLines: TransferReceiptLineRecord[] = [];
  for (const allocation of allocations) {
    const received = receiptInput.find((line) => line.lotId === allocation.lotId); if (!received) throw new Error("A dispatched lot is missing from the transfer receipt");
    [received.receivedQuantity, received.damagedQuantity, received.missingQuantity].forEach((value) => validateCount(value, "Transfer receipt quantity"));
    if (received.receivedQuantity + received.damagedQuantity + received.missingQuantity !== allocation.quantity) throw new Error("Received, damaged, and missing quantities must equal the dispatched quantity");
    if ((received.damagedQuantity > 0 || received.missingQuantity > 0) && received.reason.trim().length < 3) throw new Error("A discrepancy reason is required");
    receiptLines.push({ lotId: allocation.lotId, productId: allocation.productId, productName: allocation.productName, dispatchedQuantity: allocation.quantity, receivedQuantity: received.receivedQuantity, damagedQuantity: received.damagedQuantity, missingQuantity: received.missingQuantity, reason: received.reason.trim(), destinationLotId: null });
  }
  const next = { ...transfer, status: "completed" as const, receiptLines, receivedAt: now, receivedBy: actor.id, receivedByName: actor.name, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [putTransfer(tenantId, next, transfer.updatedAt)];
  for (const allocation of allocations) { const receiptLine = receiptLines.find((line) => line.lotId === allocation.lotId)!; if (receiptLine.receivedQuantity > 0) { const lotId = randomUUID(); receiptLine.destinationLotId = lotId; const lot: InventoryLotRecord = { id: lotId, storeId: transfer.toStoreId, productId: allocation.productId, productName: allocation.productName, supplierId: allocation.supplierId, receiptId: null, batchNumber: allocation.batchNumber, expiryDate: allocation.expiryDate, receivedQuantity: receiptLine.receivedQuantity, remainingQuantity: receiptLine.receivedQuantity, unitCost: allocation.unitCost, origin: "transfer", status: "active", receivedAt: now, updatedAt: now }; transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "LOT", lotId), accessPartition: collection(tenantId, `STORE#${lot.storeId}#INVENTORY#ACTIVE`), accessSort: `${lot.expiryDate ?? "9999-12-31"}#${now}#${lotId}`, entityType: "inventory_lot", tenantId, ...lot }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, stockMovementPut(tenantId, { type: "transfer_receive", storeId: transfer.toStoreId, productId: allocation.productId, productName: allocation.productName, lotId, quantity: receiptLine.receivedQuantity, unitCost: allocation.unitCost, reason: `Received ${transfer.transferNumber}`, referenceId: transfer.id, actorId: actor.id, actorName: actor.name }, now)); } if (receiptLine.damagedQuantity > 0) transaction.push(stockMovementPut(tenantId, { type: "transfer_damage", storeId: transfer.toStoreId, productId: allocation.productId, productName: allocation.productName, lotId: allocation.lotId, quantity: -receiptLine.damagedQuantity, unitCost: allocation.unitCost, reason: receiptLine.reason, referenceId: transfer.id, actorId: actor.id, actorName: actor.name }, now)); if (receiptLine.missingQuantity > 0) transaction.push(stockMovementPut(tenantId, { type: "transfer_shortage", storeId: transfer.toStoreId, productId: allocation.productId, productName: allocation.productName, lotId: allocation.lotId, quantity: -receiptLine.missingQuantity, unitCost: allocation.unitCost, reason: receiptLine.reason, referenceId: transfer.id, actorId: actor.id, actorName: actor.name }, now)); }
  if (transaction.length + 1 > 100) throw new Error("Transfer is too fragmented to receive atomically"); return commitIdempotent(tenantId, "receive_transfer", requestId, payload, next, transaction);
};

export const cancelTransfer = async (tenantId: string, id: string, reason: string) => { const transfer = await getTransfer(tenantId, id); if (!transfer || transfer.status !== "draft") throw new Error("Only draft transfers can be cancelled"); const next = { ...transfer, status: "cancelled" as const, notes: [transfer.notes, `Cancelled: ${reason.trim() || "Cancelled"}`].filter(Boolean).join("\n"), updatedAt: new Date().toISOString() }; await dynamoDB.send(new TransactWriteCommand({ TransactItems: [putTransfer(tenantId, next, transfer.updatedAt)] })); return next; };

export const listStocktakes = (tenantId: string, storeId?: string) => queryCollection<StocktakeSessionRecord>(tenantId, "STOCKTAKE", { limit: 100, descending: true }).then((items) => storeId ? items.filter((item) => item.storeId === storeId) : items);
export const getStocktake = (tenantId: string, id: string) => get<StocktakeSessionRecord>(tenantId, "STOCKTAKE", id);
export const createStocktake = async (tenantId: string, storeId: string, name: string, actor: Actor, requestId: string, productId?: string) => {
  const payload = { storeId, name, productId: productId ?? null }; const previous = await existingIdempotentResult<StocktakeSessionRecord>(tenantId, "create_stocktake", requestId, payload); if (previous) return previous;
  const [store, storeLots, open] = await Promise.all([getStore(tenantId, storeId), listLots(tenantId, storeId), listStocktakes(tenantId, storeId)]); const lots = productId ? storeLots.filter((lot) => lot.productId === productId) : storeLots;
  if (!store || store.status !== "active") throw new Error("Select an active store"); if (name.trim().length < 3) throw new Error("A stocktake name is required"); if (open.some((item) => item.status === "in_progress")) throw new Error("Complete or cancel the current stocktake first"); if (!lots.length) throw new Error(productId ? "This product has no active lots in the store" : "This store has no inventory lots to count"); if (lots.length > 40) throw new Error("This stocktake exceeds 40 lots; select one product and run separate sessions");
  const now = new Date().toISOString(); const id = randomUUID(); const session: StocktakeSessionRecord = { id, stocktakeNumber: `ST-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, storeId, storeName: store.name, name: normalized(name), status: "in_progress", lines: lots.map((lot) => ({ lotId: lot.id, productId: lot.productId, productName: lot.productName, batchNumber: lot.batchNumber, expectedQuantity: lot.remainingQuantity, countedQuantity: null, variance: null, unitCost: lot.unitCost })), createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now };
  return commitIdempotent(tenantId, "create_stocktake", requestId, payload, session, [{ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "STOCKTAKE", id), accessPartition: collection(tenantId, "STOCKTAKE"), accessSort: `${now}#${id}`, entityType: "stocktake", tenantId, ...session }, ConditionExpression: "attribute_not_exists(partitionKey)" } }]);
};
export const completeStocktake = async (tenantId: string, id: string, counts: Array<{ lotId: string; quantity: number }>, reason: string, actor: Actor, requestId: string) => {
  const payload = { id, counts, reason }; const previous = await existingIdempotentResult<StocktakeSessionRecord>(tenantId, "complete_stocktake", requestId, payload); if (previous) return previous;
  const session = await getStocktake(tenantId, id); if (!session || session.status !== "in_progress") throw new Error("Stocktake is not open"); if (reason.trim().length < 3) throw new Error("A stocktake completion reason is required"); if (counts.length !== session.lines.length || new Set(counts.map((item) => item.lotId)).size !== counts.length) throw new Error("Count every stocktake lot exactly once");
  counts.forEach((item) => validateCount(item.quantity, "Counted quantity")); const now = new Date().toISOString(); const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  const lines = session.lines.map((line) => { const count = counts.find((item) => item.lotId === line.lotId); if (!count) throw new Error("A stocktake lot was not counted"); return { ...line, countedQuantity: count.quantity, variance: count.quantity - line.expectedQuantity }; });
  for (const line of lines.filter((item) => item.variance !== 0)) { const lot = await getLot(tenantId, line.lotId); if (!lot || lot.remainingQuantity !== line.expectedQuantity) throw new Error(`${line.productName} changed after this stocktake started`); const status = line.countedQuantity === 0 ? "exhausted" : "active"; transaction.push({ Update: { TableName: TABLE_NAME, Key: key(tenantId, "LOT", lot.id), UpdateExpression: "SET remainingQuantity = :quantity, #status = :status, updatedAt = :now, accessPartition = :partition, accessSort = :sort", ConditionExpression: "remainingQuantity = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":quantity": line.countedQuantity, ":expected": line.expectedQuantity, ":status": status, ":now": now, ":partition": collection(tenantId, `STORE#${lot.storeId}#INVENTORY#${line.countedQuantity ? "ACTIVE" : "LOT"}`), ":sort": line.countedQuantity ? `${lot.expiryDate ?? "9999-12-31"}#${lot.receivedAt}#${lot.id}` : `${now}#${lot.id}` } } }, stockMovementPut(tenantId, { type: "count_correction", storeId: session.storeId, productId: line.productId, productName: line.productName, lotId: line.lotId, quantity: line.variance!, unitCost: line.unitCost, reason: `${session.stocktakeNumber}: ${reason.trim()}`, referenceId: session.id, actorId: actor.id, actorName: actor.name }, now)); }
  const completed: StocktakeSessionRecord = { ...session, lines, status: "completed", completedBy: actor.id, completedByName: actor.name, reason: reason.trim(), completedAt: now, updatedAt: now };
  transaction.unshift({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "STOCKTAKE", id), accessPartition: collection(tenantId, "STOCKTAKE"), accessSort: `${session.createdAt}#${id}`, entityType: "stocktake", tenantId, ...completed }, ConditionExpression: "#status = :open AND updatedAt = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":open": "in_progress", ":expected": session.updatedAt } } });
  return commitIdempotent(tenantId, "complete_stocktake", requestId, payload, completed, transaction);
};
export const cancelStocktake = async (tenantId: string, id: string, reason: string, actor: Actor) => { const session = await getStocktake(tenantId, id); if (!session || session.status !== "in_progress") throw new Error("Only an open stocktake can be cancelled"); const now = new Date().toISOString(); const next: StocktakeSessionRecord = { ...session, status: "cancelled", reason: reason.trim() || "Cancelled", completedBy: actor.id, completedByName: actor.name, completedAt: now, updatedAt: now }; await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...key(tenantId, "STOCKTAKE", id), accessPartition: collection(tenantId, "STOCKTAKE"), accessSort: `${session.createdAt}#${id}`, entityType: "stocktake", tenantId, ...next }, ConditionExpression: "#status = :open", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":open": "in_progress" } })); return next; };

export const replenishmentSuggestions = async (tenantId: string, storeId: string, supplierId: string) => {
  const [stock, policies, supplierProducts, orders, transfers] = await Promise.all([storeStock(tenantId, storeId), listStorePolicies(tenantId, storeId), listSupplierProducts(tenantId, supplierId), listPurchaseOrders(tenantId), listTransfers(tenantId)]);
  const byStock = new Map(stock.map((item) => [item.productId, item]));
  return policies.flatMap((policy) => {
    const supplierProduct = supplierProducts.find((item) => item.productId === policy.productId && item.preferred) ?? supplierProducts.find((item) => item.productId === policy.productId); if (!supplierProduct) return [];
    const onOrder = orders.filter((order) => order.storeId === storeId && (order.status === "issued" || order.status === "partially_received")).flatMap((order) => order.lines).filter((line) => line.productId === policy.productId).reduce((sum, line) => sum + Math.max(0, line.orderedPurchaseQuantity * line.unitsPerPurchaseUnit - line.acceptedBaseQuantity), 0);
    const inbound = transfers.filter((transfer) => transfer.toStoreId === storeId && transfer.status === "dispatched").flatMap((transfer) => transfer.lines).filter((line) => line.productId === policy.productId).reduce((sum, line) => sum + line.quantity, 0);
    const quantity = byStock.get(policy.productId)?.quantity ?? 0; const projectedQuantity = quantity + onOrder + inbound; if (projectedQuantity > policy.reorderPoint) return [];
    return [{ storeId, supplierId, productId: policy.productId, availableQuantity: quantity, projectedQuantity, reorderPoint: policy.reorderPoint, targetQuantity: policy.targetQuantity, openPurchaseOrderQuantity: onOrder, inboundTransferQuantity: inbound, suggestedPurchaseQuantity: Math.max(0, Math.ceil((policy.targetQuantity - projectedQuantity) / supplierProduct.unitsPerPurchaseUnit)), supplierProduct }];
  });
};

export const supplyChainReport = async (tenantId: string, input: { from: string; to: string; storeId?: string; supplierId?: string; productId?: string; status?: string; expiryDays?: number }) => {
  const fromTime = Date.parse(input.from); const toTime = Date.parse(input.to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) throw new Error("Enter a valid report date range");
  if (toTime - fromTime > 366 * 24 * 60 * 60 * 1000) throw new Error("Report periods cannot exceed 366 days");
  const stores = input.storeId ? [{ id: input.storeId }] : await listStores(tenantId);
  const [orders, receipts, movements, lots, transfers, currentOrders, currentTransfers, stockByStore, allPolicies, supplierProducts] = await Promise.all([listPurchaseOrders(tenantId, { from: input.from, to: input.to, limit: 1001 }), listGoodsReceipts(tenantId, { from: input.from, to: input.to, limit: 1001 }), listMovements(tenantId, { from: input.from, to: input.to }), listLots(tenantId), listTransfers(tenantId, { from: input.from, to: input.to, limit: 1001 }), listPurchaseOrders(tenantId, { limit: 1000 }), listTransfers(tenantId, { limit: 1000 }), Promise.all(stores.map((store) => storeStock(tenantId, store.id))), listStorePolicies(tenantId), listSupplierProducts(tenantId)]);
  if (orders.length > 1000 || receipts.length > 1000 || transfers.length > 1000) throw new Error("This report exceeds 1,000 documents; narrow the date or store filters");
  const stock = stockByStore.flat();
  const inRange = <T extends { createdAt: string }>(items: T[]) => items.filter((item) => item.createdAt >= input.from && item.createdAt <= input.to);
  const filteredOrders = inRange(orders).filter((item) => (!input.storeId || item.storeId === input.storeId) && (!input.supplierId || item.supplierId === input.supplierId) && (!input.status || item.status === input.status) && (!input.productId || item.lines.some((line) => line.productId === input.productId)));
  const filteredReceipts = inRange(receipts).filter((item) => (!input.storeId || item.storeId === input.storeId) && (!input.supplierId || item.supplierId === input.supplierId) && (!input.productId || item.lines.some((line) => line.productId === input.productId)));
  const filteredMovements = movements.filter((item) => (!input.storeId || item.storeId === input.storeId) && (!input.productId || item.productId === input.productId)); const filteredTransfers = inRange(transfers).filter((item) => (!input.storeId || item.fromStoreId === input.storeId || item.toStoreId === input.storeId) && (!input.status || item.status === input.status) && (!input.productId || item.lines.some((line) => line.productId === input.productId)));
  const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() + Math.min(Math.max(input.expiryDays ?? 30, 0), 365)); const cutoffDate = cutoff.toISOString().slice(0, 10);
  const expiryLots = lots.filter((lot) => (!input.storeId || lot.storeId === input.storeId) && (!input.productId || lot.productId === input.productId) && lot.expiryDate && lot.expiryDate <= cutoffDate && lot.remainingQuantity > 0);
  const activeLots = lots.filter((lot) => (!input.storeId || lot.storeId === input.storeId) && (!input.productId || lot.productId === input.productId) && lot.remainingQuantity > 0);
  const replenishment = allPolicies.filter((policy) => !input.storeId || policy.storeId === input.storeId).flatMap((policy) => { if (input.productId && policy.productId !== input.productId) return []; const position = stock.find((item) => item.storeId === policy.storeId && item.productId === policy.productId); const relation = supplierProducts.find((item) => item.productId === policy.productId && item.preferred) ?? supplierProducts.find((item) => item.productId === policy.productId); if (!relation || (input.supplierId && relation.supplierId !== input.supplierId)) return []; const openOrder = currentOrders.filter((order) => order.storeId === policy.storeId && (order.status === "issued" || order.status === "partially_received")).flatMap((order) => order.lines).filter((line) => line.productId === policy.productId).reduce((sum, line) => sum + Math.max(0, line.orderedPurchaseQuantity * line.unitsPerPurchaseUnit - line.acceptedBaseQuantity), 0); const inbound = currentTransfers.filter((transfer) => transfer.toStoreId === policy.storeId && transfer.status === "dispatched").flatMap((transfer) => transfer.lines).filter((line) => line.productId === policy.productId).reduce((sum, line) => sum + line.quantity, 0); const projectedQuantity = (position?.quantity ?? 0) + openOrder + inbound; if (projectedQuantity > policy.reorderPoint) return []; return [{ storeId: policy.storeId, supplierId: relation.supplierId, productId: policy.productId, availableQuantity: position?.quantity ?? 0, projectedQuantity, reorderPoint: policy.reorderPoint, targetQuantity: policy.targetQuantity, openPurchaseOrderQuantity: openOrder, inboundTransferQuantity: inbound, suggestedPurchaseQuantity: Math.max(0, Math.ceil((policy.targetQuantity - projectedQuantity) / relation.unitsPerPurchaseUnit)), supplierProduct: relation }]; });
  const receiptLines = filteredReceipts.flatMap((item) => item.lines);
  return { from: input.from, to: input.to, purchaseOrders: filteredOrders, receipts: filteredReceipts, movements: filteredMovements, transfers: filteredTransfers, stock: input.productId ? stock.filter((item) => item.productId === input.productId) : stock, expiryLots, replenishment, orderedValue: roundMoney(filteredOrders.filter((item) => item.status !== "draft" && item.status !== "cancelled").reduce((sum, item) => sum + item.totalAmount, 0)), purchaseSpend: roundMoney(receiptLines.reduce((sum, line) => sum + line.acceptedBaseQuantity * line.unitCost, 0)), receivedValue: roundMoney(receiptLines.reduce((sum, line) => sum + line.acceptedBaseQuantity * line.unitCost, 0)), priceVariance: roundMoney(receiptLines.reduce((sum, line) => sum + line.priceVariance * (line.acceptedBaseQuantity / (filteredOrders.flatMap((order) => order.lines).find((orderLine) => orderLine.id === line.purchaseOrderLineId)?.unitsPerPurchaseUnit ?? 1)), 0)), damagedValue: roundMoney(filteredMovements.filter((item) => item.type === "damage" || item.type === "expiry" || item.type === "transfer_damage" || item.type === "transfer_shortage").reduce((sum, item) => sum + Math.abs(item.quantity) * item.unitCost, 0)), inventoryValue: roundMoney(activeLots.reduce((sum, lot) => sum + lot.remainingQuantity * lot.unitCost, 0)), inTransitValue: roundMoney(currentTransfers.filter((item) => item.status === "dispatched" && (!input.storeId || item.fromStoreId === input.storeId || item.toStoreId === input.storeId)).flatMap((item) => item.lines).flatMap((line) => line.allocations ?? []).reduce((sum, allocation) => sum + allocation.quantity * allocation.unitCost, 0)) };
};
