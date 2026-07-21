import { readFile } from "node:fs/promises";
import {
  createCategory,
  createProduct,
  findProduct,
  listCategories,
  type ProductRecord,
  updateCategory,
  updateProduct,
} from "../repositories/pos-repository";
import {
  createPurchaseOrder,
  createStore,
  createSupplier,
  createTransfer,
  dispatchTransfer,
  listPurchaseOrders,
  listStores,
  listSuppliers,
  listTransfers,
  receivePurchaseOrder,
  receiveTransfer,
  setPurchaseOrderStatus,
  updateStore,
  updateSupplier,
  upsertStorePolicy,
  upsertSupplierProduct,
} from "../repositories/supply-chain-repository";
import { verifyAwsConnection } from "../config/db";
import { getTenantRecord } from "../repositories/tenant-repository";
import { buildMvpSeed, type SeedFile } from "../seed/mvp-catalog";

const actor = { id: "system-seed", name: "MVP seed loader" };

const assertSeedFile: (value: unknown) => asserts value is SeedFile = (value) => {
  if (!value || typeof value !== "object") throw new Error("Seed file must contain an object");
  const seed = value as Partial<SeedFile>;
  if (!Array.isArray(seed.categories) || !Array.isArray(seed.products)) {
    throw new Error("Seed file must contain categories and products arrays");
  }
  const categoryCodes = new Set<string>();
  for (const category of seed.categories) {
    if (!category.code?.trim() || !category.name?.trim()) throw new Error("Every category needs code and name");
    const code = category.code.trim().toUpperCase();
    if (categoryCodes.has(code)) throw new Error(`Duplicate category code: ${code}`);
    categoryCodes.add(code);
  }
  for (const category of seed.categories) {
    const parentCode = category.parentCode?.trim().toUpperCase();
    if (parentCode && !categoryCodes.has(parentCode)) throw new Error(`Unknown parent category code for ${category.code}: ${parentCode}`);
    if (parentCode === category.code.trim().toUpperCase()) throw new Error(`${category.code} cannot be its own parent`);
  }
  const categoryParents = new Map(seed.categories.map((category) => [category.code.trim().toUpperCase(), category.parentCode?.trim().toUpperCase()]));
  for (const code of categoryCodes) {
    const visited = new Set<string>();
    let cursor: string | undefined = code;
    while (cursor) {
      if (visited.has(cursor)) throw new Error(`Category hierarchy contains a cycle at ${cursor}`);
      visited.add(cursor);
      cursor = categoryParents.get(cursor);
    }
  }
  const skus = new Set<string>();
  const barcodes = new Set<string>();
  for (const product of seed.products) {
    if (!product.name?.trim() || !product.sku?.trim() || !product.barcode?.trim()) throw new Error("Every product needs name, SKU, and barcode");
    if (!categoryCodes.has(product.categoryCode?.trim().toUpperCase())) throw new Error(`Unknown category code for ${product.name}`);
    if (skus.has(product.sku.toUpperCase()) || barcodes.has(product.barcode.toUpperCase())) throw new Error(`Duplicate product lookup value for ${product.name}`);
    skus.add(product.sku.toUpperCase());
    barcodes.add(product.barcode.toUpperCase());
    for (const [field, amount] of [["sellingPrice", product.sellingPrice], ["buyingPrice", product.buyingPrice]] as const) {
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`${product.name} has invalid ${field}`);
    }
    if (product.promotionPrice != null && (!Number.isFinite(product.promotionPrice) || product.promotionPrice < 0 || product.promotionPrice >= product.sellingPrice)) {
      throw new Error(`${product.name} has an invalid promotion price`);
    }
  }
  if (!seed.supplyChain) return;
  const storeCodes = new Set<string>();
  for (const store of seed.supplyChain.stores) {
    const code = store.code?.trim().toUpperCase();
    if (!code || !store.name?.trim() || !store.address?.trim()) throw new Error("Every seed store needs code, name, and address");
    if (storeCodes.has(code)) throw new Error(`Duplicate seed store code: ${code}`);
    storeCodes.add(code);
  }
  const supplierCodes = new Set<string>();
  for (const supplier of seed.supplyChain.suppliers) {
    const code = supplier.code?.trim().toUpperCase();
    if (!code || !supplier.name?.trim()) throw new Error("Every seed supplier needs code and name");
    if (supplierCodes.has(code)) throw new Error(`Duplicate seed supplier code: ${code}`);
    supplierCodes.add(code);
  }
  const productSkus = new Set(seed.products.map((product) => product.sku.trim().toUpperCase()));
  const supplierProducts = new Set<string>();
  const preferredProducts = new Set<string>();
  for (const item of seed.supplyChain.supplierProducts) {
    const supplierCode = item.supplierCode?.trim().toUpperCase();
    const productSku = item.productSku?.trim().toUpperCase();
    if (!supplierCodes.has(supplierCode)) throw new Error(`Unknown supplier code in catalog: ${supplierCode}`);
    if (!productSkus.has(productSku)) throw new Error(`Unknown product SKU in supplier catalog: ${productSku}`);
    if (!item.purchaseUnit?.trim() || !item.purchaseMeasurementUnit?.trim() || !Number.isFinite(item.purchaseQuantity) || item.purchaseQuantity <= 0) throw new Error(`Invalid supplier package for ${productSku}`);
    const key = `${supplierCode}#${productSku}`;
    if (supplierProducts.has(key)) throw new Error(`Duplicate supplier catalog entry: ${key}`);
    supplierProducts.add(key);
    if (item.preferred && preferredProducts.has(productSku)) throw new Error(`Multiple preferred suppliers configured for ${productSku}`);
    if (item.preferred) preferredProducts.add(productSku);
  }
  const purchaseOrderKeys = new Set<string>();
  for (const order of seed.supplyChain.purchaseOrders) {
    if (!order.key?.trim() || purchaseOrderKeys.has(order.key)) throw new Error(`Duplicate or missing seed purchase-order key: ${order.key}`);
    purchaseOrderKeys.add(order.key);
    const supplierCode = order.supplierCode.trim().toUpperCase();
    if (!supplierCodes.has(supplierCode)) throw new Error(`Unknown purchase-order supplier: ${supplierCode}`);
    if (!storeCodes.has(order.storeCode.trim().toUpperCase())) throw new Error(`Unknown purchase-order store: ${order.storeCode}`);
    if (!order.lines.length || order.lines.length > 40) throw new Error(`${order.key} must contain 1 to 40 lines`);
    for (const line of order.lines) {
      const productSku = line.productSku.trim().toUpperCase();
      if (!supplierProducts.has(`${supplierCode}#${productSku}`)) throw new Error(`${productSku} is not configured for supplier ${supplierCode}`);
      if (!Number.isInteger(line.orderedPurchaseQuantity) || line.orderedPurchaseQuantity < 1) throw new Error(`${order.key} has an invalid ordered quantity`);
      if (line.expiryDays != null && (!Number.isInteger(line.expiryDays) || line.expiryDays < 0)) throw new Error(`${order.key} has an invalid expiry offset`);
    }
  }
  const policyKeys = new Set<string>();
  for (const policy of seed.supplyChain.storePolicies) {
    if (!storeCodes.has(policy.storeCode.trim().toUpperCase())) throw new Error(`Unknown policy store: ${policy.storeCode}`);
    if (!productSkus.has(policy.productSku.trim().toUpperCase())) throw new Error(`Unknown policy product: ${policy.productSku}`);
    if (!Number.isInteger(policy.reorderPoint) || !Number.isInteger(policy.targetQuantity) || policy.reorderPoint < 0 || policy.targetQuantity < policy.reorderPoint) throw new Error(`Invalid store policy for ${policy.productSku}`);
    const key = `${policy.storeCode.trim().toUpperCase()}#${policy.productSku.trim().toUpperCase()}`;
    if (policyKeys.has(key)) throw new Error(`Duplicate store policy: ${key}`);
    policyKeys.add(key);
  }
  const transferKeys = new Set<string>();
  for (const transfer of seed.supplyChain.transfers) {
    if (!transfer.key?.trim() || transferKeys.has(transfer.key)) throw new Error(`Duplicate or missing seed transfer key: ${transfer.key}`);
    transferKeys.add(transfer.key);
    if (!storeCodes.has(transfer.fromStoreCode.trim().toUpperCase()) || !storeCodes.has(transfer.toStoreCode.trim().toUpperCase())) throw new Error(`${transfer.key} references an unknown store`);
    if (transfer.fromStoreCode.trim().toUpperCase() === transfer.toStoreCode.trim().toUpperCase()) throw new Error(`${transfer.key} must use different stores`);
    if (!transfer.lines.length || transfer.lines.length > 40) throw new Error(`${transfer.key} must contain 1 to 40 lines`);
    if (new Set(transfer.lines.map((line) => line.productSku.trim().toUpperCase())).size !== transfer.lines.length) throw new Error(`${transfer.key} contains duplicate products`);
    for (const line of transfer.lines) if (!productSkus.has(line.productSku.trim().toUpperCase()) || !Number.isInteger(line.quantity) || line.quantity < 1) throw new Error(`${transfer.key} has an invalid line`);
  }
};

