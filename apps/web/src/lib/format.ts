import { nutrient, type NutrientKey } from "../../../../packages/shared/src/nutrients.ts";

export function kcal(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : Math.round(n).toLocaleString();
}

export function grams(n: number | null | undefined, dp = 0): string {
  if (n === null || n === undefined) return "–";
  const v = dp ? Math.round(n * 10 ** dp) / 10 ** dp : Math.round(n);
  return v.toLocaleString();
}

/** "1", "1½", "2¼", "0.3" — friendly quantities for household units. */
export function quantity(q: number): string {
  const whole = Math.floor(q);
  const frac = Math.round((q - whole) * 100) / 100;
  const sym: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
  if (frac === 0) return String(whole);
  if (sym[frac]) return whole ? `${whole}${sym[frac]}` : sym[frac]!;
  return String(Math.round(q * 100) / 100);
}

export function portion(q: number, unit: string, weightG?: number): string {
  if (unit === "g") return `${grams(q)} g`;
  const base = `${quantity(q)} ${unit}`;
  return weightG ? `${base} · ${grams(weightG)} g` : base;
}

export function nutrientValue(key: NutrientKey, v: number | undefined): string {
  if (v === undefined) return "–";
  const unit = nutrient(key).unit;
  const dp = v < 1 ? 2 : v < 10 ? 1 : 0;
  const n = Math.round(v * 10 ** dp) / 10 ** dp;
  return `${n.toLocaleString()} ${unit === "ug" ? "µg" : unit}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  indb: "Indian recipe",
  ifct: "Ingredient",
  off: "Packaged",
  custom: "My food",
};
