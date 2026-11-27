/** Node host: opens the database with the built-in `node:sqlite`. Not used in the browser. */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Db } from "./types.ts";

export { transaction, newId, type Db } from "./types.ts";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

export function databaseFile(): string {
  const configured = process.env.DATABASE_FILE ?? "./var/app.db";
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

export function dataDir(): string {
  const configured = process.env.DATA_DIR ?? "./var";
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

/** Open the app database with the pragmas every connection needs. Pass ":memory:" in tests. */
export function openDatabase(file: string = databaseFile()): DatabaseSync & Db {
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
