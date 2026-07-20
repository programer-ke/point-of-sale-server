import { randomUUID } from "node:crypto";
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
  lines: Array<ReceiptLineInput & { productId: string; productName: string; unitCost: number; lotId?: string | null }>;
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
  origin: "supplier_receipt" | "legacy_opening" | "transfer";
  status: "active" | "exhausted";
  receivedAt: string;
  updatedAt: string;
}

export type StockMovementType = "receipt" | "sale" | "transfer_dispatch" | "transfer_receive" | "damage" | "expiry" | "count_correction" | "legacy_opening";
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
  createdAt: string;
  updatedAt: string;
}

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

const queryCollection = async <T>(tenantId: string, name: string, range?: { from?: string; to?: string }) => {
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
    }));
    items.push(...(result.Items ?? []).map((item) => stripKeys<T>(item)!));
    cursor = result.LastEvaluatedKey;
  } while (cursor);
  return items;
};

const get = async <T>(tenantId: string, kind: string, id: string, sortKey = "PROFILE") => {
  const result = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: key(tenantId, kind, id, sortKey) }));
  return stripKeys<T>(result.Item);
};

export const stockMovementPut = (tenantId: string, movement: Omit<StockMovementRecord, "id" | "createdAt">, now: string) => {
  const id = randomUUID();
  return { Put: { TableName: TABLE_NAME, Item: {
    ...key(tenantId, "MOVEMENT", id, "EVENT"), accessPartition: collection(tenantId, "STOCK#MOVEMENT"),
    accessSort: `${now}#${id}`, entityType: "stock_movement", tenantId, id, ...movement, createdAt: now,
  } } };
};

const idempotencyKey = (tenantId: string, operation: string, requestId: string) => key(tenantId, `IDEMPOTENCY#${operation}`, requestId, "RESULT");
const existingIdempotentResult = async <T>(tenantId: string, operation: string, requestId: string) => {
  const result = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: idempotencyKey(tenantId, operation, requestId) }));
  return result.Item?.result as T | undefined;
};

const validateCount = (value: number, label: string, allowZero = true) => {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} must be ${allowZero ? "zero or a positive" : "a positive"} whole number`);
};

export const listStores = (tenantId: string) => queryCollection<StoreRecord>(tenantId, "STORE");
export const getStore = (tenantId: string, id: string) => get<StoreRecord>(tenantId, "STORE", id);
export const createStore = async (tenantId: string, input: Pick<StoreRecord, "code" | "name" | "address">, actor: Actor) => {
  const id = randomUUID(); const now = new Date().toISOString();
  const store: StoreRecord = { id, code: normalizedCode(input.code), name: normalized(input.name), address: normalized(input.address), status: "active", createdAt: now, updatedAt: now };
  if (!store.code || !store.name) throw new Error("Store code and name are required");
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "STORE", id), accessPartition: collection(tenantId, "STORE"), accessSort: `${store.name.toLowerCase()}#${id}`, entityType: "store", tenantId, ...store }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "LOOKUP#STORE", store.code), entityType: "store_lookup", tenantId, storeId: id }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return store;
};

export const updateStore = async (tenantId: string, id: string, input: Partial<Pick<StoreRecord, "name" | "address" | "status">>) => {
  const current = await getStore(tenantId, id); if (!current) throw new Error("Store not found");
  if (input.status === "inactive" && current.status === "active") {
    const [lots, orders, transfers] = await Promise.all([listLots(tenantId, id), listPurchaseOrders(tenantId), listTransfers(tenantId)]);
    if (lots.some((lot) => lot.remainingQuantity > 0)) throw new Error("Move or write off this store's stock before deactivating it");
    if (orders.some((order) => order.storeId === id && (order.status === "draft" || order.status === "issued" || order.status === "partially_received"))) throw new Error("Close this store's open purchase orders before deactivating it");
    if (transfers.some((transfer) => (transfer.fromStoreId === id || transfer.toStoreId === id) && (transfer.status === "draft" || transfer.status === "dispatched"))) throw new Error("Complete this store's open transfers before deactivating it");
  }
  const next = { ...current, ...input, name: normalized(input.name ?? current.name), address: normalized(input.address ?? current.address), updatedAt: new Date().toISOString() };
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
  const all = queryCollection<SupplierProductRecord>(tenantId, "SUPPLIER#PRODUCT");
  return supplierId ? all.then((items) => items.filter((item) => item.supplierId === supplierId)) : all;
};

