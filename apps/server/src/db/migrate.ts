/** Node host: reads migrations/*.sql from disk. The browser bundles them with import.meta.glob. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, databaseFile } from "./index.ts";
import { applyMigrations, type Db, type Migration } from "./types.ts";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "migrations");

export function nodeMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));
}

export function migrate(db: Db): string[] {
  return applyMigrations(db, nodeMigrations());
}

if (import.meta.main) {
  const db = openDatabase();
  const applied = migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date.", `(${databaseFile()})`);
  db.close();
}
