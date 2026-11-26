/**
 * Food search, modelled on HealthifyMe's local search
 * (LIKE on foodnames_v2.food_name / canonical_food_name, ordered by food_rank and
 * food_relevance_<meal>), upgraded to FTS5 + trigram fuzzy matching.
 *
 * score = text match + source prior (foods.rank) + meal-slot relevance + personal frequency
 */
import type { DatabaseSync } from "node:sqlite";
import type { MealTypeCode } from "../../../../packages/shared/src/meals.ts";

export type SearchOptions = { limit?: number; mealType?: MealTypeCode };

export type FoodSearchResult = {
  id: string;
  name: string;
  matchedName: string;
  brand: string | null;
  category: string | null;
  source: string;
  isVeg: boolean | null;
  kcalPer100g: number | null;
  defaultMeasure: { id: string; name: string; weightG: number } | null;
  /** 100 when the default unit is grams, else 1. */
  defaultQuantity: number;
  kcalPerDefault: number | null;
  dataQuality: string | null;
  score: number;
};

type Candidate = { foodId: string; name: string; isPrimary: number; text: number };

// Fuzzy (trigram) matching only for queries long enough to be meaningful:
// "chai" would otherwise match "Elumichai rasam".
const FUZZY_MIN_LETTERS = 5;
const FUZZY_MIN_COVERAGE = 0.7;

const REL_COL: Record<MealTypeCode, string> = {
  B: "rel_breakfast", SM: "rel_snack", L: "rel_lunch", S: "rel_snack", D: "rel_dinner",
};

export function normalizeQuery(q: string): string {
  return q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const synonymCache = new WeakMap<DatabaseSync, Record<string, string[]>>();
function synonyms(db: DatabaseSync): Record<string, string[]> {
  let s = synonymCache.get(db);
  if (!s) {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'search_synonyms'").get() as { value: string } | undefined;
    s = row ? (JSON.parse(row.value) as Record<string, string[]>) : {};
    synonymCache.set(db, s);
  }
  return s;
}

/**
 * FTS5 expression: every token must match (itself or a synonym), each as a prefix.
 * Single-letter tokens ("parle g") are dropped; returns "" when nothing usable remains.
 */
export function buildFtsQuery(tokens: string[], syn: Record<string, string[]>): string {
  return tokens
    .map((t) => [...new Set([t, ...(syn[t] ?? [])])].filter((a) => a.length >= 2 || /^\d+$/.test(a)))
    .filter((alts) => alts.length > 0)
    .map((alts) => `(${alts.map((a) => `"${a}"*`).join(" OR ")})`)
    .join(" AND ");
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.split(" ")) {
    const w = ` ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/** Share of the query's trigrams present in the name (0..1). */
export function trigramCoverage(query: string, name: string): number {
  const q = trigrams(query);
  if (!q.size) return 0;
  const n = trigrams(normalizeQuery(name));
  let hit = 0;
  for (const t of q) if (n.has(t)) hit++;
  return hit / q.size;
}

function ftsCandidates(db: DatabaseSync, norm: string, syn: Record<string, string[]>): Candidate[] {
  const tokens = norm.split(" ").filter(Boolean);
  const expr = buildFtsQuery(tokens, syn);
  if (!expr) return [];
  const rows = db.prepare(`
    SELECT n.food_id AS foodId, n.name AS name, n.is_primary AS isPrimary, bm25(food_names_fts) AS bm
    FROM food_names_fts JOIN food_names n ON n.id = food_names_fts.rowid
    WHERE food_names_fts MATCH ? ORDER BY bm LIMIT 400`).all(expr) as
    { foodId: string; name: string; isPrimary: number; bm: number }[];
  const first = tokens[0]!;
  return rows.map((r) => {
    const n = normalizeQuery(r.name);
    const words = new Set(n.split(" "));
    const startsWith = n.startsWith(first) ? 0.4 : 0;
    const exact = n === norm ? 0.5 : 0;
    // Whole-word hits beat prefix hits ("roti" → "Roti" over "Rotini").
    const wholeWords = tokens.filter((t) => words.has(t)).length / tokens.length;
    const brevity = Math.min(n.length / 120, 0.25);
    return { foodId: r.foodId, name: r.name, isPrimary: r.isPrimary, text: 1 + startsWith + exact + 0.2 * wholeWords - brevity };
  });
}

function fuzzyCandidates(db: DatabaseSync, norm: string): Candidate[] {
  const grams = [...trigrams(norm)].map((g) => g.trim()).filter((g) => g.length === 3);
  if (grams.length < 2) return [];
  const expr = [...new Set(grams)].map((g) => `"${g.replace(/"/g, "")}"`).join(" OR ");
  const rows = db.prepare(`
    SELECT n.food_id AS foodId, n.name AS name, n.is_primary AS isPrimary
    FROM food_names_tri JOIN food_names n ON n.id = food_names_tri.rowid
    WHERE food_names_tri MATCH ? LIMIT 1500`).all(expr) as { foodId: string; name: string; isPrimary: number }[];
  const out: Candidate[] = [];
  for (const r of rows) {
    const cov = trigramCoverage(norm, r.name);
    if (cov >= FUZZY_MIN_COVERAGE) out.push({ ...r, text: cov * 0.9 });
  }
  return out;
}