export const upsertSupplierProduct = async (tenantId: string, input: SupplierProductRecord) => {
  validateCount(input.unitsPerPurchaseUnit, "Units per purchase unit", false);
  if (!Number.isFinite(input.lastPurchasePrice) || input.lastPurchasePrice < 0) throw new Error("Purchase price must be zero or greater");
  const now = new Date().toISOString();
  const record = { ...input, supplierSku: normalizedCode(input.supplierSku), purchaseUnit: normalized(input.purchaseUnit), updatedAt: now };
  const current = await listSupplierProducts(tenantId);
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  if (record.preferred) {
    for (const item of current.filter((item) => item.productId === record.productId && item.preferred && item.supplierId !== record.supplierId)) {
      transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "SUPPLIER_PRODUCT", `${item.supplierId}#${item.productId}`), accessPartition: collection(tenantId, "SUPPLIER#PRODUCT"), accessSort: `${item.productId}#${item.supplierId}`, entityType: "supplier_product", tenantId, ...item, preferred: false, updatedAt: now } } });
    }
  }
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "SUPPLIER_PRODUCT", `${record.supplierId}#${record.productId}`), accessPartition: collection(tenantId, "SUPPLIER#PRODUCT"), accessSort: `${record.productId}#${record.supplierId}`, entityType: "supplier_product", tenantId, ...record } } });
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return record;
};

export const listStorePolicies = (tenantId: string, storeId?: string) => queryCollection<StoreProductPolicyRecord>(tenantId, "STORE#POLICY").then((items) => storeId ? items.filter((item) => item.storeId === storeId) : items);
export const upsertStorePolicy = async (tenantId: string, input: Omit<StoreProductPolicyRecord, "updatedAt">) => {
  validateCount(input.reorderPoint, "Reorder point"); validateCount(input.targetQuantity, "Target quantity");
  if (input.targetQuantity < input.reorderPoint) throw new Error("Target quantity must be at least the reorder point");
  const record = { ...input, updatedAt: new Date().toISOString() };
  await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...key(tenantId, "STORE_POLICY", `${input.storeId}#${input.productId}`), accessPartition: collection(tenantId, "STORE#POLICY"), accessSort: `${input.storeId}#${input.productId}`, entityType: "store_product_policy", tenantId, ...record } }));
  return record;
};

export const listLots = async (tenantId: string, storeId?: string, includeExhausted = false) => {
  const active = await queryCollection<InventoryLotRecord>(tenantId, "INVENTORY#ACTIVE");
  const lots = includeExhausted ? [...active, ...await queryCollection<InventoryLotRecord>(tenantId, "INVENTORY#LOT")] : active;
  return storeId ? lots.filter((lot) => lot.storeId === storeId) : lots;
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

export const listPurchaseOrders = (tenantId: string) => queryCollection<PurchaseOrderRecord>(tenantId, "PURCHASE_ORDER");
export const getPurchaseOrder = (tenantId: string, id: string) => get<PurchaseOrderRecord>(tenantId, "PO", id);
export const createPurchaseOrder = async (tenantId: string, input: { supplierId: string; storeId: string; expectedDeliveryDate?: string | null; notes: string; lines: Array<Omit<PurchaseOrderLineRecord, "id" | "productName" | "acceptedBaseQuantity"> & { productName: string }> }, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<PurchaseOrderRecord>(tenantId, "create_po", requestId); if (previous) return previous;
  if (input.lines.length < 1 || input.lines.length > 40) throw new Error("A purchase order must contain 1 to 40 lines");
  const [supplier, store] = await Promise.all([getSupplier(tenantId, input.supplierId), getStore(tenantId, input.storeId)]);
  if (!supplier || supplier.status !== "active") throw new Error("Select an active supplier"); if (!store || store.status !== "active") throw new Error("Select an active store");
  const now = new Date().toISOString(); const id = randomUUID();
  const lines = input.lines.map((line) => { validateCount(line.unitsPerPurchaseUnit, "Conversion", false); validateCount(line.orderedPurchaseQuantity, "Ordered quantity", false); if (!Number.isFinite(line.pricePerPurchaseUnit) || line.pricePerPurchaseUnit < 0) throw new Error("Purchase price must be zero or greater"); return { ...line, id: randomUUID(), acceptedBaseQuantity: 0 }; });
  const po: PurchaseOrderRecord = { id, orderNumber: `PO-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, supplierId: supplier.id, supplierName: supplier.name, storeId: store.id, storeName: store.name, status: "draft", expectedDeliveryDate: input.expectedDeliveryDate ?? null, notes: input.notes.trim(), lines, totalAmount: roundMoney(lines.reduce((sum, line) => sum + line.orderedPurchaseQuantity * line.pricePerPurchaseUnit, 0)), createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "PO", id), accessPartition: collection(tenantId, "PURCHASE_ORDER"), accessSort: `${now}#${id}`, entityType: "purchase_order", tenantId, ...po }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, "create_po", requestId), entityType: "idempotency", tenantId, result: po }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
  ] }));
  return po;
};

