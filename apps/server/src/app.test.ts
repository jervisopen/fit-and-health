import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { createApp } from "./app.ts";
import { writeFoods, type FoodRecord } from "./foods/write.ts";
import { writeGenericUnits, writeSynonyms } from "../../../data/ingest/build-db.ts";
import type { DiaryDayDTO, FoodDetailDTO, FoodLogDTO, SettingsDTO, RecentFoodDTO } from "../../../packages/shared/src/api.ts";

const rel = { breakfast: 0.5, lunch: 0.5, snack: 0.5, dinner: 0.5 };
const FOODS: FoodRecord[] = [
  {
    id: "indb:ROTI", source: "indb", sourceRef: "ROTI", name: "Chapati/Roti", rank: 3, relevance: rel,
    nutrients: { energy_kcal: 202.8, protein_g: 7.8, carbs_g: 39, fat_g: 1.2, fibre_g: 5 },
    names: [{ name: "Chapati/Roti", lang: "en", isPrimary: true }, { name: "Roti", lang: "en", isPrimary: false }],
    measures: [{ id: "indb:ROTI:serving", name: "chapati", weightG: 36, rank: 1, isEstimated: false, source: "indb" }],
    defaultMeasureId: "indb:ROTI:serving",
  },
  {
    id: "indb:DAL", source: "indb", sourceRef: "DAL", name: "Dal makhani", rank: 3, relevance: rel, densityGPerMl: 1,
    nutrients: { energy_kcal: 74, protein_g: 3.5, carbs_g: 8, fat_g: 3, fibre_g: 2.5 },
    names: [{ name: "Dal makhani", lang: "en", isPrimary: true }],
    measures: [{ id: "indb:DAL:serving", name: "bowl", weightG: 353.4, rank: 1, isEstimated: false, source: "indb" }],
    defaultMeasureId: "indb:DAL:serving",
  },
  {
    id: "ifct:EGG", source: "ifct", sourceRef: "EGG", name: "Egg, poultry, whole, boiled", rank: 2, relevance: rel,
    nutrients: { energy_kcal: 147, protein_g: 12.5 },
    names: [{ name: "Egg, poultry, whole, boiled", lang: "en", isPrimary: true }], measures: [], defaultMeasureId: "gen:g",
  },
];

const OFF_PRODUCT = {
  product_name: "Glucose biscuits", brands: "Acme", serving_quantity: 25, quantity: "200 g",
  nutriments: { "energy-kcal_100g": 450, proteins_100g: 7, carbohydrates_100g: 77, fat_100g: 12 },
};

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  writeGenericUnits(db);
  writeSynonyms(db);
  writeFoods(db, FOODS);
  let offCalls = 0;
  const app = createApp({
    db,
    offFetcher: async (code) => { offCalls++; return code === "8901234567890" ? { ...OFF_PRODUCT } : null; },
  });
  const call = async <T = unknown>(method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method, headers: json ? { "content-type": "application/json" } : undefined, body: json ? JSON.stringify(json) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  return { db, call, offCalls: () => offCalls };
}

