import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { api } from "../lib/api.ts";
import { API_MODE } from "../lib/transport.ts";

// Object URLs for images served by the in-browser API, shared across components.
const cache = new Map<string, Promise<string>>();
const MAX_CACHED = 120;

function objectUrl(path: string): Promise<string> {
  let p = cache.get(path);
  if (!p) {
    p = api.blob(path).then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
    if (cache.size > MAX_CACHED) {
      const [oldest] = cache.keys();
      const old = cache.get(oldest!);
      cache.delete(oldest!);
      void old?.then((u) => URL.revokeObjectURL(u));
    }
  }
  return p;
}

/** <img> for "/api/…" image URLs; works with the in-browser API, where there is no HTTP server. */
export function ApiImage({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const path = src.replace(/^\/api/, "");
  const [url, setUrl] = useState<string | null>(API_MODE === "server" ? src : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (API_MODE === "server") { setUrl(src); return; }
    let alive = true;
    objectUrl(path).then((u) => alive && setUrl(u), () => alive && setFailed(true));
    return () => { alive = false; };
  }, [src, path]);
  if (failed || !url) return <span aria-hidden="true" className={`${rest.className ?? ""} block bg-surface-2`} />;
  return <img src={url} {...rest} />;
}

/** Save an API response (e.g. the fasting calendar) as a file. */
export async function downloadFromApi(path: string, filename: string) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
