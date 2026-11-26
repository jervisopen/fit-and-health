/**
 * Nutrient registry: the single source of truth for every nutrient column.
 *
 * - `key` is the column name in `foods` (values per 100 g) and in `food_logs` (values for the
 *   logged amount, snapshotted at log time like HealthifyMe's `foodlog`).
 * - Source mappings convert each dataset's native unit into `unit`.
 *     IFCT 2017 (nodef packaging): masses in g per 100 g, energy in kJ.
 *     INDB (Anuvaad 2024.11):       per 100 g, units in the column suffix (_g, _mg, _ug, _kcal).
 *     Open Food Facts:              `<key>_100g`, masses in g, energy-kcal in kcal.
 */
export type NutrientUnit = "kcal" | "g" | "mg" | "ug";

export type SourceMap = {
  /** Column(s) in the source; the first present non-empty value wins, or values are summed if `sum`. */
  cols: readonly string[];
  /** Multiply source value by this to get `unit`. */
  factor: number;
  sum?: boolean;
};

export type Nutrient = {
  key: string;
  label: string;
  unit: NutrientUnit;
  /** Shown on the diary's macro bar / food card. */
  macro?: boolean;
  ifct?: SourceMap;
  indb?: SourceMap;
  off?: SourceMap;
};

const KJ_TO_KCAL = 1 / 4.184;
const G_TO_MG = 1_000;
const G_TO_UG = 1_000_000;

export const NUTRIENTS = [
  { key: "energy_kcal", label: "Calories", unit: "kcal", macro: true,
    ifct: { cols: ["enerc"], factor: KJ_TO_KCAL },
    indb: { cols: ["energy_kcal"], factor: 1 },
    off: { cols: ["energy-kcal_100g"], factor: 1 } },
  { key: "protein_g", label: "Protein", unit: "g", macro: true,
    ifct: { cols: ["protcnt"], factor: 1 }, indb: { cols: ["protein_g"], factor: 1 }, off: { cols: ["proteins_100g"], factor: 1 } },
  { key: "carbs_g", label: "Carbs", unit: "g", macro: true,
    ifct: { cols: ["choavldf"], factor: 1 }, indb: { cols: ["carb_g"], factor: 1 }, off: { cols: ["carbohydrates_100g"], factor: 1 } },
  { key: "fat_g", label: "Fat", unit: "g", macro: true,
    ifct: { cols: ["fatce"], factor: 1 }, indb: { cols: ["fat_g"], factor: 1 }, off: { cols: ["fat_100g"], factor: 1 } },
  { key: "fibre_g", label: "Fibre", unit: "g", macro: true,
    ifct: { cols: ["fibtg"], factor: 1 }, indb: { cols: ["fibre_g"], factor: 1 }, off: { cols: ["fiber_100g"], factor: 1 } },
  { key: "sugar_g", label: "Sugar", unit: "g",
    ifct: { cols: ["fsugar"], factor: 1 }, indb: { cols: ["freesugar_g"], factor: 1 }, off: { cols: ["sugars_100g"], factor: 1 } },
  { key: "sat_fat_g", label: "Saturated fat", unit: "g",
    ifct: { cols: ["fasat"], factor: 1 }, indb: { cols: ["sfa_mg"], factor: 1 / 1000 }, off: { cols: ["saturated-fat_100g"], factor: 1 } },
  { key: "trans_fat_g", label: "Trans fat", unit: "g",
    ifct: { cols: ["fatrn"], factor: 1 }, off: { cols: ["trans-fat_100g"], factor: 1 } },
  { key: "cholesterol_mg", label: "Cholesterol", unit: "mg",
    ifct: { cols: ["cholc"], factor: G_TO_MG }, indb: { cols: ["cholesterol_mg"], factor: 1 }, off: { cols: ["cholesterol_100g"], factor: G_TO_MG } },
  { key: "sodium_mg", label: "Sodium", unit: "mg",
    ifct: { cols: ["na"], factor: G_TO_MG }, indb: { cols: ["sodium_mg"], factor: 1 }, off: { cols: ["sodium_100g"], factor: G_TO_MG } },
  { key: "potassium_mg", label: "Potassium", unit: "mg",
    ifct: { cols: ["k"], factor: G_TO_MG }, indb: { cols: ["potassium_mg"], factor: 1 }, off: { cols: ["potassium_100g"], factor: G_TO_MG } },
  { key: "calcium_mg", label: "Calcium", unit: "mg",
    ifct: { cols: ["ca"], factor: G_TO_MG }, indb: { cols: ["calcium_mg"], factor: 1 }, off: { cols: ["calcium_100g"], factor: G_TO_MG } },
  { key: "iron_mg", label: "Iron", unit: "mg",
    ifct: { cols: ["fe"], factor: G_TO_MG }, indb: { cols: ["iron_mg"], factor: 1 }, off: { cols: ["iron_100g"], factor: G_TO_MG } },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg",
    ifct: { cols: ["mg"], factor: G_TO_MG }, indb: { cols: ["magnesium_mg"], factor: 1 }, off: { cols: ["magnesium_100g"], factor: G_TO_MG } },
  { key: "zinc_mg", label: "Zinc", unit: "mg",
    ifct: { cols: ["zn"], factor: G_TO_MG }, indb: { cols: ["zinc_mg"], factor: 1 }, off: { cols: ["zinc_100g"], factor: G_TO_MG } },
  { key: "vit_a_ug", label: "Vitamin A", unit: "ug",
    ifct: { cols: ["vita"], factor: G_TO_UG }, indb: { cols: ["vita_ug"], factor: 1 }, off: { cols: ["vitamin-a_100g"], factor: G_TO_UG } },
  { key: "vit_c_mg", label: "Vitamin C", unit: "mg",
    ifct: { cols: ["vitc"], factor: G_TO_MG }, indb: { cols: ["vitc_mg"], factor: 1 }, off: { cols: ["vitamin-c_100g"], factor: G_TO_MG } },
  { key: "vit_d_ug", label: "Vitamin D", unit: "ug",
    ifct: { cols: ["vitd"], factor: G_TO_UG }, indb: { cols: ["vitd2_ug", "vitd3_ug"], factor: 1, sum: true },
    off: { cols: ["vitamin-d_100g"], factor: G_TO_UG } },
  { key: "vit_b6_mg", label: "Vitamin B6", unit: "mg",
    ifct: { cols: ["vitb6c"], factor: G_TO_MG }, indb: { cols: ["vitb6_mg"], factor: 1 }, off: { cols: ["vitamin-b6_100g"], factor: G_TO_MG } },
  { key: "vit_b12_ug", label: "Vitamin B12", unit: "ug",
    off: { cols: ["vitamin-b12_100g"], factor: G_TO_UG } },
  { key: "folate_ug", label: "Folate", unit: "ug",
    ifct: { cols: ["folsum"], factor: G_TO_UG }, indb: { cols: ["folate_ug"], factor: 1 }, off: { cols: ["folates_100g"], factor: G_TO_UG } },
  { key: "beta_carotene_ug", label: "Beta-carotene", unit: "ug",
    ifct: { cols: ["cartb"], factor: G_TO_UG }, off: { cols: ["beta-carotene_100g"], factor: G_TO_UG } },
  { key: "omega3_g", label: "Omega-3", unit: "g",
    ifct: { cols: ["facn3", "f18d3n3"], factor: 1 }, off: { cols: ["omega-3-fat_100g"], factor: 1 } },
  { key: "omega6_g", label: "Omega-6", unit: "g",
    ifct: { cols: ["facn6", "f18d2cn6"], factor: 1 }, off: { cols: ["omega-6-fat_100g"], factor: 1 } },
] as const satisfies readonly Nutrient[];

