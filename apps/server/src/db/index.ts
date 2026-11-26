import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

export function databaseFile(): string {
  const configured = process.env.DATABASE_FILE ?? "./var/app.db";
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

/** Open the app database with the pragmas every connection needs. Pass ":memory:" in tests. */
export function openDatabase(file: string = databaseFile()): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

/** Run `fn` inside a transaction; rolls back on throw. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
