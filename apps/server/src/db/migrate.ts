import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, transaction, databaseFile } from "./index.ts";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "migrations");

/** Apply every migrations/NNN_*.sql not yet recorded in schema_migrations, in order. */
export function migrate(db: DatabaseSync): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  const done = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    transaction(db, () => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(name) VALUES (?)").run(f);
    });
    applied.push(f);
  }
  return applied;
}

if (import.meta.main) {
  const db = openDatabase();
  const applied = migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date.", `(${databaseFile()})`);
  db.close();
}
