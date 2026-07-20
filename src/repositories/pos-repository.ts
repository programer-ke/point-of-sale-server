import { randomUUID } from "crypto";
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { allocateLots, commitIdempotent, existingIdempotentResult, getStore, listStores as listInventoryStores, lotDecrement, sellableLots, stockMovementPut, storeStock as getStoreStock } from "./supply-chain-repository";

export interface SaleVariantRecord { id: string; name: string; sku: string; barcode: string; quantityInBaseUnits: number; sellingPrice: number; status: "active" | "inactive" }

export interface CategoryRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  description: string;
  sku: string;
  barcode: string;
  categoryId: string;
  categoryName: string;
  sellingPrice: number;
  buyingPrice: number;
  baseUnit: string;
  tracksExpiry: boolean;
  saleVariants: SaleVariantRecord[];
  promotionPrice?: number | null;
  promotionStartsAt?: string | null;
  promotionEndsAt?: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface SaleItemRecord {
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  quantity: number;
  variantId: string;
  variantName: string;
  quantityInBaseUnits: number;
  inventoryQuantity: number;
  price: number;
  regularPrice?: number;
  promotionApplied?: boolean;
  cost: number;
  total: number;
}

export interface SaleRecord {
  id: string;
  orderNumber: string;
  customerName: string;
  items: SaleItemRecord[];
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  status: "completed";
  paymentMethod: "cash" | "mpesa" | "card" | "mobile_money";
  paymentStatus: "paid";
  amountTendered?: number | null;
  changeDue?: number | null;
  paymentReference?: string | null;
  cashShiftId?: string | null;
  createdBy: string;
  createdByName: string;
  storeId?: string | null;
  storeName?: string | null;
  sellerDepartment?: string | null;
  cashierDisplayName?: string;
  receiptBranding?: BusinessSettingsRecord;
  createdAt: string;
  updatedAt: string;
}

export interface CashShiftRecord { id: string; shiftNumber: string; storeId: string; storeName: string; cashierId: string; cashierName: string; status: "open" | "closed"; openingFloat: number; cashSalesTotal: number; cashInTotal: number; cashOutTotal: number; expectedCash?: number | null; countedCash?: number | null; variance?: number | null; openedAt: string; closedAt?: string | null; updatedAt: string }
export interface CashMovementRecord { id: string; shiftId: string; storeId: string; type: "cash_in" | "cash_out"; amount: number; reason: string; actorId: string; actorName: string; createdAt: string }

export interface AuditRecord {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  productName?: string;
  quantityBefore?: number;
  quantityAfter?: number;
  quantityDelta?: number;
  reason: string;
  referenceId?: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export interface StaffProfileRecord {
  userId: string;
  employeeCode: string;
  jobTitle: string;
  storeId?: string;
  storeName?: string;
  storeIds: string[];
  phone: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessSettingsRecord {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  thankYouMessage: string;
  returnPolicy: string;
  storeName: string;
  updatedAt: string;
}

export type BusinessBrandingInput = Omit<BusinessSettingsRecord, "updatedAt" | "storeName">;

export interface ReportProductRecord {
  productId: string;
  productName: string;
  units: number;
  revenue: number;
  grossProfit: number;
  savings: number;
}

export interface StockReportProductRecord {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  reorderPoint: number;
  actualCostValue: number;
  sellingPrice: number;
  retailValue: number;
  status: string;
}

export interface BusinessReportRecord {
  from: string;
  to: string;
  salesCount: number;
  revenue: number;
  grossProfit: number;
  unitsSold: number;
  promotionUnitsSold: number;
  promotionRevenue: number;
  promotionSavings: number;
  stockUnits: number;
  stockCostValue: number;
  stockRetailValue: number;
  potentialMargin: number;
  lowStockCount: number;
  outOfStockCount: number;
  netStockAdjustment: number;
  stockAdjustmentCount: number;
  priceChangeCount: number;
  topProducts: ReportProductRecord[];
  promotionProducts: ReportProductRecord[];
  stockProducts: StockReportProductRecord[];
  stockAdjustments: AuditRecord[];
  priceChanges: AuditRecord[];
}

const normalizeLookup = (value: string) => value.trim().toUpperCase();
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const businessDate = (date = new Date()) =>
  new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const tenantKey = (tenantId: string, value: string) => `TENANT#${tenantId}#${value}`;
const productKey = (tenantId: string, id: string) => ({ partitionKey: tenantKey(tenantId, `PRODUCT#${id}`), sortKey: "PROFILE" });
const categoryKey = (tenantId: string, id: string) => ({ partitionKey: tenantKey(tenantId, `CATEGORY#${id}`), sortKey: "PROFILE" });
const lookupKey = (tenantId: string, kind: "SKU" | "BARCODE" | "CATEGORY", value: string) => ({
  partitionKey: tenantKey(tenantId, `LOOKUP#${kind}#${normalizeLookup(value)}`),
  sortKey: "PRODUCT",
});
const profileKey = (tenantId: string, userId: string) => ({ partitionKey: tenantKey(tenantId, `USER#${userId}`), sortKey: "PROFILE" });
const mpesaPaymentKey = (tenantId: string, reference: string) => ({ partitionKey: tenantKey(tenantId, `PAYMENT#MPESA#${reference}`), sortKey: "SALE" });
const cashShiftKey = (tenantId: string, id: string) => ({ partitionKey: tenantKey(tenantId, `CASH_SHIFT#${id}`), sortKey: "PROFILE" });
const openCashShiftKey = (tenantId: string, storeId: string, cashierId: string) => ({ partitionKey: tenantKey(tenantId, `CASH_SHIFT_OPEN#${storeId}#${cashierId}`), sortKey: "PROFILE" });
const businessSettingsKey = (tenantId: string) => ({ partitionKey: tenantKey(tenantId, "SETTINGS#BUSINESS"), sortKey: "PROFILE" });
const defaultBusinessSettings: BusinessSettingsRecord = {
  businessName: "Tomkondi Supermarket",
  address: "Nairobi, Kenya",
  phone: "",
  email: "",
  thankYouMessage: "Thank you for shopping with us.",
  returnPolicy: "Goods once sold cannot be returned.",
  storeName: "",
  updatedAt: new Date(0).toISOString(),
};

const defaultVariant = (product: Pick<ProductRecord, "id" | "name" | "sku" | "barcode" | "sellingPrice">): SaleVariantRecord => ({ id: `${product.id}-default`, name: product.name, sku: product.sku, barcode: product.barcode, quantityInBaseUnits: 1, sellingPrice: product.sellingPrice, status: "active" });
const variantsOf = (product: ProductRecord) => product.saleVariants?.length ? product.saleVariants : [defaultVariant(product)];
const validateVariants = (variants: SaleVariantRecord[]) => {
  if (!variants.length || variants.length > 20) throw new Error("A product must have 1 to 20 sale variants");
  const ids = new Set<string>(); const codes = new Set<string>();
  return variants.map((variant) => { const id = variant.id?.trim() || randomUUID(); const name = variant.name.trim(); if (!name) throw new Error("Every sale variant requires a name"); if (ids.has(id)) throw new Error("Sale variant IDs must be unique"); ids.add(id); if (!Number.isInteger(variant.quantityInBaseUnits) || variant.quantityInBaseUnits <= 0) throw new Error("Variant quantity must be a positive whole number of base units"); if (!Number.isFinite(variant.sellingPrice) || variant.sellingPrice < 0) throw new Error("Variant selling price must be zero or greater"); const sku = normalizeLookup(variant.sku ?? ""); const barcode = normalizeLookup(variant.barcode ?? ""); for (const code of [sku, barcode].filter(Boolean)) { if (codes.has(code)) throw new Error("Variant SKU and barcode values must be unique within the product"); codes.add(code); } return { ...variant, id, name, sku, barcode, status: variant.status ?? "active" }; });
};
const productAliases = (product: ProductRecord) => {
  const aliases = new Map<string, { kind: "SKU" | "BARCODE"; value: string; variantId?: string }>();
  const add = (kind: "SKU" | "BARCODE", value: string, variantId?: string) => { const normalized = normalizeLookup(value); if (normalized) aliases.set(`${kind}#${normalized}`, { kind, value: normalized, variantId }); };
  add("SKU", product.sku); add("BARCODE", product.barcode);
  for (const variant of variantsOf(product)) { add("SKU", variant.sku, variant.id); add("BARCODE", variant.barcode, variant.id); }
  return aliases;
};

const stripKeys = <T>(item: Record<string, unknown> | undefined): T | null => {
  if (!item) return null;
  const { partitionKey: _partitionKey, sortKey: _sortKey, accessPartition: _accessPartition, accessSort: _accessSort, entityType: _type, recordType: _recordType, ...record } = item;
  return record as T;
};

const auditPut = (tenantId: string, audit: Omit<AuditRecord, "id" | "createdAt">, now: string) => {
  const id = randomUUID();
  return {
    Put: {
      TableName: TABLE_NAME,
      Item: {
        partitionKey: tenantKey(tenantId, `AUDIT#${id}`),
        sortKey: "EVENT",
        accessPartition: tenantKey(tenantId, "AUDIT"),
        accessSort: `${now}#${id}`,
        recordType: "audit",
        id,
        ...audit,
        createdAt: now,
      },
    },
  };
};

const queryCollection = async <T>(tenantId: string, partition: string, options?: { limit?: number; from?: string; to?: string }) => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: options?.from && options?.to
        ? "accessPartition = :pk AND accessSort BETWEEN :from AND :to"
        : options?.from
          ? "accessPartition = :pk AND accessSort >= :from"
        : "accessPartition = :pk",
      ExpressionAttributeValues: {
        ":pk": tenantKey(tenantId, partition),
        ...(options?.from ? { ":from": options.from } : {}),
        ...(options?.to ? { ":to": `${options.to}\uffff` } : {}),
      },
      ScanIndexForward: options?.limit ? false : true,
      Limit: options?.limit,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(response.Items ?? []));
    exclusiveStartKey = options?.limit ? undefined : response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items.map((item) => stripKeys<T>(item) as T);
};

