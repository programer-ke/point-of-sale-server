import { randomUUID } from "crypto";
import { GraphQLError } from "graphql";
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
import { MEASUREMENT_UNITS, measurementUnit, STANDARD_MEASUREMENT_DEFINITIONS } from "../domain/measurements";
import { productUnitsToSaleVariants, validateProductUnits, type ProductUnitInput, type ProductUnitRecord } from "../domain/product-units";
import { inclusiveVatBreakdown, isVatClass, vatApplies, vatRateBasisPoints, type VatClass } from "../domain/vat";
import { allocateLots, commitIdempotent, existingIdempotentResult, getStore, listStores as listInventoryStores, lotDecrement, lotRemainingCostMinor, sellableLots, stockMovementPut, storeStock as getStoreStock } from "./supply-chain-repository";
import { nextTenantCode } from "./code-generator";

export interface SaleVariantRecord { id: string; name: string; sku: string; barcode: string; quantityInBaseUnits: number; sellingPrice: number; status: "active" | "inactive" }

export interface ProductPriceAdjustmentRecord {
  id: string;
  effectiveAt: string;
  reason: string;
  lines: Array<{ productUnitId: string; productUnitName: string; previousPrice: number; newPrice: number }>;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface CategoryRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  parentId?: string | null;
  parentName?: string | null;
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
  vatClass?: VatClass | null;
  baseUnit: string;
  stockUnit: string;
  tracksExpiry: boolean;
  saleVariants: SaleVariantRecord[];
  productUnits?: ProductUnitRecord[];
  promotionPrice?: number | null;
  promotionStartsAt?: string | null;
  promotionEndsAt?: string | null;
  priceAdjustment?: ProductPriceAdjustmentRecord | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  itemType?: "product" | "service";
  serviceComponents?: ServiceComponentRecord[];
}

export interface ServiceComponentRecord {
  productId: string;
  productName: string;
  quantity: number;
  stockUnit: string;
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
  priceBeforeOverride?: number;
  priceOverrideReason?: string;
  regularPrice?: number;
  promotionApplied?: boolean;
  cost: number;
  total: number;
  vatClass?: VatClass | null;
  vatRateBasisPoints?: number;
  taxableAmount?: number;
  vatAmount?: number;
  consumedComponents?: Array<{ productId: string; productName: string; quantity: number; unitCost: number; totalCost: number }>;
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
  paymentEvidence?: "manual" | "stk" | "c2b" | "stk_c2b" | null;
  paymentAmountKes?: number | null;
  paymentRoundingAdjustment?: number | null;
  mpesaPaymentId?: string | null;
  payerPhoneLast4?: string | null;
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
  vatRegistered: boolean;
  kraPin: string;
  vatEffectiveFrom?: string | null;
  withholdingVatAgent: boolean;
  updatedAt: string;
}

export interface PackageUnitLabelRecord {
  code: string;
  name: string;
  pluralName: string;
  symbol: string;
  status: "active" | "inactive";
}

export interface BusinessMeasurementSettingsRecord {
  standardUnits: Array<{ code: string; dimension: string; baseUnit: string; baseUnits: number }>;
  packageLabels: PackageUnitLabelRecord[];
  updatedAt: string;
}

export type CheckoutPaymentMethod = "cash" | "mpesa";

export interface BusinessCheckoutSettingsRecord {
  enabledPaymentMethods: CheckoutPaymentMethod[];
  defaultPaymentMethod: CheckoutPaymentMethod;
  requireCustomerName: boolean;
  allowStaffPriceOverrides: boolean;
  maxStaffPriceDiscountPercent: number;
  mpesaConfirmationMode: "manual_or_verified" | "verified_only";
  updatedAt: string;
}

export type BusinessBrandingInput = Pick<BusinessSettingsRecord, "businessName" | "address" | "phone" | "email" | "thankYouMessage" | "returnPolicy"> & Partial<Pick<BusinessSettingsRecord, "vatRegistered" | "kraPin" | "vatEffectiveFrom" | "withholdingVatAgent">>;

export interface ReportProductRecord {
  productId: string;
  productName: string;
  baseUnit: string;
  stockUnit: string;
  units: number;
  revenue: number;
  grossProfit: number;
  savings: number;
}

