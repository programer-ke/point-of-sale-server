import { readFile } from "node:fs/promises";
import {
  createCategory,
  createProduct,
  findProduct,
  listCategories,
  updateProduct,
} from "../repositories/pos-repository";
import { verifyAwsConnection } from "../config/db";

interface SeedFile {
  categories: Array<{ code: string; name: string; description?: string }>;
  products: Array<{
    name: string;
    description?: string;
    sku: string;
    barcode: string;
    categoryCode: string;
    price: number;
    cost: number;
    initialStock: number;
    minStock: number;
  }>;
}

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
    for (const [field, amount] of [["price", product.price], ["cost", product.cost], ["initialStock", product.initialStock], ["minStock", product.minStock]] as const) {
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`${product.name} has invalid ${field}`);
    }
  }
};

async function main() {
  const file = process.argv[2] ?? "seed-data/mvp.json";
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  assertSeedFile(parsed);
  if (process.argv.includes("--validate-only")) {
    console.log(`Validated ${parsed.categories.length} categories and ${parsed.products.length} products`);
    return;
  }
  if (!(await verifyAwsConnection())) throw new Error("DynamoDB is not available");

  const existingCategories = await listCategories();
  const categoriesByCode = new Map(existingCategories.map((category) => [category.code, category]));
  for (const category of parsed.categories) {
    const code = category.code.trim().toUpperCase();
    if (!categoriesByCode.has(code)) {
      const created = await createCategory({ code, name: category.name.trim(), description: category.description?.trim() ?? "", status: "active" }, actor);
      categoriesByCode.set(code, created);
      console.log(`Created category ${code}`);
    } else {
      console.log(`Kept existing category ${code}`);
    }
  }

  for (const product of parsed.products) {
    const category = categoriesByCode.get(product.categoryCode.trim().toUpperCase())!;
    const existing = await findProduct(product.sku);
    if (existing) {
      await updateProduct(existing.id, {
        name: product.name.trim(),
        description: product.description?.trim() ?? "",
        sku: product.sku,
        barcode: product.barcode,
        categoryId: category.id,
        price: product.price,
        cost: product.cost,
        minStock: product.minStock,
        status: "active",
      }, actor);
      console.log(`Updated product ${product.sku}; preserved stock ${existing.stock}`);
    } else {
      await createProduct({
        name: product.name.trim(),
        description: product.description?.trim() ?? "",
        sku: product.sku,
        barcode: product.barcode,
        categoryId: category.id,
        price: product.price,
        cost: product.cost,
        initialStock: product.initialStock,
        minStock: product.minStock,
      }, actor);
      console.log(`Created product ${product.sku}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
