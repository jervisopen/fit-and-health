/** Messages between the page and the local API worker. */
export type ToWorker =
  | { kind: "fetch"; id: number; method: string; path: string; headers: [string, string][]; body: string | ArrayBuffer | { form: [string, string | Blob][] } | null }
  | { kind: "setup-foods"; id: number }
  | { kind: "info"; id: number }
  | { kind: "backup"; id: number }
  | { kind: "restore"; id: number; bytes: ArrayBuffer };

export type FromWorker =
  | { kind: "response"; id: number; status: number; headers: [string, string][]; body: ArrayBuffer }
  | { kind: "progress"; id: number; stage: string; pct: number }
  | { kind: "done"; id: number; result: unknown }
  | { kind: "error"; id: number; error: string }
  /** Broadcast (id 0): "waiting" while another tab or window has the database open. */
  | { kind: "status"; id: 0; status: "waiting" | "open" };