export interface StockReportProductRecord {
  productId: string;
  productName: string;
  sku: string;
  baseUnit: string;
  stockUnit: string;
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
const mpesaReceiptClaimKey = (reference: string) => ({ partitionKey: `MPESA_RECEIPT_CLAIM#${reference}`, sortKey: "CLAIM" });
const cashShiftKey = (tenantId: string, id: string) => ({ partitionKey: tenantKey(tenantId, `CASH_SHIFT#${id}`), sortKey: "PROFILE" });
const openCashShiftKey = (tenantId: string, storeId: string, cashierId: string) => ({ partitionKey: tenantKey(tenantId, `CASH_SHIFT_OPEN#${storeId}#${cashierId}`), sortKey: "PROFILE" });
const businessSettingsKey = (tenantId: string) => ({ partitionKey: tenantKey(tenantId, "SETTINGS#BUSINESS"), sortKey: "PROFILE" });
const measurementSettingsKey = (tenantId: string) => ({ partitionKey: tenantKey(tenantId, "SETTINGS#MEASUREMENTS"), sortKey: "PROFILE" });
const checkoutSettingsKey = (tenantId: string) => ({ partitionKey: tenantKey(tenantId, "SETTINGS#CHECKOUT"), sortKey: "PROFILE" });
const defaultBusinessSettings: BusinessSettingsRecord = {
  businessName: "My Business",
  address: "Nairobi, Kenya",
  phone: "",
  email: "",
  thankYouMessage: "Thank you for shopping with us.",
  returnPolicy: "Goods once sold cannot be returned.",
  storeName: "",
  vatRegistered: false,
  kraPin: "",
  vatEffectiveFrom: null,
  withholdingVatAgent: false,
  updatedAt: new Date(0).toISOString(),
};

const defaultCheckoutSettings: BusinessCheckoutSettingsRecord = {
  enabledPaymentMethods: ["cash", "mpesa"],
  defaultPaymentMethod: "cash",
  requireCustomerName: false,
  allowStaffPriceOverrides: false,
  maxStaffPriceDiscountPercent: 10,
  mpesaConfirmationMode: "manual_or_verified",
  updatedAt: new Date(0).toISOString(),
};

const defaultPackageLabels: PackageUnitLabelRecord[] = [
  ["pair", "Pair", "Pairs", "pr"], ["dozen", "Dozen", "Dozens", "doz"], ["pack", "Pack", "Packs", "pack"],
  ["tray", "Tray", "Trays", "tray"], ["crate", "Crate", "Crates", "crate"], ["carton", "Carton", "Cartons", "ctn"],
  ["case", "Case", "Cases", "case"], ["pallet", "Pallet", "Pallets", "pallet"],
].map(([code, name, pluralName, symbol]) => ({ code, name, pluralName, symbol, status: "active" as const }));

const normalizePackageCode = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const measurementSettings = (packageLabels = defaultPackageLabels, updatedAt = new Date(0).toISOString()): BusinessMeasurementSettingsRecord => ({
  standardUnits: STANDARD_MEASUREMENT_DEFINITIONS.map(({ code, dimension, baseUnit, baseUnits }) => ({ code, dimension, baseUnit, baseUnits })),
  packageLabels,
  updatedAt,
});

const itemTypeOf = (product: ProductRecord) => product.itemType ?? "product";
const defaultVariant = (product: Pick<ProductRecord, "id" | "name" | "sku" | "barcode" | "sellingPrice" | "stockUnit" | "itemType">): SaleVariantRecord => ({ id: `${product.id}-default`, name: product.itemType === "service" ? "Service" : `1 ${product.stockUnit}`, sku: product.sku, barcode: product.barcode, quantityInBaseUnits: product.itemType === "service" ? 1 : measurementUnit(product.stockUnit).baseUnits, sellingPrice: product.sellingPrice, status: "active" });
const variantsOf = (product: ProductRecord) => product.saleVariants?.length ? product.saleVariants : [defaultVariant(product)];
const legacyProductUnits = (product: ProductRecord): ProductUnitRecord[] => variantsOf(product).map((variant) => ({
  id: variant.id,
  labelCode: variant.quantityInBaseUnits === measurementUnit(product.stockUnit).baseUnits ? product.stockUnit : "pack",
  name: variant.name,
  parentUnitId: null,
  multiplier: 1,
  quantityInBaseUnits: variant.quantityInBaseUnits,
  sellable: true,
  purchasable: true,
  sellingPrice: variant.sellingPrice,
  sku: variant.sku,
  barcode: variant.barcode,
  status: variant.status,
}));
export const productUnitsOf = (product: ProductRecord) => product.productUnits?.length ? product.productUnits : legacyProductUnits(product);
const adjustmentIsEffective = (product: ProductRecord, at = new Date()) => Boolean(product.priceAdjustment && Date.parse(product.priceAdjustment.effectiveAt) <= at.getTime());
export const pendingPriceAdjustment = (product: ProductRecord, at = new Date()) => product.priceAdjustment && !adjustmentIsEffective(product, at) ? product.priceAdjustment : null;
export const regularVariantPrice = (product: ProductRecord, variantId: string, at = new Date()) => {
  const variant = variantsOf(product).find((candidate) => candidate.id === variantId);
  if (!variant) throw new Error("Product sale variant is unavailable");
  if (!adjustmentIsEffective(product, at)) return variant.sellingPrice;
  return product.priceAdjustment!.lines.find((line) => line.productUnitId === variantId)?.newPrice ?? variant.sellingPrice;
};
const materializeEffectiveAdjustment = (product: ProductRecord, at = new Date()): ProductRecord => {
  if (!adjustmentIsEffective(product, at)) return product;
  const prices = new Map(product.priceAdjustment!.lines.map((line) => [line.productUnitId, line.newPrice]));
  const saleVariants = variantsOf(product).map((variant) => ({ ...variant, sellingPrice: prices.get(variant.id) ?? variant.sellingPrice }));
  const productUnits = productUnitsOf(product).map((unit) => ({ ...unit, sellingPrice: unit.sellingPrice == null ? null : prices.get(unit.id) ?? unit.sellingPrice }));
  const { priceAdjustment: _priceAdjustment, ...withoutAdjustment } = product;
  return { ...withoutAdjustment, sellingPrice: saleVariants[0].sellingPrice, saleVariants, productUnits };
};
const weightedProductBaseCost = async (tenantId: string, productId: string, fallback: number) => {
  const stores = await listInventoryStores(tenantId);
  const stock = (await Promise.all(stores.map((store) => getStoreStock(tenantId, store.id)))).flat().filter((item) => item.productId === productId);
  const quantity = stock.reduce((sum, item) => sum + item.quantity, 0);
  return quantity > 0 ? stock.reduce((sum, item) => sum + item.inventoryValue, 0) / quantity : fallback;
};
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
  const { partitionKey, sortKey: _sortKey, accessPartition: _accessPartition, accessSort: _accessSort, entityType, recordType, ...record } = item;
  if (recordType === "audit") return { ...record, entityType } as T;
  if (entityType === "audit" && typeof record.id !== "string") {
    const marker = "#AUDIT#";
    const storedKey = typeof partitionKey === "string" ? partitionKey : "";
    const markerIndex = storedKey.lastIndexOf(marker);
    const id = markerIndex >= 0 ? storedKey.slice(markerIndex + marker.length) : "";
    if (!id) throw new Error("Audit record is missing an identifier");
    return { ...record, id, entityType: record.action === "stock.opening_recorded" ? "opening_stock" : "audit" } as T;
  }
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
          : options?.to
            ? "accessPartition = :pk AND accessSort <= :to"
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
export const listCatalogItems = (tenantId: string) => queryCollection<ProductRecord>(tenantId, "CATALOG#PRODUCT").then((products) => products.map((product) => materializeEffectiveAdjustment({ ...product, itemType: itemTypeOf(product), saleVariants: variantsOf(product) })));
export const listProducts = (tenantId: string) => listCatalogItems(tenantId).then((products) => products.filter((product) => itemTypeOf(product) === "product"));
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
        : range?.from
          ? "accessPartition = :pk AND accessSort >= :from"
          : range?.to
            ? "accessPartition = :pk AND accessSort <= :to"
            : "accessPartition = :pk",
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
  includeServices?: boolean;
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
    products.push(...(response.Items ?? []).map((item) => { const product = stripKeys<ProductRecord>(item)!; return { ...product, itemType: itemTypeOf(product), saleVariants: variantsOf(product) }; }).filter((product) => {
      if (!options.includeServices && itemTypeOf(product) === "service") return false;
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
  return product ? { ...product, itemType: itemTypeOf(product), saleVariants: variantsOf(product) } : null;
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

export const getBusinessMeasurementSettings = async (tenantId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: measurementSettingsKey(tenantId) }));
  const stored = stripKeys<{ packageLabels?: PackageUnitLabelRecord[]; updatedAt?: string }>(response.Item);
  return measurementSettings(stored?.packageLabels?.length ? stored.packageLabels : defaultPackageLabels, stored?.updatedAt);
};

export const getBusinessCheckoutSettings = async (tenantId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: checkoutSettingsKey(tenantId) }));
  const stored = stripKeys<Partial<BusinessCheckoutSettingsRecord>>(response.Item);
  const enabledPaymentMethods = (stored?.enabledPaymentMethods ?? defaultCheckoutSettings.enabledPaymentMethods)
    .filter((method): method is CheckoutPaymentMethod => method === "cash" || method === "mpesa");
  const uniqueMethods = [...new Set(enabledPaymentMethods)];
  const methods = uniqueMethods.length ? uniqueMethods : defaultCheckoutSettings.enabledPaymentMethods;
  const requestedDefault = stored?.defaultPaymentMethod;
  return {
    ...defaultCheckoutSettings,
    ...stored,
    enabledPaymentMethods: methods,
    defaultPaymentMethod: requestedDefault && methods.includes(requestedDefault) ? requestedDefault : methods[0],
  };
};