export const listCategories = (tenantId: string) => queryCollection<CategoryRecord>(tenantId, "CATALOG#CATEGORY");
export const listProducts = (tenantId: string) => queryCollection<ProductRecord>(tenantId, "CATALOG#PRODUCT").then((products) => products.map((product) => ({ ...product, saleVariants: variantsOf(product) })));
export const listSales = (tenantId: string, limit = 50, range?: { from?: string; to?: string }) => queryCollection<SaleRecord>(tenantId, "SALE", { limit, ...range });
export const listSalesByStaff = async (tenantId: string, staffId: string, limit = 50, range?: { from?: string; to?: string }) => {
  const sales: SaleRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: range?.from && range?.to
        ? "accessPartition = :pk AND accessSort BETWEEN :from AND :to"
        : range?.from ? "accessPartition = :pk AND accessSort >= :from" : "accessPartition = :pk",
      FilterExpression: "createdBy = :staffId",
      ExpressionAttributeValues: { ":pk": tenantKey(tenantId, "SALE"), ":staffId": staffId, ...(range?.from ? { ":from": range.from } : {}), ...(range?.to ? { ":to": `${range.to}\uffff` } : {}) },
      ScanIndexForward: false,
      Limit: Math.max(limit * 2, 50),
      ExclusiveStartKey: exclusiveStartKey,
    }));
    // Keep the application filter as defense in depth and for local adapters
    // that do not evaluate DynamoDB FilterExpression.
    sales.push(...(response.Items ?? [])
      .map((item) => stripKeys<SaleRecord>(item)!)
      .filter((sale) => sale.createdBy === staffId));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (sales.length < limit && exclusiveStartKey);
  return sales.slice(0, limit);
};
export const listAudits = (tenantId: string, limit = 100, range?: { from?: string; to?: string }) => queryCollection<AuditRecord>(tenantId, "AUDIT", { limit, ...range });

