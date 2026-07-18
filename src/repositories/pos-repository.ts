import { randomUUID } from "crypto";
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";

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
  price: number;
  cost: number;
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
  paymentMethod: "cash" | "card" | "mobile_money";
  paymentStatus: "paid";
  createdBy: string;
  createdByName: string;
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
  phone: string;
  createdAt: string;
  updatedAt: string;
}

const normalizeLookup = (value: string) => value.trim().toUpperCase();
const businessDate = (date = new Date()) =>
  new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const productKey = (id: string) => ({ PK: `PRODUCT#${id}`, SK: "PROFILE" });
const categoryKey = (id: string) => ({ PK: `CATEGORY#${id}`, SK: "PROFILE" });
const lookupKey = (kind: "SKU" | "BARCODE" | "CATEGORY", value: string) => ({
  PK: `LOOKUP#${kind}#${normalizeLookup(value)}`,
  SK: "PRODUCT",
});
const profileKey = (userId: string) => ({ PK: `USER#${userId}`, SK: "PROFILE" });

const stripKeys = <T>(item: Record<string, unknown> | undefined): T | null => {
  if (!item) return null;
  const { PK: _pk, SK: _sk, GSI1PK: _gsiPk, GSI1SK: _gsiSk, entityType: _type, recordType: _recordType, ...record } = item;
  return record as T;
};

const auditPut = (audit: Omit<AuditRecord, "id" | "createdAt">, now: string) => {
  const id = randomUUID();
  return {
    Put: {
      TableName: TABLE_NAME,
      Item: {
        PK: `AUDIT#${id}`,
        SK: "EVENT",
        GSI1PK: "AUDIT",
        GSI1SK: `${now}#${id}`,
        recordType: "audit",
        id,
        ...audit,
        createdAt: now,
      },
    },
  };
};

const queryCollection = async <T>(partition: string, options?: { limit?: number; from?: string }) => {
  const response = await dynamoDB.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: options?.from
        ? "GSI1PK = :pk AND GSI1SK >= :from"
        : "GSI1PK = :pk",
      ExpressionAttributeValues: {
        ":pk": partition,
        ...(options?.from ? { ":from": options.from } : {}),
      },
      ScanIndexForward: options?.limit ? false : true,
      Limit: options?.limit,
    }),
  );
  return (response.Items ?? []).map((item) => stripKeys<T>(item) as T);
};

export const listCategories = () => queryCollection<CategoryRecord>("CATALOG#CATEGORY");
export const listProducts = () => queryCollection<ProductRecord>("CATALOG#PRODUCT");
export const listSales = (limit = 50) => queryCollection<SaleRecord>("SALE", { limit });
export const listAudits = (limit = 100) => queryCollection<AuditRecord>("AUDIT", { limit });

export const getProductPage = async (options: {
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
  const products = (await listProducts()).filter((product) => {
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

export const getCategory = async (id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: categoryKey(id) }));
  return stripKeys<CategoryRecord>(response.Item);
};

export const getProduct = async (id: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: productKey(id) }));
  return stripKeys<ProductRecord>(response.Item);
};

export const findProduct = async (term: string) => {
  const normalized = normalizeLookup(term);
  for (const kind of ["BARCODE", "SKU"] as const) {
    const lookup = await dynamoDB.send(
      new GetCommand({ TableName: TABLE_NAME, Key: lookupKey(kind, normalized) }),
    );
    const productId = lookup.Item?.productId;
    if (typeof productId === "string") return getProduct(productId);
  }
  return null;
};

export const createCategory = async (
  input: Omit<CategoryRecord, "id" | "createdAt" | "updatedAt">,
  actor: { id: string; name: string },
) => {
  const id = randomUUID();
  const now = new Date().toISOString();
  const category = { ...input, code: normalizeLookup(input.code) };
  const item = { ...categoryKey(id), GSI1PK: "CATALOG#CATEGORY", GSI1SK: `${category.name.toLowerCase()}#${id}`, entityType: "category", id, ...category, createdAt: now, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(PK)" } },
    { Put: { TableName: TABLE_NAME, Item: { ...lookupKey("CATEGORY", category.code), entityType: "category_lookup", categoryId: id }, ConditionExpression: "attribute_not_exists(PK)" } },
    auditPut({ action: "category.created", entityType: "category", entityId: id, reason: "Category created", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return stripKeys<CategoryRecord>(item)!;
};

export const createProduct = async (
  input: Omit<ProductRecord, "id" | "categoryName" | "stock" | "status" | "createdAt" | "updatedAt"> & { initialStock: number },
  actor: { id: string; name: string },
) => {
  const category = await getCategory(input.categoryId);
  if (!category || category.status !== "active") throw new Error("Select an active category");
  const id = randomUUID();
  const now = new Date().toISOString();
  const { initialStock, ...values } = input;
  const product: ProductRecord = { id, ...values, sku: normalizeLookup(input.sku), barcode: normalizeLookup(input.barcode), categoryName: category.name, stock: initialStock, status: "active", createdAt: now, updatedAt: now };
  const item = { ...productKey(id), GSI1PK: "CATALOG#PRODUCT", GSI1SK: `${product.name.toLowerCase()}#${id}`, entityType: "product", ...product };
  const lookupItems = [
    { ...lookupKey("SKU", product.sku), entityType: "product_lookup", productId: id },
    ...(product.barcode && product.barcode !== product.sku ? [{ ...lookupKey("BARCODE", product.barcode), entityType: "product_lookup", productId: id }] : []),
  ];
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [
    { Put: { TableName: TABLE_NAME, Item: item, ConditionExpression: "attribute_not_exists(PK)" } },
    ...lookupItems.map((lookup) => ({ Put: { TableName: TABLE_NAME, Item: lookup, ConditionExpression: "attribute_not_exists(PK)" } })),
    auditPut({ action: "product.created", entityType: "product", entityId: id, productName: product.name, quantityBefore: 0, quantityAfter: initialStock, quantityDelta: initialStock, reason: "Initial stock", actorId: actor.id, actorName: actor.name }, now),
  ] }));
  return product;
};