export const updatePurchaseOrder = async (tenantId: string, id: string, input: { supplierId: string; storeId: string; expectedDeliveryDate?: string | null; notes: string; lines: Array<Omit<PurchaseOrderLineRecord, "id" | "acceptedBaseQuantity">> }) => {
  const current = await getPurchaseOrder(tenantId, id); if (!current) throw new Error("Purchase order not found"); if (current.status !== "draft") throw new Error("Only draft purchase orders can be edited");
  if (input.lines.length < 1 || input.lines.length > 40) throw new Error("A purchase order must contain 1 to 40 lines");
  const [supplier, store] = await Promise.all([getSupplier(tenantId, input.supplierId), getStore(tenantId, input.storeId)]); if (!supplier || supplier.status !== "active") throw new Error("Select an active supplier"); if (!store || store.status !== "active") throw new Error("Select an active store");
  const lines = input.lines.map((line) => { validateCount(line.unitsPerPurchaseUnit, "Conversion", false); validateCount(line.orderedPurchaseQuantity, "Ordered quantity", false); if (!Number.isFinite(line.pricePerPurchaseUnit) || line.pricePerPurchaseUnit < 0) throw new Error("Purchase price must be zero or greater"); return { ...line, id: current.lines.find((item) => item.productId === line.productId)?.id ?? randomUUID(), acceptedBaseQuantity: 0 }; });
  const next: PurchaseOrderRecord = { ...current, supplierId: supplier.id, supplierName: supplier.name, storeId: store.id, storeName: store.name, expectedDeliveryDate: input.expectedDeliveryDate ?? null, notes: input.notes.trim(), lines, totalAmount: roundMoney(lines.reduce((sum, line) => sum + line.orderedPurchaseQuantity * line.pricePerPurchaseUnit, 0)), updatedAt: new Date().toISOString() };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [putPurchaseOrder(tenantId, next, current.updatedAt)] })); return next;
};

const putPurchaseOrder = (tenantId: string, po: PurchaseOrderRecord, expectedUpdatedAt: string) => ({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "PO", po.id), accessPartition: collection(tenantId, "PURCHASE_ORDER"), accessSort: `${po.createdAt}#${po.id}`, entityType: "purchase_order", tenantId, ...po }, ConditionExpression: "attribute_exists(partitionKey) AND updatedAt = :expectedUpdatedAt", ExpressionAttributeValues: { ":expectedUpdatedAt": expectedUpdatedAt } } });
export const setPurchaseOrderStatus = async (tenantId: string, id: string, action: "issue" | "close" | "cancel", reason: string) => {
  const current = await getPurchaseOrder(tenantId, id); if (!current) throw new Error("Purchase order not found"); const now = new Date().toISOString();
  let next: PurchaseOrderRecord;
  if (action === "issue") { if (current.status !== "draft") throw new Error("Only draft purchase orders can be issued"); next = { ...current, status: "issued", issuedAt: now, updatedAt: now }; }
  else if (action === "cancel") { if (!(["draft", "issued"] as string[]).includes(current.status) || current.lines.some((line) => line.acceptedBaseQuantity > 0)) throw new Error("Only unreceived draft or issued orders can be cancelled"); next = { ...current, status: "cancelled", closeReason: reason.trim() || "Cancelled", updatedAt: now }; }
  else { if (!(current.status === "partially_received" || current.status === "issued")) throw new Error("Only open purchase orders can be closed"); if (reason.trim().length < 3) throw new Error("A close reason is required"); next = { ...current, status: "closed", closeReason: reason.trim(), updatedAt: now }; }
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [putPurchaseOrder(tenantId, next, current.updatedAt)] })); return next;
};

