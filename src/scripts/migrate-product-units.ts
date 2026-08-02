import { randomUUID } from "node:crypto";
import { getBusinessMeasurementSettings, listProducts, productUnitsOf, updateBusinessMeasurementSettings, updateProduct } from "../repositories/pos-repository";
import { listSupplierProducts, upsertSupplierProduct } from "../repositories/supply-chain-repository";

const tenantId = process.argv[2]?.trim();
if (!tenantId) throw new Error("Usage: yarn migrate:product-units <tenant-id>");

const actor = { id: "system:migrate-product-units", name: "Product unit migration" };
const normalizeCode = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const run = async () => {
  const settings = await getBusinessMeasurementSettings(tenantId);
  await updateBusinessMeasurementSettings(tenantId, settings.packageLabels, actor);
  const allowedPackages = new Set(settings.packageLabels.map(({ code }) => code));
  const [products, supplierProducts] = await Promise.all([listProducts(tenantId), listSupplierProducts(tenantId)]);

  for (let product of products) {
    let units = productUnitsOf(product);
    if (!product.productUnits?.length) {
      for (const supplierProduct of supplierProducts.filter(({ productId }) => productId === product.id)) {
        if (units.some(({ quantityInBaseUnits }) => quantityInBaseUnits === supplierProduct.unitsPerPurchaseUnit)) continue;
        const requestedCode = normalizeCode(supplierProduct.purchaseUnit);
        const labelCode = allowedPackages.has(requestedCode) ? requestedCode : "pack";
        const sameNameCount = units.filter(({ name }) => name.toLowerCase() === supplierProduct.purchaseUnit.toLowerCase()).length;
        units.push({ id: randomUUID(), labelCode, name: sameNameCount ? `${supplierProduct.purchaseUnit} (${supplierProduct.unitsPerPurchaseUnit} base units)` : supplierProduct.purchaseUnit, parentUnitId: null, multiplier: 1, quantityInBaseUnits: supplierProduct.unitsPerPurchaseUnit, sellable: false, purchasable: true, sellingPrice: null, sku: "", barcode: "", status: "active" });
      }
      product = await updateProduct(tenantId, product.id, { productUnits: units, acknowledgeBelowCost: true }, actor);
      units = productUnitsOf(product);
    }
    for (const supplierProduct of supplierProducts.filter(({ productId, productUnitId }) => productId === product.id && !productUnitId)) {
      const unit = units.find(({ quantityInBaseUnits }) => quantityInBaseUnits === supplierProduct.unitsPerPurchaseUnit);
      if (!unit) continue;
      await upsertSupplierProduct(tenantId, { ...supplierProduct, productUnitId: unit.id });
    }
  }
  console.log(`Product-unit migration completed for tenant ${tenantId}`);
};

void run();
