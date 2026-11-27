import type { Db } from "../db/types.ts";

/** Where meal photos are kept. Keys look like "snaps/2026-11/<id>.jpg". */
export interface BlobStore {
  put(key: string, bytes: Uint8Array): void;
  get(key: string): Uint8Array;
  remove(key: string): void;
}

/** Photos stored in the database itself: one file to back up, no file-system access needed. */
export class DbBlobStore implements BlobStore {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  put(key: string, bytes: Uint8Array) {
    this.db.prepare("INSERT OR REPLACE INTO blobs (key, bytes) VALUES (?, ?)").run(key, bytes);
  }
  get(key: string): Uint8Array {
    const row = this.db.prepare("SELECT bytes FROM blobs WHERE key = ?").get(key) as { bytes: Uint8Array } | undefined;
    if (!row) throw new Error(`Missing blob ${key}`);
    return new Uint8Array(row.bytes);
  }
  remove(key: string) {
    this.db.prepare("DELETE FROM blobs WHERE key = ?").run(key);
  }
}
