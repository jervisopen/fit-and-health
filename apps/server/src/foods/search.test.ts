import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { NUTRIENT_KEYS } from "../../../../packages/shared/src/nutrients.ts";
import { writeFoods, writeGenericUnits, writeSynonyms } from "../../../../data/ingest/build-db.ts";
import type { FoodRecord } from "../../../../data/ingest/lib/types.ts";
import { buildFtsQuery, normalizeQuery, searchFoods, trigramCoverage } from "./search.ts";

const rel = { breakfast: 0.3, lunch: 0.3, snack: 0.3, dinner: 0.3 };
function food(id: string, name: string, extra: Partial<FoodRecord> = {}): FoodRecord {
  return {
    id, source: "indb", sourceRef: id, name, rank: 3, relevance: rel,
    nutrients: { energy_kcal: 200 }, names: [{ name, lang: "en", isPrimary: true }],
    measures: [], defaultMeasureId: "gen:g", ...extra,
  };
}

function fixtureDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  writeGenericUnits(db);
  writeSynonyms(db);
  writeFoods(db, [
    food("indb:R1", "Chapati/Roti", {
      names: [{ name: "Chapati/Roti", lang: "en", isPrimary: true }, { name: "Chapati", lang: "en", isPrimary: false }, { name: "Roti", lang: "en", isPrimary: false }],
      measures: [{ id: "indb:R1:serving", name: "chapati", weightG: 36, rank: 1, isEstimated: false, source: "indb" }],
      defaultMeasureId: "indb:R1:serving", nutrients: { energy_kcal: 203 },
    }),
    food("indb:R2", "Soya roti"),
    food("indb:C1", "Curd rice (Dahi chawal)", { names: [{ name: "Curd rice (Dahi chawal)", lang: "en", isPrimary: true }, { name: "Dahi chawal", lang: "hi-Latn", isPrimary: false }] }),
    food("indb:P1", "Poha", { relevance: { breakfast: 1, lunch: 0.1, snack: 0.4, dinner: 0.1 } }),
    food("indb:P2", "Poha cutlet", { dataQuality: "suspect_frying_oil", relevance: { breakfast: 0.1, lunch: 0.1, snack: 1, dinner: 0.1 } }),
    food("ifct:E1", "Egg, poultry, whole, raw", { source: "ifct", rank: 2, names: [{ name: "Egg, poultry, whole, raw", lang: "en", isPrimary: true }, { name: "Anda", lang: "hi", isPrimary: false }] }),
    food("off:890", "Marie Gold", { source: "off", rank: 1.5, brand: "Britannia", barcode: "890" }),
  ]);
  return db;
}

test("schema has a column for every registered nutrient", () => {
  const db = openDatabase(":memory:");
  migrate(db);
  for (const table of ["foods", "food_logs"]) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const k of NUTRIENT_KEYS) assert.ok(cols.has(k), `${table}.${k} missing`);
  }
});

test("query helpers", () => {
  assert.equal(normalizeQuery("  Pão-de-Queijo!! "), "pao de queijo");
  assert.equal(buildFtsQuery(["dahi"], { dahi: ["curd"] }), '("dahi"* OR "curd"*)');
  assert.ok(trigramCoverage("chapathi", "Chapati") >= 0.5);
  assert.ok(trigramCoverage("chai", "Lemon rice") < 0.3);
});

test("whole-word alias beats partial match", () => {
  const db = fixtureDb();
  const r = searchFoods(db, "roti");
  assert.equal(r[0]?.id, "indb:R1");
  assert.equal(r[0]?.defaultMeasure?.name, "chapati");
  assert.equal(r[0]?.kcalPerDefault, 73);
});

test("Hindi synonyms and local names", () => {
  const db = fixtureDb();
  assert.equal(searchFoods(db, "anda")[0]?.id, "ifct:E1");
  assert.ok(searchFoods(db, "curd").some((x) => x.id === "indb:C1"));
  assert.ok(searchFoods(db, "dahi").some((x) => x.id === "indb:C1"));
});

test("fuzzy spelling fallback", () => {
  const db = fixtureDb();
  assert.equal(searchFoods(db, "chapathi")[0]?.id, "indb:R1");
});

test("meal-slot relevance and data-quality penalty", () => {
  const db = fixtureDb();
  const b = searchFoods(db, "poha", { mealType: "B" });
  assert.deepEqual(b.map((x) => x.id), ["indb:P1", "indb:P2"]);
  assert.equal(b[1]?.dataQuality, "suspect_frying_oil");
});

test("brand-only queries find packaged foods; grams default to 100 g", () => {
  const db = fixtureDb();
  const r = searchFoods(db, "marie");
  assert.equal(r[0]?.id, "off:890");
  assert.equal(r[0]?.defaultQuantity, 100);
  assert.equal(r[0]?.kcalPerDefault, 200);
});

test("empty and junk queries return nothing", () => {
  const db = fixtureDb();
  assert.deepEqual(searchFoods(db, "   "), []);
  assert.deepEqual(searchFoods(db, "zzzzqqq"), []);
  assert.deepEqual(searchFoods(db, "g"), []);
});

test("single-letter tokens are ignored instead of breaking FTS (\"parle g\")", () => {
  const db = fixtureDb();
  assert.equal(buildFtsQuery(["parle", "g"], {}), '("parle"*)');
  assert.equal(searchFoods(db, "marie g")[0]?.id, "off:890");
});
