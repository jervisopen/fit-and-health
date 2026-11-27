/**
 * IFCT 2017 raw ingredients → FoodRecord.
 * Input: data/raw/ifct/compositions.csv (nodef/ifct2017 packaging: g per 100 g, energy kJ).
 */
import { NUTRIENTS, readMapped, round, type NutrientValues } from "../../../packages/shared/src/nutrients.ts";
import { csvObjects } from "../lib/csv.ts";
import { densityFor, mealRelevance, normalize, pieceWeightsFor } from "../lib/classify.ts";
import type { FoodNameRecord, FoodRecord, MeasureRecord } from "../lib/types.ts";

/** Where browsers and `data:fetch` download IFCT 2017 from (CORS-enabled). */
export const IFCT_URL = "https://raw.githubusercontent.com/nodef/ifct2017/main/compositions/index.csv";

// Language prefixes used in the IFCT "lang" column ("H. Atta; Tam. Mulu Godumai maavu; …").
const LANG: Record<string, string> = {
  E: "en", Common: "en",
  A: "as", B: "bn", G: "gu", H: "hi", Kan: "kn", Kash: "ks", Kh: "kha", Kon: "kok", Mal: "ml",
  M: "mni", Mar: "mr", N: "ne", O: "or", P: "pa", S: "sa", Tam: "ta", Tel: "te", U: "ur",
};

export function parseLocalNames(lang: string): FoodNameRecord[] {
  const out: FoodNameRecord[] = [];
  for (const part of lang.split(";")) {
    const m = part.trim().match(/^([A-Z][a-z]*)\.\s*(.+?)\.?$/);
    if (!m) continue;
    const code = LANG[m[1]!] ?? m[1]!.toLowerCase();
    for (const n of m[2]!.split(/,|\//)) {
      const name = n.trim();
      if (name.length >= 2) out.push({ name, lang: code, isPrimary: false });
    }
  }
  return out;
}

/** IFCT compositions CSV text → food records. */
export function ifctRecords(csvText: string): FoodRecord[] {
  const rows = csvObjects(csvText);
  return rows.map((r) => {
    const code = r.code!;
    const name = r.name!.trim();
    const category = r.grup?.trim() || undefined;

    const nutrients: NutrientValues = {};
    for (const n of NUTRIENTS) {
      const v = readMapped(r, "ifct" in n ? n.ifct : undefined);
      if (v !== null) nutrients[n.key] = round(v, n.key === "energy_kcal" ? 1 : 4);
    }

    const measures: MeasureRecord[] = pieceWeightsFor(name).map((p, i) => ({
      id: `ifct:${code}:${normalize(p.unit).replace(/\W+/g, "_")}`,
      name: p.unit,
      weightG: p.weightG,
      rank: 1 + i,
      isEstimated: true,
      source: "seed",
    }));

    // Local-language names, deduplicated against the English name.
    const seen = new Set([normalize(name)]);
    const names: FoodNameRecord[] = [{ name, lang: "en", isPrimary: true }];
    for (const n of parseLocalNames(r.lang ?? "")) {
      const key = normalize(n.name);
      if (!seen.has(key)) { seen.add(key); names.push(n); }
    }

    const fruit = category === "Fruits";
    const rel = fruit ? { breakfast: 0.6, lunch: 0.2, snack: 1, dinner: 0.1 } : mealRelevance(name, category);

    return {
      id: `ifct:${code}`,
      source: "ifct",
      sourceRef: code,
      name,
      category,
      isVeg: /\bvegetarian\b/.test(r.tags ?? ""),
      rank: 2,
      relevance: rel,
      densityGPerMl: densityFor(name, category),
      nutrients,
      names,
      measures,
      defaultMeasureId: measures[0]?.id ?? "gen:g",
    } satisfies FoodRecord;
  });
}
