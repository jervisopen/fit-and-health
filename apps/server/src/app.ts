import { Hono, type Context } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { MEAL_CODES, type MealTypeCode } from "../../../packages/shared/src/meals.ts";
import { NUTRIENT_KEYS } from "../../../packages/shared/src/nutrients.ts";
import { searchFoods } from "./foods/search.ts";
import {
  deleteCustomFood, getFoodDetail, listCustomFoods, NotFoundError, recentFoods, upsertCustomFood, ValidationError,
} from "./foods/repo.ts";
import { lookupBarcode, type OffFetcher } from "./foods/barcode.ts";
import {
  copyMeal, createLog, daySummaries, deleteLog, getDiaryDay, getLog, getSettings, setGoals, setMealSettings,
  setProfile, updateLog,
} from "./diary/repo.ts";
import {
  activePlan, deleteFast, endFast, endPlan, getStatus, history, planIcs, setPlan, startFast, updateFast,
} from "./fasting/repo.ts";
import { isValidTimeZone } from "../../../packages/shared/src/time.ts";

// ── Validation ──────────────────────────────────────────────────────────────────────────────
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date");
const mealType = z.enum(["B", "SM", "L", "S", "D"]) satisfies z.ZodType<MealTypeCode>;
const quantity = z.number().positive().max(10_000);
const epochMs = z.number().int().min(946_684_800_000).max(4_102_444_800_000); // 2000–2100
const nutrientShape = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, z.number().min(0).max(100_000).optional()]));

const schemas = {
  createLog: z.object({
    date: isoDate, mealType, foodId: z.string().min(1), measureId: z.string().min(1), quantity,
    source: z.enum(["search", "recent", "my_meal", "custom", "barcode", "snap", "quick_add"]).optional(),
  }),
  updateLog: z.object({ quantity: quantity.optional(), measureId: z.string().min(1).optional(), mealType: mealType.optional(), date: isoDate.optional() })
    .refine((o) => Object.keys(o).length > 0, "Nothing to update"),
  copyMeal: z.object({
    from: z.object({ date: isoDate, mealType }),
    to: z.object({ date: isoDate, mealType }),
  }),
  goals: z.object({
    calories: z.number().min(800).max(10_000),
    protein_g: z.number().min(0).max(1000),
    carbs_g: z.number().min(0).max(2000),
    fat_g: z.number().min(0).max(1000),
    fibre_g: z.number().min(0).max(300),
    effectiveFrom: isoDate,
  }),
  meals: z.object({
    effectiveFrom: isoDate,
    meals: z.array(z.object({
      code: mealType, displayName: z.string().max(40), timeMin: z.number().int().min(0).max(1439),
      enabled: z.boolean(), caloriesPct: z.number().min(0).max(100),
    })).length(MEAL_CODES.length),
  }),
  profile: z.object({
    sex: z.enum(["female", "male"]), age: z.number().int().min(13).max(110),
    heightCm: z.number().min(100).max(250), weightKg: z.number().min(25).max(350),
    activity: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
    goal: z.enum(["lose", "maintain", "gain"]),
  }),
  fastingPlan: z.object({
    presetKey: z.string().min(1).max(20),
    mode: z.enum(["schedule", "manual"]),
    fastingHours: z.number().min(10).max(48),
    startsAtMin: z.number().int().min(0).max(1439).nullable().optional(),
    timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
  }).refine((p) => p.mode === "manual" || (p.startsAtMin !== undefined && p.startsAtMin !== null), "A schedule needs startsAtMin"),
  fastingStart: z.object({ startedAt: z.number().int().positive().optional() }),
  fastingEnd: z.object({ endedAt: z.number().int().positive().optional(), startedAt: z.number().int().positive().optional() }),
  fastingPatch: z.object({
    startedAt: z.number().int().positive().optional(),
    endedAt: z.number().int().positive().optional(),
    note: z.string().max(500).nullable().optional(),
  }).refine((o) => Object.keys(o).length > 0, "Nothing to update"),
  customFood: z.object({
    name: z.string().trim().min(2).max(120),
    brand: z.string().trim().max(80).optional(),
    isVeg: z.boolean().optional(),
    servingName: z.string().trim().min(1).max(40),
    servingWeightG: z.number().positive().max(5000),
    perServing: z.object(nutrientShape).refine((n) => n.energy_kcal !== undefined, "Calories are required"),
  }),
};

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new ValidationError("Request body must be JSON"); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return parsed.data;
}

