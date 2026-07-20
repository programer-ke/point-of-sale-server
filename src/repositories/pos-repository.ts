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
import { allocateLots, listStores as listInventoryStores, lotDecrement, sellableLots, stockMovementPut, storeStock as getStoreStock } from "./supply-chain-repository";

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
  /** Compatibility aliases retained while old sale snapshots are readable. */
  price: number;
  cost: number;
  promotionPrice?: number | null;
  promotionStartsAt?: string | null;
  promotionEndsAt?: string | null;
  stock: number;
  minStock: number;
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
  updatedAt: string;
}

export type BusinessBrandingInput = Omit<BusinessSettingsRecord, "updatedAt">;

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
  stock: number;
  minStock: number;
  cost: number;
  price: number;
  costValue: number;
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
const businessSettingsKey = (tenantId: string) => ({ partitionKey: tenantKey(tenantId, "SETTINGS#BUSINESS"), sortKey: "PROFILE" });
const defaultBusinessSettings: BusinessSettingsRecord = {
  businessName: "Tomkondi Supermarket",
  address: "Nairobi, Kenya",
  phone: "",
  email: "",
  thankYouMessage: "Thank you for shopping with us.",
  returnPolicy: "Goods once sold cannot be returned.",
  updatedAt: new Date(0).toISOString(),
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
const normalizeProductRecord = (product: ProductRecord): ProductRecord => ({
  ...product,
  sellingPrice: product.sellingPrice ?? product.price,
  buyingPrice: product.buyingPrice ?? product.cost,
  baseUnit: product.baseUnit ?? "unit",
  tracksExpiry: product.tracksExpiry ?? false,
  price: product.sellingPrice ?? product.price,
  cost: product.buyingPrice ?? product.cost,
  stock: 0,
  minStock: 0,
});
export const listProducts = (tenantId: string) => queryCollection<ProductRecord>(tenantId, "CATALOG#PRODUCT").then((products) => products.map(normalizeProductRecord));
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
  const offsetValue = options.cursor
    ? Number.parseInt(Buffer.from(options.cursor, "base64url").toString("utf8"), 10)
    : 0;
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const products = (await listProducts(tenantId)).filter((product) => {
    if (options.activeOnly && product.status !== "active") return false;
    if (!search) return true;
    return [product.name, product.sku, product.barcode, product.categoryName]
      .some((value) => value.toLowerCase().includes(search));
  });
  const end = Math.min(offset + limit, products.length);
  return {
    items: products.slice(offset, end),
    totalCount: products.length,
    nextCursor: end < products.length ? Buffer.from(String(end)).toString("base64url") : null,
  };
};

export const getCategory = async (tenantId: string, id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: categoryKey(tenantId, id) }));
  return stripKeys<CategoryRecord>(response.Item);
};