export const updateProduct = async (
  id: string,
  updates: Partial<Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "price" | "cost" | "minStock" | "status">>,
  actor: { id: string; name: string },
) => {
  const current = await getProduct(id);
  if (!current) throw new Error("Product not found");
  const categoryId = updates.categoryId ?? current.categoryId;
  const category = await getCategory(categoryId);
  if (!category) throw new Error("Category not found");
  const now = new Date().toISOString();
  const next: ProductRecord = { ...current, ...updates, sku: normalizeLookup(updates.sku ?? current.sku), barcode: normalizeLookup(updates.barcode ?? current.barcode), categoryId, categoryName: category.name, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  const aliases = [
    { kind: "SKU" as const, oldValue: current.sku, newValue: next.sku },
    { kind: "BARCODE" as const, oldValue: current.barcode, newValue: next.barcode },
  ];
  for (const alias of aliases) {
    if (alias.oldValue === alias.newValue || !alias.newValue) continue;
    if (alias.oldValue) transaction.push({ Delete: { TableName: TABLE_NAME, Key: lookupKey(alias.kind, alias.oldValue) } });
    transaction.push({ Put: { TableName: TABLE_NAME, Item: { ...lookupKey(alias.kind, alias.newValue), entityType: "product_lookup", productId: id }, ConditionExpression: "attribute_not_exists(PK)" } });
  }
  transaction.push(
    { Put: { TableName: TABLE_NAME, Item: { ...productKey(id), GSI1PK: "CATALOG#PRODUCT", GSI1SK: `${next.name.toLowerCase()}#${id}`, entityType: "product", ...next }, ConditionExpression: "attribute_exists(PK)" } },
    auditPut({ action: "product.updated", entityType: "product", entityId: id, productName: next.name, reason: "Product details updated", actorId: actor.id, actorName: actor.name }, now),
  );
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return next;
};

export const adjustStock = async (
  productId: string,
  delta: number,
  reason: string,
  actor: { id: string; name: string },
) => {
  const [updated] = await adjustStocks([{ productId, delta }], reason, actor);
  return updated;
};

export const adjustStocks = async (
  adjustments: Array<{ productId: string; delta: number }>,
  reason: string,
  actor: { id: string; name: string },
) => {
  if (adjustments.length === 0) throw new Error("Add at least one stock adjustment");
  if (adjustments.length > 49) throw new Error("A stock count can adjust at most 49 products at once");
  if (new Set(adjustments.map(({ productId }) => productId)).size !== adjustments.length) {
    throw new Error("Each product can appear only once in a stock count");
  }
  if (adjustments.some(({ delta }) => !Number.isInteger(delta) || delta === 0)) {
    throw new Error("Stock adjustments must be non-zero whole numbers");
  }
  if (reason.trim().length < 3) throw new Error("A meaningful stock adjustment reason is required");
  const currentProducts = await Promise.all(adjustments.map(({ productId }) => getProduct(productId)));
  if (currentProducts.some((product) => !product)) throw new Error("One or more products were not found");
  const now = new Date().toISOString();
  const updated = currentProducts.map((product, index) => {
    const current = product!;
    const delta = adjustments[index].delta;
    const stock = current.stock + delta;
    if (stock < 0) throw new Error(`${current.name} cannot be adjusted below zero`);
    return { ...current, stock, updatedAt: now };
  });
  const transaction = updated.flatMap((product, index) => {
    const delta = adjustments[index].delta;
    const current = currentProducts[index]!;
    return [
      { Update: { TableName: TABLE_NAME, Key: productKey(product.id), UpdateExpression: "SET #stock = #stock + :delta, updatedAt = :now", ConditionExpression: "attribute_exists(PK) AND #stock + :delta >= :zero", ExpressionAttributeNames: { "#stock": "stock" }, ExpressionAttributeValues: { ":delta": delta, ":zero": 0, ":now": now } } },
      auditPut({ action: "stock.adjusted", entityType: "product", entityId: product.id, productName: product.name, quantityBefore: current.stock, quantityAfter: product.stock, quantityDelta: delta, reason: reason.trim(), actorId: actor.id, actorName: actor.name }, now),
    ];
  });
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return updated;
};

export const completeSale = async (
  input: { customerName?: string; paymentMethod: SaleRecord["paymentMethod"]; items: Array<{ productId: string; quantity: number }> },
  actor: { id: string; name: string },
) => {
  const grouped = new Map<string, number>();
  for (const item of input.items) grouped.set(item.productId, (grouped.get(item.productId) ?? 0) + item.quantity);
  if (grouped.size === 0) throw new Error("Add at least one product to the sale");
  if (grouped.size > 10) throw new Error("A sale can contain at most 10 distinct products");
  if ([...grouped.values()].some((quantity) => !Number.isInteger(quantity) || quantity <= 0)) throw new Error("Sale quantities must be positive whole numbers");
  const products = await Promise.all([...grouped.keys()].map(getProduct));
  if (products.some((product) => !product || product.status !== "active")) throw new Error("One or more products are unavailable");
  const now = new Date().toISOString();
  const id = randomUUID();
  const saleItems: SaleItemRecord[] = products.map((product) => {
    const value = product!;
    const quantity = grouped.get(value.id)!;
    if (value.stock < quantity) throw new Error(`${value.name} has only ${value.stock} units available`);
    return { productId: value.id, productName: value.name, sku: value.sku, barcode: value.barcode, quantity, price: value.price, cost: value.cost, total: value.price * quantity };
  });
  const subtotal = saleItems.reduce((sum, item) => sum + item.total, 0);
  const sale: SaleRecord = { id, orderNumber: `SALE-${businessDate().replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, customerName: input.customerName?.trim() || "Cash customer", items: saleItems, subtotal, tax: 0, discount: 0, totalAmount: subtotal, status: "completed", paymentMethod: input.paymentMethod, paymentStatus: "paid", createdBy: actor.id, createdByName: actor.name, createdAt: now, updatedAt: now };
  const transaction: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
  for (const item of saleItems) {
    const product = products.find((candidate) => candidate?.id === item.productId)!;
    transaction.push(
      { Update: { TableName: TABLE_NAME, Key: productKey(item.productId), UpdateExpression: "SET #stock = #stock - :quantity, updatedAt = :now", ConditionExpression: "#status = :active AND #stock >= :quantity", ExpressionAttributeNames: { "#stock": "stock", "#status": "status" }, ExpressionAttributeValues: { ":quantity": item.quantity, ":active": "active", ":now": now } } },
      auditPut({ action: "stock.sold", entityType: "product", entityId: item.productId, productName: item.productName, quantityBefore: product.stock, quantityAfter: product.stock - item.quantity, quantityDelta: -item.quantity, reason: `Sale ${sale.orderNumber}`, referenceId: id, actorId: actor.id, actorName: actor.name }, now),
    );
  }
  transaction.push({ Put: { TableName: TABLE_NAME, Item: { PK: `SALE#${id}`, SK: "RECEIPT", GSI1PK: "SALE", GSI1SK: `${now}#${id}`, entityType: "sale", ...sale }, ConditionExpression: "attribute_not_exists(PK)" } });
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: transaction }));
  return sale;
};

