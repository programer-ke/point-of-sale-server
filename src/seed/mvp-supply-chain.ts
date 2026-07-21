export type SeedSupplier = {
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
};

export type SeedSupplierProduct = {
  supplierCode: string;
  productSku: string;
  supplierSku?: string;
  purchaseUnit: string;
  purchaseQuantity: number;
  purchaseMeasurementUnit: string;
  lastPurchasePrice?: number | null;
  preferred?: boolean;
  reorderPoint?: number;
  targetQuantity?: number;
};

export type SeedPurchaseOrder = {
  key: string;
  supplierCode: string;
  status: "draft" | "issued" | "partially_received" | "completed";
  notes: string;
  lines: Array<{ productSku: string; orderedPurchaseQuantity: number; pricePerPurchaseUnit?: number | null }>;
};

export type SupplyChainSeed = {
  suppliers: SeedSupplier[];
  supplierProducts: SeedSupplierProduct[];
  purchaseOrders: SeedPurchaseOrder[];
};

export const buildMvpSupplyChainSeed = (): SupplyChainSeed => ({
  suppliers: [
    { code: "EAF", name: "East Africa Foods Wholesale", contactName: "Grace Wanjiku", phone: "+254711000101", email: "orders@eastafricafoods.example", address: "Enterprise Road, Nairobi" },
    { code: "FFD", name: "FreshFields Distributors", contactName: "Daniel Kiptoo", phone: "+254711000102", email: "sales@freshfields.example", address: "Market Road, Nakuru" },
    { code: "HCW", name: "HomeCare Wholesale", contactName: "Amina Hassan", phone: "+254711000103", email: "trade@homecare.example", address: "Industrial Area, Nairobi" },
  ],
  supplierProducts: [
    { supplierCode: "EAF", productSku: "STAP-0001", supplierSku: "EAF-MF1-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 960, preferred: true, reorderPoint: 24, targetQuantity: 72 },
    { supplierCode: "EAF", productSku: "STAP-0005", supplierSku: "EAF-SG1-20", purchaseUnit: "carton", purchaseQuantity: 20, purchaseMeasurementUnit: "each", lastPurchasePrice: 2_760, preferred: true, reorderPoint: 30, targetQuantity: 100 },
    { supplierCode: "EAF", productSku: "STAP-0007", supplierSku: "EAF-RC1-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 2_040, preferred: true, reorderPoint: 18, targetQuantity: 60 },
    { supplierCode: "EAF", productSku: "BEVE-0021", supplierSku: "EAF-W500-24", purchaseUnit: "case", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 840, preferred: true, reorderPoint: 48, targetQuantity: 144 },
    { supplierCode: "FFD", productSku: "DAIR-0041", supplierSku: "FFD-M500-24", purchaseUnit: "crate", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_080, preferred: true, reorderPoint: 48, targetQuantity: 120 },
    { supplierCode: "FFD", productSku: "DAIR-0048", supplierSku: "FFD-Y150-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 720, preferred: true, reorderPoint: 24, targetQuantity: 72 },
    { supplierCode: "FFD", productSku: "PROD-0121", supplierSku: "FFD-BAN-20", purchaseUnit: "crate", purchaseQuantity: 20, purchaseMeasurementUnit: "each", lastPurchasePrice: 300, preferred: true, reorderPoint: 30, targetQuantity: 100 },
    { supplierCode: "FFD", productSku: "BAKE-0141", supplierSku: "FFD-BREAD-12", purchaseUnit: "crate", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 540, preferred: true, reorderPoint: 24, targetQuantity: 72 },
    { supplierCode: "HCW", productSku: "HOUS-0083", supplierSku: "HCW-WP500-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_260, preferred: true, reorderPoint: 18, targetQuantity: 60 },
    { supplierCode: "HCW", productSku: "HOUS-0086", supplierSku: "HCW-DL250-24", purchaseUnit: "carton", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_920, preferred: true, reorderPoint: 24, targetQuantity: 96 },
    { supplierCode: "HCW", productSku: "PERS-0101", supplierSku: "HCW-SOAP100-48", purchaseUnit: "carton", purchaseQuantity: 48, purchaseMeasurementUnit: "each", lastPurchasePrice: 2_880, preferred: true, reorderPoint: 48, targetQuantity: 144 },
    { supplierCode: "HCW", productSku: "STAT-0181", supplierSku: "HCW-A5-24", purchaseUnit: "carton", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_440, preferred: true, reorderPoint: 24, targetQuantity: 72 },
  ],
  purchaseOrders: [
    { key: "foods-completed", supplierCode: "EAF", status: "completed", notes: "Initial grocery replenishment", lines: [{ productSku: "STAP-0001", orderedPurchaseQuantity: 6 }, { productSku: "STAP-0005", orderedPurchaseQuantity: 4 }, { productSku: "BEVE-0021", orderedPurchaseQuantity: 5 }] },
    { key: "fresh-partial", supplierCode: "FFD", status: "partially_received", notes: "Chilled and bakery delivery with remaining quantities outstanding", lines: [{ productSku: "DAIR-0041", orderedPurchaseQuantity: 5 }, { productSku: "DAIR-0048", orderedPurchaseQuantity: 4 }, { productSku: "BAKE-0141", orderedPurchaseQuantity: 4 }] },
    { key: "homecare-issued", supplierCode: "HCW", status: "issued", notes: "Monthly household supplies order awaiting delivery", lines: [{ productSku: "HOUS-0083", orderedPurchaseQuantity: 5 }, { productSku: "HOUS-0086", orderedPurchaseQuantity: 4 }, { productSku: "PERS-0101", orderedPurchaseQuantity: 3 }] },
    { key: "stationery-draft", supplierCode: "HCW", status: "draft", notes: "Draft stationery order for approval", lines: [{ productSku: "STAT-0181", orderedPurchaseQuantity: 3 }] },
  ],
});
