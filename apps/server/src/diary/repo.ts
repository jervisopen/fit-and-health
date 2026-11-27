import type { Db } from "../db/types.ts";
import { NUTRIENT_KEYS, round, scaleNutrients, type NutrientValues } from "../../../../packages/shared/src/nutrients.ts";
import { MEAL_TYPES, type MealTypeCode } from "../../../../packages/shared/src/meals.ts";
import { DEFAULT_GOALS, type MacroGoals, type Profile } from "../../../../packages/shared/src/goals.ts";
import type {
  CreateLogBody, DaySummaryDTO, DiaryDayDTO, FoodLogDTO, LogSource, MealSettingDTO, SettingsDTO, UpdateLogBody,
} from "../../../../packages/shared/src/api.ts";
import { newId, transaction } from "../db/types.ts";
import { getFoodRow, NotFoundError, per100g, resolveMeasure, ValidationError } from "../foods/repo.ts";

// ── Settings: goals and meals apply from a date onward; the latest row on or before a date wins ──

export function goalsFor(db: Db, date: string): { goals: MacroGoals; isDefault: boolean } {
  const row = db.prepare(`SELECT calories, protein_g, carbs_g, fat_g, fibre_g FROM goals
                          WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1`).get(date) as MacroGoals | undefined;
  return row ? { goals: { ...row }, isDefault: false } : { goals: DEFAULT_GOALS, isDefault: true };
}

export function setGoals(db: Db, goals: MacroGoals, effectiveFrom: string) {
  db.prepare(`INSERT OR REPLACE INTO goals (effective_from, calories, protein_g, carbs_g, fat_g, fibre_g)
              VALUES (?, ?, ?, ?, ?, ?)`).run(effectiveFrom, goals.calories, goals.protein_g, goals.carbs_g, goals.fat_g, goals.fibre_g);
}

export function mealSettingsFor(db: Db, date: string): MealSettingDTO[] {
  const latest = db.prepare("SELECT max(effective_from) AS d FROM meal_settings WHERE effective_from <= ?").get(date) as { d: string | null };
  const saved = latest.d
    ? (db.prepare("SELECT * FROM meal_settings WHERE effective_from = ?").all(latest.d) as Record<string, unknown>[])
    : [];
  const byCode = new Map(saved.map((r) => [r.meal_type as string, r]));
  return MEAL_TYPES.map((m) => {
    const r = byCode.get(m.code);
    return r
      ? { code: m.code, displayName: r.display_name as string, timeMin: r.time_min as number, enabled: Boolean(r.enabled), caloriesPct: r.calories_pct as number }
      : { code: m.code, displayName: m.name, timeMin: m.defaultTimeMin, enabled: true, caloriesPct: m.defaultPct };
  });
}

export function setMealSettings(db: Db, meals: MealSettingDTO[], effectiveFrom: string) {
  const enabled = meals.filter((m) => m.enabled);
  if (!enabled.length) throw new ValidationError("At least one meal must be enabled");
  const total = enabled.reduce((s, m) => s + m.caloriesPct, 0);
  if (Math.abs(total - 100) > 0.5) throw new ValidationError(`Enabled meals must add up to 100% of calories (got ${round(total, 1)}%)`);
  transaction(db, () => {
    db.prepare("DELETE FROM meal_settings WHERE effective_from = ?").run(effectiveFrom);
    const ins = db.prepare(`INSERT INTO meal_settings (effective_from, meal_type, display_name, time_min, enabled, calories_pct)
                            VALUES (?, ?, ?, ?, ?, ?)`);
    for (const m of meals) ins.run(effectiveFrom, m.code, m.displayName.trim() || m.code, m.timeMin, Number(m.enabled), m.enabled ? m.caloriesPct : 0);
  });
}

export function getProfile(db: Db): Profile | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'profile'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as Profile) : null;
}

export function setProfile(db: Db, profile: Profile) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('profile', ?)").run(JSON.stringify(profile));
}

export function getSettings(db: Db, today: string): SettingsDTO {
  const { goals, isDefault } = goalsFor(db, today);
  return { goals, goalsAreDefault: isDefault, meals: mealSettingsFor(db, today), profile: getProfile(db) };
}

