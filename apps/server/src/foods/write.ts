/** Writing dataset foods (used by the ingest builder and by live barcode lookup). */
import type { Db } from "../db/types.ts";
import { NUTRIENT_KEYS, type NutrientValues } from "../../../../packages/shared/src/nutrients.ts";

export type DatasetSource = "ifct" | "indb" | "off";

export type FoodNameRecord = { name: string; lang: string; isPrimary: boolean };

export type MeasureRecord = {
  id: string;
  name: string;
  weightG: number;
  rank: number;
  isEstimated: boolean;
  source: "indb" | "off" | "seed";
};

export type FoodRecord = {
  id: string;
  source: DatasetSource;
  sourceRef: string;
  name: string;
  brand?: string;
  category?: string;
  barcode?: string;
  isVeg?: boolean;
  /** Static prior used by search ranking; higher is better. */
  rank: number;
  relevance: { breakfast: number; lunch: number; snack: number; dinner: number };
  densityGPerMl?: number;
  imageUrl?: string;
  /** Known issue with the source values, surfaced in the UI. */
  dataQuality?: "suspect_frying_oil";
  nutrients: NutrientValues;
  names: FoodNameRecord[];
  measures: MeasureRecord[];
  defaultMeasureId: string;
};

export function writeFoods(db: Db, foods: FoodRecord[]) {
  const cols = ["id", "source", "source_ref", "name", "brand", "category", "barcode", "is_veg", "rank",
    "rel_breakfast", "rel_lunch", "rel_snack", "rel_dinner", "default_measure_id", "density_g_per_ml", "image_url",
    "data_quality", ...NUTRIENT_KEYS];
  const insFood = db.prepare(`INSERT INTO foods (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  const insName = db.prepare("INSERT INTO food_names (food_id, name, lang, is_primary) VALUES (?, ?, ?, ?)");
  const insMeasure = db.prepare(`INSERT INTO food_measures (id, food_id, name, weight_g, volume_ml, rank, is_estimated, source)
                                 VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`);
  const taken = db.prepare("SELECT 1 FROM foods WHERE barcode = ?");
  const barcodes = new Set<string>();
  for (const f of foods) {
    // Barcodes are unique; the first (highest-priority) record wins.
    const free = f.barcode && !barcodes.has(f.barcode) && !taken.get(f.barcode);
    const barcode = free ? f.barcode! : null;
    if (barcode) barcodes.add(barcode);
    insFood.run(
      f.id, f.source, f.sourceRef, f.name, f.brand ?? null, f.category ?? null, barcode,
      f.isVeg === undefined ? null : Number(f.isVeg), f.rank,
      f.relevance.breakfast, f.relevance.lunch, f.relevance.snack, f.relevance.dinner,
      f.defaultMeasureId, f.densityGPerMl ?? null, f.imageUrl ?? null, f.dataQuality ?? null,
      ...NUTRIENT_KEYS.map((k) => f.nutrients[k] ?? null),
    );
    for (const n of f.names) insName.run(f.id, n.name, n.lang, Number(n.isPrimary));
    for (const m of f.measures) insMeasure.run(m.id, f.id, m.name, m.weightG, m.rank, Number(m.isEstimated), m.source);
  }
}