export const getProduct = async (tenantId: string, id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: productKey(tenantId, id) }));
  const product = stripKeys<ProductRecord>(response.Item);
  return product ? normalizeProductRecord(product) : null;
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
  return settings ?? defaultBusinessSettings;
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
  if (typeof promotionalPrice !== "number" || promotionalPrice < 0 || promotionalPrice >= product.price) {
    return product.price;
  }
  const timestamp = at.getTime();
  const startsAt = product.promotionStartsAt ? Date.parse(product.promotionStartsAt) : Number.NEGATIVE_INFINITY;
  const endsAt = product.promotionEndsAt ? Date.parse(product.promotionEndsAt) : Number.POSITIVE_INFINITY;
  return timestamp >= startsAt && timestamp <= endsAt ? promotionalPrice : product.price;
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
  input: Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "sellingPrice" | "buyingPrice" | "baseUnit" | "tracksExpiry"> & { promotionPrice?: number | null; promotionStartsAt?: string | null; promotionEndsAt?: string | null },
  actor: { id: string; name: string },
) => {
  const category = await getCategory(tenantId, input.categoryId);
  if (!category || category.status !== "active") throw new Error("Select an active category");
  const id = randomUUID();
  const now = new Date().toISOString();
  const product: ProductRecord = { id, ...input, name: input.name.trim(), description: input.description.trim(), baseUnit: input.baseUnit.trim(), sku: normalizeLookup(input.sku), barcode: normalizeLookup(input.barcode), categoryName: category.name, price: input.sellingPrice, cost: input.buyingPrice, stock: 0, minStock: 0, status: "active", createdAt: now, updatedAt: now };
  const item = { ...productKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${product.name.toLowerCase()}#${id}`, entityType: "product", tenantId, ...product };
  const lookupItems = [
    { ...lookupKey(tenantId, "SKU", product.sku), entityType: "product_lookup", tenantId, productId: id },
    ...(product.barcode && product.barcode !== product.sku ? [{ ...lookupKey(tenantId, "BARCODE", product.barcode), entityType: "product_lookup", tenantId, productId: id }] : []),
  ];
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
  updates: Partial<Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "sellingPrice" | "buyingPrice" | "baseUnit" | "tracksExpiry" | "promotionPrice" | "promotionStartsAt" | "promotionEndsAt" | "status">>,
  actor: { id: string; name: string },
) => {
  const current = await getProduct(tenantId, id);
  if (!current) throw new Error("Product not found");
  const categoryId = updates.categoryId ?? current.categoryId;
  const category = await getCategory(tenantId, categoryId);
  if (!category) throw new Error("Category not found");
  const now = new Date().toISOString();
  const sellingPrice = updates.sellingPrice ?? current.sellingPrice ?? current.price;
  const buyingPrice = updates.buyingPrice ?? current.buyingPrice ?? current.cost;
  const next: ProductRecord = { ...current, ...updates, sellingPrice, buyingPrice, price: sellingPrice, cost: buyingPrice, baseUnit: updates.baseUnit ?? current.baseUnit ?? "unit", tracksExpiry: updates.tracksExpiry ?? current.tracksExpiry ?? false, sku: normalizeLookup(updates.sku ?? current.sku), barcode: normalizeLookup(updates.barcode ?? current.barcode), categoryId, categoryName: category.name, stock: 0, minStock: 0, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  const aliases = [
    { kind: "SKU" as const, oldValue: current.sku, newValue: next.sku },
    { kind: "BARCODE" as const, oldValue: current.barcode, newValue: next.barcode },
  ];
  for (const alias of aliases) {
    if (alias.oldValue === alias.newValue || !alias.newValue) continue;
    if (alias.oldValue) transaction.push({ Delete: { TableName: TABLE_NAME, Key: lookupKey(tenantId, alias.kind, alias.oldValue) } });
    transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...lookupKey(tenantId, alias.kind, alias.newValue), entityType: "product_lookup", tenantId, productId: id }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  }
  transaction.push(
    { Put: { TableName: TABLE_NAME, Item: { ...productKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${next.name.toLowerCase()}#${id}`, entityType: "product", tenantId, ...next }, ConditionExpression: "attribute_exists(partitionKey)" } },
    auditPut(tenantId, {
      action: (current.sellingPrice ?? current.price) !== next.sellingPrice ? "product.price.updated" : "product.updated",
      entityType: "product",
      entityId: id,
      productName: next.name,
      reason: (current.sellingPrice ?? current.price) !== next.sellingPrice
        ? `Selling price changed from ${(current.sellingPrice ?? current.price).toFixed(2)} to ${next.sellingPrice.toFixed(2)}`
        : "Product details updated",
      actorId: actor.id,
      actorName: actor.name,
    }, now),
  );
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return next;
};

export const completeSale = async (
  tenantId: string,
  input: {
    storeId: string;
    customerName?: string;
    paymentMethod: "cash" | "mpesa";
    amountTendered?: number | null;
    mpesaReference?: string | null;
    items: Array<{ productId: string; quantity: number }>;
  },
  actor: { id: string; name: string; employeeCode?: string; storeName?: string },
) => {
  const grouped = new Map<string, number>();
  for (const item of input.items) grouped.set(item.productId, (grouped.get(item.productId) ?? 0) + item.quantity);
  if (grouped.size === 0) throw new Error("Add at least one product to the sale");
  if (grouped.size > 40) throw new Error("A sale can contain at most 40 distinct products");
  if ([...grouped.values()].some((quantity) => !Number.isInteger(quantity) || quantity <= 0)) throw new Error("Sale quantities must be positive whole numbers");
  const products = await Promise.all([...grouped.keys()].map((id) => getProduct(tenantId, id)));
  if (products.some((product) => !product || product.status !== "active")) throw new Error("One or more products are unavailable");
  const now = new Date().toISOString();
  const id = randomUUID();
  const allocations = await allocateLots(tenantId, input.storeId, [...grouped].map(([productId, quantity]) => ({ productId, quantity })));
  const saleItems: SaleItemRecord[] = products.map((product) => {
    const value = product!;
    const quantity = grouped.get(value.id)!;
    const price = effectiveProductPrice(value, new Date(now));
    const cost = roundMoney((allocations.get(value.id) ?? []).reduce((sum, allocation) => sum + allocation.quantity * allocation.lot.unitCost, 0) / quantity);
    return { productId: value.id, productName: value.name, sku: value.sku, barcode: value.barcode, quantity, price, regularPrice: value.sellingPrice ?? value.price, promotionApplied: price < (value.sellingPrice ?? value.price), cost, total: roundMoney(price * quantity) };
  });
  const subtotal = roundMoney(products.reduce((sum, product) => {
    const value = product!;
    return sum + (value.sellingPrice ?? value.price) * grouped.get(value.id)!;
  }, 0));
  const totalAmount = roundMoney(saleItems.reduce((sum, item) => sum + item.total, 0));
  const discount = roundMoney(subtotal - totalAmount);
  const receiptBranding = await getBusinessSettings(tenantId);
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
    createdBy: actor.id,
    createdByName: actor.name,
    storeId: input.storeId,
    storeName: actor.storeName?.trim() || null,
    cashierDisplayName: [actor.name.trim().split(/\s+/)[0], actor.employeeCode ? `(${actor.employeeCode})` : ""].filter(Boolean).join(" "),
    receiptBranding,
    createdAt: now,
    updatedAt: now,
  };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  for (const item of saleItems) for (const allocation of allocations.get(item.productId) ?? []) transaction.push(
    lotDecrement(tenantId, allocation.lot, allocation.quantity, now),
    stockMovementPut(tenantId, { type: "sale", storeId: input.storeId, productId: item.productId, productName: item.productName, lotId: allocation.lot.id, quantity: -allocation.quantity, unitCost: allocation.lot.unitCost, reason: `Sale ${sale.orderNumber}`, referenceId: id, actorId: actor.id, actorName: actor.name }, now),
  );
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { partitionKey: tenantKey(tenantId, `SALE#${id}`), sortKey: "RECEIPT", accessPartition: tenantKey(tenantId, "SALE"), accessSort: `${now}#${id}`, entityType: "sale", tenantId, ...sale }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  if (paymentReference) {
    transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...mpesaPaymentKey(tenantId, paymentReference), entityType: "payment_lookup", tenantId, saleId: id, orderNumber: sale.orderNumber, createdAt: now }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  }
  if (transaction.length > 100) throw new Error("Sale uses too many inventory lots to complete atomically; reduce the basket size");
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return sale;
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
  const products = catalogProducts.map((product) => ({ ...product, stock: byProduct.get(product.id)?.quantity ?? 0, minStock: byProduct.get(product.id)?.reorderPoint ?? 0 }));
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
    .filter((product) => product.status === "active" && product.stock <= product.minStock)
    .sort((a, b) => (a.stock - a.minStock) - (b.stock - b.minStock));
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

export const businessReport = async (tenantId: string, range: { from: string; to: string }): Promise<BusinessReportRecord> => {
  const [catalogProducts, sales, audits, stores] = await Promise.all([
    listProducts(tenantId),
    queryCollection<SaleRecord>(tenantId, "SALE", range),
    queryCollection<AuditRecord>(tenantId, "AUDIT", range),
    listInventoryStores(tenantId),
  ]);
  const lots = (await Promise.all(stores.map((store) => sellableLots(tenantId, store.id)))).flat();
  const quantityByProduct = new Map<string, number>();
  const valueByProduct = new Map<string, number>();
  for (const lot of lots) { quantityByProduct.set(lot.productId, (quantityByProduct.get(lot.productId) ?? 0) + lot.remainingQuantity); valueByProduct.set(lot.productId, roundMoney((valueByProduct.get(lot.productId) ?? 0) + lot.remainingQuantity * lot.unitCost)); }
  const products = catalogProducts.map((product) => ({ ...product, stock: quantityByProduct.get(product.id) ?? 0 }));
  const productTotals = new Map<string, ReportProductRecord>();
  const promotionTotals = new Map<string, ReportProductRecord>();
  let promotionUnitsSold = 0;
  let promotionRevenue = 0;
  let promotionSavings = 0;
  for (const sale of sales) {
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
  const revenue = roundMoney(sales.reduce((sum, sale) => sum + sale.totalAmount, 0));
  const grossProfit = roundMoney(sales.flatMap(({ items }) => items).reduce((sum, item) => sum + (item.price - item.cost) * item.quantity, 0));
  const stockCostValue = roundMoney([...valueByProduct.values()].reduce((sum, value) => sum + value, 0));
  const stockRetailValue = roundMoney(products.reduce((sum, product) => sum + product.stock * product.price, 0));
  return {
    from: range.from,
    to: range.to,
    salesCount: sales.length,
    revenue,
    grossProfit,
    unitsSold: sales.flatMap(({ items }) => items).reduce((sum, item) => sum + item.quantity, 0),
    promotionUnitsSold,
    promotionRevenue,
    promotionSavings,
    stockUnits: products.reduce((sum, product) => sum + product.stock, 0),
    stockCostValue,
    stockRetailValue,
    potentialMargin: roundMoney(stockRetailValue - stockCostValue),
    lowStockCount: products.filter((product) => product.status === "active" && product.stock <= product.minStock).length,
    outOfStockCount: products.filter((product) => product.status === "active" && product.stock === 0).length,
    netStockAdjustment: stockAdjustments.reduce((sum, audit) => sum + (audit.quantityDelta ?? 0), 0),
    stockAdjustmentCount: stockAdjustments.length,
    priceChangeCount: priceChanges.length,
    topProducts: [...productTotals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20),
    promotionProducts: [...promotionTotals.values()].sort((a, b) => b.revenue - a.revenue),
    stockProducts: products.map((product) => ({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      stock: product.stock,
      minStock: product.minStock,
      cost: product.cost,
      price: product.price,
      costValue: valueByProduct.get(product.id) ?? 0,
      retailValue: roundMoney(product.stock * product.price),
      status: product.status,
    })).sort((a, b) => Number(a.stock > a.minStock) - Number(b.stock > b.minStock) || a.productName.localeCompare(b.productName)),
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
  input: Pick<StaffProfileRecord, "employeeCode" | "jobTitle" | "phone"> & Pick<StaffProfileRecord, "storeId" | "storeName">,
) => {
  const current = await getStaffProfile(tenantId, userId);
  const now = new Date().toISOString();
  const profile: StaffProfileRecord = { userId, employeeCode: input.employeeCode.trim(), jobTitle: input.jobTitle.trim(), storeId: input.storeId ?? current?.storeId, storeName: input.storeName ?? current?.storeName, phone: input.phone.trim(), createdAt: current?.createdAt ?? now, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE_NAME, Item: { ...profileKey(tenantId, userId), entityType: "staff_profile", tenantId, ...profile } } }] }));
  return profile;
};

export const deleteStaffProfile = async (tenantId: string, userId: string) => {
  await dynamoDB.send(new DeleteCommand({ TableName: TABLE_NAME, Key: profileKey(tenantId, userId) }));
};
