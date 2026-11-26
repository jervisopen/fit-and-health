/**
 * Production entry: API under /api, the built PWA (apps/web/dist) for everything else.
 *   npm start            (after npm run build)
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, REPO_ROOT, databaseFile } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { createApp } from "./app.ts";

loadDotEnv(path.join(REPO_ROOT, ".env"));

const db = openDatabase();
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
const foodCount = (db.prepare("SELECT count(*) AS n FROM foods").get() as { n: number }).n;
if (!foodCount) console.warn("! Food database is empty. Run: npm run data:fetch && npm run data:build");

const root = new Hono();
root.route("/", createApp({ db }));

const dist = path.join(REPO_ROOT, "apps", "web", "dist");
if (existsSync(dist)) {
  const rel = path.relative(process.cwd(), dist) || ".";
  root.use("/*", serveStatic({ root: rel }));
  // SPA fallback: client-side routes get index.html.
  const indexHtml = readFileSync(path.join(dist, "index.html"), "utf8");
  root.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port }, () => {
  console.log(`Server on http://localhost:${port}  (db: ${databaseFile()}, foods: ${foodCount})`);
  if (!existsSync(dist)) console.log("  API only. The web app is served by Vite in dev (npm run dev).");
});

/** Minimal .env loader (KEY=VALUE lines); real environment variables win. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