export const updateBusinessCheckoutSettings = async (
  tenantId: string,
  input: Omit<BusinessCheckoutSettingsRecord, "updatedAt">,
  actor: { id: string; name: string },
) => {
  const enabledPaymentMethods = [...new Set(input.enabledPaymentMethods)];
  if (!enabledPaymentMethods.length || enabledPaymentMethods.some((method) => method !== "cash" && method !== "mpesa")) throw new Error("Enable at least one supported payment method");
  if (!enabledPaymentMethods.includes(input.defaultPaymentMethod)) throw new Error("Default payment method must be enabled");
  if (!Number.isFinite(input.maxStaffPriceDiscountPercent) || input.maxStaffPriceDiscountPercent < 0 || input.maxStaffPriceDiscountPercent > 100) throw new Error("Maximum staff markdown must be between 0 and 100 percent");
  const now = new Date().toISOString();
  const settings: BusinessCheckoutSettingsRecord = {
    enabledPaymentMethods,
    defaultPaymentMethod: input.defaultPaymentMethod,
    requireCustomerName: Boolean(input.requireCustomerName),
    allowStaffPriceOverrides: Boolean(input.allowStaffPriceOverrides),
    maxStaffPriceDiscountPercent: Math.round(input.maxStaffPriceDiscountPercent * 100) / 100,
    mpesaConfirmationMode: input.mpesaConfirmationMode === "verified_only" ? "verified_only" : "manual_or_verified",
    updatedAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...checkoutSettingsKey(tenantId), entityType: "checkout_settings", tenantId, ...settings } } },
    auditPut(tenantId, { action: "settings.checkout.updated", entityType: "checkout_settings", entityId: "business", reason: "Payment and checkout policies updated", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return settings;
};

export const updateBusinessMeasurementSettings = async (
  tenantId: string,
  packageLabels: PackageUnitLabelRecord[],
  actor: { id: string; name: string },
) => {
  if (!packageLabels.length || packageLabels.length > 50) throw new Error("Configure 1 to 50 package labels");
  const codes = new Set<string>();
  const normalized = packageLabels.map((label) => {
    const code = normalizePackageCode(label.code);
    const name = label.name.trim().replace(/\s+/g, " ");
    const pluralName = label.pluralName.trim().replace(/\s+/g, " ");
    const symbol = label.symbol.trim();
    if (!code || !name || !pluralName || !symbol) throw new Error("Every package label requires a code, singular name, plural name, and symbol");
    if (MEASUREMENT_UNITS[code]) throw new Error(`${code} is reserved for a standard measurement`);
    if (codes.has(code)) throw new Error("Package label codes must be unique");
    codes.add(code);
    return { code, name, pluralName, symbol, status: label.status === "inactive" ? "inactive" as const : "active" as const };
  });
  const currentProducts = await listProducts(tenantId);
  const activeCodes = new Set(normalized.filter(({ status }) => status === "active").map(({ code }) => code));
  const removedInUse = currentProducts.flatMap(productUnitsOf).find((unit) => !activeCodes.has(unit.labelCode) && !MEASUREMENT_UNITS[unit.labelCode] && unit.status === "active");
  if (removedInUse) throw new Error(`${removedInUse.name} is still used by an active product unit`);
  const now = new Date().toISOString();
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: { ...measurementSettingsKey(tenantId), entityType: "measurement_settings", tenantId, packageLabels: normalized, updatedAt: now } } },
    auditPut(tenantId, { action: "settings.measurements.updated", entityType: "measurement_settings", entityId: "business", reason: "Measurement and package labels updated", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return measurementSettings(normalized, now);
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
  audit = { action: "settings.branding.updated", reason: "Business and receipt settings updated" },
) => {
  const now = new Date().toISOString();
  const previousSettings = await getBusinessSettings(tenantId);
  const vatRegistered = input.vatRegistered ?? previousSettings.vatRegistered;
  const kraPin = (input.kraPin ?? previousSettings.kraPin).trim().toUpperCase();
  const vatEffectiveFrom = input.vatEffectiveFrom === undefined ? previousSettings.vatEffectiveFrom : input.vatEffectiveFrom;
  const withholdingVatAgent = input.withholdingVatAgent ?? previousSettings.withholdingVatAgent;
  if (vatRegistered) {
    if (!/^[A-Z0-9]{8,16}$/.test(kraPin)) throw new Error("Enter a valid KRA PIN before enabling VAT");
    if (!vatEffectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(vatEffectiveFrom) || Number.isNaN(Date.parse(`${vatEffectiveFrom}T00:00:00Z`))) throw new Error("Enter a valid VAT effective date");
    if (!previousSettings.vatRegistered && (await listProducts(tenantId)).some((product) => product.status === "active" && !isVatClass(product.vatClass))) throw new Error("Classify every active product before enabling VAT");
  }
  const branding = {
    businessName: input.businessName.trim(),
    address: input.address.trim(),
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    thankYouMessage: input.thankYouMessage.trim(),
    returnPolicy: input.returnPolicy.trim(),
    storeName: "",
    vatRegistered,
    kraPin: vatRegistered ? kraPin : "",
    vatEffectiveFrom: vatRegistered ? vatEffectiveFrom : null,
    withholdingVatAgent: vatRegistered && withholdingVatAgent,
    updatedAt: now,
  };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Update: {
      TableName: TABLE_NAME,
      Key: businessSettingsKey(tenantId),
      UpdateExpression: "SET businessName = :businessName, address = :address, phone = :phone, email = :email, thankYouMessage = :thankYouMessage, returnPolicy = :returnPolicy, vatRegistered = :vatRegistered, kraPin = :kraPin, vatEffectiveFrom = :vatEffectiveFrom, withholdingVatAgent = :withholdingVatAgent, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":businessName": branding.businessName,
        ":address": branding.address,
        ":phone": branding.phone,
        ":email": branding.email,
        ":thankYouMessage": branding.thankYouMessage,
        ":returnPolicy": branding.returnPolicy,
        ":vatRegistered": branding.vatRegistered,
        ":kraPin": branding.kraPin,
        ":vatEffectiveFrom": branding.vatEffectiveFrom,
        ":withholdingVatAgent": branding.withholdingVatAgent,
        ":updatedAt": branding.updatedAt,
      },
      ConditionExpression: "attribute_exists(partitionKey)",
    } },
    auditPut(tenantId, { action: audit.action, entityType: "business_settings", entityId: "business", reason: audit.reason, actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return branding;
};

export const updateBusinessDetails = async (
  tenantId: string,
  input: Pick<BusinessBrandingInput, "businessName" | "address" | "phone" | "email" | "vatRegistered" | "kraPin" | "vatEffectiveFrom" | "withholdingVatAgent">,
  actor: { id: string; name: string },
) => {
  const current = await getBusinessSettings(tenantId);
  const vatRegistered = input.vatRegistered ?? current.vatRegistered;
  const kraPin = (input.kraPin ?? current.kraPin).trim().toUpperCase();
  const vatEffectiveFrom = input.vatEffectiveFrom === undefined ? current.vatEffectiveFrom : input.vatEffectiveFrom;
  const withholdingVatAgent = input.withholdingVatAgent ?? current.withholdingVatAgent;
  if (vatRegistered) {
    if (!/^[A-Z0-9]{8,16}$/.test(kraPin)) throw new Error("Enter a valid KRA PIN before enabling VAT");
    if (!vatEffectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(vatEffectiveFrom) || Number.isNaN(Date.parse(`${vatEffectiveFrom}T00:00:00Z`))) throw new Error("Enter a valid VAT effective date");
    if (!current.vatRegistered && (await listProducts(tenantId)).some((product) => product.status === "active" && !isVatClass(product.vatClass))) throw new Error("Classify every active product before enabling VAT");
  }
  const now = new Date().toISOString();
  const details = { businessName: input.businessName.trim(), address: input.address.trim(), phone: input.phone.trim(), email: input.email.trim().toLowerCase(), vatRegistered, kraPin: vatRegistered ? kraPin : "", vatEffectiveFrom: vatRegistered ? vatEffectiveFrom : null, withholdingVatAgent: vatRegistered && withholdingVatAgent, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Update: { TableName: TABLE_NAME, Key: businessSettingsKey(tenantId), UpdateExpression: "SET businessName = :businessName, address = :address, phone = :phone, email = :email, vatRegistered = :vatRegistered, kraPin = :kraPin, vatEffectiveFrom = :vatEffectiveFrom, withholdingVatAgent = :withholdingVatAgent, updatedAt = :updatedAt", ExpressionAttributeValues: { ":businessName": details.businessName, ":address": details.address, ":phone": details.phone, ":email": details.email, ":vatRegistered": details.vatRegistered, ":kraPin": details.kraPin, ":vatEffectiveFrom": details.vatEffectiveFrom, ":withholdingVatAgent": details.withholdingVatAgent, ":updatedAt": now }, ConditionExpression: "attribute_exists(partitionKey)" } },
    auditPut(tenantId, { action: "settings.business.updated", entityType: "business_settings", entityId: "business", reason: "Business and tax details updated", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return { ...current, ...details };
};

export const updateBusinessReceiptSettings = async (
  tenantId: string,
  input: Pick<BusinessBrandingInput, "thankYouMessage" | "returnPolicy">,
  actor: { id: string; name: string },
) => {
  const current = await getBusinessSettings(tenantId);
  const now = new Date().toISOString();
  const receipt = { thankYouMessage: input.thankYouMessage.trim(), returnPolicy: input.returnPolicy.trim(), updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Update: { TableName: TABLE_NAME, Key: businessSettingsKey(tenantId), UpdateExpression: "SET thankYouMessage = :thankYouMessage, returnPolicy = :returnPolicy, updatedAt = :updatedAt", ExpressionAttributeValues: { ":thankYouMessage": receipt.thankYouMessage, ":returnPolicy": receipt.returnPolicy, ":updatedAt": now }, ConditionExpression: "attribute_exists(partitionKey)" } },
    auditPut(tenantId, { action: "settings.receipts.updated", entityType: "business_settings", entityId: "business", reason: "Global receipt settings updated", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return { ...current, ...receipt };
};

export const effectiveProductPrice = (product: ProductRecord, at = new Date()) => {
  const regularPrice = regularVariantPrice(product, variantsOf(product)[0].id, at);
  const promotionalPrice = product.promotionPrice;
  if (typeof promotionalPrice !== "number" || promotionalPrice < 0 || promotionalPrice >= regularPrice) {
    return regularPrice;
  }
  const timestamp = at.getTime();
  const startsAt = product.promotionStartsAt ? Date.parse(product.promotionStartsAt) : Number.NEGATIVE_INFINITY;
  const endsAt = product.promotionEndsAt ? Date.parse(product.promotionEndsAt) : Number.POSITIVE_INFINITY;
  return timestamp >= startsAt && timestamp <= endsAt ? promotionalPrice : regularPrice;
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
  input: Pick<CategoryRecord, "code" | "name" | "description" | "status"> & { parentId?: string | null },
  actor: { id: string; name: string },
) => {
  const id = randomUUID();
  const now = new Date().toISOString();
  const parent = input.parentId ? await getCategory(tenantId, input.parentId) : null;
  if (input.parentId && (!parent || parent.status !== "active")) throw new Error("Select an active parent category");
  const category = { ...input, parentId: parent?.id ?? null, parentName: parent?.name ?? null, code: normalizeLookup(input.code) || await nextTenantCode(tenantId, "CATEGORY") };
  if ((await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: lookupKey(tenantId, "CATEGORY", category.code) }))).Item) throw new Error("Category code is already in use");
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
  input: Pick<CategoryRecord, "code" | "name" | "description"> & { parentId?: string | null },
  actor: { id: string; name: string },
) => {
  const current = await getCategory(tenantId, id);
  if (!current) throw new Error("Category not found");
  const categories = await listCategories(tenantId);
  const parent = input.parentId ? categories.find((category) => category.id === input.parentId) : null;
  if (input.parentId && (!parent || parent.status !== "active")) throw new Error("Select an active parent category");
  if (parent?.id === id) throw new Error("A category cannot be its own parent");
  let ancestor = parent;
  const visited = new Set<string>();
  while (ancestor) {
    if (ancestor.id === id) throw new Error("A category cannot be moved below one of its descendants");
    if (visited.has(ancestor.id)) throw new Error("The selected category hierarchy contains a cycle");
    visited.add(ancestor.id);
    ancestor = ancestor.parentId ? categories.find((category) => category.id === ancestor!.parentId) : undefined;
  }
  const now = new Date().toISOString();
  const next: CategoryRecord = {
    ...current,
    code: normalizeLookup(input.code),
    name: input.name.trim(),
    description: input.description.trim(),
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? null,
    updatedAt: now,
  };
  const products = next.name === current.name
    ? []
    : (await listCatalogItems(tenantId)).filter((product) => product.categoryId === id);
  const children = next.name === current.name ? [] : categories.filter((category) => category.parentId === id);
  const codeChanged = next.code !== current.code;
  if (codeChanged) {
    const existingCode = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: lookupKey(tenantId, "CATEGORY", next.code) }));
    if (existingCode.Item?.categoryId && existingCode.Item.categoryId !== id) throw new Error("Category code is already in use");
  }
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
    ...children.map((child) => ({ Update: {
      TableName: TABLE_NAME,
      Key: categoryKey(tenantId, child.id),
      UpdateExpression: "SET parentName = :parentName, updatedAt = :updatedAt",
      ConditionExpression: "parentId = :parentId",
      ExpressionAttributeValues: { ":parentId": id, ":parentName": next.name, ":updatedAt": now },
    } })),
    auditPut(tenantId, { action: "category.updated", entityType: "category", entityId: id, reason: "Category updated", actorId: actor.id, actorName: actor.name }, now),
  ];
  if (transactionItems.length > 100) {
    throw new Error("This category has too many products or child categories to rename safely in one operation");
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
  if ((await listCatalogItems(tenantId)).some((product) => product.categoryId === id)) {
    throw new Error("Move this category's products or services before deleting it");
  }
  if ((await listCategories(tenantId)).some((category) => category.parentId === id)) {
    throw new Error("Move or delete this category's child categories first");
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
  input: Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "sellingPrice" | "buyingPrice" | "stockUnit" | "tracksExpiry" | "vatClass"> & { itemType?: "product" | "service"; serviceComponents?: Array<{ productId: string; quantity: number }>; saleVariants?: SaleVariantRecord[]; productUnits?: ProductUnitInput[]; acknowledgeBelowCost?: boolean; promotionPrice?: number | null; promotionStartsAt?: string | null; promotionEndsAt?: string | null },
  actor: { id: string; name: string },
  requestId?: string,
) => {
  if (requestId) {
    const previous = await existingIdempotentResult<ProductRecord>(tenantId, "create_catalog_item", requestId, input);
    if (previous) return previous;
  }
  const businessSettings = await getBusinessSettings(tenantId);
  if (businessSettings.vatRegistered && !isVatClass(input.vatClass)) throw new Error("Select a VAT class for this product");
  if (input.vatClass != null && !isVatClass(input.vatClass)) throw new Error("Invalid VAT class");
  const category = await getCategory(tenantId, input.categoryId);
  if (!category || category.status !== "active") throw new Error("Select an active category");
  const id = randomUUID();
  const now = new Date().toISOString();
  const itemType = input.itemType ?? "product";
  const unit = measurementUnit(itemType === "service" ? "each" : input.stockUnit);
  const sku = normalizeLookup(input.sku) || await nextTenantCode(tenantId, "PRODUCT");
  const serviceComponents: ServiceComponentRecord[] = [];
  if (itemType === "service") {
    const seen = new Set<string>();
    for (const component of input.serviceComponents ?? []) {
      if (seen.has(component.productId)) throw new Error("A service component can only be added once");
      seen.add(component.productId);
      if (!Number.isSafeInteger(component.quantity) || component.quantity < 1) throw new Error("Service component quantities must be positive whole base quantities");
      const product = await getProduct(tenantId, component.productId);
      if (!product || itemTypeOf(product) !== "product" || product.status !== "active") throw new Error("Service components must be active physical products");
      serviceComponents.push({ productId: product.id, productName: product.name, quantity: component.quantity, stockUnit: product.stockUnit });
    }
  }
  const provisional = { id, itemType, name: input.name.trim(), description: input.description.trim(), categoryId: input.categoryId, sellingPrice: input.sellingPrice, buyingPrice: itemType === "service" ? 0 : input.buyingPrice, vatClass: input.vatClass ?? null, tracksExpiry: itemType === "service" ? false : input.tracksExpiry, serviceComponents, promotionPrice: input.promotionPrice, promotionStartsAt: input.promotionStartsAt, promotionEndsAt: input.promotionEndsAt, baseUnit: unit.baseUnit, stockUnit: unit.code, sku, barcode: normalizeLookup(input.barcode), categoryName: category.name, status: "active" as const, createdAt: now, updatedAt: now };
  if (!provisional.name) throw new Error("Product name is required");
  const settings = itemType === "product" && input.productUnits?.length ? await getBusinessMeasurementSettings(tenantId) : null;
  const allowedLabels = new Set([...(settings?.standardUnits.filter(({ baseUnit }) => baseUnit === unit.baseUnit).map(({ code }) => code) ?? []), ...(settings?.packageLabels.filter(({ status }) => status === "active").map(({ code }) => code) ?? [])]);
  const validatedProductUnits = itemType === "product" && input.productUnits?.length ? validateProductUnits(input.productUnits, allowedLabels) : undefined;
  const usedUnitSkus = new Set([sku, ...(validatedProductUnits ?? []).map(({ sku: unitSku }) => unitSku).filter(Boolean)]);
  let generatedUnitSequence = 1;
  const productUnits = validatedProductUnits?.map((productUnit) => {
    if (productUnit.sku) return productUnit;
    let unitSku: string;
    do {
      unitSku = `${sku}-${String(generatedUnitSequence++).padStart(2, "0")}`;
    } while (usedUnitSkus.has(unitSku));
    usedUnitSkus.add(unitSku);
    return { ...productUnit, sku: unitSku };
  });
  const saleVariants = validateVariants(itemType === "service" ? [defaultVariant(provisional)] : productUnits ? productUnitsToSaleVariants(productUnits) : input.saleVariants?.length ? input.saleVariants : [defaultVariant(provisional)]);
  if (productUnits) {
    const baseCost = input.buyingPrice / unit.baseUnits;
    const belowCost = productUnits.some((productUnit) => productUnit.sellable && (productUnit.sellingPrice ?? 0) < baseCost * productUnit.quantityInBaseUnits);
    if (belowCost && !input.acknowledgeBelowCost) throw new Error("Acknowledge the below-cost product unit before saving");
  }
  const product: ProductRecord = { ...provisional, sellingPrice: saleVariants[0].sellingPrice, saleVariants, productUnits };
  const item = { ...productKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${product.name.toLowerCase()}#${id}`, entityType: "product", tenantId, ...product };
  const lookupItems = [...productAliases(product).values()].map((alias) => ({ ...lookupKey(tenantId, alias.kind, alias.value), entityType: "product_lookup", tenantId, productId: id, variantId: alias.variantId }));
  for (const lookup of lookupItems) if ((await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: { partitionKey: lookup.partitionKey, sortKey: lookup.sortKey } }))).Item) throw new Error(`${lookup.partitionKey.includes("#SKU#") ? "SKU" : "Barcode"} is already used by another product or sale variant`);
  const transaction = [
    { Put: { TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(partitionKey)" } },
    ...lookupItems.map((lookup) => ({ Put: { TableName: TABLE_NAME, Item: lookup, ConditionExpression: "attribute_not_exists(partitionKey)" } })),
    auditPut(tenantId, { action: itemType === "service" ? "service.created" : "product.created", entityType: itemType, entityId: id, productName: product.name, quantityBefore: 0, quantityAfter: 0, quantityDelta: 0, reason: itemType === "service" ? "Service created" : "Product created without stock", actorId: actor.id, actorName: actor.name }, now),
  ];
  if (requestId) return commitIdempotent(tenantId, "create_catalog_item", requestId, input, product, transaction);
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return product;
};

export const updateProduct = async (
  tenantId: string,
  id: string,
  updates: Partial<Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "sellingPrice" | "buyingPrice" | "stockUnit" | "tracksExpiry" | "saleVariants" | "promotionPrice" | "promotionStartsAt" | "promotionEndsAt" | "status" | "vatClass">> & { serviceComponents?: Array<{ productId: string; quantity: number }>; productUnits?: ProductUnitInput[]; acknowledgeBelowCost?: boolean },
  actor: { id: string; name: string },
) => {
  const storedCurrent = await getProduct(tenantId, id);
  if (!storedCurrent) throw new Error("Product not found");
  const current = materializeEffectiveAdjustment(storedCurrent);
  if (updates.status === "inactive" && itemTypeOf(current) === "product" && (await listCatalogItems(tenantId)).some((item) => itemTypeOf(item) === "service" && item.status === "active" && (item.serviceComponents ?? []).some((component) => component.productId === id))) {
    throw new Error("Remove this product from active services before archiving it");
  }
  let serviceComponents = current.serviceComponents;
  if (itemTypeOf(current) === "service") {
    if (updates.stockUnit !== undefined || updates.tracksExpiry !== undefined || updates.productUnits !== undefined) throw new Error("Services do not have stock settings");
    if (updates.serviceComponents) {
      const seen = new Set<string>(); const resolved: ServiceComponentRecord[] = [];
      for (const component of updates.serviceComponents) {
        if (seen.has(component.productId)) throw new Error("A service component can only be added once");
        seen.add(component.productId);
        if (!Number.isSafeInteger(component.quantity) || component.quantity < 1) throw new Error("Service component quantities must be positive whole base quantities");
        const product = await getProduct(tenantId, component.productId);
        if (!product || itemTypeOf(product) !== "product" || product.status !== "active") throw new Error("Service components must be active physical products");
        resolved.push({ productId: product.id, productName: product.name, quantity: component.quantity, stockUnit: product.stockUnit });
      }
      serviceComponents = resolved;
    }
  }
  if (updates.productUnits?.length) {
    const currentPrices = new Map(productUnitsOf(current).filter((unit) => unit.sellable && unit.sellingPrice != null).map((unit) => [unit.id, regularVariantPrice(current, unit.id)]));
    const changedExistingPrice = updates.productUnits.some((unit) => currentPrices.has(unit.id ?? "") && unit.sellingPrice !== currentPrices.get(unit.id ?? ""));
    if (changedExistingPrice) throw new Error("Use Adjust prices to change an existing selling unit price");
  }
  if (itemTypeOf(current) !== "service" && updates.saleVariants?.length && updates.productUnits === undefined) {
    const currentPrices = new Map(variantsOf(current).map((variant) => [variant.id, regularVariantPrice(current, variant.id)]));
    if (updates.saleVariants.some((variant) => currentPrices.has(variant.id) && variant.sellingPrice !== currentPrices.get(variant.id))) throw new Error("Use Adjust prices to change an existing selling unit price");
  }
  if (itemTypeOf(current) !== "service" && updates.sellingPrice !== undefined && updates.productUnits === undefined && updates.saleVariants === undefined && updates.sellingPrice !== regularVariantPrice(current, variantsOf(current)[0].id)) {
    throw new Error("Use Adjust prices to change an existing selling unit price");
  }
  const businessSettings = await getBusinessSettings(tenantId);
  const nextVatClass = updates.vatClass === undefined ? current.vatClass : updates.vatClass;
  if (businessSettings.vatRegistered && !isVatClass(nextVatClass)) throw new Error("Select a VAT class for this product");
  if (nextVatClass != null && !isVatClass(nextVatClass)) throw new Error("Invalid VAT class");
  const categoryId = updates.categoryId ?? current.categoryId;
  const category = await getCategory(tenantId, categoryId);
  if (!category) throw new Error("Category not found");
  const now = new Date().toISOString();
  const settings = updates.productUnits?.length ? await getBusinessMeasurementSettings(tenantId) : null;
  const requestedUnit = measurementUnit(updates.stockUnit ?? current.stockUnit);
  const allowedLabels = new Set([...(settings?.standardUnits.filter(({ baseUnit }) => baseUnit === requestedUnit.baseUnit).map(({ code }) => code) ?? []), ...(settings?.packageLabels.filter(({ status }) => status === "active").map(({ code }) => code) ?? []), ...productUnitsOf(current).map(({ labelCode }) => labelCode)]);
  const productUnits = updates.productUnits?.length ? validateProductUnits(updates.productUnits, allowedLabels) : current.productUnits;
  const saleVariants = validateVariants(productUnits && updates.productUnits ? productUnitsToSaleVariants(productUnits) : updates.saleVariants ?? variantsOf(current));
  const sellingPrice = updates.saleVariants ? saleVariants[0].sellingPrice : updates.sellingPrice ?? current.sellingPrice;
  const buyingPrice = updates.buyingPrice ?? current.buyingPrice;
  const unit = requestedUnit;
  if (unit.baseUnit !== current.baseUnit) throw new Error("A product's measurement type cannot be changed after creation");
  if (productUnits && updates.productUnits) {
    const baseCost = await weightedProductBaseCost(tenantId, id, buyingPrice / unit.baseUnits);
    const belowCost = productUnits.some((productUnit) => productUnit.sellable && (productUnit.sellingPrice ?? 0) < baseCost * productUnit.quantityInBaseUnits);
    if (belowCost && !updates.acknowledgeBelowCost) throw new Error("Acknowledge the below-cost product unit before saving");
  }
  const { acknowledgeBelowCost: _acknowledgeBelowCost, serviceComponents: _requestedServiceComponents, ...storedUpdates } = updates;
  const next: ProductRecord = { ...current, ...storedUpdates, serviceComponents, productUnits, saleVariants, sellingPrice, buyingPrice, baseUnit: unit.baseUnit, stockUnit: unit.code, tracksExpiry: updates.tracksExpiry ?? current.tracksExpiry, sku: normalizeLookup(updates.sku ?? current.sku), barcode: normalizeLookup(updates.barcode ?? current.barcode), categoryId, categoryName: category.name, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  const oldAliases = productAliases(current); const newAliases = productAliases(next);
  for (const [aliasKey, alias] of newAliases) if (!oldAliases.has(aliasKey) && (await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: lookupKey(tenantId, alias.kind, alias.value) }))).Item) throw new Error(`${alias.kind === "SKU" ? "SKU" : "Barcode"} is already used by another product or sale variant`);
  for (const [key, alias] of oldAliases) if (!newAliases.has(key)) transaction.push({ Delete: { TableName: TABLE_NAME, Key: lookupKey(tenantId, alias.kind, alias.value) } });
  for (const [key, alias] of newAliases) if (!oldAliases.has(key)) transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...lookupKey(tenantId, alias.kind, alias.value), entityType: "product_lookup", tenantId, productId: id, variantId: alias.variantId }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  transaction.push(
    { Put: { TableName: TABLE_NAME, Item: { ...productKey(tenantId, id), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${next.name.toLowerCase()}#${id}`, entityType: "product", tenantId, ...next }, ConditionExpression: "attribute_exists(partitionKey)" } },
    auditPut(tenantId, {
      action: current.sellingPrice !== next.sellingPrice ? "product.price.updated" : current.vatClass !== next.vatClass ? "product.vat_class.updated" : "product.updated",
      entityType: "product",
      entityId: id,
      productName: next.name,
      reason: current.sellingPrice !== next.sellingPrice
        ? `Selling price changed from ${current.sellingPrice.toFixed(2)} to ${next.sellingPrice.toFixed(2)}`
        : current.vatClass !== next.vatClass ? `VAT class changed from ${current.vatClass ?? "unclassified"} to ${next.vatClass ?? "unclassified"}`
        : "Product details updated",
      actorId: actor.id,
      actorName: actor.name,
    }, now),
  );
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return next;
};

export const adjustProductPrices = async (
  tenantId: string,
  productId: string,
  input: { lines: Array<{ productUnitId: string; newPrice: number }>; effectiveAt: string; reason: string; requestId: string },
  actor: { id: string; name: string },
) => {
  const payload = { productId, ...input };
  const previous = await existingIdempotentResult<ProductRecord>(tenantId, "adjust_product_prices", input.requestId, payload);
  if (previous) return previous;
  const stored = await getProduct(tenantId, productId);
  if (!stored) throw new Error("Product not found");
  const now = new Date(); const nowIso = now.toISOString();
  const effectiveTime = Date.parse(input.effectiveAt);
  if (Number.isNaN(effectiveTime)) throw new Error("Enter a valid price effective date and time");
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) throw new Error("Enter a price adjustment reason between 3 and 200 characters");
  if (!input.lines.length || input.lines.length > 20 || new Set(input.lines.map((line) => line.productUnitId)).size !== input.lines.length) throw new Error("Select 1 to 20 unique selling units");

  const current = materializeEffectiveAdjustment(stored, now);
  const units = productUnitsOf(current);
  const sellable = new Map(units.filter((unit) => unit.sellable && unit.status === "active" && unit.sellingPrice != null).map((unit) => [unit.id, unit]));
  const lines = input.lines.map((line) => {
    const unit = sellable.get(line.productUnitId);
    if (!unit) throw new Error("Select an active selling unit");
    if (!Number.isFinite(line.newPrice) || line.newPrice < 0 || Math.round(line.newPrice * 100) / 100 !== line.newPrice) throw new Error("Selling prices must be non-negative amounts with at most two decimal places");
    if (line.newPrice === unit.sellingPrice) throw new Error(`${unit.name} already has that selling price`);
    return { productUnitId: unit.id, productUnitName: unit.name, previousPrice: unit.sellingPrice!, newPrice: line.newPrice };
  });
  const defaultId = variantsOf(current)[0].id;
  const defaultNewPrice = lines.find((line) => line.productUnitId === defaultId)?.newPrice ?? regularVariantPrice(current, defaultId, now);
  const promotionOverlaps = typeof current.promotionPrice === "number" && (!current.promotionEndsAt || Date.parse(current.promotionEndsAt) >= effectiveTime);
  if (promotionOverlaps && current.promotionPrice! >= defaultNewPrice) throw new Error("The regular price must remain above the overlapping promotion price");

  const immediate = effectiveTime <= now.getTime();
  const adjustment: ProductPriceAdjustmentRecord = { id: randomUUID(), effectiveAt: immediate ? nowIso : new Date(effectiveTime).toISOString(), reason, lines, createdBy: actor.id, createdByName: actor.name, createdAt: nowIso };
  let next: ProductRecord;
  if (immediate) {
    const prices = new Map(lines.map((line) => [line.productUnitId, line.newPrice]));
    const saleVariants = variantsOf(current).map((variant) => ({ ...variant, sellingPrice: prices.get(variant.id) ?? variant.sellingPrice }));
    const productUnits = units.map((unit) => ({ ...unit, sellingPrice: unit.sellingPrice == null ? null : prices.get(unit.id) ?? unit.sellingPrice }));
    next = { ...current, sellingPrice: saleVariants[0].sellingPrice, saleVariants, productUnits, priceAdjustment: null, updatedAt: nowIso };
  } else {
    next = { ...current, priceAdjustment: adjustment, updatedAt: nowIso };
  }
  const replacing = Boolean(pendingPriceAdjustment(stored, now));
  const detail = lines.map((line) => `${line.productUnitName}: ${line.previousPrice.toFixed(2)} to ${line.newPrice.toFixed(2)}`).join("; ");
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
    { Put: { TableName: TABLE_NAME, Item: { ...productKey(tenantId, productId), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${next.name.toLowerCase()}#${productId}`, entityType: "product", tenantId, ...next }, ConditionExpression: "updatedAt = :expected", ExpressionAttributeValues: { ":expected": stored.updatedAt } } },
    auditPut(tenantId, { action: replacing ? "product.price_adjustment.replaced" : immediate ? "product.price_adjustment.applied" : "product.price_adjustment.scheduled", entityType: "product", entityId: productId, productName: next.name, reason: `${reason} — ${detail}; effective ${adjustment.effectiveAt}${replacing ? "; replaced the previous scheduled adjustment" : ""}`.slice(0, 1000), actorId: actor.id, actorName: actor.name }, nowIso),
  ];
  return commitIdempotent(tenantId, "adjust_product_prices", input.requestId, payload, next, transaction);
};

export const cancelProductPriceAdjustment = async (
  tenantId: string,
  productId: string,
  reasonInput: string,
  actor: { id: string; name: string },
  requestId: string,
) => {
  const payload = { productId, reason: reasonInput, requestId };
  const previous = await existingIdempotentResult<ProductRecord>(tenantId, "cancel_product_price_adjustment", requestId, payload);
  if (previous) return previous;
  const current = await getProduct(tenantId, productId);
  if (!current) throw new Error("Product not found");
  const pending = pendingPriceAdjustment(current);
  if (!pending) throw new Error("This product has no upcoming price adjustment");
  const reason = reasonInput.trim();
  if (reason.length < 3 || reason.length > 200) throw new Error("Enter a cancellation reason between 3 and 200 characters");
  const now = new Date().toISOString();
  const { priceAdjustment: _priceAdjustment, ...withoutAdjustment } = current;
  const next: ProductRecord = { ...withoutAdjustment, updatedAt: now };
  return commitIdempotent(tenantId, "cancel_product_price_adjustment", requestId, payload, next, [
    { Put: { TableName: TABLE_NAME, Item: { ...productKey(tenantId, productId), accessPartition: tenantKey(tenantId, "CATALOG#PRODUCT"), accessSort: `${next.name.toLowerCase()}#${productId}`, entityType: "product", tenantId, ...next }, ConditionExpression: "updatedAt = :expected", ExpressionAttributeValues: { ":expected": current.updatedAt } } },
    auditPut(tenantId, { action: "product.price_adjustment.cancelled", entityType: "product", entityId: productId, productName: next.name, reason: `${reason} — cancelled adjustment effective ${pending.effectiveAt}`.slice(0, 1000), actorId: actor.id, actorName: actor.name }, now),
  ]);
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
    verifiedMpesa?: { paymentId: string; receiptNumber: string; amountKes: number; evidenceSources: Array<"stk" | "c2b">; phoneLast4?: string | null } | null;
    items: Array<{ productId: string; variantId?: string | null; quantity: number; expectedCatalogPrice?: number | null; unitPriceOverride?: number | null; priceOverrideReason?: string | null }>;
    requestId: string;
  },
  actor: { id: string; name: string; employeeCode?: string; storeName?: string; role?: "admin" | "staff" },
) => {
  const previous = await existingIdempotentResult<SaleRecord>(tenantId, "complete_sale", input.requestId, input); if (previous) return previous;
  const grouped = new Map<string, { productId: string; variantId?: string | null; quantity: number; expectedCatalogPrice?: number | null; unitPriceOverride?: number | null; priceOverrideReason?: string | null }>();
  for (const item of input.items) { const key = `${item.productId}#${item.variantId ?? "default"}`; const current = grouped.get(key); if (current && (current.expectedCatalogPrice !== item.expectedCatalogPrice || current.unitPriceOverride !== item.unitPriceOverride || current.priceOverrideReason !== item.priceOverrideReason)) throw new Error("Duplicate sale lines must use the same expected price and override"); grouped.set(key, { ...item, quantity: (current?.quantity ?? 0) + item.quantity }); }
  if (grouped.size === 0) throw new Error("Add at least one product to the sale");
  if (grouped.size > 40) throw new Error("A sale can contain at most 40 distinct variants");
  if ([...grouped.values()].some(({ quantity }) => !Number.isInteger(quantity) || quantity <= 0)) throw new Error("Sale quantities must be positive whole numbers");
  const productIds = [...new Set([...grouped.values()].map(({ productId }) => productId))];
  const products = await Promise.all(productIds.map((productId) => getProduct(tenantId, productId)));
  if (products.some((product) => !product || product.status !== "active")) throw new Error("One or more products are unavailable");
  const byProduct = new Map(products.map((product) => [product!.id, product!]));
  const resolvedItems = [...grouped.values()].map((item) => { const product = byProduct.get(item.productId)!; const variants = variantsOf(product).filter((variant) => variant.status === "active"); const variant = variants.find((candidate) => candidate.id === item.variantId) ?? (!item.variantId ? variants[0] : undefined); if (!variant) throw new Error(`${product.name} sale variant is unavailable`); return { ...item, product, variant, inventoryQuantity: itemTypeOf(product) === "service" ? 0 : item.quantity * variant.quantityInBaseUnits }; });
  const componentIds = [...new Set(resolvedItems.flatMap((item) => itemTypeOf(item.product) === "service" ? (item.product.serviceComponents ?? []).map((component) => component.productId) : []))];
  const componentProducts = await Promise.all(componentIds.map((productId) => getProduct(tenantId, productId)));
  if (componentProducts.some((product) => !product || itemTypeOf(product) !== "product" || product.status !== "active")) throw new Error("One or more service materials are unavailable");
  const pricingAt = new Date();
  const priceChanges = resolvedItems.flatMap(({ product, variant, expectedCatalogPrice }) => {
    if (expectedCatalogPrice === undefined || expectedCatalogPrice === null) return [];
    const regularPrice = regularVariantPrice(product, variant.id, pricingAt);
    const currentPrice = variantsOf(product)[0]?.id === variant.id ? effectiveProductPrice(product, pricingAt) : regularPrice;
    return currentPrice === expectedCatalogPrice ? [] : [{ productId: product.id, productName: product.name, variantId: variant.id, variantName: variant.name, previousPrice: expectedCatalogPrice, currentPrice }];
  });
  if (priceChanges.length) throw new GraphQLError("One or more basket prices changed. Review the updated totals before completing the sale.", { extensions: { code: "PRICE_CHANGED", priceChanges } });
  const inventoryByProduct = new Map<string, number>();
  const directlySoldProducts = new Set<string>();
  const inventoryNames = new Map<string, string>();
  for (const item of resolvedItems) {
    if (itemTypeOf(item.product) === "service") {
      for (const component of item.product.serviceComponents ?? []) {
        const quantity = component.quantity * item.quantity;
        inventoryByProduct.set(component.productId, (inventoryByProduct.get(component.productId) ?? 0) + quantity);
        inventoryNames.set(component.productId, component.productName);
      }
    } else {
      directlySoldProducts.add(item.productId); inventoryNames.set(item.productId, item.product.name);
      inventoryByProduct.set(item.productId, (inventoryByProduct.get(item.productId) ?? 0) + item.inventoryQuantity);
    }
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  const [allocations, cashShift, store, globalBranding, checkoutSettings] = await Promise.all([allocateLots(tenantId, input.storeId, [...inventoryByProduct].map(([productId, quantity]) => ({ productId, quantity }))), input.paymentMethod === "cash" ? getOpenCashShift(tenantId, input.storeId, actor.id) : Promise.resolve(null), getStore(tenantId, input.storeId), getBusinessSettings(tenantId), getBusinessCheckoutSettings(tenantId)]);
  if (!store || store.status !== "active") throw new Error("Selected store is unavailable");
  if (!checkoutSettings.enabledPaymentMethods.includes(input.paymentMethod)) throw new Error("This payment method is disabled for this business");
  if (checkoutSettings.requireCustomerName && !input.customerName?.trim()) throw new Error("Customer name is required for checkout");
  if (input.paymentMethod === "cash" && !cashShift) throw new Error("Open a cash shift before accepting cash sales");
  const remainingCostByProduct = new Map([...inventoryByProduct].map(([productId, inventoryQuantity]) => [productId, { quantity: inventoryQuantity, costMinor: (allocations.get(productId) ?? []).reduce((sum, allocation) => sum + allocation.costMinor, 0) }]));
  const consumeCost = (productId: string, quantity: number) => { const remaining = remainingCostByProduct.get(productId); if (!remaining || quantity < 1 || quantity > remaining.quantity) throw new Error("Unable to allocate inventory cost"); const costMinor = quantity === remaining.quantity ? remaining.costMinor : Math.round(remaining.costMinor * quantity / remaining.quantity); remaining.quantity -= quantity; remaining.costMinor -= costMinor; return costMinor; };
  const saleItems: SaleItemRecord[] = resolvedItems.map(({ product, variant, quantity, inventoryQuantity, unitPriceOverride, priceOverrideReason }) => {
    const regularPrice = regularVariantPrice(product, variant.id, new Date(now));
    const defaultSale = variantsOf(product)[0]?.id === variant.id; const authoritativePrice = defaultSale ? effectiveProductPrice(product, new Date(now)) : regularPrice;
    const overrideRequested = unitPriceOverride !== undefined && unitPriceOverride !== null && unitPriceOverride !== authoritativePrice;
    const reason = priceOverrideReason?.trim() ?? "";
    if (overrideRequested) {
      if (!Number.isFinite(unitPriceOverride) || unitPriceOverride! < 0 || Math.round(unitPriceOverride! * 100) / 100 !== unitPriceOverride) throw new Error("Price overrides must be non-negative amounts with at most two decimal places");
      if (reason.length < 3 || reason.length > 200) throw new Error("Enter a price override reason between 3 and 200 characters");
      if (actor.role !== "admin") {
        if (!checkoutSettings.allowStaffPriceOverrides) throw new Error("Staff price markdowns are disabled");
        if (unitPriceOverride! > authoritativePrice) throw new Error("Staff cannot increase prices at checkout");
        const minimumPrice = roundMoney(authoritativePrice * (1 - checkoutSettings.maxStaffPriceDiscountPercent / 100));
        if (unitPriceOverride! < minimumPrice) throw new Error(`Staff markdown exceeds the ${checkoutSettings.maxStaffPriceDiscountPercent}% limit`);
      }
    }
    const price = overrideRequested ? unitPriceOverride! : authoritativePrice;
    const consumedComponents = itemTypeOf(product) === "service" ? (product.serviceComponents ?? []).map((component) => { const componentQuantity = component.quantity * quantity; const totalCostMinor = consumeCost(component.productId, componentQuantity); return { productId: component.productId, productName: component.productName, quantity: componentQuantity, unitCost: totalCostMinor / 100 / componentQuantity, totalCost: totalCostMinor / 100 }; }) : undefined;
    const lineCostMinor = itemTypeOf(product) === "service" ? (consumedComponents ?? []).reduce((sum, component) => sum + Math.round(component.totalCost * 100), 0) : consumeCost(product.id, inventoryQuantity);
    const cost = lineCostMinor / 100 / quantity;
    const total = roundMoney(price * quantity);
    const activeVat = vatApplies(globalBranding, now) && isVatClass(product.vatClass);
    const vatClass = activeVat ? product.vatClass! : null;
    const breakdown = activeVat ? inclusiveVatBreakdown(Math.round(total * 100), vatClass!, now) : { taxableMinor: 0, vatMinor: 0, rateBasisPoints: 0 };
    return {
      productId: product.id,
      productName: product.name,
      sku: variant.sku || product.sku,
      barcode: variant.barcode || product.barcode,
      variantId: variant.id,
      variantName: variant.name,
      quantityInBaseUnits: variant.quantityInBaseUnits,
      inventoryQuantity,
      quantity,
      price,
      ...(overrideRequested ? { priceBeforeOverride: authoritativePrice, priceOverrideReason: reason } : {}),
      regularPrice,
      promotionApplied: authoritativePrice < regularPrice,
      cost,
      total,
      vatClass,
      vatRateBasisPoints: breakdown.rateBasisPoints,
      taxableAmount: breakdown.taxableMinor / 100,
      vatAmount: breakdown.vatMinor / 100,
      ...(consumedComponents?.length ? { consumedComponents } : {}),
    };
  });
  const subtotal = roundMoney(saleItems.reduce((sum, item) => sum + Math.max(item.regularPrice ?? item.price, item.priceBeforeOverride ?? item.price, item.price) * item.quantity, 0));
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
    if (checkoutSettings.mpesaConfirmationMode === "verified_only" && !input.verifiedMpesa) throw new Error("This business requires a verified M-Pesa payment");
    paymentReference = input.verifiedMpesa?.receiptNumber ?? input.mpesaReference?.trim().toUpperCase() ?? "";
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
    tax: roundMoney(saleItems.reduce((sum, item) => sum + (item.vatAmount ?? 0), 0)),
    discount,
    totalAmount,
    status: "completed",
    paymentMethod: input.paymentMethod,
    paymentStatus: "paid",
    amountTendered,
    changeDue,
    paymentReference,
    paymentEvidence: input.paymentMethod === "mpesa" ? input.verifiedMpesa
      ? input.verifiedMpesa.evidenceSources.includes("stk") && input.verifiedMpesa.evidenceSources.includes("c2b") ? "stk_c2b" : input.verifiedMpesa.evidenceSources[0]
      : "manual" : null,
    paymentAmountKes: input.paymentMethod === "mpesa" ? input.verifiedMpesa?.amountKes ?? Math.ceil(totalAmount) : null,
    paymentRoundingAdjustment: input.paymentMethod === "mpesa" ? roundMoney((input.verifiedMpesa?.amountKes ?? Math.ceil(totalAmount)) - totalAmount) : null,
    mpesaPaymentId: input.verifiedMpesa?.paymentId ?? null,
    payerPhoneLast4: input.verifiedMpesa?.phoneLast4 ?? null,
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
    stockMovementPut(tenantId, { type: directlySoldProducts.has(productId) ? "sale" : "service_consumption", storeId: input.storeId, productId, productName: inventoryNames.get(productId) ?? allocation.lot.productName, lotId: allocation.lot.id, quantity: -allocation.quantity, unitCost: allocation.lot.unitCost, reason: `${directlySoldProducts.has(productId) ? "Sale" : "Service materials for"} ${sale.orderNumber}`, referenceId: id, actorId: actor.id, actorName: actor.name }, now),
  );
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { partitionKey: tenantKey(tenantId, `SALE#${id}`), sortKey: "RECEIPT", accessPartition: tenantKey(tenantId, "SALE"), accessSort: `${now}#${id}`, entityType: "sale", tenantId, ...sale }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  if (paymentReference) {
    transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...mpesaPaymentKey(tenantId, paymentReference), entityType: "payment_lookup", tenantId, saleId: id, orderNumber: sale.orderNumber, createdAt: now }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
    if (!input.verifiedMpesa) transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...mpesaReceiptClaimKey(paymentReference), entityType: "mpesa_receipt_claim", tenantId, saleId: id, evidence: "manual", createdAt: now }, ConditionExpression: "attribute_not_exists(partitionKey)" } });
  }
  if (input.verifiedMpesa) transaction.push({ Update: { TableName: TABLE_NAME, Key: { partitionKey: `MPESA_PAYMENT#${input.verifiedMpesa.receiptNumber}`, sortKey: "PAYMENT" }, UpdateExpression: "SET #status = :assigned, saleId = :saleId, orderNumber = :orderNumber, updatedAt = :now", ConditionExpression: "tenantId = :tenantId AND #status = :processing AND id = :paymentId", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":assigned": "assigned", ":saleId": id, ":orderNumber": sale.orderNumber, ":now": now, ":tenantId": tenantId, ":processing": "processing", ":paymentId": input.verifiedMpesa.paymentId } } });
  if (cashShift) transaction.push({ Update: { TableName: TABLE_NAME, Key: cashShiftKey(tenantId, cashShift.id), UpdateExpression: "SET cashSalesTotal = cashSalesTotal + :amount, updatedAt = :now", ConditionExpression: "#status = :open", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":amount": totalAmount, ":now": now, ":open": "open" } } });
  const overriddenItems = saleItems.filter((item) => item.priceBeforeOverride !== undefined);
  if (overriddenItems.length) transaction.push(auditPut(tenantId, { action: "checkout.price_overrides.applied", entityType: "sale", entityId: id, reason: overriddenItems.map((item) => `${item.productName}: ${item.priceBeforeOverride!.toFixed(2)} to ${item.price.toFixed(2)} (${item.priceOverrideReason})`).join("; ").slice(0, 1000), actorId: actor.id, actorName: actor.name }, now));
  if (transaction.length + 1 > 100) throw new Error("Sale uses too many inventory lots to complete atomically; reduce the basket size");
  return commitIdempotent(tenantId, "complete_sale", input.requestId, input, sale, transaction);
};