export const listGoodsReceipts = (tenantId: string) => queryCollection<GoodsReceiptRecord>(tenantId, "GOODS_RECEIPT");
export const receivePurchaseOrder = async (tenantId: string, purchaseOrderId: string, deliveryNote: string, lines: ReceiptLineInput[], actor: Actor, requestId: string, productExpiry: (productId: string) => Promise<boolean>) => {
  const previous = await existingIdempotentResult<GoodsReceiptRecord>(tenantId, "receive_po", requestId); if (previous) return previous;
  if (lines.length < 1 || lines.length > 40) throw new Error("A receipt must contain 1 to 40 batch lines");
  const po = await getPurchaseOrder(tenantId, purchaseOrderId); if (!po || !(po.status === "issued" || po.status === "partially_received")) throw new Error("Purchase order is not open for receiving");
  const now = new Date().toISOString(); const id = randomUUID(); const receiptLines: GoodsReceiptRecord["lines"] = []; const acceptedByLine = new Map<string, number>(); const lotWrites: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  for (const input of lines) {
    [input.deliveredBaseQuantity, input.acceptedBaseQuantity, input.damagedBaseQuantity, input.rejectedBaseQuantity].forEach((value) => validateCount(value, "Receipt quantity"));
    if (input.deliveredBaseQuantity !== input.acceptedBaseQuantity + input.damagedBaseQuantity + input.rejectedBaseQuantity) throw new Error("Delivered quantity must equal accepted, damaged, and rejected quantities");
    const poLine = po.lines.find((line) => line.id === input.purchaseOrderLineId); if (!poLine) throw new Error("Purchase order line not found");
    const nextAccepted = (acceptedByLine.get(poLine.id) ?? 0) + input.acceptedBaseQuantity;
    const outstanding = poLine.orderedPurchaseQuantity * poLine.unitsPerPurchaseUnit - poLine.acceptedBaseQuantity;
    if (nextAccepted > outstanding) throw new Error(`${poLine.productName} receipt exceeds the outstanding ordered quantity`);
    if (input.acceptedBaseQuantity > 0 && await productExpiry(poLine.productId) && !input.expiryDate) throw new Error(`${poLine.productName} requires an expiry date`);
    if (input.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) throw new Error("Expiry dates must use YYYY-MM-DD");
    acceptedByLine.set(poLine.id, nextAccepted);
    const unitCost = roundMoney(poLine.pricePerPurchaseUnit / poLine.unitsPerPurchaseUnit); let lotId: string | null = null;
    if (input.acceptedBaseQuantity > 0) {
      lotId = randomUUID(); const lot: InventoryLotRecord = { id: lotId, storeId: po.storeId, productId: poLine.productId, productName: poLine.productName, supplierId: po.supplierId, receiptId: id, batchNumber: normalized(input.batchNumber ?? "") || `GRN-${id.slice(0, 8).toUpperCase()}`, expiryDate: input.expiryDate ?? null, receivedQuantity: input.acceptedBaseQuantity, remainingQuantity: input.acceptedBaseQuantity, unitCost, origin: "supplier_receipt", status: "active", receivedAt: now, updatedAt: now };
      lotWrites.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "LOT", lotId), accessPartition: collection(tenantId, "INVENTORY#ACTIVE"), accessSort: `${lot.storeId}#${lot.expiryDate ?? "9999-12-31"}#${now}#${lotId}`, entityType: "inventory_lot", tenantId, ...lot }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, stockMovementPut(tenantId, { type: "receipt", storeId: po.storeId, productId: poLine.productId, productName: poLine.productName, lotId, quantity: input.acceptedBaseQuantity, unitCost, reason: `Receipt for ${po.orderNumber}`, referenceId: id, actorId: actor.id, actorName: actor.name }, now));
    }
    receiptLines.push({ ...input, productId: poLine.productId, productName: poLine.productName, unitCost, lotId });
  }
  const nextLines = po.lines.map((line) => ({ ...line, acceptedBaseQuantity: line.acceptedBaseQuantity + (acceptedByLine.get(line.id) ?? 0) }));
  const complete = nextLines.every((line) => line.acceptedBaseQuantity >= line.orderedPurchaseQuantity * line.unitsPerPurchaseUnit);
  const nextPo: PurchaseOrderRecord = { ...po, lines: nextLines, status: complete ? "completed" : "partially_received", updatedAt: now };
  const receipt: GoodsReceiptRecord = { id, receiptNumber: `GRN-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, purchaseOrderId: po.id, orderNumber: po.orderNumber, supplierId: po.supplierId, supplierName: po.supplierName, storeId: po.storeId, storeName: po.storeName, deliveryNote: deliveryNote.trim(), lines: receiptLines, createdBy: actor.id, createdByName: actor.name, createdAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [putPurchaseOrder(tenantId, nextPo, po.updatedAt), { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "RECEIPT", id), accessPartition: collection(tenantId, "GOODS_RECEIPT"), accessSort: `${now}#${id}`, entityType: "goods_receipt", tenantId, ...receipt }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, ...lotWrites, { Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, "receive_po", requestId), entityType: "idempotency", tenantId, result: receipt }, ConditionExpression: "attribute_not_exists(partitionKey)" } }];
  if (transaction.length > 100) throw new Error("Receipt is too fragmented to commit atomically; split it into smaller receipts");
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction })); return receipt;
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