function param<T extends z.ZodType>(schema: T, value: unknown, name: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(`${name}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type AppDeps = { db: DatabaseSync; offFetcher?: OffFetcher; clock?: () => number };

export function createApp({ db, offFetcher, clock = Date.now }: AppDeps) {
  const app = new Hono().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/health", (c) => {
    const v = db.prepare("SELECT value FROM meta WHERE key = 'food_db_version'").get() as { value: string } | undefined;
    const foods = (db.prepare("SELECT count(*) AS n FROM foods WHERE deleted_at IS NULL").get() as { n: number }).n;
    return c.json({ ok: true, foodDbVersion: v?.value ?? null, foods });
  });

  // ── Foods ──
  app.get("/foods/search", (c) => {
    const q = c.req.query("q") ?? "";
    const meal = c.req.query("meal");
    const limit = Number(c.req.query("limit") ?? 25);
    return c.json(searchFoods(db, q, { limit, mealType: meal ? param(mealType, meal, "meal") : undefined }));
  });
  app.get("/foods/recent", (c) => {
    const meal = c.req.query("meal");
    return c.json(recentFoods(db, meal ? param(mealType, meal, "meal") : undefined, Number(c.req.query("limit") ?? 20)));
  });
  app.get("/foods/custom", (c) => c.json(listCustomFoods(db)));
  app.post("/foods/custom", async (c) => c.json(upsertCustomFood(db, await body(c, schemas.customFood)), 201));
  app.put("/foods/custom/:id", async (c) => c.json(upsertCustomFood(db, await body(c, schemas.customFood), c.req.param("id"))));
  app.delete("/foods/custom/:id", (c) => { deleteCustomFood(db, c.req.param("id")); return c.body(null, 204); });
  app.get("/foods/barcode/:code", async (c) => {
    const food = await lookupBarcode(db, c.req.param("code"), offFetcher);
    return food ? c.json(food) : c.json({ error: "No product with nutrition facts found for this barcode" }, 404);
  });
  app.get("/foods/:id", (c) => c.json(getFoodDetail(db, c.req.param("id"))));

  // ── Diary ──
  app.get("/diary/summary", (c) => {
    const from = param(isoDate, c.req.query("from"), "from");
    const to = param(isoDate, c.req.query("to"), "to");
    return c.json(daySummaries(db, from, to));
  });
  app.get("/diary/:date", (c) => c.json(getDiaryDay(db, param(isoDate, c.req.param("date"), "date"))));
  app.post("/logs", async (c) => c.json(createLog(db, await body(c, schemas.createLog)), 201));
  app.get("/logs/:id", (c) => c.json(getLog(db, c.req.param("id"))));
  app.patch("/logs/:id", async (c) => c.json(updateLog(db, c.req.param("id"), await body(c, schemas.updateLog))));
  app.delete("/logs/:id", (c) => { deleteLog(db, c.req.param("id")); return c.body(null, 204); });
  app.post("/logs/copy-meal", async (c) => {
    const b = await body(c, schemas.copyMeal);
    return c.json(copyMeal(db, b.from, b.to), 201);
  });

  // ── Settings ──
  app.get("/settings", (c) => c.json(getSettings(db, c.req.query("date") ? param(isoDate, c.req.query("date"), "date") : localToday())));
  app.put("/settings/goals", async (c) => {
    const { effectiveFrom, ...goals } = await body(c, schemas.goals);
    setGoals(db, goals, effectiveFrom);
    return c.json(getSettings(db, effectiveFrom));
  });
  app.put("/settings/meals", async (c) => {
    const b = await body(c, schemas.meals);
    setMealSettings(db, b.meals, b.effectiveFrom);
    return c.json(getSettings(db, b.effectiveFrom));
  });
  app.put("/settings/profile", async (c) => {
    setProfile(db, await body(c, schemas.profile));
    return c.json(getSettings(db, localToday()));
  });

  // ── Fasting ──
  app.get("/fasting/status", (c) => c.json(getStatus(db, clock())));
  app.put("/fasting/plan", async (c) => {
    const b = await body(c, schemas.fastingPlan);
    setPlan(db, { ...b, startsAtMin: b.startsAtMin ?? null }, clock());
    return c.json(getStatus(db, clock()));
  });
  app.delete("/fasting/plan", (c) => { endPlan(db, clock()); return c.json(getStatus(db, clock())); });
  app.post("/fasting/start", async (c) => {
    const b = await body(c, schemas.fastingStart);
    return c.json(startFast(db, b.startedAt ?? clock(), clock()));
  });
  app.post("/fasting/end", async (c) => {
    const b = await body(c, schemas.fastingEnd);
    return c.json(endFast(db, { endedAt: b.endedAt ?? clock(), startedAt: b.startedAt }, clock()));
  });
  app.get("/fasting/history", (c) => {
    const now = clock();
    const from = c.req.query("from") ? param(epochMs, Number(c.req.query("from")), "from") : now - 35 * 86_400_000;
    const to = c.req.query("to") ? param(epochMs, Number(c.req.query("to")), "to") : now;
    return c.json(history(db, from, to, now));
  });
  app.patch("/fasting/logs/:id", async (c) => c.json(updateFast(db, c.req.param("id"), await body(c, schemas.fastingPatch), clock())));
  app.delete("/fasting/logs/:id", (c) => { deleteFast(db, c.req.param("id")); return c.body(null, 204); });
  app.get("/fasting/plan.ics", (c) => {
    const plan = activePlan(db);
    if (!plan) throw new NotFoundError("No active fasting plan");
    return c.body(planIcs(plan), 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="fasting-schedule.ics"',
    });
  });

  return app;
}
