import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { kcalFor, NUTRIENT_KEYS, round, type NutrientValues } from "../../../../packages/shared/src/nutrients.ts";
import type {
  CustomFoodBody, FoodDetailDTO, FoodSummaryDTO, MeasureDTO, RecentFoodDTO,
} from "../../../../packages/shared/src/api.ts";
import type { MealTypeCode } from "../../../../packages/shared/src/meals.ts";
import { transaction } from "../db/index.ts";

type FoodRow = Record<string, unknown> & {
  id: string; name: string; brand: string | null; category: string | null; source: string;
  is_veg: number | null; energy_kcal: number | null; default_measure_id: string | null;
  density_g_per_ml: number | null; data_quality: string | null; barcode: string | null; image_url: string | null;
};

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export function getFoodRow(db: DatabaseSync, id: string): FoodRow | undefined {
  return db.prepare("SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL").get(id) as FoodRow | undefined;
}

export function per100g(row: Record<string, unknown>): NutrientValues {
  const out: NutrientValues = {};
  for (const k of NUTRIENT_KEYS) if (row[k] !== null && row[k] !== undefined) out[k] = row[k] as number;
  return out;
}

/**
 * Every unit a food can be logged in: its own units (bowl, piece, serving…) first, then generic ones.
 * Volume units (katori, cup, glass, tsp…) are offered only when the food has a density;
 * a generic unit is hidden when the food already has a unit with the same name.
 */
export function measuresFor(db: DatabaseSync, food: FoodRow): MeasureDTO[] {
  const own = (db.prepare("SELECT id, name, weight_g, is_estimated FROM food_measures WHERE food_id = ? AND weight_g IS NOT NULL ORDER BY rank")
    .all(food.id) as { id: string; name: string; weight_g: number; is_estimated: number }[])
    .map((m) => ({ id: m.id, name: m.name, weightG: m.weight_g, isEstimated: Boolean(m.is_estimated), kind: "food" as const }));
  const names = new Set(own.map((m) => m.name.toLowerCase()));
  const generic = (db.prepare("SELECT id, name, weight_g, volume_ml, is_estimated FROM food_measures WHERE food_id IS NULL ORDER BY rank")
    .all() as { id: string; name: string; weight_g: number | null; volume_ml: number | null; is_estimated: number }[])
    .flatMap((m): MeasureDTO[] => {
      if (names.has(m.name.toLowerCase())) return [];
      const weightG = m.weight_g ?? (m.volume_ml && food.density_g_per_ml ? round(m.volume_ml * food.density_g_per_ml, 1) : null);
      if (!weightG) return [];
      return [{ id: m.id, name: m.name, weightG, isEstimated: Boolean(m.is_estimated) || m.weight_g === null, kind: "generic" }];
    });
  return [...own, ...generic];
}

export function resolveMeasure(db: DatabaseSync, food: FoodRow, measureId: string): MeasureDTO {
  const m = measuresFor(db, food).find((x) => x.id === measureId);
  if (!m) throw new ValidationError(`Unit "${measureId}" is not available for ${food.name}`);
  return m;
}

function summarize(row: FoodRow, measures?: MeasureDTO[]): FoodSummaryDTO {
  const dm = measures?.find((m) => m.id === row.default_measure_id)
    ?? (row.default_measure_id === "gen:g" || !row.default_measure_id ? { id: "gen:g", name: "g", weightG: 1 } : undefined);
  const defaultQuantity = !dm || dm.id === "gen:g" ? 100 : 1;
  const kcal = row.energy_kcal;
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    source: row.source,
    isVeg: row.is_veg === null ? null : Boolean(row.is_veg),
    kcalPer100g: kcal,
    defaultMeasure: dm ? { id: dm.id, name: dm.name, weightG: dm.weightG } : null,
    defaultQuantity,
    kcalPerDefault: kcal !== null && dm ? kcalFor(kcal, dm.weightG * defaultQuantity) : null,
    dataQuality: row.data_quality,
  };
}

export function getFoodDetail(db: DatabaseSync, id: string): FoodDetailDTO {
  const row = getFoodRow(db, id);
  if (!row) throw new NotFoundError(`Food ${id} not found`);
  const measures = measuresFor(db, row);
  const defaultMeasureId = measures.some((m) => m.id === row.default_measure_id) ? row.default_measure_id! : "gen:g";
  return {
    ...summarize(row, measures),
    per100g: per100g(row),
    measures,
    defaultMeasureId,
    barcode: row.barcode,
    imageUrl: row.image_url,
  };
}

