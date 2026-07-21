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
};

export type SeedPurchaseOrder = {
  key: string;
  supplierCode: string;
  storeCode: string;
  status: "draft" | "issued" | "partially_received" | "completed";
  notes: string;
  lines: Array<{ productSku: string; orderedPurchaseQuantity: number; pricePerPurchaseUnit?: number | null; expiryDays?: number }>;
};

export type SeedStore = { code: string; name: string; address: string; receiptPhone?: string; receiptFooter?: string };
export type SeedStorePolicy = { storeCode: string; productSku: string; reorderPoint: number; targetQuantity: number };
export type SeedTransfer = {
  key: string;
  fromStoreCode: string;
  toStoreCode: string;
  status: "draft" | "dispatched" | "completed";
  notes: string;
  lines: Array<{ productSku: string; quantity: number }>;
};

export type SupplyChainSeed = {
  stores: SeedStore[];
  suppliers: SeedSupplier[];
  supplierProducts: SeedSupplierProduct[];
  storePolicies: SeedStorePolicy[];
  purchaseOrders: SeedPurchaseOrder[];
  transfers: SeedTransfer[];
};

export const buildMvpSupplyChainSeed = (): SupplyChainSeed => ({
  stores: [
    { code: "MAIN", name: "Main Store", address: "Kimathi Street, Nairobi", receiptPhone: "+254700100100", receiptFooter: "Thank you for shopping with us." },
    { code: "WEST", name: "Westlands Store", address: "Woodvale Grove, Westlands", receiptPhone: "+254700100200", receiptFooter: "Returns accepted with receipt under the store policy." },
    { code: "EAST", name: "Eastlands Store", address: "Outer Ring Road, Nairobi", receiptPhone: "+254700100300", receiptFooter: "Thank you for supporting your local store." },
  ],
  suppliers: [
    { code: "EAF", name: "East Africa Foods Wholesale", contactName: "Grace Wanjiku", phone: "+254711000101", email: "orders@eastafricafoods.example", address: "Enterprise Road, Nairobi" },
    { code: "FFD", name: "FreshFields Distributors", contactName: "Daniel Kiptoo", phone: "+254711000102", email: "sales@freshfields.example", address: "Market Road, Nakuru" },
    { code: "HCW", name: "HomeCare Wholesale", contactName: "Amina Hassan", phone: "+254711000103", email: "trade@homecare.example", address: "Industrial Area, Nairobi" },
  ],
  supplierProducts: [
    { supplierCode: "EAF", productSku: "STAP-0001", supplierSku: "EAF-MF1-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 960, preferred: true },
    { supplierCode: "EAF", productSku: "STAP-0005", supplierSku: "EAF-SG1-20", purchaseUnit: "carton", purchaseQuantity: 20, purchaseMeasurementUnit: "each", lastPurchasePrice: 2_760, preferred: true },
    { supplierCode: "EAF", productSku: "STAP-0007", supplierSku: "EAF-RC1-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 2_040, preferred: true },
    { supplierCode: "EAF", productSku: "BEVE-0021", supplierSku: "EAF-W500-24", purchaseUnit: "case", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 840, preferred: true },
    { supplierCode: "FFD", productSku: "DAIR-0041", supplierSku: "FFD-M500-24", purchaseUnit: "crate", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_080, preferred: true },
    { supplierCode: "FFD", productSku: "DAIR-0048", supplierSku: "FFD-Y150-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 720, preferred: true },
    { supplierCode: "FFD", productSku: "PROD-0121", supplierSku: "FFD-BAN-20", purchaseUnit: "crate", purchaseQuantity: 20, purchaseMeasurementUnit: "each", lastPurchasePrice: 300, preferred: true },
    { supplierCode: "FFD", productSku: "BAKE-0141", supplierSku: "FFD-BREAD-12", purchaseUnit: "crate", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 540, preferred: true },
    { supplierCode: "HCW", productSku: "HOUS-0083", supplierSku: "HCW-WP500-12", purchaseUnit: "carton", purchaseQuantity: 12, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_260, preferred: true },
    { supplierCode: "HCW", productSku: "HOUS-0086", supplierSku: "HCW-DL250-24", purchaseUnit: "carton", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_920, preferred: true },
    { supplierCode: "HCW", productSku: "PERS-0101", supplierSku: "HCW-SOAP100-48", purchaseUnit: "carton", purchaseQuantity: 48, purchaseMeasurementUnit: "each", lastPurchasePrice: 2_880, preferred: true },
    { supplierCode: "HCW", productSku: "STAT-0181", supplierSku: "HCW-A5-24", purchaseUnit: "carton", purchaseQuantity: 24, purchaseMeasurementUnit: "each", lastPurchasePrice: 1_440, preferred: true },
  ],
  storePolicies: [
    { storeCode: "MAIN", productSku: "STAP-0001", reorderPoint: 24, targetQuantity: 72 },
    { storeCode: "MAIN", productSku: "STAP-0005", reorderPoint: 30, targetQuantity: 100 },
    { storeCode: "MAIN", productSku: "BEVE-0021", reorderPoint: 48, targetQuantity: 144 },
    { storeCode: "WEST", productSku: "DAIR-0041", reorderPoint: 36, targetQuantity: 96 },
    { storeCode: "WEST", productSku: "DAIR-0048", reorderPoint: 18, targetQuantity: 60 },
    { storeCode: "WEST", productSku: "BAKE-0141", reorderPoint: 18, targetQuantity: 48 },
    { storeCode: "EAST", productSku: "DAIR-0041", reorderPoint: 24, targetQuantity: 72 },
    { storeCode: "EAST", productSku: "BAKE-0141", reorderPoint: 12, targetQuantity: 36 },
    { storeCode: "EAST", productSku: "HOUS-0083", reorderPoint: 12, targetQuantity: 48 },
  ],
  purchaseOrders: [
    { key: "foods-completed", supplierCode: "EAF", storeCode: "MAIN", status: "completed", notes: "Initial grocery replenishment", lines: [{ productSku: "STAP-0001", orderedPurchaseQuantity: 6, expiryDays: 120 }, { productSku: "STAP-0005", orderedPurchaseQuantity: 4, expiryDays: 180 }, { productSku: "BEVE-0021", orderedPurchaseQuantity: 5, expiryDays: 90 }] },
    { key: "fresh-partial", supplierCode: "FFD", storeCode: "WEST", status: "partially_received", notes: "Chilled and bakery delivery with remaining quantities outstanding", lines: [{ productSku: "DAIR-0041", orderedPurchaseQuantity: 5, expiryDays: 5 }, { productSku: "DAIR-0048", orderedPurchaseQuantity: 4, expiryDays: 8 }, { productSku: "BAKE-0141", orderedPurchaseQuantity: 4, expiryDays: 2 }] },
    { key: "east-fresh-completed", supplierCode: "FFD", storeCode: "EAST", status: "completed", notes: "Short-life stock for expiry and FEFO demonstrations", lines: [{ productSku: "DAIR-0041", orderedPurchaseQuantity: 3, expiryDays: 1 }, { productSku: "BAKE-0141", orderedPurchaseQuantity: 2, expiryDays: 0 }] },
    { key: "homecare-issued", supplierCode: "HCW", storeCode: "EAST", status: "issued", notes: "Monthly household supplies order awaiting delivery", lines: [{ productSku: "HOUS-0083", orderedPurchaseQuantity: 5 }, { productSku: "HOUS-0086", orderedPurchaseQuantity: 4 }, { productSku: "PERS-0101", orderedPurchaseQuantity: 3 }] },
    { key: "stationery-draft", supplierCode: "HCW", storeCode: "WEST", status: "draft", notes: "Draft stationery order for approval", lines: [{ productSku: "STAT-0181", orderedPurchaseQuantity: 3 }] },
  ],
  transfers: [
    { key: "main-to-west-completed", fromStoreCode: "MAIN", toStoreCode: "WEST", status: "completed", notes: "Completed branch replenishment", lines: [{ productSku: "STAP-0001", quantity: 12 }, { productSku: "BEVE-0021", quantity: 24 }] },
    { key: "main-to-east-in-transit", fromStoreCode: "MAIN", toStoreCode: "EAST", status: "dispatched", notes: "Branch replenishment currently in transit", lines: [{ productSku: "STAP-0005", quantity: 20 }, { productSku: "BEVE-0021", quantity: 24 }] },
    { key: "main-to-west-draft", fromStoreCode: "MAIN", toStoreCode: "WEST", status: "draft", notes: "Draft transfer awaiting dispatch", lines: [{ productSku: "STAP-0001", quantity: 12 }] },
  ],
});
