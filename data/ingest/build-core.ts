/**
 * Write food records into the app database. Host-neutral: used by `npm run data:build` (Node)
 * and by the browser's first-run setup. Needs the seed loader registered (lib/seeds.ts).
 */
import type { Db } from "../../apps/server/src/db/types.ts";
import { transaction } from "../../apps/server/src/db/types.ts";
import { writeFoods, type FoodRecord } from "../../apps/server/src/foods/write.ts";
import { seedRows } from "./lib/seeds.ts";

export { writeFoods };

export function writeGenericUnits(db: Db) {
  db.exec("DELETE FROM food_measures WHERE food_id IS NULL");
  const ins = db.prepare(`INSERT INTO food_measures (id, food_id, name, weight_g, volume_ml, rank, is_estimated, source)
                          VALUES (?, NULL, ?, ?, ?, ?, ?, 'seed')`);
  for (const u of seedRows("generic_units")) {
    ins.run(u.id!, u.name!, u.weight_g ? Number(u.weight_g) : null, u.volume_ml ? Number(u.volume_ml) : null,
      Number(u.rank), Number(u.is_estimated));
  }
}

export function writeSynonyms(db: Db) {
  const map: Record<string, string[]> = {};
  for (const r of seedRows("synonyms")) {
    (map[r.term!.toLowerCase()] ??= []).push(...r.expands_to!.toLowerCase().split(/\s+/).filter(Boolean));
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('search_synonyms', ?)").run(JSON.stringify(map));
}

export type DatasetRecords = { indb: FoodRecord[]; ifct: FoodRecord[]; off: FoodRecord[] };

/**
 * Replace every dataset food (ifct / indb / off) in one transaction. Custom foods, diary logs,
 * fasting and snap data are untouched; logs keep working because food ids are stable.
 */
export function replaceDatasetFoods(db: Db, data: DatasetRecords, datasets: unknown = {}) {
  transaction(db, () => {
    db.exec("DELETE FROM foods WHERE source IN ('ifct','indb','off')");
    writeGenericUnits(db);
    writeFoods(db, [...data.indb, ...data.ifct, ...data.off]);
    writeSynonyms(db);
    const meta = {
      food_db_version: new Date().toISOString(),
      food_counts: JSON.stringify({ indb: data.indb.length, ifct: data.ifct.length, off: data.off.length }),
      datasets: JSON.stringify(datasets),
    };
    const up = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(meta)) up.run(k, v);
  });
  db.exec("INSERT INTO food_names_fts(food_names_fts) VALUES ('optimize')");
  db.exec("INSERT INTO food_names_tri(food_names_tri) VALUES ('optimize')");
  return { indb: data.indb.length, ifct: data.ifct.length, off: data.off.length };
}