const dateAfterDays = (days: number) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

async function main() {
  const file = process.argv.find((argument, index) => index > 1 && !argument.startsWith("--"));
  const parsed: unknown = file ? JSON.parse(await readFile(file, "utf8")) : buildMvpSeed();
  assertSeedFile(parsed);
  if (process.argv.includes("--validate-only")) {
    const supplySummary = parsed.supplyChain ? `, ${parsed.supplyChain.stores.length} stores, ${parsed.supplyChain.suppliers.length} suppliers, ${parsed.supplyChain.supplierProducts.length} supplier catalog entries, ${parsed.supplyChain.purchaseOrders.length} purchase orders, and ${parsed.supplyChain.transfers.length} transfers` : "";
    console.log(`Validated ${parsed.categories.length} categories and ${parsed.products.length} products${supplySummary}`);
    return;
  }
  const tenantArgument = process.argv.find((argument) => argument.startsWith("--tenant="))?.slice("--tenant=".length).trim();
  const tenantId = tenantArgument || process.env.POS_TENANT_ID;
  if (!tenantId) throw new Error("Set POS_TENANT_ID or pass --tenant=<business-id> when loading seed data");
  if (!(await verifyAwsConnection())) throw new Error("DynamoDB is not available");
  if (!(await getTenantRecord(tenantId))) throw new Error(`Business workspace ${tenantId} does not exist`);

  const existingCategories = await listCategories(tenantId);
  const categoriesByCode = new Map(existingCategories.map((category) => [category.code, category]));
  for (const category of parsed.categories) {
    const code = category.code.trim().toUpperCase();
    if (!categoriesByCode.has(code)) {
      const parentId = category.parentCode ? categoriesByCode.get(category.parentCode.trim().toUpperCase())?.id : null;
      if (category.parentCode && !parentId) throw new Error(`Parent category ${category.parentCode} must be seeded before ${code}`);
      const created = await createCategory(tenantId, { code, name: category.name.trim(), description: category.description?.trim() ?? "", parentId, status: "active" }, actor);
      categoriesByCode.set(code, created);
      console.log(`Created category ${code}`);
    } else {
      const existing = categoriesByCode.get(code)!;
      const parentId = category.parentCode ? categoriesByCode.get(category.parentCode.trim().toUpperCase())?.id : null;
      if (category.parentCode && !parentId) throw new Error(`Parent category ${category.parentCode} must be seeded before ${code}`);
      const saved = await updateCategory(tenantId, existing.id, { code, name: category.name.trim(), description: category.description?.trim() ?? "", parentId }, actor);
      categoriesByCode.set(code, saved);
      console.log(`Updated category ${code}`);
    }
  }

  // Keep concurrency deliberately bounded to make a 200-product seed fast
  // without creating a burst that can overwhelm a small on-demand table.
  const productsBySku = new Map<string, ProductRecord>();
  for (let offset = 0; offset < parsed.products.length; offset += 5) {
    await Promise.all(parsed.products.slice(offset, offset + 5).map(async (product) => {
      const category = categoriesByCode.get(product.categoryCode.trim().toUpperCase())!;
      const existing = await findProduct(tenantId, product.sku);
      if (existing) {
        const saved = await updateProduct(tenantId, existing.id, {
          name: product.name.trim(),
          description: product.description?.trim() ?? "",
          sku: product.sku,
          barcode: product.barcode,
          categoryId: category.id,
          sellingPrice: product.sellingPrice,
          buyingPrice: product.buyingPrice,
          stockUnit: product.baseUnit,
          tracksExpiry: product.tracksExpiry,
          promotionPrice: product.promotionPrice ?? null,
          status: "active",
        }, actor);
        productsBySku.set(product.sku.trim().toUpperCase(), saved);
        console.log(`Updated product ${product.sku}; store inventory was not changed`);
      } else {
        const saved = await createProduct(tenantId, {
          name: product.name.trim(),
          description: product.description?.trim() ?? "",
          sku: product.sku,
          barcode: product.barcode,
          categoryId: category.id,
          sellingPrice: product.sellingPrice,
          buyingPrice: product.buyingPrice,
          stockUnit: product.baseUnit,
          tracksExpiry: product.tracksExpiry,
          promotionPrice: product.promotionPrice ?? null,
        }, actor);
        productsBySku.set(product.sku.trim().toUpperCase(), saved);
        console.log(`Created product ${product.sku}`);
      }
    }));
  }

  if (!parsed.supplyChain) return;
  const storesByCode = new Map((await listStores(tenantId)).map((store) => [store.code, store]));
  for (const input of parsed.supplyChain.stores) {
    const code = input.code.trim().toUpperCase();
    const existing = storesByCode.get(code);
    const saved = existing
      ? await updateStore(tenantId, existing.id, { name: input.name, address: input.address, receiptPhone: input.receiptPhone ?? "", receiptFooter: input.receiptFooter ?? "", status: "active" })
      : await createStore(tenantId, { ...input, code }, actor);
    storesByCode.set(code, saved);
    console.log(`${existing ? "Updated" : "Created"} store ${code}`);
  }

  const existingSuppliers = await listSuppliers(tenantId);
  const suppliersByCode = new Map(existingSuppliers.map((supplier) => [supplier.code, supplier]));
  for (const input of parsed.supplyChain.suppliers) {
    const code = input.code.trim().toUpperCase();
    const existing = suppliersByCode.get(code);
    const saved = existing
      ? await updateSupplier(tenantId, existing.id, { name: input.name, contactName: input.contactName, phone: input.phone, email: input.email, address: input.address, status: "active" })
      : await createSupplier(tenantId, { ...input, code });
    suppliersByCode.set(code, saved);
    console.log(`${existing ? "Updated" : "Created"} supplier ${code}`);
  }

  for (const input of parsed.supplyChain.supplierProducts) {
    const supplier = suppliersByCode.get(input.supplierCode.trim().toUpperCase())!;
    const product = productsBySku.get(input.productSku.trim().toUpperCase())!;
    await upsertSupplierProduct(tenantId, {
      supplierId: supplier.id,
      productId: product.id,
      supplierSku: input.supplierSku ?? "",
      purchaseUnit: input.purchaseUnit,
      purchaseQuantity: input.purchaseQuantity,
      purchaseMeasurementUnit: input.purchaseMeasurementUnit,
      lastPurchasePrice: input.lastPurchasePrice ?? null,
      preferred: input.preferred ?? false,
    });
  }
  for (const input of parsed.supplyChain.storePolicies) {
    await upsertStorePolicy(tenantId, { storeId: storesByCode.get(input.storeCode.trim().toUpperCase())!.id, productId: productsBySku.get(input.productSku.trim().toUpperCase())!.id, reorderPoint: input.reorderPoint, targetQuantity: input.targetQuantity });
  }
  console.log(`Configured ${parsed.supplyChain.supplierProducts.length} supplier catalog entries and ${parsed.supplyChain.storePolicies.length} store policies`);

  const productsById = new Map([...productsBySku.values()].map((product) => [product.id, product]));
  const existingOrders = await listPurchaseOrders(tenantId, { limit: 200 });
  for (const specification of parsed.supplyChain.purchaseOrders) {
    const marker = `[seed:mvp:${specification.key}]`;
    let order = existingOrders.find((item) => item.notes.includes(marker));
    if (!order) {
      const supplier = suppliersByCode.get(specification.supplierCode.trim().toUpperCase())!;
      order = await createPurchaseOrder(tenantId, {
        supplierId: supplier.id,
        storeId: storesByCode.get(specification.storeCode.trim().toUpperCase())!.id,
        expectedDeliveryDate: dateAfterDays(specification.status === "completed" ? 0 : 7),
        notes: `${specification.notes}\n${marker}`,
        lines: specification.lines.map((line) => ({
          productId: productsBySku.get(line.productSku.trim().toUpperCase())!.id,
          orderedPurchaseQuantity: line.orderedPurchaseQuantity,
          pricePerPurchaseUnit: line.pricePerPurchaseUnit ?? null,
        })),
      }, actor, `mvp-seed-create-${specification.key}`);
      console.log(`Created ${specification.key} as ${order.orderNumber}`);
    }
    if (specification.status !== "draft" && order.status === "draft") order = await setPurchaseOrderStatus(tenantId, order.id, "issue", "");
    const shouldComplete = specification.status === "completed" && (order.status === "issued" || order.status === "partially_received");
    const shouldPartiallyReceive = specification.status === "partially_received" && order.status === "issued" && order.receiptCount === 0;
    if (shouldComplete || shouldPartiallyReceive) {
      const receiptLines = order.lines.map((line, index) => {
        const outstanding = line.orderedPurchaseQuantity * line.unitsPerPurchaseUnit - line.acceptedBaseQuantity;
        const acceptedBaseQuantity = shouldComplete ? outstanding : Math.max(1, Math.floor(outstanding / 2));
        const damagedBaseQuantity = shouldPartiallyReceive && index === 0 ? 1 : 0;
        const product = productsById.get(line.productId)!;
        return {
          purchaseOrderLineId: line.id,
          batchNumber: `SEED-${specification.key.slice(0, 8).toUpperCase()}-${index + 1}`,
          expiryDate: product.tracksExpiry ? dateAfterDays(specification.lines[index]?.expiryDays ?? (product.categoryName.toLowerCase().includes("bakery") ? 14 : 180)) : null,
          deliveredBaseQuantity: acceptedBaseQuantity + damagedBaseQuantity,
          acceptedBaseQuantity,
          damagedBaseQuantity,
          rejectedBaseQuantity: 0,
          actualPricePerPurchaseUnit: Math.max(0, line.pricePerPurchaseUnit + (index % 2 === 0 ? 15 : -5)),
        };
      });
      await receivePurchaseOrder(tenantId, order.id, `SEED-DN-${specification.key.toUpperCase()}`, `SEED-INV-${specification.key.toUpperCase()}`, receiptLines, actor, `mvp-seed-receive-${specification.key}`);
      console.log(`${shouldComplete ? "Completed" : "Partially received"} ${order.orderNumber}`);
    } else {
      console.log(`Kept ${order.orderNumber} in ${order.status} status`);
    }
  }

  const existingTransfers = await listTransfers(tenantId, { limit: 200 });
  for (const specification of parsed.supplyChain.transfers) {
    const marker = `[seed:mvp:${specification.key}]`;
    let transfer = existingTransfers.find((item) => item.notes.includes(marker));
    if (!transfer) {
      transfer = await createTransfer(tenantId, {
        fromStoreId: storesByCode.get(specification.fromStoreCode.trim().toUpperCase())!.id,
        toStoreId: storesByCode.get(specification.toStoreCode.trim().toUpperCase())!.id,
        notes: `${specification.notes}\n${marker}`,
        lines: specification.lines.map((line) => ({ productId: productsBySku.get(line.productSku.trim().toUpperCase())!.id, quantity: line.quantity })),
      }, actor, `mvp-seed-create-transfer-${specification.key}`);
      console.log(`Created ${specification.key} as ${transfer.transferNumber}`);
    }
    if (specification.status !== "draft" && transfer.status === "draft") {
      transfer = await dispatchTransfer(tenantId, transfer.id, actor, `mvp-seed-dispatch-transfer-${specification.key}`);
    }
    if (specification.status === "completed" && transfer.status === "dispatched") {
      const receiptLines = transfer.lines.flatMap((line) => (line.allocations ?? []).map((allocation) => ({ lotId: allocation.lotId, receivedQuantity: allocation.quantity, damagedQuantity: 0, missingQuantity: 0, reason: "" })));
      transfer = await receiveTransfer(tenantId, transfer.id, receiptLines, actor, `mvp-seed-receive-transfer-${specification.key}`);
    }
    console.log(`Kept ${transfer.transferNumber} in ${transfer.status} status`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
