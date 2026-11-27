import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createApp } from "../app.ts";

function setup(env: Record<string, string> = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  const app = createApp({ db, env, browser: true, mode: "local" });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { db, call };
}

test("Snap AI settings: saved on the device, key never returned, kept when omitted", async () => {
  const { db, call } = setup();
  let r = await call("GET", "/settings/vision");
  assert.equal(r.json.saved, null);
  assert.equal(r.json.status.configured, false);
  assert.match(r.json.status.reason, /Snap AI/);

  r = await call("PUT", "/settings/vision", { provider: "anthropic", apiKey: "sk-ant-secret", effort: "low" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status.configured, true);
  assert.equal(r.json.status.provider, "anthropic");

  r = await call("GET", "/settings/vision");
  assert.deepEqual(r.json.saved, { provider: "anthropic", model: "", baseURL: "", effort: "low", hasKey: true });
  assert.ok(!JSON.stringify(r.json).includes("sk-ant-secret"));

  // Omitting the key (the form never shows it) keeps it; "" clears it.
  await call("PUT", "/settings/vision", { provider: "anthropic", effort: "high" });
  assert.equal((await call("GET", "/settings/vision")).json.saved.hasKey, true);
  r = await call("PUT", "/settings/vision", { provider: "anthropic", apiKey: "" });
  assert.equal(r.json.status.configured, false);

  await call("PUT", "/settings/vision", { provider: "mock" });
  assert.equal((await call("GET", "/snap/status")).json.provider, "mock");

  r = await call("DELETE", "/settings/vision");
  assert.equal(r.json.status.configured, false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM meta WHERE key = 'vision_config'").get()!.n, 0);
});

test("Snap AI settings: validation and env fallback", async () => {
  const { call } = setup({ VISION_PROVIDER: "mock" });
  assert.equal((await call("GET", "/settings/vision")).json.status.provider, "mock");
  assert.equal((await call("PUT", "/settings/vision", { provider: "nope" })).status, 400);
  assert.equal((await call("PUT", "/settings/vision", { provider: "openai_compatible", baseURL: "ftp://x" })).status, 400);
  // A saved config wins over the environment.
  const r = await call("PUT", "/settings/vision", { provider: "openai_compatible", baseURL: "http://localhost:11434/v1", model: "llava" });
  assert.equal(r.json.status.provider, "openai_compatible");
  assert.equal((await call("GET", "/health")).json.mode, "local");
});