export const getProductPage = async (tenantId: string, options: {
  search?: string;
  limit?: number;
  cursor?: string;
  activeOnly?: boolean;
}) => {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const search = options.search?.trim().toLowerCase() ?? "";
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (options.cursor) {
    try { exclusiveStartKey = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as Record<string, unknown>; }
    catch { throw new Error("Invalid product cursor"); }
  }
  const products: ProductRecord[] = [];
  let pagesRead = 0;
  do {
    const response = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "AccessIndex",
      KeyConditionExpression: "accessPartition = :pk",
      ExpressionAttributeValues: { ":pk": tenantKey(tenantId, "CATALOG#PRODUCT") },
      ExclusiveStartKey: exclusiveStartKey,
      Limit: limit - products.length,
    }));
    products.push(...(response.Items ?? []).map((item) => { const product = stripKeys<ProductRecord>(item)!; return { ...product, saleVariants: variantsOf(product) }; }).filter((product) => {
      if (options.activeOnly && product.status !== "active") return false;
      return !search || [product.name, product.sku, product.barcode, product.categoryName]
        .some((value) => value.toLowerCase().includes(search));
    }));
    exclusiveStartKey = response.LastEvaluatedKey;
    pagesRead += 1;
  } while (products.length < limit && exclusiveStartKey && pagesRead < 20);
  const nextCursor = exclusiveStartKey
    ? Buffer.from(JSON.stringify(exclusiveStartKey)).toString("base64url")
    : null;
  return {
    items: products,
    // Exact totals require reading the whole catalog. This is the number known so
    // far; nextCursor is authoritative for whether another page is available.
    totalCount: products.length + (nextCursor ? 1 : 0),
    nextCursor,
  };
};

export const getCategory = async (tenantId: string, id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: categoryKey(tenantId, id) }));
  return stripKeys<CategoryRecord>(response.Item);
};

export const getProduct = async (tenantId: string, id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: productKey(tenantId, id) }));
  const product = stripKeys<ProductRecord>(response.Item);
  return product ? { ...product, saleVariants: variantsOf(product) } : null;
};

export const getSale = async (tenantId: string, id: string) => {
  const response = await dynamoDB.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { partitionKey: tenantKey(tenantId, `SALE#${id}`), sortKey: "RECEIPT" },
  }));
  return stripKeys<SaleRecord>(response.Item);
};

export const getBusinessSettings = async (tenantId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: businessSettingsKey(tenantId) }));
  const settings = stripKeys<BusinessSettingsRecord>(response.Item);
  return { ...defaultBusinessSettings, ...(settings ?? {}) };
};

export const ensureBusinessSettings = async (tenantId: string, businessName: string, email: string) => {
  const settings: BusinessSettingsRecord = {
    ...defaultBusinessSettings,
    businessName: businessName.trim(),
    address: "Update your business address",
    email: email.trim().toLowerCase(),
    updatedAt: new Date().toISOString(),
  };
  await dynamoDB.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...businessSettingsKey(tenantId), entityType: "business_settings", tenantId, ...settings },
    ConditionExpression: "attribute_not_exists(partitionKey)",
  })).catch((error: unknown) => {
    if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
  });
  return getBusinessSettings(tenantId);
};

export const updateBusinessSettings = async (
  tenantId: string,
  input: BusinessBrandingInput,
  actor: { id: string; name: string },
) => {
  const now = new Date().toISOString();
  const branding = {
    businessName: input.businessName.trim(),
    address: input.address.trim(),
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    thankYouMessage: input.thankYouMessage.trim(),
    returnPolicy: input.returnPolicy.trim(),
    storeName: "",
    updatedAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Update: {
      TableName: TABLE_NAME,
      Key: businessSettingsKey(tenantId),
      UpdateExpression: "SET businessName = :businessName, address = :address, phone = :phone, email = :email, thankYouMessage = :thankYouMessage, returnPolicy = :returnPolicy, updatedAt = :updatedAt",
      ExpressionAttributeValues: Object.fromEntries(Object.entries(branding).map(([key, value]) => [`:${key}`, value])),
      ConditionExpression: "attribute_exists(partitionKey)",
    } },
    auditPut(tenantId, { action: "settings.branding.updated", entityType: "business_settings", entityId: "business", reason: "Receipt branding updated", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return branding;
};

export const effectiveProductPrice = (product: ProductRecord, at = new Date()) => {
  const promotionalPrice = product.promotionPrice;
  if (typeof promotionalPrice !== "number" || promotionalPrice < 0 || promotionalPrice >= product.sellingPrice) {
    return product.sellingPrice;
  }
  const timestamp = at.getTime();
  const startsAt = product.promotionStartsAt ? Date.parse(product.promotionStartsAt) : Number.NEGATIVE_INFINITY;
  const endsAt = product.promotionEndsAt ? Date.parse(product.promotionEndsAt) : Number.POSITIVE_INFINITY;
  return timestamp >= startsAt && timestamp <= endsAt ? promotionalPrice : product.sellingPrice;
};

export const findProduct = async (tenantId: string, term: string) => {
  const normalized = normalizeLookup(term);
  for (const kind of ["BARCODE", "SKU"] as const) {
    const lookup = await dynamoDB.send(
      new GetCommand({ TableName: TABLE_NAME, Key: lookupKey(tenantId, kind, normalized) }),
    );
    const productId = lookup.Item?.productId;
    if (typeof productId === "string") return getProduct(tenantId, productId);
  }
  return null;
};

export const createCategory = async (
  tenantId: string,
  input: Omit<CategoryRecord, "id" | "createdAt" | "updatedAt">,
  actor: { id: string; name: string },
) => {
  const id = randomUUID();
  const now = new Date().toISOString();
  const category = { ...input, code: normalizeLookup(input.code) };
  const item = { ...categoryKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#CATEGORY"), accessSort: `${category.name.toLowerCase()}#${id}`, entityType: "category", tenantId, id, ...category, createdAt: now, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...lookupKey(tenantId, "CATEGORY", category.code), entityType: "category_lookup", tenantId, categoryId: id }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    auditPut(tenantId, { action: "category.created", entityType: "category", entityId: id, reason: "Category created", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return stripKeys<CategoryRecord>(item)!;
};

export const updateCategory = async (
  tenantId: string,
  id: string,
  input: Pick<CategoryRecord, "code" | "name" | "description">,
  actor: { id: string; name: string },
) => {
  const current = await getCategory(tenantId, id);
  if (!current) throw new Error("Category not found");
  const now = new Date().toISOString();
  const next: CategoryRecord = {
    ...current,
    code: normalizeLookup(input.code),
    name: input.name.trim(),
    description: input.description.trim(),
    updatedAt: now,
  };
  const products = next.name === current.name
    ? []
    : (await listProducts(tenantId)).filter((product) => product.categoryId === id);
  const codeChanged = next.code !== current.code;
  const transactionItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
    { Put: {
      TableName: TABLE_NAME,
      Item: { ...categoryKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#CATEGORY"), accessSort: `${next.name.toLowerCase()}#${id}`, entityType: "category", tenantId, ...next },
      ConditionExpression: "attribute_exists(partitionKey)",
    } },
    ...(codeChanged ? [
      { Put: { TableName: TABLE_NAME, Item: { ...lookupKey(tenantId, "CATEGORY", next.code), entityType: "category_lookup", tenantId, categoryId: id }, ConditionExpression: "attribute_not_exists(partitionKey)" } },
      { Delete: { TableName: TABLE_NAME, Key: lookupKey(tenantId, "CATEGORY", current.code) } },
    ] : []),
    ...products.map((product) => ({ Update: {
      TableName: TABLE_NAME,
      Key: productKey(tenantId, product.id),
      UpdateExpression: "SET categoryName = :categoryName, updatedAt = :updatedAt",
      ConditionExpression: "categoryId = :categoryId",
      ExpressionAttributeValues: { ":categoryId": id, ":categoryName": next.name, ":updatedAt": now },
    } })),
    auditPut(tenantId, { action: "category.updated", entityType: "category", entityId: id, reason: "Category updated", actorId: actor.id, actorName: actor.name }, now),
  ];
  if (transactionItems.length > 100) {
    throw new Error("This category has too many products to rename safely in one operation");
  }
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transactionItems }));
  return next;
};

