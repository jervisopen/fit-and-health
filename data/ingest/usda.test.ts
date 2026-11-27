import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import "./lib/seeds-node.ts";
import { openDatabase } from "../../apps/server/src/db/index.ts";
import { applyMigrations } from "../../apps/server/src/db/types.ts";
import { migrate, nodeMigrations } from "../../apps/server/src/db/migrate.ts";
import { searchFoods } from "../../apps/server/src/foods/search.ts";
import { getFoodDetail } from "../../apps/server/src/foods/repo.ts";
import { ensureStaples, replaceUsdaFoods, writeGenericUnits, writeSynonyms } from "./build-core.ts";
import { staplesSeed } from "./lib/seeds.ts";
import type { UsdaBulkFile } from "./sources/usda.ts";

function freshDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  writeGenericUnits(db);
  writeSynonyms(db);
  return db;
}

test("migration 008 rebuilds foods without losing names, measures or logs", () => {
  const db = openDatabase(":memory:");
  const all = nodeMigrations();
  applyMigrations(db, all.filter((m) => m.name < "008"));
  db.prepare(`INSERT INTO foods (id, source, source_ref, name, rank, default_measure_id, energy_kcal) VALUES ('indb:X', 'indb', 'X', 'Poha', 3, 'indb:X:m', 180)`).run();
  db.prepare(`INSERT INTO food_names (food_id, name, lang, is_primary) VALUES ('indb:X', 'Poha', 'en', 1)`).run();
  db.prepare(`INSERT INTO food_measures (id, food_id, name, weight_g, rank, source) VALUES ('indb:X:m', 'indb:X', 'bowl', 150, 1, 'indb')`).run();
  applyMigrations(db, all);
  assert.equal((db.prepare("SELECT count(*) n FROM food_names WHERE food_id = 'indb:X'").get() as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT count(*) n FROM food_measures WHERE food_id = 'indb:X'").get() as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT energy_kcal FROM foods WHERE id = 'indb:X'").get() as { energy_kcal: number }).energy_kcal, 180);
  assert.equal(Number((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys), 1, "foreign keys back on");
  db.prepare(`INSERT INTO foods (id, source, source_ref, name, rank, default_measure_id) VALUES ('usda:1', 'usda', '1', 'Test', 1, 'gen:g')`).run();
  // Cascades still work after the rebuild.
  db.prepare("DELETE FROM foods WHERE id = 'indb:X'").run();
  assert.equal((db.prepare("SELECT count(*) n FROM food_names WHERE food_id = 'indb:X'").get() as { n: number }).n, 0);
});

test("staples: added once, Indian names and measures, real USDA values", () => {
  const db = freshDb();
  assert.equal(ensureStaples(db), true);
  assert.equal(ensureStaples(db), false, "idempotent");
  const n = (db.prepare("SELECT count(*) n FROM foods WHERE source = 'usda'").get() as { n: number }).n;
  assert.equal(n, staplesSeed().foods.length);
  const rice = getFoodDetail(db, "usda:168878");
  assert.equal(rice.name, "Plain rice, cooked (chawal)");
  assert.equal(rice.per100g.energy_kcal, 130);
  assert.ok(rice.measures.some((m) => m.name === "katori" && m.weightG === 150));
});

test("search: everyday words find the staple first", () => {
  const db = freshDb();
  ensureStaples(db);
  const top = (q: string) => searchFoods(db, q)[0]?.name;
  assert.equal(top("cooked rice"), "Plain rice, cooked (chawal)");
  assert.equal(top("rice"), "Plain rice, cooked (chawal)");
  assert.equal(top("chawal"), "Plain rice, cooked (chawal)");
  assert.equal(top("boiled egg"), "Boiled egg (anda)");
  assert.equal(top("dahi"), "Curd / dahi (whole milk)");
  assert.equal(top("milk"), "Milk, whole (3.25% fat, like toned milk)");
});

test("USDA bulk: real file loads, skips the staples, and replacing it keeps them", () => {
  const db = freshDb();
  ensureStaples(db);
  const file = JSON.parse(gunzipSync(readFileSync(path.resolve(import.meta.dirname, "..", "..", "apps", "web", "public", "data", "usda-sr-legacy.json.gz"))).toString("utf8")) as UsdaBulkFile;
  assert.ok(file.foods.length > 7000);
  const added = replaceUsdaFoods(db, file);
  assert.ok(added > 7000);
  assert.equal(getFoodDetail(db, "usda:168878").name, "Plain rice, cooked (chawal)", "staple kept, not overwritten");
  const quinoa = searchFoods(db, "quinoa cooked")[0]!;
  assert.match(quinoa.name, /Quinoa, cooked/);
  assert.equal(quinoa.source, "usda");
  // A second import replaces, not duplicates.
  replaceUsdaFoods(db, file);
  const total = (db.prepare("SELECT count(*) n FROM foods WHERE source = 'usda'").get() as { n: number }).n;
  assert.equal(total, added + staplesSeed().foods.length);
});

test("search: everyday USDA foods beat processed ones on ties", () => {
  const db = freshDb();
  ensureStaples(db);
  const file = JSON.parse(gunzipSync(readFileSync(path.resolve(import.meta.dirname, "..", "..", "apps", "web", "public", "data", "usda-sr-legacy.json.gz"))).toString("utf8")) as UsdaBulkFile;
  replaceUsdaFoods(db, file);
  const top5 = searchFoods(db, "cooked rice").slice(0, 5).map((r) => r.name);
  assert.ok(!top5.some((n) => /sausage/i.test(n)), top5.join(" / "));
});
