/**
 * INDB (Anuvaad 2024.11) prepared Indian recipes → FoodRecord.
 * Every recipe has per-100 g and per-serving values; the serving weight is derived exactly:
 *   weight_g = unit_serving_<n> / <n> × 100   (energy first, then other macros as fallback)
 */
import { NUTRIENTS, readMapped, round, type NutrientValues } from "../../../packages/shared/src/nutrients.ts";
import { classifyDish, densityFor, isVegDish, mealRelevance, normalize } from "../lib/classify.ts";
import type { FoodNameRecord, FoodRecord, MeasureRecord } from "../lib/types.ts";

/**
 * Where browsers download INDB from: the authors' GitHub copy, identical to Anuvaad_INDB_2024.11.xlsx
 * (same 1,014 rows and 82 columns; checked 2026-11-27) and, unlike anuvaad.org.in, CORS-enabled.
 */
export const INDB_URL = "https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/INDB.xlsx";

// Units that duplicate our generic ones or carry no meaning as a serving.
const SKIP_UNITS = new Set(["ml", "gm", "g", "small"]);
const RATIO_COLS = ["energy_kcal", "carb_g", "protein_g", "fat_g"] as const;

export function servingWeightG(r: Record<string, unknown>): number | null {
  for (const col of RATIO_COLS) {
    const per100 = Number(r[col]);
    const perServing = Number(r[`unit_serving_${col}`]);
    if (per100 > 0.5 && perServing > 0) return (perServing / per100) * 100;
  }
  return null;
}

/**
 * INDB counts every drop of deep-frying oil as eaten (its Units.xlsx: "Oil | Frying | 2 cups"),
 * so fried dishes come out at 600–800 kcal/100 g. We flag rather than alter source values.
 */
export function isSuspectFryingOil(n: NutrientValues): boolean {
  const kcal = n.energy_kcal ?? 0;
  return kcal > 450 && ((n.fat_g ?? 0) * 9) / kcal > 0.55;
}

/** "Chapati/Roti" → "Chapati", "Roti"; "Mutton biryani/biriyani" → "Mutton biryani", "Mutton biriyani". */
export function slashVariants(name: string): string[] {
  const m = name.match(/^(.*?)(\S+)\/(\S+)(.*)$/);
  if (!m) return [];
  return [`${m[1]}${m[2]}${m[4]}`.trim(), `${m[1]}${m[3]}${m[4]}`.trim()];
}

/** "Hot tea (Garam Chai)" → ["Hot tea (Garam Chai)", "Hot tea", "Garam Chai"], plus slash variants. */
export function nameVariants(name: string): FoodNameRecord[] {
  const out: FoodNameRecord[] = [{ name, lang: "en", isPrimary: true }];
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*(.*)$/);
  const outside = m ? `${m[1]} ${m[3]}`.trim() : name;
  if (m && outside) out.push({ name: outside, lang: "en", isPrimary: false });
  for (const v of slashVariants(outside)) out.push({ name: v, lang: "en", isPrimary: false });
  if (m) {
    for (const inner of m[2]!.split(/\/|,/)) {
      const t = inner.trim();
      if (t.length > 2) out.push({ name: t, lang: "hi-Latn", isPrimary: false });
    }
  }
  return out;
}

/** INDB spreadsheet rows (header first, as read-excel-file returns them) → food records. */
export function indbRecords(sheet: unknown[][]): FoodRecord[] {
  const [header, ...rows] = sheet;
  const cols = (header ?? []).map(String);
  const records: FoodRecord[] = [];
  for (const raw of rows) {
    const r = Object.fromEntries(cols.map((c, i) => [c, raw[i]])) as Record<string, unknown>;
    const code = String(r.food_code);
    const name = String(r.food_name ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;

    const nutrients: NutrientValues = {};
    for (const n of NUTRIENTS) {
      const v = readMapped(r, "indb" in n ? n.indb : undefined);
      if (v !== null) nutrients[n.key] = round(v, n.key === "energy_kcal" ? 1 : 4);
    }

    const measures: MeasureRecord[] = [];
    const unitRaw = r.servings_unit == null ? "serving" : String(r.servings_unit).trim().toLowerCase();
    const weight = servingWeightG(r);
    if (weight && weight >= 5 && weight <= 2000 && !SKIP_UNITS.has(unitRaw)) {
      measures.push({
        id: `indb:${code}:serving`,
        name: unitRaw,
        weightG: round(weight, 1),
        rank: 1,
        isEstimated: false,
        source: "indb",
      });
    }

    const category = classifyDish(name);
    records.push({
      id: `indb:${code}`,
      source: "indb",
      sourceRef: code,
      name,
      category,
      isVeg: isVegDish(name),
      rank: 3,
      relevance: mealRelevance(name, category),
      densityGPerMl: densityFor(name, category),
      dataQuality: isSuspectFryingOil(nutrients) ? "suspect_frying_oil" : undefined,
      nutrients,
      names: dedupe(nameVariants(name)),
      measures,
      defaultMeasureId: measures[0]?.id ?? "gen:g",
    });
  }
  return records;
}

function dedupe(names: FoodNameRecord[]): FoodNameRecord[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = normalize(n.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
