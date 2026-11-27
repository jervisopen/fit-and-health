/**
 * Where API calls go.
 *   local (default): the in-browser API worker; data stays on this device. Used by the static site.
 *   server: a self-hosted fit&health server at /api (build or run Vite with `--mode server`).
 */
import { localFetch } from "../local/client.ts";

export const API_MODE: "local" | "server" = import.meta.env.VITE_API_MODE === "server" ? "server" : "local";

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return API_MODE === "server" ? fetch(`/api${path}`, init) : localFetch(path, init);
}
