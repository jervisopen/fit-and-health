/**
 * Turn a detected item ("chapati", 2 × chapati, ~72 g) into a database food plus a portion
 * in one of that food's units, ready to log.
 */
import type { Db } from "../db/types.ts";
import type { MeasureDTO } from "../../../../packages/shared/src/api.ts";
import type { MealTypeCode } from "../../../../packages/shared/src/meals.ts";
import { round } from "../../../../packages/shared/src/nutrients.ts";
import { searchFoods } from "../foods/search.ts";
import { getFoodRow, measuresFor } from "../foods/repo.ts";
import type { DetectedItem } from "./vision/types.ts";

export type Match = {
  foodId: string | null;
  measureId: string | null;
  quantity: number | null;
  weightG: number | null;
  alternativeIds: string[];
};

// Detected unit → unit names it may correspond to in the database (first match wins).
const UNIT_ALIASES: Record<string, string[]> = {
  chapati: ["chapati", "roti", "phulka", "piece"],
  roti: ["roti", "chapati", "phulka", "piece"],
  paratha: ["parantha", "paratha", "piece"],
  piece: ["piece", "medium", "idli", "dosa", "vada", "samosa", "slice", "serving"],
  katori: ["katori", "small bowl", "bowl"],
  "small katori": ["small katori", "katori", "small bowl"],
  bowl: ["bowl", "katori", "soup bowl", "curry bowl"],
  plate: ["plate", "serving"],
  glass: ["glass", "tall glass", "cup"],
  cup: ["cup", "tea cup", "glass"],
  tbsp: ["tablespoon"],
  tsp: ["teaspoon"],
  slice: ["slice", "piece"],
};

const roundQty = (q: number) => Math.max(0.25, Math.round(q * 4) / 4);

/** Choose a unit and quantity for `estGrams`, preferring the unit the model named. */
export function choosePortion(measures: MeasureDTO[], unit: string, quantity: number, estGrams: number): { measure: MeasureDTO; quantity: number } {
  const grams = measures.find((m) => m.id === "gen:g")!;
  const wanted = UNIT_ALIASES[unit] ?? [unit];
  for (const name of wanted) {
    const m = measures.find((x) => x.name.toLowerCase() === name);
    if (!m || m.id === "gen:g") continue;
    // Trust the count, unless it disagrees wildly with the weight estimate (then trust the weight).
    const implied = m.weightG * quantity;
    const q = implied > estGrams * 2.5 || implied < estGrams / 2.5 ? estGrams / m.weightG : quantity;
    return { measure: m, quantity: roundQty(q) };
  }
  // No matching unit: use the food's own household unit if it has one, else grams.
  const own = measures.find((m) => m.kind === "food");
  if (own && unit !== "g") return { measure: own, quantity: roundQty(estGrams / own.weightG) };
  return { measure: grams, quantity: Math.max(5, Math.round(estGrams / 5) * 5) };
}

/**
 * Search with the full name; if nothing matches, drop one word at a time and keep the best-scoring
 * variant ("paneer butter masala" → "paneer butter" → "Paneer in butter sauce").
 */
function bestHits(db: Db, name: string, mealType?: MealTypeCode) {
  const wordHits = (q: string) => searchFoods(db, q, { limit: 6, mealType }).filter((h) => h.matchKind === "words");
  const full = wordHits(name);
  if (full.length) return full;
  const words = name.split(/\s+/).filter(Boolean);
  for (let keep = words.length - 1; keep >= 1; keep--) {
    let best: ReturnType<typeof searchFoods> = [];
    for (let skip = 0; skip <= keep; skip++) {
      // Every way of keeping `keep` words in order by dropping one contiguous run of the others.
      const variant = [...words.slice(0, skip), ...words.slice(skip + words.length - keep)].join(" ");
      const hits = wordHits(variant);
      if (hits[0] && (!best[0] || hits[0].score > best[0].score)) best = hits;
    }
    if (best.length) return best;
  }
  // Nothing by words: spelling similarity as the last resort ("chapathi").
  return searchFoods(db, name, { limit: 6, mealType });
}

export function matchItem(db: Db, item: DetectedItem, mealType?: MealTypeCode): Match {
  let hits = bestHits(db, item.name, mealType);
  if (!hits.length && item.local_name) hits = bestHits(db, item.local_name, mealType);
  const best = hits[0];
  if (!best) return { foodId: null, measureId: null, quantity: null, weightG: null, alternativeIds: [] };
  const row = getFoodRow(db, best.id)!;
  const { measure, quantity } = choosePortion(measuresFor(db, row), item.portion_unit, item.portion_quantity, item.estimated_grams);

  // One-tap swaps: the other matches plus each word's family ("jeera rice" → rice dishes too),
  // interleaved so every word is represented, same kind of food (dish vs ingredient) first.
  const lists = [hits.slice(1), ...item.name.split(/\s+/).filter((w) => w.length >= 3)
    .map((w) => searchFoods(db, w, { limit: 6, mealType }).filter((h) => h.matchKind === "words"))];
  const pool: { id: string; sameKind: boolean; order: number }[] = [];
  lists.forEach((list, li) => list.forEach((h, i) => pool.push({ id: h.id, sameKind: h.source === best.source, order: i * 10 + li })));
  pool.sort((a, b) => Number(b.sameKind) - Number(a.sameKind) || a.order - b.order);
  const alternatives: string[] = [];
  for (const p of pool) if (p.id !== best.id && !alternatives.includes(p.id)) alternatives.push(p.id);
  return {
    foodId: best.id,
    measureId: measure.id,
    quantity,
    weightG: round(measure.weightG * quantity, 1),
    alternativeIds: alternatives.slice(0, 5),
  };
}