export const dashboardSummary = async (tenantId: string, requestedDays = 1, staffId?: string, includeDetails = true, storeId?: string) => {
  const days = Math.min(Math.max(requestedDays, 1), 90);
  const startDate = new Date(`${businessDate()}T00:00:00+03:00`);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const start = startDate.toISOString();
  const [catalogProducts, allSales, audits, stock] = await Promise.all([
    listCatalogItems(tenantId),
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
    (sum, item) => sum + item.total - (item.vatAmount ?? 0) - item.cost * item.quantity,
    0,
  ));
  const byCashier = new Map<string, { staffId: string; staffName: string; salesCount: number; unitsSold: number; revenue: number; grossProfit: number }>();
  for (const sale of sales) {
    const current = byCashier.get(sale.createdBy) ?? { staffId: sale.createdBy, staffName: sale.createdByName, salesCount: 0, unitsSold: 0, revenue: 0, grossProfit: 0 };
    current.salesCount += 1;
    current.unitsSold += sale.items.reduce((sum, item) => sum + item.quantity, 0);
    current.revenue = roundMoney(current.revenue + sale.totalAmount);
    current.grossProfit = roundMoney(current.grossProfit + sale.items.reduce((sum, item) => sum + item.total - (item.vatAmount ?? 0) - item.cost * item.quantity, 0));
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
    listCatalogItems(tenantId),
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
  for (const lot of lots) { quantityByProduct.set(lot.productId, (quantityByProduct.get(lot.productId) ?? 0) + lot.remainingQuantity); valueByProduct.set(lot.productId, roundMoney((valueByProduct.get(lot.productId) ?? 0) + lotRemainingCostMinor(lot) / 100)); }
  const reorderByProduct = new Map<string, number>();
  for (const position of storePositions) reorderByProduct.set(position.productId, (reorderByProduct.get(position.productId) ?? 0) + position.reorderPoint);
  const catalogItems = catalogProducts.map((product) => ({ ...product, quantity: quantityByProduct.get(product.id) ?? 0, reorderPoint: reorderByProduct.get(product.id) }));
  const products = catalogItems.filter((product) => itemTypeOf(product) === "product");
  const productById = new Map(catalogItems.map((product) => [product.id, product]));
  const productTotals = new Map<string, ReportProductRecord>();
  const promotionTotals = new Map<string, ReportProductRecord>();
  let promotionUnitsSold = 0;
  let promotionRevenue = 0;
  let promotionSavings = 0;
  for (const sale of filteredSales) {
    for (const item of sale.items) {
      const product = productById.get(item.productId);
      const current = productTotals.get(item.productId) ?? { productId: item.productId, productName: item.productName, baseUnit: product?.baseUnit ?? "each", stockUnit: product?.stockUnit ?? "each", units: 0, revenue: 0, grossProfit: 0, savings: 0 };
      current.units += product?.itemType === "service"
        ? item.quantity
        : item.inventoryQuantity / measurementUnit(current.stockUnit).baseUnits;
      current.revenue = roundMoney(current.revenue + item.total);
      current.grossProfit = roundMoney(current.grossProfit + item.total - (item.vatAmount ?? 0) - item.cost * item.quantity);
      productTotals.set(item.productId, current);
      if (item.promotionApplied) {
        const saving = roundMoney(((item.regularPrice ?? item.price) - item.price) * item.quantity);
        promotionUnitsSold += item.quantity;
        promotionRevenue = roundMoney(promotionRevenue + item.total);
        promotionSavings = roundMoney(promotionSavings + saving);
        const promotional = promotionTotals.get(item.productId) ?? { productId: item.productId, productName: item.productName, baseUnit: product?.baseUnit ?? "each", stockUnit: product?.stockUnit ?? "each", units: 0, revenue: 0, grossProfit: 0, savings: 0 };
        promotional.units += product?.itemType === "service"
          ? item.quantity
          : item.inventoryQuantity / measurementUnit(promotional.stockUnit).baseUnits;
        promotional.revenue = roundMoney(promotional.revenue + item.total);
        promotional.grossProfit = roundMoney(promotional.grossProfit + item.total - (item.vatAmount ?? 0) - item.cost * item.quantity);
        promotional.savings = roundMoney(promotional.savings + saving);
        promotionTotals.set(item.productId, promotional);
      }
    }
  }
  const stockAdjustments = audits.filter(({ action }) => action === "stock.adjusted");
  const priceChanges = audits.filter(({ action }) => action === "product.price.updated" || action.startsWith("product.price_adjustment."));
  const revenue = roundMoney(filteredSales.reduce((sum, sale) => sum + sale.totalAmount, 0));
  const grossProfit = roundMoney(filteredSales.flatMap(({ items }) => items).reduce((sum, item) => sum + item.total - (item.vatAmount ?? 0) - item.cost * item.quantity, 0));
  const stockCostValue = roundMoney([...valueByProduct.values()].reduce((sum, value) => sum + value, 0));
  const stockRetailValue = roundMoney(products.reduce((sum, product) => sum + (product.quantity / measurementUnit(product.stockUnit).baseUnits) * product.sellingPrice, 0));
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
      baseUnit: product.baseUnit,
      stockUnit: product.stockUnit,
      quantity: product.quantity,
      reorderPoint: product.reorderPoint ?? 0,
      actualCostValue: valueByProduct.get(product.id) ?? 0,
      sellingPrice: product.sellingPrice,
      retailValue: roundMoney((product.quantity / measurementUnit(product.stockUnit).baseUnits) * product.sellingPrice),
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
