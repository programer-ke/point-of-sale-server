import { readFile } from "node:fs/promises";
import {
  createCategory,
  createProduct,
  findProduct,
  listCategories,
  updateProduct,
} from "../repositories/pos-repository";
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
};

async function main() {
  const file = process.argv.find((argument, index) => index > 1 && !argument.startsWith("--"));
  const parsed: unknown = file ? JSON.parse(await readFile(file, "utf8")) : buildMvpSeed();
  assertSeedFile(parsed);
  if (process.argv.includes("--validate-only")) {
    console.log(`Validated ${parsed.categories.length} categories and ${parsed.products.length} products`);
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
      const created = await createCategory(tenantId, { code, name: category.name.trim(), description: category.description?.trim() ?? "", status: "active" }, actor);
      categoriesByCode.set(code, created);
      console.log(`Created category ${code}`);
    } else {
      console.log(`Kept existing category ${code}`);
    }
  }

  // Keep concurrency deliberately bounded to make a 200-product seed fast
  // without creating a burst that can overwhelm a small on-demand table.
  for (let offset = 0; offset < parsed.products.length; offset += 5) {
    await Promise.all(parsed.products.slice(offset, offset + 5).map(async (product) => {
      const category = categoriesByCode.get(product.categoryCode.trim().toUpperCase())!;
      const existing = await findProduct(tenantId, product.sku);
      if (existing) {
        await updateProduct(tenantId, existing.id, {
          name: product.name.trim(),
          description: product.description?.trim() ?? "",
          sku: product.sku,
          barcode: product.barcode,
          categoryId: category.id,
          sellingPrice: product.sellingPrice,
          buyingPrice: product.buyingPrice,
          baseUnit: product.baseUnit,
          tracksExpiry: product.tracksExpiry,
          promotionPrice: product.promotionPrice ?? null,
          status: "active",
        }, actor);
        console.log(`Updated product ${product.sku}; store inventory was not changed`);
      } else {
        await createProduct(tenantId, {
          name: product.name.trim(),
          description: product.description?.trim() ?? "",
          sku: product.sku,
          barcode: product.barcode,
          categoryId: category.id,
          sellingPrice: product.sellingPrice,
          buyingPrice: product.buyingPrice,
          baseUnit: product.baseUnit,
          tracksExpiry: product.tracksExpiry,
          promotionPrice: product.promotionPrice ?? null,
        }, actor);
        console.log(`Created product ${product.sku}`);
      }
    }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
