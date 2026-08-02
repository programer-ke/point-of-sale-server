export type VatClass = "standard" | "zero_rated" | "exempt";

export const VAT_CLASSES: ReadonlyArray<{ code: VatClass; label: string; rateBasisPoints: number }> = [
  { code: "standard", label: "Standard rated (16%)", rateBasisPoints: 1600 },
  { code: "zero_rated", label: "Zero rated (0%)", rateBasisPoints: 0 },
  { code: "exempt", label: "VAT exempt", rateBasisPoints: 0 },
];

export const isVatClass = (value: unknown): value is VatClass => VAT_CLASSES.some(({ code }) => code === value);

// Rates are deliberately centralized and effective-dated. Products store the
// statutory class while transaction lines snapshot the rate that actually applied.
export const vatRateBasisPoints = (vatClass: VatClass, at: string | Date = new Date()) => {
  const effectiveDate = typeof at === "string" ? at.slice(0, 10) : at.toISOString().slice(0, 10);
  if (effectiveDate < "2013-09-02") return 0;
  return vatClass === "standard" ? 1600 : 0;
};

export interface VatBreakdownMinor {
  grossMinor: number;
  taxableMinor: number;
  vatMinor: number;
  rateBasisPoints: number;
}

export const inclusiveVatBreakdown = (grossMinor: number, vatClass: VatClass, at?: string | Date): VatBreakdownMinor => {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) throw new Error("VAT amount must be a non-negative integer number of cents");
  const rateBasisPoints = vatRateBasisPoints(vatClass, at);
  if (vatClass === "exempt") return { grossMinor, taxableMinor: 0, vatMinor: 0, rateBasisPoints };
  if (rateBasisPoints === 0) return { grossMinor, taxableMinor: grossMinor, vatMinor: 0, rateBasisPoints };
  const taxableMinor = Math.round(grossMinor * 10_000 / (10_000 + rateBasisPoints));
  return { grossMinor, taxableMinor, vatMinor: grossMinor - taxableMinor, rateBasisPoints };
};

export const vatApplies = (settings: { vatRegistered?: boolean; vatEffectiveFrom?: string | null }, at: string | Date) => {
  if (!settings.vatRegistered || !settings.vatEffectiveFrom) return false;
  const date = typeof at === "string" ? at.slice(0, 10) : at.toISOString().slice(0, 10);
  return date >= settings.vatEffectiveFrom;
};

export const withholdingVatMinor = (settlementMinor: number, standardTaxableMinor: number, invoiceGrossMinor: number, enabled: boolean) => {
  if (!enabled || settlementMinor <= 0 || standardTaxableMinor <= 0 || invoiceGrossMinor <= 0) return 0;
  return Math.round(settlementMinor * standardTaxableMinor * 200 / invoiceGrossMinor / 10_000);
};
