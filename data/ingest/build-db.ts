/**
 * Build (or rebuild) the food database inside the app database (Node host).
 *
 *   npm run data:build
 */
import "./lib/seeds-node.ts";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Db } from "../../apps/server/src/db/types.ts";
import { openDatabase, databaseFile } from "../../apps/server/src/db/index.ts";
import { migrate } from "../../apps/server/src/db/migrate.ts";
import { replaceDatasetFoods, usdaFoodsFrom, writeFoods, writeGenericUnits, writeSynonyms } from "./build-core.ts";
import type { UsdaBulkFile } from "./sources/usda.ts";
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
  // USDA foods ship with the repo (public domain), made by data/ingest/usda/convert.py.
  const usdaFile = path.resolve(import.meta.dirname, "..", "..", "apps", "web", "public", "data", "usda-sr-legacy.json.gz");
  const usda = existsSync(usdaFile) ? usdaFoodsFrom(JSON.parse(gunzipSync(readFileSync(usdaFile)).toString("utf8")) as UsdaBulkFile) : undefined;
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const counts = replaceDatasetFoods(db, { indb, ifct, off, usda }, manifest);
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
