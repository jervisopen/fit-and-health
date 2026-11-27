/**
 * Build (or rebuild) the food database inside the app database (Node host).
 *
 *   npm run data:build
 */
import "./lib/seeds-node.ts";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Db } from "../../apps/server/src/db/types.ts";
import { openDatabase, databaseFile } from "../../apps/server/src/db/index.ts";
import { migrate } from "../../apps/server/src/db/migrate.ts";
import { replaceDatasetFoods, writeFoods, writeGenericUnits, writeSynonyms } from "./build-core.ts";
import { loadIfct, loadIndb, loadOff, OFF_CACHE, OFF_FILE } from "./sources/node-loaders.ts";

export { writeFoods, writeGenericUnits, writeSynonyms };

const MANIFEST = path.resolve(import.meta.dirname, "..", "raw", "manifest.json");

export async function buildFoodDb(db: Db) {
  const t0 = Date.now();
  const indb = await loadIndb();
  const ifct = loadIfct();
  const off = loadOff();
  if (!existsSync(OFF_FILE)) {
    console.warn(existsSync(OFF_CACHE)
      ? "! Open Food Facts fetch incomplete, using the partial cache (resume with: npm run data:fetch -- off)"
      : "! Open Food Facts not fetched, skipping packaged foods (npm run data:fetch -- off)");
  }
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const counts = replaceDatasetFoods(db, { indb, ifct, off }, manifest);
  return { ...counts, ms: Date.now() - t0 };
}

if (import.meta.main) {
  const db = openDatabase();
  migrate(db);
  const r = await buildFoodDb(db);
  const names = (db.prepare("SELECT count(*) n FROM food_names").get() as { n: number }).n;
  const measures = (db.prepare("SELECT count(*) n FROM food_measures").get() as { n: number }).n;
  console.log(`Built food DB in ${r.ms} ms → ${databaseFile()}`);
  console.log(`  INDB recipes ${r.indb} · IFCT ingredients ${r.ifct} · OFF packaged ${r.off}`);
  console.log(`  ${names} searchable names · ${measures} serving units`);
  db.close();
}