export const dashboardSummary = async () => {
  const start = new Date(`${businessDate()}T00:00:00+03:00`).toISOString();
  const [products, sales, audits] = await Promise.all([
    listProducts(),
    queryCollection<SaleRecord>("SALE", { from: start }),
    listAudits(8),
  ]);
  return {
    salesTotal: sales.reduce((sum, sale) => sum + sale.totalAmount, 0),
    salesCount: sales.length,
    itemsSold: sales.flatMap((sale) => sale.items).reduce((sum, item) => sum + item.quantity, 0),
    productCount: products.filter((product) => product.status === "active").length,
    lowStock: products.filter((product) => product.status === "active" && product.stock <= product.minStock),
    recentSales: [...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
    recentAudits: audits,
  };
};

export const getStaffProfile = async (userId: string) => {
  const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: profileKey(userId) }));
  return stripKeys<StaffProfileRecord>(response.Item);
};

export const getStaffProfiles = async (userIds: string[]) => {
  if (userIds.length === 0) return new Map<string, StaffProfileRecord>();
  const response = await dynamoDB.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: userIds.map(profileKey) } } }));
  return new Map((response.Responses?.[TABLE_NAME] ?? []).map((item) => {
    const profile = stripKeys<StaffProfileRecord>(item)!;
    return [profile.userId, profile];
  }));
};

export const upsertStaffProfile = async (
  userId: string,
  input: Pick<StaffProfileRecord, "employeeCode" | "jobTitle" | "phone">,
) => {
  const current = await getStaffProfile(userId);
  const now = new Date().toISOString();
  const profile: StaffProfileRecord = { userId, employeeCode: input.employeeCode.trim(), jobTitle: input.jobTitle.trim(), phone: input.phone.trim(), createdAt: current?.createdAt ?? now, updatedAt: now };
  await dynamoDB.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE_NAME, Item: { ...profileKey(userId), entityType: "staff_profile", ...profile } } }] }));
  return profile;
};
