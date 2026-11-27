/**
 * The small slice of a synchronous SQLite API the app uses, so the same repositories run on
 * Node's built-in `node:sqlite` (server, tests) and on SQLite WebAssembly in a browser worker.
 */
export type SqlValue = null | number | bigint | string | Uint8Array;

export interface Statement {
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): unknown;
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

/** Run `fn` inside a transaction; rolls back on throw. */
export function transaction<T>(db: Db, fn: () => T): T {
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

/** Random id that works in Node 19+ and every browser. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export type Migration = { name: string; sql: string };

/** Apply migrations not yet recorded in schema_migrations, in name order. */
export function applyMigrations(db: Db, migrations: Migration[]): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  const done = new Set((db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name));
  const applied: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations(name) VALUES (?)").run(m.name);
    });
    applied.push(m.name);
  }
  return applied;
}