export const deleteCategory = async (
  tenantId: string,
  id: string,
  actor: { id: string; name: string },
) => {
  const current = await getCategory(tenantId, id);
  if (!current) throw new Error("Category not found");
  if ((await listProducts(tenantId)).some((product) => product.categoryId === id)) {
    throw new Error("Move this category's products before deleting it");
  }
  const now = new Date().toISOString();
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: TABLE_NAME, Key: categoryKey(tenantId, id), ConditionExpression: "attribute_exists(partitionKey)" } },
    { Delete: { TableName: TABLE_NAME, Key: lookupKey(tenantId, "CATEGORY", current.code) } },
    auditPut(tenantId, { action: "category.deleted", entityType: "category", entityId: id, reason: "Category deleted", actorId: actor.id, actorName: actor.name }, now),
  ] }));
};

export const createProduct = async (
  tenantId: string,
  input: Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "sellingPrice" | "buyingPrice" | "baseUnit" | "tracksExpiry"> & { saleVariants?: SaleVariantRecord[]; promotionPrice?: number | null; promotionStartsAt?: string | null; promotionEndsAt?: string | null },
  actor: { id: string; name: string },
) => {
  const category = await getCategory(tenantId, input.categoryId);
  if (!category || category.status !== "active") throw new Error("Select an active category");
  const id = randomUUID();
  const now = new Date().toISOString();
  const provisional = { id, ...input, name: input.name.trim(), description: input.description.trim(), baseUnit: input.baseUnit.trim().toLowerCase(), sku: normalizeLookup(input.sku), barcode: normalizeLookup(input.barcode), categoryName: category.name, status: "active" as const, createdAt: now, updatedAt: now };
  const saleVariants = validateVariants(input.saleVariants?.length ? input.saleVariants : [defaultVariant(provisional)]);
  const product: ProductRecord = { ...provisional, sellingPrice: saleVariants[0].sellingPrice, saleVariants };
  const item = { ...productKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${product.name.toLowerCase()}#${id}`, entityType: "product", tenantId, ...product };
  const lookupItems = [...productAliases(product).values()].map((alias) => ({ ...lookupKey(tenantId, alias.kind, alias.value), entityType: "product_lookup", tenantId, productId: id, variantId: alias.variantId }));
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    ...lookupItems.map((lookup) => ({ Put: { TableName: TABLE_NAME, Item: lookup, ConditionExpression: "attribute_not_exists(partitionKey)" } })),
    auditPut(tenantId, { action: "product.created", entityType: "product", entityId: id, productName: product.name, quantityBefore: 0, quantityAfter: 0, quantityDelta: 0, reason: "Product created without stock", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return product;
};

export const updateProduct = async (
  tenantId: string,
  id: string,
  updates: Partial<Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "sellingPrice" | "buyingPrice" | "baseUnit" | "tracksExpiry" | "saleVariants" | "promotionPrice" | "promotionStartsAt" | "promotionEndsAt" | "status">>,
  actor: { id: string; name: string },
) => {
  const current = await getProduct(tenantId, id);
  if (!current) throw new Error("Product not found");
  const categoryId = updates.categoryId ?? current.categoryId;
  const category = await getCategory(tenantId, categoryId);
  if (!category) throw new Error("Category not found");
  const now = new Date().toISOString();
  const saleVariants = validateVariants(updates.saleVariants ?? variantsOf(current));
  const sellingPrice = updates.saleVariants ? saleVariants[0].sellingPrice : updates.sellingPrice ?? current.sellingPrice;
  const buyingPrice = updates.buyingPrice ?? current.buyingPrice;
  const next: ProductRecord = { ...current, ...updates, saleVariants, sellingPrice, buyingPrice, baseUnit: (updates.baseUnit ?? current.baseUnit).trim().toLowerCase(), tracksExpiry: updates.tracksExpiry ?? current.tracksExpiry, sku: normalizeLookup(updates.sku ?? current.sku), barcode: normalizeLookup(updates.barcode ?? current.barcode), categoryId, categoryName: category.name, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  const oldAliases = productAliases(current); const newAliases = productAliases(next);
  for (const [key, alias] of oldAliases) if (!newAliases.has(key)) transaction.push({ Delete: { TableName: TABLE_NAME, Key: lookupKey(tenantId, alias.kind, alias.value) } });
  for (const [key, alias] of newAliases) if (!oldAliases.has(key)) transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...lookupKey(tenantId, alias.kind, alias.value), entityType: "product_lookup", tenantId, productId: id, variantId: alias.variantId }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  transaction.push(
    { Put: { TableName: TABLE_NAME, Item: { ...productKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${next.name.toLowerCase()}#${id}`, entityType: "product", tenantId, ...next }, ConditionExpression: "attribute_exists(partitionKey)" } },
    auditPut(tenantId, {
      action: current.sellingPrice !== next.sellingPrice ? "product.price.updated" : "product.updated",
      entityType: "product",
      entityId: id,
      productName: next.name,
      reason: current.sellingPrice !== next.sellingPrice
        ? `Selling price changed from ${current.sellingPrice.toFixed(2)} to ${next.sellingPrice.toFixed(2)}`
        : "Product details updated",
      actorId: actor.id,
      actorName: actor.name,
    }, now),
  );
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return next;
};

export const getCashShift = async (tenantId: string, id: string) => stripKeys<CashShiftRecord>((await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: cashShiftKey(tenantId, id) }))).Item);
export const getOpenCashShift = async (tenantId: string, storeId: string, cashierId: string) => {
  const lookup = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: openCashShiftKey(tenantId, storeId, cashierId) }));
  return lookup.Item?.shiftId ? getCashShift(tenantId, String(lookup.Item.shiftId)) : null;
};
export const listCashShifts = (tenantId: string, limit = 100, range?: { from?: string; to?: string; storeId?: string }) => queryCollection<CashShiftRecord>(tenantId, "CASH_SHIFT", { limit, from: range?.from, to: range?.to }).then((shifts) => range?.storeId ? shifts.filter((shift) => shift.storeId === range.storeId) : shifts);
export const openCashShift = async (tenantId: string, store: { id: string; name: string }, openingFloat: number, actor: { id: string; name: string }, requestId: string) => {
  if (!Number.isFinite(openingFloat) || openingFloat < 0) throw new Error("Opening float must be zero or greater"); const payload = { storeId: store.id, openingFloat }; const previous = await existingIdempotentResult<CashShiftRecord>(tenantId, "open_cash_shift", requestId, payload); if (previous) return previous;
  if (await getOpenCashShift(tenantId, store.id, actor.id)) throw new Error("This cashier already has an open shift in this store"); const now = new Date().toISOString(); const id = randomUUID(); const shift: CashShiftRecord = { id, shiftNumber: `SHIFT-${businessDate().replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, storeId: store.id, storeName: store.name, cashierId: actor.id, cashierName: actor.name, status: "open", openingFloat: roundMoney(openingFloat), cashSalesTotal: 0, cashInTotal: 0, cashOutTotal: 0, openedAt: now, updatedAt: now };
  return commitIdempotent(tenantId, "open_cash_shift", requestId, payload, shift, [{ Put: { TableName: TABLE_NAME, Item: { ...cashShiftKey(tenantId, id), accessPartition: tenantKey(tenantId, "CASH_SHIFT"), accessSort: `${now}#${id}`, entityType: "cash_shift", tenantId, ...shift }, ConditionExpression: "attribute_not_exists(partitionKey)" } }, { Put: { TableName: TABLE_NAME, Item: { ...openCashShiftKey(tenantId, store.id, actor.id), entityType: "open_cash_shift", tenantId, shiftId: id }, ConditionExpression: "attribute_not_exists(partitionKey)" } }]);
};
export const recordCashMovement = async (tenantId: string, shiftId: string, type: "cash_in" | "cash_out", amount: number, reason: string, actor: { id: string; name: string }, requestId: string) => {
  const payload = { shiftId, type, amount, reason }; const previous = await existingIdempotentResult<CashMovementRecord>(tenantId, "cash_movement", requestId, payload); if (previous) return previous; if (!Number.isFinite(amount) || amount <= 0) throw new Error("Cash movement amount must be greater than zero"); if (reason.trim().length < 3) throw new Error("A cash movement reason is required"); const shift = await getCashShift(tenantId, shiftId); if (!shift || shift.status !== "open") throw new Error("Cash shift is not open"); const now = new Date().toISOString(); const id = randomUUID(); const movement: CashMovementRecord = { id, shiftId, storeId: shift.storeId, type, amount: roundMoney(amount), reason: reason.trim(), actorId: actor.id, actorName: actor.name, createdAt: now }; const field = type === "cash_in" ? "cashInTotal" : "cashOutTotal";
  return commitIdempotent(tenantId, "cash_movement", requestId, payload, movement, [{ Update: { TableName: TABLE_NAME, Key: cashShiftKey(tenantId, shiftId), UpdateExpression: `SET ${field} = ${field} + :amount, updatedAt = :now`, ConditionExpression: "#status = :open", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":amount": movement.amount, ":now": now, ":open": "open" } } }, { Put: { TableName: TABLE_NAME, Item: { partitionKey: tenantKey(tenantId, `CASH_MOVEMENT#${id}`), sortKey: "EVENT", accessPartition: tenantKey(tenantId, "CASH_MOVEMENT"), accessSort: `${now}#${id}`, entityType: "cash_movement", tenantId, ...movement }, ConditionExpression: "attribute_not_exists(partitionKey)" } }]);
};
export const closeCashShift = async (tenantId: string, id: string, countedCash: number, actor: { id: string; name: string }, requestId: string) => { const payload = { id, countedCash }; const previous = await existingIdempotentResult<CashShiftRecord>(tenantId, "close_cash_shift", requestId, payload); if (previous) return previous; if (!Number.isFinite(countedCash) || countedCash < 0) throw new Error("Counted cash must be zero or greater"); const shift = await getCashShift(tenantId, id); if (!shift || shift.status !== "open") throw new Error("Cash shift is not open"); if (shift.cashierId !== actor.id) throw new Error("Only the shift cashier can close this shift"); const now = new Date().toISOString(); const expectedCash = roundMoney(shift.openingFloat + shift.cashSalesTotal + shift.cashInTotal - shift.cashOutTotal); const closed: CashShiftRecord = { ...shift, status: "closed", expectedCash, countedCash: roundMoney(countedCash), variance: roundMoney(countedCash - expectedCash), closedAt: now, updatedAt: now }; return commitIdempotent(tenantId, "close_cash_shift", requestId, payload, closed, [{ Put: { TableName: TABLE_NAME, Item: { ...cashShiftKey(tenantId, id), accessPartition: tenantKey(tenantId, "CASH_SHIFT"), accessSort: `${shift.openedAt}#${id}`, entityType: "cash_shift", tenantId, ...closed }, ConditionExpression: "#status = :open AND updatedAt = :expected", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":open": "open", ":expected": shift.updatedAt } } }, { Delete: { TableName: TABLE_NAME, Key: openCashShiftKey(tenantId, shift.storeId, shift.cashierId), ConditionExpression: "shiftId = :id", ExpressionAttributeValues: { ":id": id } } }]); };