export const lotDecrement = (tenantId: string, lot: InventoryLotRecord, quantity: number, now: string) => ({ Update: { TableName: TABLE_NAME, Key: key(tenantId, "LOT", lot.id), UpdateExpression: quantity === lot.remainingQuantity ? "SET remainingQuantity = :zero, #status = :exhausted, updatedAt = :now, accessPartition = :archive, accessSort = :sort" : "SET remainingQuantity = remainingQuantity - :quantity, updatedAt = :now", ConditionExpression: "remainingQuantity >= :quantity AND #status = :active", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":quantity": quantity, ":zero": 0, ":active": "active", ":exhausted": "exhausted", ":now": now, ...(quantity === lot.remainingQuantity ? { ":archive": collection(tenantId, "INVENTORY#LOT"), ":sort": `${lot.storeId}#${now}#${lot.id}` } : {}) } } });

export const listMovements = (tenantId: string, range?: { from?: string; to?: string }) => queryCollection<StockMovementRecord>(tenantId, "STOCK#MOVEMENT", range);
export const writeOffLot = async (tenantId: string, lotId: string, quantity: number, type: "damage" | "expiry", reason: string, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<StockMovementRecord>(tenantId, "writeoff", requestId); if (previous) return previous;
  validateCount(quantity, "Write-off quantity", false); if (reason.trim().length < 3) throw new Error("A write-off reason is required");
  const lot = await getLot(tenantId, lotId); if (!lot || lot.status !== "active" || lot.remainingQuantity < quantity) throw new Error("Lot does not have enough stock");
  const now = new Date().toISOString(); const movement: StockMovementRecord = { id: randomUUID(), type, storeId: lot.storeId, productId: lot.productId, productName: lot.productName, lotId, quantity: -quantity, unitCost: lot.unitCost, reason: reason.trim(), referenceId: null, actorId: actor.id, actorName: actor.name, createdAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [lotDecrement(tenantId, lot, quantity, now), { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "MOVEMENT", movement.id, "EVENT"), accessPartition: collection(tenantId, "STOCK#MOVEMENT"), accessSort: `${now}#${movement.id}`, entityType: "stock_movement", tenantId, ...movement } } }, { Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, "writeoff", requestId), entityType: "idempotency", tenantId, result: movement }, ConditionExpression: "attribute_not_exists(partitionKey)" } }] })); return movement;
};

