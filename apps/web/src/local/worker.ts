/**
 * Local-first host: the whole API (the same Hono app the Node server runs) inside a Web Worker,
 * on SQLite WebAssembly stored in the browser's private file system (OPFS). Nothing leaves the
 * device except: the one-time food dataset download, barcode lookups (Open Food Facts) and Snap
 * photos sent to the vision provider the user configured with their own key.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import readXlsxFile from "read-excel-file/web-worker";
import { applyMigrations } from "../../../server/src/db/types.ts";
import { createApp } from "../../../server/src/app.ts";
import { setSeedLoader, type SeedName } from "../../../../data/ingest/lib/seeds.ts";
import { replaceDatasetFoods } from "../../../../data/ingest/build-core.ts";
import { IFCT_URL, ifctRecords } from "../../../../data/ingest/sources/ifct.ts";
import { INDB_URL, indbRecords } from "../../../../data/ingest/sources/indb.ts";
import genericUnits from "../../../../data/seeds/generic_units.csv?raw";
import densities from "../../../../data/seeds/densities.csv?raw";
import pieceWeights from "../../../../data/seeds/piece_weights.csv?raw";
import synonyms from "../../../../data/seeds/synonyms.csv?raw";
import { WasmDb } from "./sqlite-db.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

const SEEDS: Record<SeedName, string> = { generic_units: genericUnits, densities, piece_weights: pieceWeights, synonyms };
setSeedLoader((name) => SEEDS[name]);

const migrations = Object.entries(
  import.meta.glob("../../../server/src/db/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
).map(([file, sql]) => ({ name: file.split("/").pop()!, sql }));

const post = (msg: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Pool = Awaited<ReturnType<Sqlite3["installOpfsSAHPoolVfs"]>>;
type Host = { db: WasmDb; raw: { pointer?: unknown }; app: ReturnType<typeof createApp>; persistent: boolean };

const DB_FILE = "/fit-and-health.db";
let sqlite3: Sqlite3;
let pool: Pool | null = null;

/** An in-memory database holding a copy of `bytes` (a whole SQLite file). */
function memoryDbFrom(bytes: Uint8Array) {
  const db = new sqlite3.oo1.DB(":memory:");
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const { capi } = sqlite3;
  const rc = capi.sqlite3_deserialize(db.pointer!, "main", p, bytes.byteLength, bytes.byteLength,
    capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
  db.checkRc(rc);
  return db;
}

function host(raw: InstanceType<Sqlite3["oo1"]["DB"]>, persistent: boolean): Host {
  const db = new WasmDb(raw as never);
  db.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(db, migrations);
  return { db, raw, app: createApp({ db, browser: true, mode: "local" }), persistent };
}

const opfsSupported = () =>
  typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function" &&
  typeof FileSystemFileHandle !== "undefined" && "createSyncAccessHandle" in FileSystemFileHandle.prototype;

/**
 * Only one copy of the app may have the database open (OPFS sync handles are exclusive). Hold a
 * Web Lock for this worker's whole life: on a reload the new page waits until the old page's
 * worker is gone instead of failing; with a second tab or the installed app open, it waits until
 * that one closes.
 */
function holdDatabaseLock(): Promise<void> {
  if (!navigator.locks) return Promise.resolve();
  return new Promise((acquired, failed) => {
    const waiting = setTimeout(() => post({ kind: "status", id: 0, status: "waiting" }), 1500);
    navigator.locks.request("fit-and-health-db", { mode: "exclusive" }, () => {
      clearTimeout(waiting);
      post({ kind: "status", id: 0, status: "open" });
      acquired();
      return new Promise<never>(() => {}); // released when this worker ends
    }).catch(failed);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openPool(): Promise<Pool> {
  let last: unknown;
  // Handles from a page that just closed can take a moment to be released.
  for (const delay of [0, 250, 750, 1500, 3000]) {
    if (delay) await sleep(delay);
    try {
      return await sqlite3.installOpfsSAHPoolVfs({
        name: "fit-and-health",
        initialCapacity: 6,
        // The default deletes the whole pool when it can't open it. Never do that: it's the user's only copy.
        preserveOnInitFailure: true,
        ...({ forceReinitIfPreviouslyFailed: true } as object),
      });
    } catch (e) {
      last = e;
      console.warn("Opening the saved database failed, retrying", e);
    }
  }
  throw new Error(`Couldn't open your saved data (${(last as Error)?.message ?? last}). Close other fit&health tabs or windows and try again.`);
}

async function start(): Promise<Host> {
  sqlite3 = await sqlite3InitModule();
  if (!opfsSupported()) {
    // Very old browser: still usable, but nothing survives a reload (the app warns about this).
    console.warn("OPFS unavailable, using a temporary in-memory database");
    pool = null;
    return host(new sqlite3.oo1.DB(":memory:"), false);
  }
  await holdDatabaseLock();
  pool = await openPool();
  return host(new pool.OpfsSAHPoolDb(DB_FILE), true);
}

let ready = start();

/** The whole database as a SQLite file, minus the saved vision API key. */
function backup(h: Host): Uint8Array {
  const bytes = sqlite3.capi.sqlite3_js_db_export(h.raw.pointer as never);
  const copy = memoryDbFrom(bytes);
  try {
    // VACUUM rewrites the file so the deleted key isn't left behind in a free page.
    copy.exec("DELETE FROM meta WHERE key = 'vision_config'; VACUUM;");
    return sqlite3.capi.sqlite3_js_db_export(copy.pointer!);
  } finally {
    copy.close();
  }
}

/** Replace this device's data with a backup (from this app or a fit&health server's data/app.db). */
async function restore(h: Host, bytes: Uint8Array): Promise<{ host: Host; error?: Error }> {
  const header = new TextDecoder().decode(bytes.subarray(0, 15));
  if (header !== "SQLite format 3") throw new Error("That file isn't a fit&health backup.");
  const probe = memoryDbFrom(bytes.slice());
  try {
    const ok = probe.selectValue("SELECT count(*) FROM sqlite_master WHERE name IN ('food_logs', 'foods')");
    if (ok !== 2) throw new Error("That file isn't a fit&health backup.");
  } finally {
    probe.close();
  }
  const previous = sqlite3.capi.sqlite3_js_db_export(h.raw.pointer as never);
  h.db.close();
  const load = async (b: Uint8Array) => {
    if (!pool) return host(memoryDbFrom(b), false);
    await pool.importDb(DB_FILE, b);
    return host(new pool.OpfsSAHPoolDb(DB_FILE), true);
  };
  try {
    return { host: await load(bytes) };
  } catch (e) {
    return { host: await load(previous), error: e as Error }; // put the old data back
  }
}

async function setupFoods(id: number, host: Host) {
  const progress = (stage: string, pct: number) => post({ kind: "progress", id, stage, pct });
  progress("Downloading ingredient data (IFCT 2017)…", 5);
  const ifctRes = await fetch(IFCT_URL);
  if (!ifctRes.ok) throw new Error(`Couldn't download IFCT 2017 (HTTP ${ifctRes.status})`);
  const ifctText = await ifctRes.text();
  progress("Downloading Indian recipes (INDB)…", 35);
  const indbRes = await fetch(INDB_URL);
  if (!indbRes.ok) throw new Error(`Couldn't download INDB (HTTP ${indbRes.status})`);
  const indbBytes = await indbRes.arrayBuffer();
  progress("Reading recipes…", 65);
  const indb = indbRecords(await readXlsxFile(indbBytes));
  const ifct = ifctRecords(ifctText);
  progress("Building your food database…", 80);
  const fetchedAt = new Date().toISOString();
  const counts = replaceDatasetFoods(host.db, { indb, ifct, off: [] }, {
    indb: { url: INDB_URL, fetchedAt, licence: "INDB (Vijayakumar et al. 2024), open access" },
    ifct: { url: IFCT_URL, fetchedAt, licence: "IFCT 2017 © ICMR-NIN; packaging by nodef/ifct2017 (AGPL-3.0)" },
  });
  progress("Done", 100);
  return counts;
}

self.addEventListener("message", async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  let host: Host;
  try {
    host = await ready;
  } catch (e) {
    post({ kind: "error", id: msg.id, error: `The local database couldn't start: ${(e as Error).message}` });
    return;
  }
  try {
    if (msg.kind === "setup-foods") {
      const counts = await setupFoods(msg.id, host);
      post({ kind: "done", id: msg.id, result: counts });
      return;
    }
    if (msg.kind === "info") {
      post({ kind: "done", id: msg.id, result: { persistent: host.persistent } });
      return;
    }
    if (msg.kind === "backup") {
      const bytes = backup(host);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ kind: "done", id: msg.id, result: buf }, [buf]);
      return;
    }
    if (msg.kind === "restore") {
      const old = host;
      const pending = restore(old, new Uint8Array(msg.bytes));
      ready = pending.then((r) => r.host, () => old);
      const { error } = await pending;
      if (error) throw new Error(`Restore failed, your data is unchanged: ${error.message}`);
      post({ kind: "done", id: msg.id, result: null });
      return;
    }
    const headers = new Headers(msg.headers);
    let body: BodyInit | undefined;
    if (msg.body && typeof msg.body === "object" && "form" in msg.body) {
      const form = new FormData();
      for (const [k, v] of msg.body.form) form.append(k, v);
      body = form;
      headers.delete("content-type"); // let FormData set the boundary
    } else body = msg.body ?? undefined;
    const res = await host.app.fetch(new Request(`http://local/api${msg.path}`, { method: msg.method, headers, body }));
    const buf = await res.arrayBuffer();
    post({ kind: "response", id: msg.id, status: res.status, headers: [...res.headers], body: buf }, [buf]);
  } catch (e) {
    post({ kind: "error", id: msg.id, error: (e as Error).message });
  }
});
