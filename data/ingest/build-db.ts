/**
 * Build (or rebuild) the food database inside the app database.
 *
 *   npm run data:build
 *
 * Replaces every dataset food (ifct / indb / off) in one transaction. Custom foods, diary logs,
 * fasting and snap data are untouched; logs keep working because food ids are stable.
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase, transaction, databaseFile } from "../../apps/server/src/db/index.ts";
import { migrate } from "../../apps/server/src/db/migrate.ts";
import { writeFoods } from "../../apps/server/src/foods/write.ts";
import { readCsvObjects } from "./lib/csv.ts";
import { loadIfct } from "./sources/ifct.ts";
import { loadIndb } from "./sources/indb.ts";
import { loadOff, OFF_CACHE, OFF_FILE } from "./sources/off.ts";

const SEEDS = path.resolve(import.meta.dirname, "..", "seeds");
const MANIFEST = path.resolve(import.meta.dirname, "..", "raw", "manifest.json");

export function writeGenericUnits(db: DatabaseSync) {
  db.exec("DELETE FROM food_measures WHERE food_id IS NULL");
  const ins = db.prepare(`INSERT INTO food_measures (id, food_id, name, weight_g, volume_ml, rank, is_estimated, source)
                          VALUES (?, NULL, ?, ?, ?, ?, ?, 'seed')`);
  for (const u of readCsvObjects(path.join(SEEDS, "generic_units.csv"))) {
    ins.run(u.id!, u.name!, u.weight_g ? Number(u.weight_g) : null, u.volume_ml ? Number(u.volume_ml) : null,
      Number(u.rank), Number(u.is_estimated));
  }
}

export { writeFoods };

export function writeSynonyms(db: DatabaseSync) {
  const map: Record<string, string[]> = {};
  for (const r of readCsvObjects(path.join(SEEDS, "synonyms.csv"))) {
    (map[r.term!.toLowerCase()] ??= []).push(...r.expands_to!.toLowerCase().split(/\s+/).filter(Boolean));
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('search_synonyms', ?)").run(JSON.stringify(map));
}

export async function buildFoodDb(db: DatabaseSync) {
  const t0 = Date.now();
  const indb = await loadIndb();
  const ifct = loadIfct();
  const off = loadOff();
  if (!existsSync(OFF_FILE)) {
    console.warn(existsSync(OFF_CACHE)
      ? "! Open Food Facts fetch incomplete, using the partial cache (resume with: npm run data:fetch -- off)"
      : "! Open Food Facts not fetched, skipping packaged foods (npm run data:fetch -- off)");
  }
  const all = [...indb, ...ifct, ...off];

  transaction(db, () => {
    db.exec("DELETE FROM foods WHERE source IN ('ifct','indb','off')");
    writeGenericUnits(db);
    writeFoods(db, all);
    writeSynonyms(db);
    const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
    const meta = {
      food_db_version: new Date().toISOString(),
      food_counts: JSON.stringify({ indb: indb.length, ifct: ifct.length, off: off.length }),
      datasets: JSON.stringify(manifest),
    };
    const up = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(meta)) up.run(k, v);
  });
  db.exec("INSERT INTO food_names_fts(food_names_fts) VALUES ('optimize')");
  db.exec("INSERT INTO food_names_tri(food_names_tri) VALUES ('optimize')");
  return { indb: indb.length, ifct: ifct.length, off: off.length, ms: Date.now() - t0 };
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