export const completeSale = async (
  tenantId: string,
  input: {
    storeId: string;
    customerName?: string;
    paymentMethod: "cash" | "mpesa";
    amountTendered?: number | null;
    mpesaReference?: string | null;
    items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
    requestId: string;
  },
  actor: { id: string; name: string; employeeCode?: string; storeName?: string },
) => {
  const previous = await existingIdempotentResult<SaleRecord>(tenantId, "complete_sale", input.requestId, input); if (previous) return previous;
  const grouped = new Map<string, { productId: string; variantId?: string | null; quantity: number }>();
  for (const item of input.items) { const key = `${item.productId}#${item.variantId ?? "default"}`; const current = grouped.get(key); grouped.set(key, { ...item, quantity: (current?.quantity ?? 0) + item.quantity }); }
  if (grouped.size === 0) throw new Error("Add at least one product to the sale");
  if (grouped.size > 40) throw new Error("A sale can contain at most 40 distinct variants");
  if ([...grouped.values()].some(({ quantity }) => !Number.isInteger(quantity) || quantity <= 0)) throw new Error("Sale quantities must be positive whole numbers");
  const productIds = [...new Set([...grouped.values()].map(({ productId }) => productId))];
  const products = await Promise.all(productIds.map((productId) => getProduct(tenantId, productId)));
  if (products.some((product) => !product || product.status !== "active")) throw new Error("One or more products are unavailable");
  const byProduct = new Map(products.map((product) => [product!.id, product!]));
  const resolvedItems = [...grouped.values()].map((item) => { const product = byProduct.get(item.productId)!; const variants = variantsOf(product).filter((variant) => variant.status === "active"); const variant = variants.find((candidate) => candidate.id === item.variantId) ?? (!item.variantId ? variants[0] : undefined); if (!variant) throw new Error(`${product.name} sale variant is unavailable`); return { ...item, product, variant, inventoryQuantity: item.quantity * variant.quantityInBaseUnits }; });
  const inventoryByProduct = new Map<string, number>(); for (const item of resolvedItems) inventoryByProduct.set(item.productId, (inventoryByProduct.get(item.productId) ?? 0) + item.inventoryQuantity);
  const now = new Date().toISOString();
  const id = randomUUID();
  const [allocations, cashShift, store, globalBranding] = await Promise.all([allocateLots(tenantId, input.storeId, [...inventoryByProduct].map(([productId, quantity]) => ({ productId, quantity }))), input.paymentMethod === "cash" ? getOpenCashShift(tenantId, input.storeId, actor.id) : Promise.resolve(null), getStore(tenantId, input.storeId), getBusinessSettings(tenantId)]);
  if (!store || store.status !== "active") throw new Error("Selected store is unavailable");
  if (input.paymentMethod === "cash" && !cashShift) throw new Error("Open a cash shift before accepting cash sales");
  const costPerBaseUnit = new Map([...inventoryByProduct].map(([productId, inventoryQuantity]) => [productId, roundMoney((allocations.get(productId) ?? []).reduce((sum, allocation) => sum + allocation.quantity * allocation.lot.unitCost, 0) / inventoryQuantity)]));
  const saleItems: SaleItemRecord[] = resolvedItems.map(({ product, variant, quantity, inventoryQuantity }) => { const defaultSale = variantsOf(product)[0]?.id === variant.id; const price = defaultSale ? effectiveProductPrice(product, new Date(now)) : variant.sellingPrice; const cost = roundMoney((costPerBaseUnit.get(product.id) ?? 0) * variant.quantityInBaseUnits); return { productId: product.id, productName: product.name, sku: variant.sku || product.sku, barcode: variant.barcode || product.barcode, variantId: variant.id, variantName: variant.name, quantityInBaseUnits: variant.quantityInBaseUnits, inventoryQuantity, quantity, price, regularPrice: variant.sellingPrice, promotionApplied: price < variant.sellingPrice, cost, total: roundMoney(price * quantity) }; });
  const subtotal = roundMoney(saleItems.reduce((sum, item) => sum + (item.regularPrice ?? item.price) * item.quantity, 0));
  const totalAmount = roundMoney(saleItems.reduce((sum, item) => sum + item.total, 0));
  const discount = roundMoney(subtotal - totalAmount);
  const receiptBranding: BusinessSettingsRecord = { ...globalBranding, businessName: store.receiptBusinessName?.trim() || globalBranding.businessName, address: store.receiptAddress?.trim() || store.address || globalBranding.address, phone: store.receiptPhone?.trim() || globalBranding.phone, email: store.receiptEmail?.trim() || globalBranding.email, thankYouMessage: store.receiptFooter?.trim() || globalBranding.thankYouMessage, returnPolicy: store.receiptReturnPolicy?.trim() || globalBranding.returnPolicy, storeName: store.name, updatedAt: now };
  let amountTendered: number | null = null;
  let changeDue: number | null = null;
  let paymentReference: string | null = null;
  if (input.paymentMethod === "cash") {
    if (!Number.isFinite(input.amountTendered) || (input.amountTendered ?? 0) < totalAmount) {
      throw new Error("Cash received must be at least the amount due");
    }
    amountTendered = roundMoney(input.amountTendered!);
    changeDue = roundMoney(amountTendered - totalAmount);
  } else {
    paymentReference = input.mpesaReference?.trim().toUpperCase() ?? "";
    if (!/^[A-Z0-9]{8,12}$/.test(paymentReference)) {
      throw new Error("Enter a valid M-Pesa transaction code (8 to 12 letters or numbers)");
    }
    const existingPayment = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: mpesaPaymentKey(tenantId, paymentReference) }));
    if (existingPayment.Item) throw new Error("This M-Pesa transaction code has already been used");
  }
  const sale: SaleRecord = {
    id,
    orderNumber: `SALE-${businessDate().replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`,
    customerName: input.customerName?.trim() || "Cash customer",
    items: saleItems,
    subtotal,
    tax: 0,
    discount,
    totalAmount,
    status: "completed",
    paymentMethod: input.paymentMethod,
    paymentStatus: "paid",
    amountTendered,
    changeDue,
    paymentReference,
    cashShiftId: cashShift?.id ?? null,
    createdBy: actor.id,
    createdByName: actor.name,
    storeId: input.storeId,
    storeName: store.name,
    cashierDisplayName: [actor.name.trim().split(/\s+/)[0], actor.employeeCode ? `(${actor.employeeCode})` : ""].filter(Boolean).join(" "),
    receiptBranding,
    createdAt: now,
    updatedAt: now,
  };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  for (const [productId] of inventoryByProduct) for (const allocation of allocations.get(productId) ?? []) transaction.push(
    lotDecrement(tenantId, allocation.lot, allocation.quantity, now),
    stockMovementPut(tenantId, { type: "sale", storeId: input.storeId, productId, productName: byProduct.get(productId)!.name, lotId: allocation.lot.id, quantity: -allocation.quantity, unitCost: allocation.lot.unitCost, reason: `Sale ${sale.orderNumber}`, referenceId: id, actorId: actor.id, actorName: actor.name }, now),
  );
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { partitionKey: tenantKey(tenantId, `SALE#${id}`), sortKey: "RECEIPT", accessPartition: tenantKey(tenantId, "SALE"), accessSort: `${now}#${id}`, entityType: "sale", tenantId, ...sale }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  if (paymentReference) {
    transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...mpesaPaymentKey(tenantId, paymentReference), entityType: "payment_lookup", tenantId, saleId: id, orderNumber: sale.orderNumber, createdAt: now }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  }
  if (cashShift) transaction.push({ Update: { TableName: TABLE_NAME, Key: cashShiftKey(tenantId, cashShift.id), UpdateExpression: "SET cashSalesTotal = cashSalesTotal + :amount, updatedAt = :now", ConditionExpression: "#status = :open", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":amount": totalAmount, ":now": now, ":open": "open" } } });
  if (transaction.length + 1 > 100) throw new Error("Sale uses too many inventory lots to complete atomically; reduce the basket size");
  return commitIdempotent(tenantId, "complete_sale", input.requestId, input, sale, transaction);
};

