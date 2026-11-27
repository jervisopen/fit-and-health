/**
 * Adapts SQLite WebAssembly (oo1 API) to the app's `Db` interface, the same shape as Node's
 * `node:sqlite`, so the server's repositories run unchanged in the browser.
 */
import type { Db, SqlValue, Statement } from "../../../server/src/db/types.ts";

type OoStmt = {
  bind(values: unknown[]): OoStmt;
  step(): boolean;
  get(target: Record<string, unknown>): Record<string, unknown>;
  reset(clearBindings?: boolean): OoStmt;
  finalize(): void;
};
type OoDb = {
  prepare(sql: string): OoStmt;
  exec(sql: string): unknown;
  changes(): number;
  close(): void;
};

export class WasmDb implements Db {
  private db: OoDb;
  private cache = new Map<string, OoStmt>();

  constructor(db: OoDb) {
    this.db = db;
  }

  private stmt(sql: string): OoStmt {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private run<T>(sql: string, params: SqlValue[], body: (s: OoStmt) => T): T {
    const s = this.stmt(sql);
    try {
      if (params.length) s.bind(params);
      return body(s);
    } finally {
      s.reset(true);
    }
  }

  prepare(sql: string): Statement {
    return {
      get: (...p) => this.run(sql, p, (s) => (s.step() ? s.get({}) : undefined)),
      all: (...p) => this.run(sql, p, (s) => {
        const rows: Record<string, unknown>[] = [];
        while (s.step()) rows.push(s.get({}));
        return rows;
      }),
      run: (...p) => this.run(sql, p, (s) => {
        s.step();
        return { changes: this.db.changes() };
      }),
    };
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  close() {
    for (const s of this.cache.values()) s.finalize();
    this.cache.clear();
    this.db.close();
  }
}