test("health reports the food count", async () => {
  const { call } = setup();
  const r = await call<{ ok: boolean; foods: number }>("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.foods, 3);
});

test("food detail lists own units, grams, and volume units only with a density", async () => {
  const { call } = setup();
  const roti = (await call<FoodDetailDTO>("GET", "/foods/indb:ROTI")).body;
  assert.deepEqual(roti.measures.map((m) => m.name), ["chapati", "g"]);
  assert.equal(roti.kcalPerDefault, 73);

  const dal = (await call<FoodDetailDTO>("GET", "/foods/indb:DAL")).body;
  const names = dal.measures.map((m) => m.name);
  assert.equal(names[0], "bowl"); // the food's own bowl…
  assert.equal(names.filter((n) => n === "bowl").length, 1); // …hides the generic bowl
  assert.equal(dal.measures.find((m) => m.name === "katori")?.weightG, 150);

  const egg = (await call<FoodDetailDTO>("GET", "/foods/ifct:EGG")).body;
  assert.equal(egg.defaultQuantity, 100);
  assert.equal((await call("GET", "/foods/nope")).status, 404);
});

test("logging snapshots nutrients and fills the diary day", async () => {
  const { call } = setup();
  const created = await call<FoodLogDTO>("POST", "/logs", { date: "2026-11-26", mealType: "L", foodId: "indb:ROTI", measureId: "indb:ROTI:serving", quantity: 2 });
  assert.equal(created.status, 201);
  assert.equal(created.body.weightG, 72);
  assert.equal(created.body.nutrients.energy_kcal, 146);
  await call("POST", "/logs", { date: "2026-11-26", mealType: "L", foodId: "indb:DAL", measureId: "gen:katori", quantity: 1 });

  const day = (await call<DiaryDayDTO>("GET", "/diary/2026-11-26")).body;
  assert.equal(day.goalsAreDefault, true);
  const lunch = day.meals.find((m) => m.code === "L")!;
  assert.equal(lunch.logs.length, 2);
  assert.equal(lunch.budgetKcal, 600); // 30 % of the default 2,000 kcal
  assert.equal(day.totals.energy_kcal, 257); // 146 + 111
  assert.deepEqual(day.meals.map((m) => m.code), ["B", "SM", "L", "S", "D"]);

  const summary = (await call<{ date: string; kcal: number }[]>("GET", "/diary/summary?from=2026-11-20&to=2026-11-30")).body;
  assert.deepEqual(summary, [{ date: "2026-11-26", kcal: 257, logs: 2 }]);
});

test("editing a log recomputes from the food; unit, meal and date can change", async () => {
  const { call } = setup();
  const { body: log } = await call<FoodLogDTO>("POST", "/logs", { date: "2026-11-26", mealType: "B", foodId: "indb:ROTI", measureId: "indb:ROTI:serving", quantity: 1 });
  let r = await call<FoodLogDTO>("PATCH", `/logs/${log.id}`, { quantity: 3 });
  assert.equal(r.body.nutrients.energy_kcal, 219);
  r = await call<FoodLogDTO>("PATCH", `/logs/${log.id}`, { measureId: "gen:g", quantity: 50, mealType: "D", date: "2026-11-27" });
  assert.equal(r.body.weightG, 50);
  assert.equal(r.body.measureName, "g");
  assert.equal(r.body.mealType, "D");
  assert.equal(r.body.date, "2026-11-27");
  assert.equal(r.body.nutrients.energy_kcal, 101.4);

  assert.equal((await call("DELETE", `/logs/${log.id}`)).status, 204);
  assert.equal((await call("GET", `/logs/${log.id}`)).status, 404);
  const day = (await call<DiaryDayDTO>("GET", "/diary/2026-11-27")).body;
  assert.equal(day.totals.energy_kcal, undefined);
});

test("logs survive their food being removed; only quantity can change then", async () => {
  const { db, call } = setup();
  const { body: log } = await call<FoodLogDTO>("POST", "/logs", { date: "2026-11-26", mealType: "B", foodId: "ifct:EGG", measureId: "gen:g", quantity: 100 });
  db.prepare("DELETE FROM foods WHERE id = 'ifct:EGG'").run(); // e.g. a dataset rebuild dropped it
  const r = await call<FoodLogDTO>("PATCH", `/logs/${log.id}`, { quantity: 50 });
  assert.equal(r.body.nutrients.energy_kcal, 73.5);
  assert.equal(r.body.weightG, 50);
  assert.equal((await call("PATCH", `/logs/${log.id}`, { measureId: "gen:katori" })).status, 400);
});

test("validation errors are 400 with a message", async () => {
  const { call } = setup();
  const bad = async (json: unknown) => (await call<{ error: string }>("POST", "/logs", json));
  let r = await bad({ date: "26-11-2026", mealType: "L", foodId: "indb:ROTI", measureId: "indb:ROTI:serving", quantity: 1 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /date/);
  r = await bad({ date: "2026-11-26", mealType: "X", foodId: "indb:ROTI", measureId: "indb:ROTI:serving", quantity: 1 });
  assert.equal(r.status, 400);
  r = await bad({ date: "2026-11-26", mealType: "L", foodId: "indb:ROTI", measureId: "gen:katori", quantity: 1 });
  assert.equal(r.status, 400); // roti has no density, so no katori
  r = await bad({ date: "2026-11-26", mealType: "L", foodId: "indb:ROTI", measureId: "gen:g", quantity: -1 });
  assert.equal(r.status, 400);
  assert.equal((await bad({ date: "2026-11-26", mealType: "L", foodId: "nope", measureId: "gen:g", quantity: 1 })).status, 404);
  assert.equal((await call("GET", "/diary/2026-13-45")).status, 400);
});

test("goals and meal settings apply from their effective date onward", async () => {
  const { call } = setup();
  const r = await call<SettingsDTO>("PUT", "/settings/goals", { calories: 1800, protein_g: 110, carbs_g: 200, fat_g: 60, fibre_g: 25, effectiveFrom: "2026-11-25" });
  assert.equal(r.status, 200);
  assert.equal((await call<DiaryDayDTO>("GET", "/diary/2026-11-24")).body.goalsAreDefault, true);
  const day = (await call<DiaryDayDTO>("GET", "/diary/2026-11-30")).body;
  assert.equal(day.goals.calories, 1800);

  const meals = (await call<SettingsDTO>("GET", "/settings?date=2026-11-30")).body.meals;
  const noSnacks = meals.map((m) => (m.code === "SM" || m.code === "S" ? { ...m, enabled: false } : { ...m, caloriesPct: m.code === "L" ? 40 : 30 }));
  assert.equal((await call("PUT", "/settings/meals", { effectiveFrom: "2026-11-30", meals: noSnacks })).status, 200);
  const after = (await call<DiaryDayDTO>("GET", "/diary/2026-11-30")).body;
  assert.deepEqual(after.meals.map((m) => [m.code, m.budgetKcal]), [["B", 540], ["L", 720], ["D", 540]]);

  const wrongTotal = meals.map((m) => ({ ...m, caloriesPct: 10 }));
  const bad = await call<{ error: string }>("PUT", "/settings/meals", { effectiveFrom: "2026-11-30", meals: wrongTotal });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /100%/);
});

test("profile is stored", async () => {
  const { call } = setup();
  const profile = { sex: "female", age: 30, heightCm: 160, weightKg: 62, activity: "light", goal: "lose" };
  const r = await call<SettingsDTO>("PUT", "/settings/profile", profile);
  assert.deepEqual(r.body.profile, profile);
  assert.equal((await call("PUT", "/settings/profile", { ...profile, age: 5 })).status, 400);
});

test("custom foods: per-serving entry, searchable, loggable, deletable", async () => {
  const { call } = setup();
  const created = await call<FoodDetailDTO>("POST", "/foods/custom", {
    name: "Mom's poha", servingName: "plate", servingWeightG: 200, isVeg: true,
    perServing: { energy_kcal: 300, protein_g: 6, carbs_g: 50, fat_g: 8, fibre_g: 3 },
  });
  assert.equal(created.status, 201);
  const food = created.body;
  assert.match(food.id, /^custom:/);
  assert.equal(food.per100g.energy_kcal, 150);
  assert.equal(food.measures[0]?.name, "plate");
  assert.equal(food.kcalPerDefault, 300);

  const hits = (await call<{ id: string }[]>("GET", "/foods/search?q=poha")).body;
  assert.equal(hits[0]?.id, food.id);
  const log = await call<FoodLogDTO>("POST", "/logs", { date: "2026-11-26", mealType: "B", foodId: food.id, measureId: food.measures[0]!.id, quantity: 1.5 });
  assert.equal(log.body.nutrients.energy_kcal, 450);

  const edited = await call<FoodDetailDTO>("PUT", `/foods/custom/${food.id}`, {
    name: "Mom's poha", servingName: "plate", servingWeightG: 250, perServing: { energy_kcal: 300 },
  });
  assert.equal(edited.body.per100g.energy_kcal, 120);
  assert.equal((await call<unknown[]>("GET", "/foods/custom")).body.length, 1);

  assert.equal((await call("DELETE", `/foods/custom/${food.id}`)).status, 204);
  assert.deepEqual((await call<unknown[]>("GET", "/foods/search?q=poha")).body, []);
  assert.equal((await call("DELETE", "/foods/custom/indb:ROTI")).status, 404); // dataset foods are not editable
  // The earlier log keeps its snapshot.
  assert.equal((await call<FoodLogDTO>("GET", `/logs/${log.body.id}`)).body.nutrients.energy_kcal, 450);
});

test("barcode lookup: Open Food Facts once, then local", async () => {
  const { call, offCalls } = setup();
  const r = await call<FoodDetailDTO>("GET", "/foods/barcode/8901234567890");
  assert.equal(r.status, 200);
  assert.equal(r.body.id, "off:8901234567890");
  assert.equal(r.body.barcode, "8901234567890");
  assert.deepEqual(r.body.measures.slice(0, 2).map((m) => [m.name, m.weightG]), [["serving", 25], ["pack", 200]]);
  await call("GET", "/foods/barcode/8901234567890");
  assert.equal(offCalls(), 1);
  assert.equal((await call("GET", "/foods/barcode/1111111111")).status, 404);
  assert.equal((await call("GET", "/foods/barcode/abc")).status, 400);
});

test("recent foods prefer the same meal and remember the last portion", async () => {
  const { call } = setup();
  await call("POST", "/logs", { date: "2026-11-25", mealType: "D", foodId: "indb:DAL", measureId: "indb:DAL:serving", quantity: 1 });
  await call("POST", "/logs", { date: "2026-11-26", mealType: "B", foodId: "indb:ROTI", measureId: "indb:ROTI:serving", quantity: 2 });
  const recent = (await call<RecentFoodDTO[]>("GET", "/foods/recent?meal=D")).body;
  assert.deepEqual(recent.map((r) => r.id), ["indb:DAL", "indb:ROTI"]);
  assert.equal(recent[1]?.lastQuantity, 2);
});

test("copy a meal to another day", async () => {
  const { call } = setup();
  await call("POST", "/logs", { date: "2026-11-25", mealType: "B", foodId: "indb:ROTI", measureId: "indb:ROTI:serving", quantity: 2 });
  await call("POST", "/logs", { date: "2026-11-25", mealType: "B", foodId: "indb:DAL", measureId: "gen:katori", quantity: 1 });
  const r = await call<FoodLogDTO[]>("POST", "/logs/copy-meal", { from: { date: "2026-11-25", mealType: "B" }, to: { date: "2026-11-26", mealType: "L" } });
  assert.equal(r.status, 201);
  assert.equal(r.body.length, 2);
  const day = (await call<DiaryDayDTO>("GET", "/diary/2026-11-26")).body;
  assert.equal(day.meals.find((m) => m.code === "L")!.logs.length, 2);
});