export const dashboardSummary = async (tenantId: string, requestedDays = 1, staffId?: string, includeDetails = true, storeId?: string) => {
  const days = Math.min(Math.max(requestedDays, 1), 90);
  const startDate = new Date(`${businessDate()}T00:00:00+03:00`);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const start = startDate.toISOString();
  const [catalogProducts, allSales, audits, stock] = await Promise.all([
    listProducts(tenantId),
    queryCollection<SaleRecord>(tenantId, "SALE", { from: start }),
    includeDetails ? listAudits(tenantId, 8) : Promise.resolve([]),
    storeId ? getStoreStock(tenantId, storeId) : Promise.resolve([]),
  ]);
  const byProduct = new Map(stock.map((item) => [item.productId, item]));
  const products = catalogProducts.map((product) => ({ ...product, storeStock: byProduct.get(product.id) }));
  const sales = staffId ? allSales.filter((sale) => sale.createdBy === staffId) : allSales;
  const revenue = roundMoney(sales.reduce((sum, sale) => sum + sale.totalAmount, 0));
  const unitsSold = sales.flatMap((sale) => sale.items).reduce((sum, item) => sum + item.quantity, 0);
  const grossProfit = roundMoney(sales.flatMap((sale) => sale.items).reduce(
    (sum, item) => sum + (item.price - item.cost) * item.quantity,
    0,
  ));
  const byCashier = new Map<string, { staffId: string; staffName: string; salesCount: number; unitsSold: number; revenue: number; grossProfit: number }>();
  for (const sale of sales) {
    const current = byCashier.get(sale.createdBy) ?? { staffId: sale.createdBy, staffName: sale.createdByName, salesCount: 0, unitsSold: 0, revenue: 0, grossProfit: 0 };
    current.salesCount += 1;
    current.unitsSold += sale.items.reduce((sum, item) => sum + item.quantity, 0);
    current.revenue = roundMoney(current.revenue + sale.totalAmount);
    current.grossProfit = roundMoney(current.grossProfit + sale.items.reduce((sum, item) => sum + (item.price - item.cost) * item.quantity, 0));
    byCashier.set(sale.createdBy, current);
  }
  const lowStock = products
    .filter((product) => product.status === "active" && product.storeStock && product.storeStock.quantity <= product.storeStock.reorderPoint)
    .sort((a, b) => (a.storeStock!.quantity - a.storeStock!.reorderPoint) - (b.storeStock!.quantity - b.storeStock!.reorderPoint));
  return {
    periodDays: days,
    periodStart: start,
    revenue,
    grossProfit,
    averageSale: sales.length ? roundMoney(revenue / sales.length) : 0,
    unitsSold,
    salesTotal: revenue,
    salesCount: sales.length,
    itemsSold: unitsSold,
    productCount: products.filter((product) => product.status === "active").length,
    lowStockCount: lowStock.length,
    lowStock: lowStock.slice(0, 8),
    recentSales: [...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    recentAudits: audits.slice(0, 6),
    cashierPerformance: [...byCashier.values()].sort((a, b) => b.revenue - a.revenue),
  };
};

export const businessReport = async (tenantId: string, range: { from: string; to: string; storeId?: string }): Promise<BusinessReportRecord> => {
  const [catalogProducts, sales, audits, stores] = await Promise.all([
    listProducts(tenantId),
    queryCollection<SaleRecord>(tenantId, "SALE", range),
    queryCollection<AuditRecord>(tenantId, "AUDIT", range),
    listInventoryStores(tenantId),
  ]);
  const selectedStores = range.storeId ? stores.filter((store) => store.id === range.storeId) : stores;
  const [lots, storePositions] = await Promise.all([
    Promise.all(selectedStores.map((store) => sellableLots(tenantId, store.id))).then((values) => values.flat()),
    Promise.all(selectedStores.map((store) => getStoreStock(tenantId, store.id))).then((values) => values.flat()),
  ]);
  const filteredSales = range.storeId ? sales.filter((sale) => sale.storeId === range.storeId) : sales;
  const quantityByProduct = new Map<string, number>();
  const valueByProduct = new Map<string, number>();
  for (const lot of lots) { quantityByProduct.set(lot.productId, (quantityByProduct.get(lot.productId) ?? 0) + lot.remainingQuantity); valueByProduct.set(lot.productId, roundMoney((valueByProduct.get(lot.productId) ?? 0) + lot.remainingQuantity * lot.unitCost)); }
  const reorderByProduct = new Map<string, number>();
  for (const position of storePositions) reorderByProduct.set(position.productId, (reorderByProduct.get(position.productId) ?? 0) + position.reorderPoint);
  const products = catalogProducts.map((product) => ({ ...product, quantity: quantityByProduct.get(product.id) ?? 0, reorderPoint: reorderByProduct.get(product.id) }));
  const productTotals = new Map<string, ReportProductRecord>();
  const promotionTotals = new Map<string, ReportProductRecord>();
  let promotionUnitsSold = 0;
  let promotionRevenue = 0;
  let promotionSavings = 0;
  for (const sale of filteredSales) {
    for (const item of sale.items) {
      const current = productTotals.get(item.productId) ?? { productId: item.productId, productName: item.productName, units: 0, revenue: 0, grossProfit: 0, savings: 0 };
      current.units += item.quantity;
      current.revenue = roundMoney(current.revenue + item.total);
      current.grossProfit = roundMoney(current.grossProfit + (item.price - item.cost) * item.quantity);
      productTotals.set(item.productId, current);
      if (item.promotionApplied) {
        const saving = roundMoney(((item.regularPrice ?? item.price) - item.price) * item.quantity);
        promotionUnitsSold += item.quantity;
        promotionRevenue = roundMoney(promotionRevenue + item.total);
        promotionSavings = roundMoney(promotionSavings + saving);
        const promotional = promotionTotals.get(item.productId) ?? { productId: item.productId, productName: item.productName, units: 0, revenue: 0, grossProfit: 0, savings: 0 };
        promotional.units += item.quantity;
        promotional.revenue = roundMoney(promotional.revenue + item.total);
        promotional.grossProfit = roundMoney(promotional.grossProfit + (item.price - item.cost) * item.quantity);
        promotional.savings = roundMoney(promotional.savings + saving);
        promotionTotals.set(item.productId, promotional);
      }
    }
  }
  const stockAdjustments = audits.filter(({ action }) => action === "stock.adjusted");
  const priceChanges = audits.filter(({ action }) => action === "product.price.updated");
  const revenue = roundMoney(filteredSales.reduce((sum, sale) => sum + sale.totalAmount, 0));
  const grossProfit = roundMoney(filteredSales.flatMap(({ items }) => items).reduce((sum, item) => sum + (item.price - item.cost) * item.quantity, 0));
  const stockCostValue = roundMoney([...valueByProduct.values()].reduce((sum, value) => sum + value, 0));
  const stockRetailValue = roundMoney(products.reduce((sum, product) => sum + product.quantity * product.sellingPrice, 0));
  return {
    from: range.from,
    to: range.to,
    salesCount: filteredSales.length,
    revenue,
    grossProfit,
    unitsSold: filteredSales.flatMap(({ items }) => items).reduce((sum, item) => sum + item.quantity, 0),
    promotionUnitsSold,
    promotionRevenue,
    promotionSavings,
    stockUnits: products.reduce((sum, product) => sum + product.quantity, 0),
    stockCostValue,
    stockRetailValue,
    potentialMargin: roundMoney(stockRetailValue - stockCostValue),
    lowStockCount: products.filter((product) => product.status === "active" && product.reorderPoint !== undefined && product.quantity <= product.reorderPoint).length,
    outOfStockCount: products.filter((product) => product.status === "active" && product.quantity === 0).length,
    netStockAdjustment: stockAdjustments.reduce((sum, audit) => sum + (audit.quantityDelta ?? 0), 0),
    stockAdjustmentCount: stockAdjustments.length,
    priceChangeCount: priceChanges.length,
    topProducts: [...productTotals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20),
    promotionProducts: [...promotionTotals.values()].sort((a, b) => b.revenue - a.revenue),
    stockProducts: products.map((product) => ({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity: product.quantity,
      reorderPoint: product.reorderPoint ?? 0,
      actualCostValue: valueByProduct.get(product.id) ?? 0,
      sellingPrice: product.sellingPrice,
      retailValue: roundMoney(product.quantity * product.sellingPrice),
      status: product.status,
    })).sort((a, b) => Number(a.quantity > a.reorderPoint) - Number(b.quantity > b.reorderPoint) || a.productName.localeCompare(b.productName)),
    stockAdjustments: stockAdjustments.slice(0, 100),
    priceChanges: priceChanges.slice(0, 100),
  };
};

export const getStaffProfile = async (tenantId: string, userId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: profileKey(tenantId, userId) }));
  const profile = stripKeys<StaffProfileRecord>(response.Item);
  return profile;
};

