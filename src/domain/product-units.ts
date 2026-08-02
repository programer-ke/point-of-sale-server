import { randomUUID } from "node:crypto";

export type ProductUnitStatus = "active" | "inactive";

export interface ProductUnitRecord {
  id: string;
  labelCode: string;
  name: string;
  parentUnitId?: string | null;
  multiplier: number;
  quantityInBaseUnits: number;
  sellable: boolean;
  purchasable: boolean;
  sellingPrice?: number | null;
  sku: string;
  barcode: string;
  status: ProductUnitStatus;
}

export type ProductUnitInput = Omit<ProductUnitRecord, "id" | "quantityInBaseUnits"> & {
  id?: string | null;
  quantityInBaseUnits?: number | null;
};

const normalizeCode = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export const validateProductUnits = (
  inputs: ProductUnitInput[],
  allowedLabelCodes: Set<string>,
): ProductUnitRecord[] => {
  if (!inputs.length || inputs.length > 30) throw new Error("A product must have 1 to 30 configured units");
  const ids = new Set<string>();
  const codes = new Set<string>();
  const normalized = inputs.map((input) => {
    const id = input.id?.trim() || randomUUID();
    const labelCode = normalizeCode(input.labelCode);
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Every product unit requires a name");
    if (!labelCode || !allowedLabelCodes.has(labelCode)) throw new Error(`${input.labelCode || "Unit"} is not enabled in Business Setup`);
    if (ids.has(id)) throw new Error("Product unit IDs must be unique");
    ids.add(id);
    if (!Number.isSafeInteger(input.multiplier) || input.multiplier <= 0) throw new Error("Product unit multipliers must be positive whole numbers");
    if (input.sellingPrice != null && (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0)) throw new Error("Product unit selling prices must be zero or greater");
    if (input.sellable && input.sellingPrice == null) throw new Error("Sellable product units require a selling price");
    const sku = input.sku.trim().toUpperCase();
    const barcode = input.barcode.trim().toUpperCase();
    for (const code of [sku, barcode].filter(Boolean)) {
      if (codes.has(code)) throw new Error("Product unit SKU and barcode values must be unique");
      codes.add(code);
    }
    return { ...input, id, labelCode, name, sku, barcode, parentUnitId: input.parentUnitId?.trim() || null, status: input.status ?? "active" };
  });

  const byId = new Map(normalized.map((unit) => [unit.id, unit]));
  const resolved = new Map<string, number>();
  const visiting = new Set<string>();
  const quantityOf = (id: string): number => {
    const existing = resolved.get(id);
    if (existing != null) return existing;
    const unit = byId.get(id);
    if (!unit) throw new Error("Product unit parent was not found");
    if (visiting.has(id)) throw new Error("Product unit hierarchy cannot contain a cycle");
    visiting.add(id);
    const quantity = unit.parentUnitId
      ? quantityOf(unit.parentUnitId) * unit.multiplier
      : unit.quantityInBaseUnits ?? 0;
    visiting.delete(id);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Product units must resolve to a positive whole base quantity");
    resolved.set(id, quantity);
    return quantity;
  };

  return normalized.map((unit) => ({ ...unit, quantityInBaseUnits: quantityOf(unit.id) }));
};

export const productUnitsToSaleVariants = (units: ProductUnitRecord[]) => units
  .filter((unit) => unit.sellable)
  .map((unit) => ({
    id: unit.id,
    name: unit.name,
    sku: unit.sku,
    barcode: unit.barcode,
    quantityInBaseUnits: unit.quantityInBaseUnits,
    sellingPrice: unit.sellingPrice ?? 0,
    status: unit.status,
  }));