export const countLot = async (tenantId: string, lotId: string, physicalQuantity: number, reason: string, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<StockMovementRecord>(tenantId, "count", requestId); if (previous) return previous;
  validateCount(physicalQuantity, "Physical quantity"); if (reason.trim().length < 3) throw new Error("A count reason is required");
  const lot = await getLot(tenantId, lotId); if (!lot) throw new Error("Lot not found"); const delta = physicalQuantity - lot.remainingQuantity; if (delta === 0) throw new Error("Physical quantity matches system quantity");
  const now = new Date().toISOString(); const status = physicalQuantity === 0 ? "exhausted" : "active"; const movement: StockMovementRecord = { id: randomUUID(), type: "count_correction", storeId: lot.storeId, productId: lot.productId, productName: lot.productName, lotId, quantity: delta, unitCost: lot.unitCost, reason: reason.trim(), referenceId: null, actorId: actor.id, actorName: actor.name, createdAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [{ Update: { TableName: TABLE_NAME, Key: key(tenantId, "LOT", lot.id), UpdateExpression: "SET remainingQuantity = :quantity, #status = :status, updatedAt = :now, accessPartition = :partition, accessSort = :sort", ConditionExpression: "remainingQuantity = :before", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":quantity": physicalQuantity, ":before": lot.remainingQuantity, ":status": status, ":now": now, ":partition": collection(tenantId, physicalQuantity ? "INVENTORY#ACTIVE" : "INVENTORY#LOT"), ":sort": physicalQuantity ? `${lot.storeId}#${lot.expiryDate ?? "9999-12-31"}#${lot.receivedAt}#${lot.id}` : `${lot.storeId}#${now}#${lot.id}` } } }, { Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "MOVEMENT", movement.id, "EVENT"), accessPartition: collection(tenantId, "STOCK#MOVEMENT"), accessSort: `${now}#${movement.id}`, entityType: "stock_movement", tenantId, ...movement } } }, { Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, "count", requestId), entityType: "idempotency", tenantId, result: movement }, ConditionExpression: "attribute_not_exists(partitionKey)" } }] })); return movement;
};

export const listTransfers = (tenantId: string) => queryCollection<StockTransferRecord>(tenantId, "TRANSFER");
export const getTransfer = (tenantId: string, id: string) => get<StockTransferRecord>(tenantId, "TRANSFER", id);
export const createTransfer = async (tenantId: string, input: { fromStoreId: string; toStoreId: string; notes: string; lines: Array<{ productId: string; productName: string; quantity: number }> }, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<StockTransferRecord>(tenantId, "create_transfer", requestId); if (previous) return previous;
  if (input.fromStoreId === input.toStoreId) throw new Error("Transfer stores must be different"); if (input.lines.length < 1 || input.lines.length > 40) throw new Error("A transfer must contain 1 to 40 lines"); input.lines.forEach((line) => validateCount(line.quantity, "Transfer quantity", false));
  const [from, to] = await Promise.all([getStore(tenantId, input.fromStoreId), getStore(tenantId, input.toStoreId)]); if (!from || !to || from.status !== "active" || to.status !== "active") throw new Error("Select two active stores");
  const now = new Date().toISOString(); const id = randomUUID(); const transfer: StockTransferRecord = { id, transferNumber: `TR-${now.slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, fromStoreId: from.id, fromStoreName: from.name, toStoreId: to.id, toStoreName: to.name, status: "draft", notes: input.notes.trim(), lines: input.lines, createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "TRANSFER", id), accessPartition: collection(tenantId, "TRANSFER"), accessSort: `${now}#${id}`, entityType: "stock_transfer", tenantId, ...transfer }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, { Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, "create_transfer", requestId), entityType: "idempotency", tenantId, result: transfer }, ConditionExpression: "attribute_not_exists(partitionKey)" } }] })); return transfer;
};

const putTransfer = (tenantId: string, transfer: StockTransferRecord, expectedUpdatedAt: string) => ({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "TRANSFER", transfer.id), accessPartition: collection(tenantId, "TRANSFER"), accessSort: `${transfer.createdAt}#${transfer.id}`, entityType: "stock_transfer", tenantId, ...transfer }, ConditionExpression: "attribute_exists(partitionKey) AND updatedAt = :expectedUpdatedAt", ExpressionAttributeValues: { ":expectedUpdatedAt": expectedUpdatedAt } } });
export const dispatchTransfer = async (tenantId: string, id: string, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<StockTransferRecord>(tenantId, "dispatch_transfer", requestId); if (previous) return previous;
  const transfer = await getTransfer(tenantId, id); if (!transfer || transfer.status !== "draft") throw new Error("Only draft transfers can be dispatched"); const now = new Date().toISOString();
  const allocations = await allocateLots(tenantId, transfer.fromStoreId, transfer.lines.map(({ productId, quantity }) => ({ productId, quantity })));
  const nextLines = transfer.lines.map((line) => ({ ...line, allocations: allocations.get(line.productId)!.map(({ lot, quantity }) => ({ lotId: lot.id, quantity, unitCost: lot.unitCost, batchNumber: lot.batchNumber, expiryDate: lot.expiryDate, supplierId: lot.supplierId })) }));
  const next = { ...transfer, lines: nextLines, status: "dispatched" as const, dispatchedAt: now, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [putTransfer(tenantId, next, transfer.updatedAt)];
  for (const line of nextLines) for (const allocation of line.allocations ?? []) { const lot = (allocations.get(line.productId) ?? []).find((item) => item.lot.id === allocation.lotId)!.lot; transaction.push(lotDecrement(tenantId, lot, allocation.quantity, now), stockMovementPut(tenantId, { type: "transfer_dispatch", storeId: transfer.fromStoreId, productId: line.productId, productName: line.productName, lotId: lot.id, quantity: -allocation.quantity, unitCost: lot.unitCost, reason: `Dispatched ${transfer.transferNumber}`, referenceId: transfer.id, actorId: actor.id, actorName: actor.name }, now)); }
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, "dispatch_transfer", requestId), entityType: "idempotency", tenantId, result: next }, ConditionExpression: "attribute_not_exists(partitionKey)" } }); if (transaction.length > 100) throw new Error("Transfer is too fragmented to dispatch atomically"); await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction })); return next;
};