export const getStaffProfiles = async (tenantId: string, userIds: string[]) => {
  if (userIds.length === 0) return new Map<string, StaffProfileRecord>();
  const items: Record<string, unknown>[] = [];
  const keys = [...new Set(userIds)].map((userId) => profileKey(tenantId, userId));
  for (let offset = 0; offset < keys.length; offset += 100) {
    let pending = keys.slice(offset, offset + 100);
    for (let attempt = 0; pending.length && attempt < 3; attempt += 1) {
      const response = await dynamoDB.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: pending } } }));
      items.push(...(response.Responses?.[TABLE_NAME] ?? []));
      pending = (response.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? []) as typeof pending;
      if (pending.length && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
      }
    }
    if (pending.length) throw new Error("Unable to load all staff profiles; try again");
  }
  return new Map(items.map((item) => {
    const profile = stripKeys<StaffProfileRecord>(item)!;
    return [profile.userId, profile];
  }));
};

export const upsertStaffProfile = async (
  tenantId: string,
  userId: string,
  input: Pick<StaffProfileRecord, "employeeCode" | "jobTitle" | "phone"> & Pick<StaffProfileRecord, "storeId" | "storeName"> & { storeIds?: string[] },
) => {
  const current = await getStaffProfile(tenantId, userId);
  const now = new Date().toISOString();
  const primaryStoreId = input.storeId ?? current?.storeId; const storeIds = [...new Set([primaryStoreId, ...(input.storeIds ?? current?.storeIds ?? [])].filter((value): value is string => Boolean(value)))];
  const profile: StaffProfileRecord = { userId, employeeCode: input.employeeCode.trim(), jobTitle: input.jobTitle.trim(), storeId: primaryStoreId, storeName: input.storeName ?? current?.storeName, storeIds, phone: input.phone.trim(), createdAt: current?.createdAt ?? now, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE_NAME, Item: { ...profileKey(tenantId, userId), entityType: "staff_profile", tenantId, ...profile } } }] }));
  return profile;
};

export const deleteStaffProfile = async (tenantId: string, userId: string) => {
  await dynamoDB.send(new DeleteCommand({ TableName: TABLE_NAME, Key: profileKey(tenantId, userId) }));
};