export function searchFoods(db: DatabaseSync, query: string, opts: SearchOptions = {}): FoodSearchResult[] {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const norm = normalizeQuery(query);
  if (!norm) return [];

  let cands = ftsCandidates(db, norm, synonyms(db));
  if (cands.length < limit && norm.replace(/ /g, "").length >= FUZZY_MIN_LETTERS) cands = cands.concat(fuzzyCandidates(db, norm));

  // Best name per food.
  const best = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = best.get(c.foodId);
    const s = c.text + (c.isPrimary ? 0.1 : 0);
    if (!prev || s > prev.text + (prev.isPrimary ? 0.1 : 0)) best.set(c.foodId, c);
  }
  if (!best.size) return [];

  const ids = [...best.keys()];
  const relCol = opts.mealType ? REL_COL[opts.mealType] : null;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT f.id, f.name, f.brand, f.category, f.source, f.is_veg, f.energy_kcal, f.rank, f.data_quality,
           ${relCol ? `f.${relCol}` : "0"} AS rel,
           m.id AS m_id, m.name AS m_name, m.weight_g AS m_weight,
           (SELECT count(*) FROM food_logs l WHERE l.food_id = f.id AND l.deleted_at IS NULL
              AND l.created_at > unixepoch() - 90*86400) AS uses
    FROM foods f
    LEFT JOIN food_measures m ON m.id = f.default_measure_id AND m.weight_g IS NOT NULL
    WHERE f.id IN (${placeholders}) AND f.deleted_at IS NULL`).all(...ids) as Record<string, unknown>[];

  const results: FoodSearchResult[] = rows.map((r) => {
    const c = best.get(r.id as string)!;
    const kcal = r.energy_kcal as number | null;
    const weight = r.m_weight as number | null;
    const isGrams = r.m_id === "gen:g" || !r.m_id;
    const defaultQuantity = isGrams ? 100 : 1;
    const quality = (r.data_quality as string | null) ?? null;
    const score = c.text + Number(r.rank) * 0.08 + Number(r.rel) * 0.3 + Math.log1p(Number(r.uses)) * 0.25
      - (quality ? 0.15 : 0);
    return {
      id: r.id as string,
      name: r.name as string,
      matchedName: c.name,
      brand: (r.brand as string) ?? null,
      category: (r.category as string) ?? null,
      source: r.source as string,
      isVeg: r.is_veg === null ? null : Boolean(r.is_veg),
      kcalPer100g: kcal,
      defaultMeasure: r.m_id ? { id: r.m_id as string, name: r.m_name as string, weightG: weight! } : null,
      defaultQuantity,
      kcalPerDefault: kcal !== null ? Math.round((kcal * (weight ?? 1) * defaultQuantity) / 100) : null,
      dataQuality: quality,
      score: Math.round(score * 1000) / 1000,
    };
  });
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