export const receiveTransfer = async (tenantId: string, id: string, actor: Actor, requestId: string) => {
  const previous = await existingIdempotentResult<StockTransferRecord>(tenantId, "receive_transfer", requestId); if (previous) return previous;
  const transfer = await getTransfer(tenantId, id); if (!transfer || transfer.status !== "dispatched") throw new Error("Only dispatched transfers can be received"); const now = new Date().toISOString(); const next = { ...transfer, status: "completed" as const, receivedAt: now, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [putTransfer(tenantId, next, transfer.updatedAt)];
  for (const line of transfer.lines) for (const allocation of line.allocations ?? []) { const lotId = randomUUID(); const lot: InventoryLotRecord = { id: lotId, storeId: transfer.toStoreId, productId: line.productId, productName: line.productName, supplierId: allocation.supplierId, receiptId: null, batchNumber: allocation.batchNumber, expiryDate: allocation.expiryDate, receivedQuantity: allocation.quantity, remainingQuantity: allocation.quantity, unitCost: allocation.unitCost, origin: "transfer", status: "active", receivedAt: now, updatedAt: now }; transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...key(tenantId, "LOT", lotId), accessPartition: collection(tenantId, "INVENTORY#ACTIVE"), accessSort: `${lot.storeId}#${lot.expiryDate ?? "9999-12-31"}#${now}#${lotId}`, entityType: "inventory_lot", tenantId, ...lot }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, stockMovementPut(tenantId, { type: "transfer_receive", storeId: transfer.toStoreId, productId: line.productId, productName: line.productName, lotId, quantity: allocation.quantity, unitCost: allocation.unitCost, reason: `Received ${transfer.transferNumber}`, referenceId: transfer.id, actorId: actor.id, actorName: actor.name }, now)); }
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...idempotencyKey(tenantId, "receive_transfer", requestId), entityType: "idempotency", tenantId, result: next }, ConditionExpression: "attribute_not_exists(partitionKey)" } }); if (transaction.length > 100) throw new Error("Transfer is too fragmented to receive atomically"); await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction })); return next;
};

