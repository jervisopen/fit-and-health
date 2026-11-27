/**
 * Open Food Facts (India subset) packaged foods → FoodRecord.
 * Input: data/raw/off/india_products.json written by fetch.ts.
 */
import { NUTRIENTS, readMapped, round, type NutrientValues } from "../../../packages/shared/src/nutrients.ts";
import { densityFor, mealRelevance } from "../lib/classify.ts";
import type { FoodRecord, MeasureRecord } from "../lib/types.ts";

type OffProduct = {
  code: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  categories_tags?: string[];
  serving_size?: string;
  serving_quantity?: number | string;
  quantity?: string;
  image_front_small_url?: string;
  nutriments?: Record<string, unknown>;
};

/** "200 g" | "1 kg" | "500ml" | "6 x 25 g" → grams (ml treated as g), else null. */
export function parsePackGrams(q: string | undefined): number | null {
  if (!q) return null;
  const s = q.toLowerCase().replace(",", ".");
  const multi = s.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|grams?|ml|l|ltr|litres?)\b/);
  const one = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|grams?|ml|l|ltr|litres?)\b/);
  const toG = (v: number, u: string) => (u === "kg" || u.startsWith("l") ? v * 1000 : v);
  if (multi) return toG(Number(multi[1]) * Number(multi[2]), multi[3]!);
  if (one) return toG(Number(one[1]), one[2]!);
  return null;
}

/**
 * Crowd-sourced rows are rejected when missing or physically impossible (pure fat ≈ 900 kcal/100 g),
 * or when stated calories disagree badly with the Atwater estimate 4·P + 4·C + 9·F
 * (e.g. a biscuit entered as 3 kcal/100 g).
 */
export function isPlausibleEnergy(n: NutrientValues): boolean {
  const kcal = n.energy_kcal;
  const p = n.protein_g ?? 0, c = n.carbs_g ?? 0, f = n.fat_g ?? 0;
  if (kcal === undefined || kcal < 0 || kcal > 950 || p + c + f > 105) return false;
  const atwater = 4 * p + 4 * c + 9 * f;
  if (atwater < 20) return true; // drinks, diet products: too little to compare
  return kcal >= atwater * 0.6 && kcal <= atwater * 1.4 + 20;
}

function prettyCategory(tags: string[] | undefined): string | undefined {
  const en = (tags ?? []).filter((t) => t.startsWith("en:"));
  const last = en[en.length - 1];
  if (!last) return undefined;
  const s = last.slice(3).replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function offToRecord(p: OffProduct, popularity: number): FoodRecord | null {
  const name = (p.product_name || p.product_name_en || p.generic_name || "").trim().replace(/\s+/g, " ");
  if (!name || !p.code) return null;
  const n = p.nutriments ?? {};

  const nutrients: NutrientValues = {};
  for (const def of NUTRIENTS) {
    const v = readMapped(n, "off" in def ? def.off : undefined);
    if (v !== null) nutrients[def.key] = round(v, def.key === "energy_kcal" ? 1 : 4);
  }
  if (nutrients.energy_kcal === undefined && Number(n["energy_100g"]) > 0) {
    nutrients.energy_kcal = round(Number(n["energy_100g"]) / 4.184, 1); // kJ → kcal
  }
  if (nutrients.sodium_mg === undefined && Number(n["salt_100g"]) >= 0 && n["salt_100g"] !== undefined) {
    nutrients.sodium_mg = round((Number(n["salt_100g"]) / 2.5) * 1000, 2);
  }
  if (!isPlausibleEnergy(nutrients)) return null;

  const id = `off:${p.code}`;
  const measures: MeasureRecord[] = [];
  const servingG = Number(p.serving_quantity);
  // Units are plain names; the UI shows the gram weight next to them.
  if (servingG > 0 && servingG <= 2000) {
    measures.push({ id: `${id}:serving`, name: "serving", weightG: round(servingG, 1), rank: 1, isEstimated: false, source: "off" });
  }
  const packG = parsePackGrams(p.quantity);
  if (packG && packG <= 5000 && packG !== servingG) {
    measures.push({ id: `${id}:pack`, name: "pack", weightG: round(packG, 1), rank: 2, isEstimated: false, source: "off" });
  }

  const brand = p.brands?.split(",")[0]?.trim() || undefined;
  const category = prettyCategory(p.categories_tags);
  const names = [{ name, lang: "en", isPrimary: true }];
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) names.push({ name: `${brand} ${name}`, lang: "en", isPrimary: false });

  return {
    id,
    source: "off",
    sourceRef: p.code,
    name,
    brand,
    category,
    barcode: p.code,
    rank: 1 + 0.5 * popularity,
    relevance: mealRelevance(name, category),
    densityGPerMl: (p.categories_tags ?? []).includes("en:beverages") ? 1 : densityFor(name, category ?? ""),
    imageUrl: p.image_front_small_url,
    nutrients,
    names,
    measures,
    defaultMeasureId: measures[0]?.id ?? "gen:g",
  };
}

export type { OffProduct };

/** Products (most popular first) → deduplicated, plausibility-checked food records. */
export function offRecords(products: OffProduct[]): FoodRecord[] {
  const out: FoodRecord[] = [];
  const seen = new Set<string>();
  products.forEach((p, i) => {
    if (seen.has(p.code)) return;
    const rec = offToRecord(p, 1 - i / Math.max(products.length, 1));
    if (rec) { seen.add(p.code); out.push(rec); }
  });
  return out;
}
