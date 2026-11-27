/**
 * Automatic backups: whole-database snapshots kept in IndexedDB, a different storage system from
 * the OPFS file the database lives in. If that file is ever lost or emptied (an app or browser
 * glitch), the diary can be brought back from here. Clearing the site's data in the browser, or
 * losing the phone, removes these too, which is why the app still suggests downloading backups.
 */
export type SnapshotReason = "daily" | "before-update" | "before-restore";
export type SnapshotMeta = { id: string; takenAt: number; reason: SnapshotReason; entries: number; size: number };
type SnapshotRecord = SnapshotMeta & { bytes: ArrayBuffer };

const DB_NAME = "fit-and-health-backups";
const STORE = "snapshots";
/** Newest ones kept; the largest older snapshot is kept as well (see prune). */
export const KEEP = 7;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openIdb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Backup storage transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const all = (await withStore<SnapshotRecord[]>("readonly", (s) => s.getAll())) ?? [];
  return all.map(({ bytes: _bytes, ...meta }) => meta).sort((a, b) => b.takenAt - a.takenAt);
}

export async function getSnapshot(id: string): Promise<SnapshotRecord | undefined> {
  return withStore<SnapshotRecord>("readonly", (s) => s.get(id));
}

export async function putSnapshot(bytes: Uint8Array, reason: SnapshotReason, entries: number, now = Date.now()): Promise<SnapshotMeta> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const rec: SnapshotRecord = { id: `${now}-${reason}`, takenAt: now, reason, entries, size: buf.byteLength, bytes: buf };
  await withStore("readwrite", (s) => { s.put(rec); });
  await prune();
  const { bytes: _b, ...meta } = rec;
  return meta;
}

/**
 * Keep the newest KEEP snapshots, plus the one with the most entries among the older ones when it
 * holds more than any kept snapshot, so a few days of a near-empty diary after a mishap can't
 * push the last good copy out.
 */
export function chooseToDelete(all: SnapshotMeta[], keep = KEEP): string[] {
  const sorted = [...all].sort((a, b) => b.takenAt - a.takenAt);
  const kept = sorted.slice(0, keep);
  const older = sorted.slice(keep);
  if (!older.length) return [];
  const best = older.reduce((m, s) => (s.entries > m.entries ? s : m));
  const keepBest = best.entries > Math.max(0, ...kept.map((s) => s.entries));
  return older.filter((s) => !(keepBest && s.id === best.id)).map((s) => s.id);
}

async function prune() {
  const ids = chooseToDelete(await listSnapshots());
  if (ids.length) await withStore("readwrite", (s) => { for (const id of ids) s.delete(id); });
}

export async function deleteAllSnapshots() {
  await withStore("readwrite", (s) => { s.clear(); });
}
