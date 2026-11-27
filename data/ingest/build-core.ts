/**
 * Write food records into the app database. Host-neutral: used by `npm run data:build` (Node)
 * and by the browser's first-run setup. Needs the seed loader registered (lib/seeds.ts).
 */
import type { Db } from "../../apps/server/src/db/types.ts";
import { transaction } from "../../apps/server/src/db/types.ts";
import { writeFoods, type FoodRecord } from "../../apps/server/src/foods/write.ts";
import { seedRows, staplesSeed } from "./lib/seeds.ts";
import { staplesRecords, usdaBulkRecords, type UsdaBulkFile } from "./sources/usda.ts";

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

export type DatasetRecords = { indb: FoodRecord[]; ifct: FoodRecord[]; off: FoodRecord[]; usda?: FoodRecord[] };

const up = (db: Db, k: string, v: string) => db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(k, v);

/** (Re)write the everyday Indian staples (bundled with the app, so they work offline from day one). */
export function writeStaples(db: Db) {
  const recs = staplesRecords(staplesSeed());
  const del = db.prepare("DELETE FROM foods WHERE id = ?");
  for (const r of recs) del.run(r.id);
  writeFoods(db, recs);
  up(db, "staples_version", `${staplesSeed().version}:${recs.length}`);
  return recs.length;
}

/** Add the staples if this database doesn't have the current set yet (cheap; run at every start). */
export function ensureStaples(db: Db): boolean {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'staples_version'").get() as { value: string } | undefined;
  const want = `${staplesSeed().version}:${staplesSeed().foods.length}`;
  if (row?.value === want) return false;
  transaction(db, () => { writeStaples(db); });
  return true;
}

export function usdaFoodsFrom(file: UsdaBulkFile): FoodRecord[] {
  const staples = new Set(staplesSeed().foods.map((f) => `usda:${f.fdcId}`));
  return usdaBulkRecords(file, staples);
}

/** Replace only the USDA bulk foods (staples stay): used to add USDA foods to an existing database. */
export function replaceUsdaFoods(db: Db, file: UsdaBulkFile): number {
  const recs = usdaFoodsFrom(file);
  const staples = staplesSeed().foods.map((f) => `usda:${f.fdcId}`);
  transaction(db, () => {
    db.prepare(`DELETE FROM foods WHERE source = 'usda' AND id NOT IN (${staples.map(() => "?").join(",")})`).run(...staples);
    writeFoods(db, recs);
    up(db, "usda_version", file.version);
  });
  db.exec("INSERT INTO food_names_fts(food_names_fts) VALUES ('optimize')");
  db.exec("INSERT INTO food_names_tri(food_names_tri) VALUES ('optimize')");
  return recs.length;
}

/**
 * Replace every dataset food (ifct / indb / off) in one transaction. Custom foods, diary logs,
 * fasting and snap data are untouched; logs keep working because food ids are stable.
 */
export function replaceDatasetFoods(db: Db, data: DatasetRecords, datasets: unknown = {}) {
  transaction(db, () => {
    db.exec(`DELETE FROM foods WHERE source IN ('ifct','indb','off'${data.usda ? ",'usda'" : ""})`);
    writeGenericUnits(db);
    writeFoods(db, [...data.indb, ...data.ifct, ...data.off, ...(data.usda ?? [])]);
    writeStaples(db);
    writeSynonyms(db);
    const meta = {
      food_db_version: new Date().toISOString(),
      food_counts: JSON.stringify({ indb: data.indb.length, ifct: data.ifct.length, off: data.off.length, usda: data.usda?.length ?? 0 }),
      datasets: JSON.stringify(datasets),
    };
    for (const [k, v] of Object.entries(meta)) up(db, k, v);
    if (data.usda) up(db, "usda_version", "bundled");
  });
  db.exec("INSERT INTO food_names_fts(food_names_fts) VALUES ('optimize')");
  db.exec("INSERT INTO food_names_tri(food_names_tri) VALUES ('optimize')");
  return { indb: data.indb.length, ifct: data.ifct.length, off: data.off.length, usda: data.usda?.length ?? 0 };
}