export const replenishmentSuggestions = async (tenantId: string, storeId: string, supplierId: string) => {
  const [stock, policies, supplierProducts, orders, transfers] = await Promise.all([storeStock(tenantId, storeId), listStorePolicies(tenantId, storeId), listSupplierProducts(tenantId, supplierId), listPurchaseOrders(tenantId), listTransfers(tenantId)]);
  const byStock = new Map(stock.map((item) => [item.productId, item]));
  return policies.flatMap((policy) => {
    const supplierProduct = supplierProducts.find((item) => item.productId === policy.productId && item.preferred) ?? supplierProducts.find((item) => item.productId === policy.productId); if (!supplierProduct) return [];
    const onOrder = orders.filter((order) => order.storeId === storeId && (order.status === "issued" || order.status === "partially_received")).flatMap((order) => order.lines).filter((line) => line.productId === policy.productId).reduce((sum, line) => sum + Math.max(0, line.orderedPurchaseQuantity * line.unitsPerPurchaseUnit - line.acceptedBaseQuantity), 0);
    const inbound = transfers.filter((transfer) => transfer.toStoreId === storeId && transfer.status === "dispatched").flatMap((transfer) => transfer.lines).filter((line) => line.productId === policy.productId).reduce((sum, line) => sum + line.quantity, 0);
    const quantity = byStock.get(policy.productId)?.quantity ?? 0; const projectedQuantity = quantity + onOrder + inbound; if (projectedQuantity > policy.reorderPoint) return [];
    return [{ storeId, supplierId, productId: policy.productId, availableQuantity: quantity, projectedQuantity, reorderPoint: policy.reorderPoint, targetQuantity: policy.targetQuantity, suggestedPurchaseQuantity: Math.max(0, Math.ceil((policy.targetQuantity - projectedQuantity) / supplierProduct.unitsPerPurchaseUnit)), supplierProduct }];
  });
};

export const supplyChainReport = async (tenantId: string, input: { from: string; to: string; storeId?: string; supplierId?: string; expiryDays?: number }) => {
  const stores = input.storeId ? [{ id: input.storeId }] : await listStores(tenantId);
  const [orders, receipts, movements, lots, transfers, stockByStore] = await Promise.all([listPurchaseOrders(tenantId), listGoodsReceipts(tenantId), listMovements(tenantId, { from: input.from, to: input.to }), listLots(tenantId), listTransfers(tenantId), Promise.all(stores.map((store) => storeStock(tenantId, store.id)))]);
  const stock = stockByStore.flat();
  const inRange = <T extends { createdAt: string }>(items: T[]) => items.filter((item) => item.createdAt >= input.from && item.createdAt <= input.to);
  const filteredOrders = inRange(orders).filter((item) => (!input.storeId || item.storeId === input.storeId) && (!input.supplierId || item.supplierId === input.supplierId));
  const filteredReceipts = inRange(receipts).filter((item) => (!input.storeId || item.storeId === input.storeId) && (!input.supplierId || item.supplierId === input.supplierId));
  const filteredMovements = movements.filter((item) => !input.storeId || item.storeId === input.storeId); const filteredTransfers = inRange(transfers).filter((item) => !input.storeId || item.fromStoreId === input.storeId || item.toStoreId === input.storeId);
  const cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() + Math.min(Math.max(input.expiryDays ?? 30, 0), 365)); const cutoffDate = cutoff.toISOString().slice(0, 10);
  const expiryLots = lots.filter((lot) => (!input.storeId || lot.storeId === input.storeId) && lot.expiryDate && lot.expiryDate <= cutoffDate && lot.remainingQuantity > 0);
  return { from: input.from, to: input.to, purchaseOrders: filteredOrders, receipts: filteredReceipts, movements: filteredMovements, transfers: filteredTransfers, stock, expiryLots, purchaseSpend: roundMoney(filteredOrders.reduce((sum, item) => sum + item.totalAmount, 0)), receivedValue: roundMoney(filteredReceipts.flatMap((item) => item.lines).reduce((sum, line) => sum + line.acceptedBaseQuantity * line.unitCost, 0)), damagedValue: roundMoney(filteredMovements.filter((item) => item.type === "damage" || item.type === "expiry").reduce((sum, item) => sum + Math.abs(item.quantity) * item.unitCost, 0)), inventoryValue: roundMoney(stock.reduce((sum, item) => sum + item.inventoryValue, 0)) };
};
