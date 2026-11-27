import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createApp } from "../app.ts";
import { geminiModelId, GeminiVision } from "./vision/gemini.ts";
import { listVisionModels } from "./vision/models.ts";

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

test("Gemini model IDs are cleaned up from what people paste", () => {
  assert.equal(geminiModelId("models/gemini-2.5-flash"), "gemini-2.5-flash");
  assert.equal(geminiModelId("  Gemini 2.5 Flash "), "gemini-2.5-flash");
  assert.equal(new GeminiVision({ apiKey: "k", model: "Models/Gemini-X" }).model, "gemini-x");
});

test("Gemini errors are readable and point to the model picker", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 400, message: "* GenerateContentRequest.model: unexpected model name format\n", status: "INVALID_ARGUMENT" } }), { status: 400 })) as typeof fetch;
    const g = new GeminiVision({ apiKey: "k", model: "bad name!" });
    await assert.rejects(g.detect({ bytes: new Uint8Array([1]), mime: "image/jpeg" }), /doesn't recognise the model .*Me → Snap AI/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), { status: 400 })) as typeof fetch;
    await assert.rejects(g.detect({ bytes: new Uint8Array([1]), mime: "image/jpeg" }), /rejected the API key/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Model list: Gemini keeps photo-capable models, newest first, using the key header", async () => {
  let seen: { url: string; key: string | null } | null = null;
  const models = await listVisionModels({ provider: "gemini", apiKey: "k" }, async (url, init) => {
    seen = { url, key: new Headers(init?.headers).get("x-goog-api-key") };
    return Response.json({ models: [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-pro", displayName: "Gemini 3 Pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
    ] });
  });
  assert.deepEqual(models.map((m) => m.id), ["gemini-3-pro", "gemini-2.5-flash"]);
  assert.equal(seen!.key, "k");
  assert.ok(!seen!.url.includes("k&") && !seen!.url.includes("key="), "key must not be in the URL");
  await assert.rejects(listVisionModels({ provider: "gemini", apiKey: "bad" }, async () => new Response("{}", { status: 400 })), /rejected the API key/);
});

test("Model list route uses the saved key when none is typed", async () => {
  const { call } = setup();
  await call("PUT", "/settings/vision", { provider: "openai_compatible", baseURL: "http://127.0.0.1:9/v1", model: "x" });
  const r = await call("POST", "/settings/vision/models", { provider: "anthropic" });
  assert.equal(r.status, 400);
  const r2 = await call("POST", "/settings/vision/models", { provider: "gemini" });
  assert.equal(r2.status, 400);
  assert.match(r2.json.error, /Paste your Gemini API key/);
});