export type NutrientKey = (typeof NUTRIENTS)[number]["key"];
export type NutrientValues = Partial<Record<NutrientKey, number>>;

export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key) as NutrientKey[];

const BY_KEY = new Map<string, Nutrient>(NUTRIENTS.map((n) => [n.key, n]));
/** Typed lookup of one nutrient definition. */
export function nutrient(key: NutrientKey): Nutrient {
  return BY_KEY.get(key)!;
}
export const MACRO_KEYS = NUTRIENTS.filter((n) => "macro" in n && n.macro).map((n) => n.key) as NutrientKey[];

/** Read one nutrient from a source row using its mapping; returns null when absent. */
export function readMapped(row: Record<string, unknown>, map: SourceMap | undefined): number | null {
  if (!map) return null;
  let total: number | null = null;
  for (const col of map.cols) {
    const raw = row[col];
    if (raw === undefined || raw === null || raw === "") continue;
    const v = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(v)) continue;
    if (!map.sum) return v * map.factor;
    total = (total ?? 0) + v;
  }
  return total === null ? null : total * map.factor;
}

/** Scale per-100 g values to an amount in grams, rounding for storage. */
export function scaleNutrients(per100g: NutrientValues, grams: number): NutrientValues {
  const out: NutrientValues = {};
  const k = grams / 100;
  for (const key of NUTRIENT_KEYS) {
    const v = per100g[key];
    if (v !== undefined && v !== null) out[key] = round(v * k, key === "energy_kcal" ? 1 : 3);
  }
  return out;
}

/**
 * Whole kcal for an amount, rounded exactly like a stored log (1 dp, then whole number),
 * so list previews, the portion sheet and the diary always agree.
 */
export function kcalFor(kcalPer100g: number, grams: number): number {
  return Math.round(round((kcalPer100g * grams) / 100, 1));
}

export function round(v: number, dp: number): number {
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}
