export type CommercialUnit = "pieza" | "unidad" | "juego";

export type CommercialProduct = {
  unit: string;
  boxFactor: number;
};

export function normalizeCommercialUnit(value: string): CommercialUnit {
  const normalized = String(value || "pieza").toLowerCase();
  if (normalized === "juego") return "juego";
  if (normalized === "unidad") return "unidad";
  return "pieza";
}

export function unitLabel(value: string, plural = false) {
  const unit = normalizeCommercialUnit(value);
  if (unit === "juego") return plural ? "juegos" : "juego";
  if (unit === "unidad") return plural ? "unidades" : "unidad";
  return plural ? "piezas" : "pieza";
}

export function validBoxFactor(value: unknown) {
  const factor = Number(value ?? 0);
  return Number.isInteger(factor) && factor > 1 ? factor : 0;
}

export function presentationFactor(product: CommercialProduct, presentation: string) {
  const baseUnit = normalizeCommercialUnit(product.unit);
  const normalized = String(presentation || baseUnit).toLowerCase();
  if (normalized === baseUnit) return 1;
  if (normalized === "caja") {
    const factor = validBoxFactor(product.boxFactor);
    return factor || null;
  }
  return null;
}

export function presentationLabel(product: CommercialProduct, presentation: string) {
  const baseUnit = normalizeCommercialUnit(product.unit);
  return String(presentation).toLowerCase() === "caja" ? "caja" : unitLabel(baseUnit);
}

export function boxSummary(product: CommercialProduct) {
  const factor = validBoxFactor(product.boxFactor);
  if (!factor) return "Sin caja configurada";
  return `1 caja = ${factor} ${unitLabel(product.unit, factor !== 1)}`;
}
