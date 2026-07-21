export type MeasurementDimension = "count" | "weight" | "liquid_volume" | "length" | "area" | "solid_volume";

export type MeasurementUnitDefinition = {
  code: string;
  dimension: MeasurementDimension;
  baseUnit: string;
  baseUnits: number;
};

const definitions = [
  { code: "each", dimension: "count", baseUnit: "each", baseUnits: 1 },
  { code: "gram", dimension: "weight", baseUnit: "gram", baseUnits: 1 },
  { code: "kilogram", dimension: "weight", baseUnit: "gram", baseUnits: 1_000 },
  { code: "tonne", dimension: "weight", baseUnit: "gram", baseUnits: 1_000_000 },
  { code: "millilitre", dimension: "liquid_volume", baseUnit: "millilitre", baseUnits: 1 },
  { code: "litre", dimension: "liquid_volume", baseUnit: "millilitre", baseUnits: 1_000 },
  { code: "millimetre", dimension: "length", baseUnit: "millimetre", baseUnits: 1 },
  { code: "centimetre", dimension: "length", baseUnit: "millimetre", baseUnits: 10 },
  { code: "metre", dimension: "length", baseUnit: "millimetre", baseUnits: 1_000 },
  { code: "square_centimetre", dimension: "area", baseUnit: "square_centimetre", baseUnits: 1 },
  { code: "square_metre", dimension: "area", baseUnit: "square_centimetre", baseUnits: 10_000 },
  { code: "cubic_centimetre", dimension: "solid_volume", baseUnit: "cubic_centimetre", baseUnits: 1 },
  { code: "cubic_metre", dimension: "solid_volume", baseUnit: "cubic_centimetre", baseUnits: 1_000_000 },
] satisfies MeasurementUnitDefinition[];

export const MEASUREMENT_UNITS: Record<string, MeasurementUnitDefinition> = Object.fromEntries(definitions.map((unit) => [unit.code, unit]));

export const measurementUnit = (code: string) => {
  const unit = MEASUREMENT_UNITS[code.trim().toLowerCase()];
  if (!unit) throw new Error("Select a supported stock measurement unit");
  return unit;
};

export const convertMeasurementToBaseUnits = (quantity: number, unitCode: string, expectedBaseUnit?: string) => {
  const unit = measurementUnit(unitCode);
  if (expectedBaseUnit && unit.baseUnit !== expectedBaseUnit) throw new Error(`${unitCode} is not compatible with this product's measurement`);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Measurement quantity must be greater than zero");
  const converted = quantity * unit.baseUnits;
  if (!Number.isSafeInteger(converted)) throw new Error("Measurement must convert to a whole supported inventory quantity");
  return converted;
};