/** Foods logged recently, same meal slot first, with the unit and quantity used last time. */
export function recentFoods(db: DatabaseSync, mealType: MealTypeCode | undefined, limit = 20): RecentFoodDTO[] {
  const rows = db.prepare(`
    SELECT l.food_id AS food_id, count(*) AS times, max(l.created_at) AS last_at,
           sum(CASE WHEN l.meal_type = ? THEN 1 ELSE 0 END) AS same_meal
    FROM food_logs l JOIN foods f ON f.id = l.food_id AND f.deleted_at IS NULL
    WHERE l.deleted_at IS NULL AND l.food_id IS NOT NULL
    GROUP BY l.food_id
    ORDER BY (same_meal > 0) DESC, last_at DESC
    LIMIT ?`).all(mealType ?? "", limit) as { food_id: string; times: number }[];
  const lastUse = db.prepare(`SELECT measure_id, quantity FROM food_logs WHERE food_id = ? AND deleted_at IS NULL
                              ORDER BY created_at DESC, rowid DESC LIMIT 1`);
  return rows.map((r) => {
    const food = getFoodRow(db, r.food_id)!;
    const last = lastUse.get(r.food_id) as { measure_id: string | null; quantity: number };
    return { ...summarize(food, measuresFor(db, food)), lastMeasureId: last.measure_id, lastQuantity: last.quantity, timesLogged: r.times };
  });
}

// ── Custom foods ──────────────────────────────────────────────────────────────────────────────

function perServingTo100g(body: CustomFoodBody): NutrientValues {
  const out: NutrientValues = {};
  for (const k of NUTRIENT_KEYS) {
    const v = body.perServing[k];
    if (v !== undefined && v !== null) out[k] = round((v * 100) / body.servingWeightG, 4);
  }
  return out;
}

export function upsertCustomFood(db: DatabaseSync, body: CustomFoodBody, existingId?: string): FoodDetailDTO {
  const id = existingId ?? `custom:${randomUUID()}`;
  if (existingId) {
    const row = getFoodRow(db, existingId);
    if (!row || row.source !== "custom") throw new NotFoundError(`Custom food ${existingId} not found`);
  }
  const nutrients = perServingTo100g(body);
  const measureId = `${id}:serving`;
  transaction(db, () => {
    db.prepare("DELETE FROM foods WHERE id = ?").run(id); // cascades names + measures
    const cols = ["id", "source", "source_ref", "name", "brand", "is_veg", "rank", "rel_breakfast", "rel_lunch",
      "rel_snack", "rel_dinner", "default_measure_id", ...NUTRIENT_KEYS];
    db.prepare(`INSERT INTO foods (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(
      id, "custom", id.slice(7), body.name.trim(), body.brand?.trim() || null,
      body.isVeg === undefined ? null : Number(body.isVeg), 2.5, 0.5, 0.5, 0.5, 0.5, measureId,
      ...NUTRIENT_KEYS.map((k) => nutrients[k] ?? null),
    );
    db.prepare("INSERT INTO food_names (food_id, name, lang, is_primary) VALUES (?, ?, 'en', 1)").run(id, body.name.trim());
    if (body.brand?.trim()) {
      db.prepare("INSERT INTO food_names (food_id, name, lang, is_primary) VALUES (?, ?, 'en', 0)").run(id, `${body.brand.trim()} ${body.name.trim()}`);
    }
    db.prepare(`INSERT INTO food_measures (id, food_id, name, weight_g, rank, is_estimated, source)
                VALUES (?, ?, ?, ?, 1, 0, 'custom')`).run(measureId, id, body.servingName.trim(), body.servingWeightG);
  });
  return getFoodDetail(db, id);
}

export function deleteCustomFood(db: DatabaseSync, id: string) {
  const row = getFoodRow(db, id);
  if (!row || row.source !== "custom") throw new NotFoundError(`Custom food ${id} not found`);
  db.prepare("UPDATE foods SET deleted_at = unixepoch() WHERE id = ?").run(id);
}

export function listCustomFoods(db: DatabaseSync): FoodSummaryDTO[] {
  const rows = db.prepare("SELECT * FROM foods WHERE source = 'custom' AND deleted_at IS NULL ORDER BY name").all() as FoodRow[];
  return rows.map((r) => summarize(r, measuresFor(db, r)));
}

// ── Barcode lookup (local first, then Open Food Facts live) ─────────────────────────────────

export type OffFetcher = (code: string) => Promise<Record<string, unknown> | null>;

export function findByBarcode(db: DatabaseSync, code: string): FoodDetailDTO | null {
  const row = db.prepare("SELECT id FROM foods WHERE barcode = ? AND deleted_at IS NULL").get(code) as { id: string } | undefined;
  return row ? getFoodDetail(db, row.id) : null;
}