// ── Food logs (nutrients are snapshotted at log time, like HealthifyMe's foodlog) ────────────

function toLog(r: Record<string, unknown>): FoodLogDTO {
  const nutrients: NutrientValues = {};
  for (const k of NUTRIENT_KEYS) if (r[k] !== null && r[k] !== undefined) nutrients[k] = r[k] as number;
  return {
    id: r.id as string,
    date: r.diary_date as string,
    mealType: r.meal_type as MealTypeCode,
    foodId: (r.food_id as string) ?? null,
    foodName: r.food_name as string,
    measureId: (r.measure_id as string) ?? null,
    measureName: r.measure_name as string,
    quantity: r.quantity as number,
    weightG: r.weight_g as number,
    nutrients,
    source: r.source as LogSource,
    snapImageId: (r.snap_image_id as string) ?? null,
    dataQuality: (r.data_quality as string) ?? null,
    createdAt: r.created_at as number,
  };
}

const LOG_SELECT = `SELECT l.*, f.data_quality FROM food_logs l LEFT JOIN foods f ON f.id = l.food_id`;

export function getLog(db: Db, id: string): FoodLogDTO {
  const r = db.prepare(`${LOG_SELECT} WHERE l.id = ? AND l.deleted_at IS NULL`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new NotFoundError(`Log ${id} not found`);
  return toLog(r);
}

function writeNutrients(db: Db, id: string, nutrients: NutrientValues) {
  const sets = NUTRIENT_KEYS.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE food_logs SET ${sets} WHERE id = ?`).run(...NUTRIENT_KEYS.map((k) => nutrients[k] ?? null), id);
}

/** Insert one log (call inside a transaction when creating several). */
export function insertLog(db: Db, body: CreateLogBody & { snapImageId?: string }): string {
  const food = getFoodRow(db, body.foodId);
  if (!food) throw new NotFoundError(`Food ${body.foodId} not found`);
  const measure = resolveMeasure(db, food, body.measureId);
  const weightG = round(measure.weightG * body.quantity, 2);
  const id = newId();
  db.prepare(`INSERT INTO food_logs (id, diary_date, meal_type, food_id, food_name, measure_id, measure_name, quantity, weight_g, source, snap_image_id, consumed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`)
    .run(id, body.date, body.mealType, food.id, food.name, measure.id, measure.name, body.quantity, weightG, body.source ?? "search", body.snapImageId ?? null);
  writeNutrients(db, id, scaleNutrients(per100g(food), weightG));
  return id;
}

export function createLog(db: Db, body: CreateLogBody): FoodLogDTO {
  const id = transaction(db, () => insertLog(db, body));
  return getLog(db, id);
}

/**
 * Change quantity / unit / meal / date. Nutrients are recomputed from the food when it still exists;
 * if the food was removed, the snapshot is scaled by the weight ratio (unit changes need the food).
 */
export function updateLog(db: Db, id: string, patch: UpdateLogBody): FoodLogDTO {
  const current = getLog(db, id);
  const quantity = patch.quantity ?? current.quantity;
  const food = current.foodId ? getFoodRow(db, current.foodId) : undefined;
  transaction(db, () => {
    if (patch.quantity !== undefined || patch.measureId !== undefined) {
      if (food) {
        const measure = resolveMeasure(db, food, patch.measureId ?? current.measureId ?? "gen:g");
        const weightG = round(measure.weightG * quantity, 2);
        db.prepare("UPDATE food_logs SET measure_id = ?, measure_name = ?, quantity = ?, weight_g = ? WHERE id = ?")
          .run(measure.id, measure.name, quantity, weightG, id);
        writeNutrients(db, id, scaleNutrients(per100g(food), weightG));
      } else {
        if (patch.measureId && patch.measureId !== current.measureId) {
          throw new ValidationError("This food is no longer in the database, so only the quantity can change");
        }
        const ratio = quantity / current.quantity;
        const scaled: NutrientValues = {};
        for (const k of NUTRIENT_KEYS) {
          const v = current.nutrients[k];
          if (v !== undefined) scaled[k] = round(v * ratio, 3);
        }
        db.prepare("UPDATE food_logs SET quantity = ?, weight_g = ? WHERE id = ?").run(quantity, round(current.weightG * ratio, 2), id);
        writeNutrients(db, id, scaled);
      }
    }
    if (patch.mealType) db.prepare("UPDATE food_logs SET meal_type = ? WHERE id = ?").run(patch.mealType, id);
    if (patch.date) db.prepare("UPDATE food_logs SET diary_date = ? WHERE id = ?").run(patch.date, id);
    db.prepare("UPDATE food_logs SET updated_at = unixepoch() WHERE id = ?").run(id);
  });
  return getLog(db, id);
}

export function deleteLog(db: Db, id: string) {
  getLog(db, id);
  db.prepare("UPDATE food_logs SET deleted_at = unixepoch() WHERE id = ?").run(id);
}

/** Copy every log of one meal to another date (and optionally another meal). */
export function copyMeal(db: Db, from: { date: string; mealType: MealTypeCode }, to: { date: string; mealType: MealTypeCode }): FoodLogDTO[] {
  const rows = db.prepare("SELECT id FROM food_logs WHERE diary_date = ? AND meal_type = ? AND deleted_at IS NULL ORDER BY created_at, rowid")
    .all(from.date, from.mealType) as { id: string }[];
  const cols = ["food_id", "food_name", "measure_id", "measure_name", "quantity", "weight_g", "source", "snap_image_id", ...NUTRIENT_KEYS];
  const created: string[] = [];
  transaction(db, () => {
    for (const { id } of rows) {
      const copyId = newId();
      db.prepare(`INSERT INTO food_logs (id, diary_date, meal_type, consumed_at, ${cols.join(",")})
                  SELECT ?, ?, ?, unixepoch(), ${cols.join(",")} FROM food_logs WHERE id = ?`).run(copyId, to.date, to.mealType, id);
      created.push(copyId);
    }
  });
  return created.map((id) => getLog(db, id));
}

function sumNutrients(logs: FoodLogDTO[]): NutrientValues {
  const out: NutrientValues = {};
  for (const l of logs) {
    for (const k of NUTRIENT_KEYS) {
      const v = l.nutrients[k];
      if (v !== undefined) out[k] = (out[k] ?? 0) + v;
    }
  }
  for (const k of NUTRIENT_KEYS) if (out[k] !== undefined) out[k] = round(out[k]!, k === "energy_kcal" ? 0 : 2);
  return out;
}

export function getDiaryDay(db: Db, date: string): DiaryDayDTO {
  const { goals, isDefault } = goalsFor(db, date);
  const settings = mealSettingsFor(db, date);
  const logs = (db.prepare(`${LOG_SELECT} WHERE l.diary_date = ? AND l.deleted_at IS NULL ORDER BY l.created_at, l.rowid`)
    .all(date) as Record<string, unknown>[]).map(toLog);
  const meals = settings
    // A disabled meal still shows if something was logged in it.
    .filter((s) => s.enabled || logs.some((l) => l.mealType === s.code))
    .map((s) => {
      const mealLogs = logs.filter((l) => l.mealType === s.code);
      return {
        code: s.code,
        name: s.displayName,
        timeMin: s.timeMin,
        enabled: s.enabled,
        budgetKcal: Math.round((goals.calories * s.caloriesPct) / 100),
        totals: sumNutrients(mealLogs),
        logs: mealLogs,
      };
    });
  return { date, goals, goalsAreDefault: isDefault, meals, totals: sumNutrients(logs) };
}

/** Calories per day for the date strip. */
export function daySummaries(db: Db, from: string, to: string): DaySummaryDTO[] {
  return db.prepare(`SELECT diary_date AS date, round(coalesce(sum(energy_kcal), 0)) AS kcal, count(*) AS logs
                     FROM food_logs WHERE diary_date BETWEEN ? AND ? AND deleted_at IS NULL
                     GROUP BY diary_date ORDER BY diary_date`).all(from, to) as DaySummaryDTO[];
}
