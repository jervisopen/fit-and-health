/** Page side of the local API worker: a `fetch`-shaped function plus first-run setup. */
import type { FromWorker, ToWorker } from "./protocol.ts";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (stage: string, pct: number) => void };

let worker: Worker | null = null;
let status: "starting" | "waiting" | "open" = "starting";
const statusListeners = new Set<(s: typeof status) => void>();

/** "waiting" while another fit&health tab or window has the database open. */
export function onDatabaseStatus(cb: (s: typeof status) => void): () => void {
  statusListeners.add(cb);
  cb(status);
  return () => { statusListeners.delete(cb); };
}
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "fit-and-health-api" });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const msg = event.data;
    if (msg.kind === "status") {
      status = msg.status;
      for (const cb of statusListeners) cb(status);
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.kind === "progress") { p.onProgress?.(msg.stage, msg.pct); return; }
    pending.delete(msg.id);
    if (msg.kind === "error") p.reject(new Error(msg.error));
    else if (msg.kind === "done") p.resolve(msg.result);
    else p.resolve(new Response(msg.status === 204 ? null : msg.body, { status: msg.status, headers: msg.headers }));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "The local database stopped"));
    pending.clear();
  };
  return worker;
}

type Outgoing = ToWorker extends infer M ? (M extends unknown ? Omit<M, "id"> : never) : never;

function send<T>(msg: Outgoing, transfer: Transferable[] = [], onProgress?: Pending["onProgress"]): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

/** Same contract as `fetch("/api" + path, init)`, answered by the in-browser API. */
export async function localFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let body: Extract<ToWorker, { kind: "fetch" }>["body"] = null;
  const transfer: Transferable[] = [];
  if (init.body instanceof FormData) {
    body = { form: [...init.body.entries()].map(([k, v]) => [k, v] as [string, string | Blob]) };
  } else if (typeof init.body === "string") {
    body = init.body;
  } else if (init.body instanceof ArrayBuffer) {
    body = init.body;
    transfer.push(init.body);
  }
  const headers = [...new Headers(init.headers)] as [string, string][];
  return send<Response>({ kind: "fetch", method: init.method ?? "GET", path, headers, body }, transfer);
}

/** Download the public datasets and build the food database on this device. */
export function setupLocalFoods(onProgress: (stage: string, pct: number) => void) {
  return send<{ indb: number; ifct: number; off: number }>({ kind: "setup-foods" }, [], onProgress);
}

export function localInfo() {
  return send<{ persistent: boolean }>({ kind: "info" });
}

/** This device's data as a SQLite file (the Snap AI key is left out). */
export async function localBackup(): Promise<Blob> {
  const buf = await send<ArrayBuffer>({ kind: "backup" });
  return new Blob([buf], { type: "application/vnd.sqlite3" });
}

/** Replace this device's data with a backup file. */
export async function localRestore(file: Blob): Promise<void> {
  const bytes = await file.arrayBuffer();
  await send<null>({ kind: "restore", bytes }, [bytes]);
}
