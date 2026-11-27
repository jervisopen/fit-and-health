/**
 * USDA FoodData Central, SR Legacy (April 2018). A U.S. government work, in the public domain, so
 * it can be bundled and redistributed. Two inputs, both made by data/ingest/usda/convert.py:
 *
 *   data/seeds/staples.json                       everyday Indian staples (cooked rice, dal, eggs, milk…)
 *                                                 with Indian names and household measures; bundled
 *   apps/web/public/data/usda-sr-legacy.json.gz   ~7,600 more foods, downloaded once at setup
 *
 * Staples rank above every other dataset so "cooked rice" finds plain rice first; the bulk ranks
 * below the Indian datasets.
 */
import type { NutrientValues } from "../../../packages/shared/src/nutrients.ts";
import type { FoodRecord, MeasureRecord } from "../lib/types.ts";

export const USDA_BULK_PATH = "/data/usda-sr-legacy.json.gz";
export const USDA_LICENCE = "USDA FoodData Central, SR Legacy (April 2018), public domain";

const STAPLE_RANK = 5;
// Within USDA: everyday categories win ties over processed, fast and baby foods.
const BULK_RANK_EVERYDAY = 1;
const BULK_RANK = 0.5;
const BULK_RANK_NICHE = 0.1;
const EVERYDAY = /^(Vegetables|Fruits|Legumes|Cereal Grains|Dairy and Egg|Nut and Seed|Spices|Poultry|Finfish|Beverages|Fats and Oils|Breakfast Cereals)/;
const NICHE = /^(Sausages|Fast Foods|Restaurant Foods|Baby Foods|Meals, Entrees|Snacks|Sweets|Alcoholic)/;

export type StaplesFile = {
  version: string;
  foods: {
    fdcId: number; name: string; usdaName: string; aliases: string[]; isVeg: boolean;
    relevance: FoodRecord["relevance"];
    measures: { name: string; weightG: number; isEstimated: boolean }[];
    nutrients: Record<string, number | null>;
  }[];
};

export type UsdaBulkFile = {
  version: string;
  nutrients: string[];
  categories: string[];
  /** [fdcId, name, categoryIndex, isVeg (1/0/null), values aligned to `nutrients`, [[portion, grams], ...]] */
  foods: [number, string, number, number | null, (number | null)[], [string, number][]][];
};

function clean(n: Record<string, number | null>): NutrientValues {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(n)) if (v !== null && v !== undefined) out[k] = v;
  return out as NutrientValues;
}

function measures(id: string, list: { name: string; weightG: number; isEstimated: boolean }[]): MeasureRecord[] {
  const seen = new Set<string>();
  const out: MeasureRecord[] = [];
  for (const m of list) {
    const key = m.name.toLowerCase();
    if (seen.has(key) || !(m.weightG > 0)) continue;
    seen.add(key);
    out.push({ id: `${id}:m${out.length + 1}`, name: m.name, weightG: m.weightG, rank: out.length + 1, isEstimated: m.isEstimated, source: "usda" });
  }
  return out;
}

export function staplesRecords(file: StaplesFile): FoodRecord[] {
  return file.foods.map((s) => {
    const id = `usda:${s.fdcId}`;
    const ms = measures(id, s.measures);
    const aliases = [...new Set([...s.aliases, s.usdaName].map((a) => a.trim()).filter((a) => a && a.toLowerCase() !== s.name.toLowerCase()))];
    return {
      id, source: "usda", sourceRef: String(s.fdcId), name: s.name, category: "Everyday staples",
      isVeg: s.isVeg, rank: STAPLE_RANK, relevance: s.relevance,
      nutrients: clean(s.nutrients),
      names: [{ name: s.name, lang: "en", isPrimary: true }, ...aliases.map((name) => ({ name, lang: "en", isPrimary: false }))],
      measures: ms,
      defaultMeasureId: ms[0]?.id ?? "gen:g",
    };
  });
}

const CUP_ML = 240; // matches gen:cup in data/seeds/generic_units.csv

export function usdaBulkRecords(file: UsdaBulkFile, skip: Set<string> = new Set()): FoodRecord[] {
  const out: FoodRecord[] = [];
  for (const [fdcId, name, cat, veg, values, portions] of file.foods) {
    const id = `usda:${fdcId}`;
    if (skip.has(id)) continue;
    const nutrients: Record<string, number | null> = {};
    file.nutrients.forEach((k, i) => { nutrients[k] = values[i] ?? null; });
    const ms = measures(id, portions.map(([n, g]) => ({ name: n, weightG: g, isEstimated: false })));
    // A "cup" portion gives the density, so katori / glass / tsp work for this food too.
    const cup = portions.find(([n]) => /^cup\b/i.test(n));
    const category = file.categories[cat] ?? "";
    const breakfast = /Breakfast Cereals/.test(category) ? 0.8 : 0.4;
    out.push({
      id, source: "usda", sourceRef: String(fdcId), name, category,
      isVeg: veg === null ? undefined : veg === 1,
      rank: EVERYDAY.test(category) ? BULK_RANK_EVERYDAY : NICHE.test(category) ? BULK_RANK_NICHE : BULK_RANK,
      relevance: { breakfast, lunch: 0.4, snack: 0.4, dinner: 0.4 },
      densityGPerMl: cup ? Math.round((cup[1] / CUP_ML) * 1000) / 1000 : undefined,
      nutrients: clean(nutrients),
      names: [{ name, lang: "en", isPrimary: true }],
      measures: ms,
      defaultMeasureId: ms[0]?.id ?? "gen:g",
    });
  }
  return out;
}
