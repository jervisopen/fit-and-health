import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDetection, parseDetectionText, VisionConfigError, VisionResponseError, type Detection } from "./types.ts";
import { visionFromEnv, lazyVision } from "./index.ts";
import { AnthropicVision, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.ts";
import { OpenAICompatibleVision } from "./openai.ts";
import { GeminiVision } from "./gemini.ts";

const JPEG = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mime: "image/jpeg" as const };
const ONE_ITEM: Detection = {
  is_food: true, notes: "",
  items: [{ name: "chapati", local_name: "roti", portion_unit: "chapati", portion_quantity: 2, estimated_grams: 72, confidence: 0.9, bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } }],
};

test("detection parsing tolerates fences and prose, validates shape", () => {
  const d = parseDetectionText("Here you go:\n```json\n" + JSON.stringify(ONE_ITEM) + "\n```");
  assert.equal(d.items[0]?.name, "chapati");
  assert.throws(() => parseDetectionText("no json here"), VisionResponseError);
  assert.throws(() => parseDetectionText('{"is_food": true}'), VisionResponseError);
});

test("normalization clamps model output", () => {
  const d = normalizeDetection({
    is_food: true, notes: " ",
    items: [
      { ...ONE_ITEM.items[0]!, portion_unit: "Chapati", portion_quantity: -2, estimated_grams: 0, confidence: 7, bbox: { x: 0.9, y: -1, w: 0.5, h: 2 } },
      { ...ONE_ITEM.items[0]!, name: "  " },
    ],
  });
  assert.equal(d.items.length, 1);
  const i = d.items[0]!;
  assert.equal(i.portion_unit, "chapati");
  assert.equal(i.portion_quantity, 1);
  assert.equal(i.estimated_grams, 100);
  assert.equal(i.confidence, 1);
  assert.deepEqual(i.bbox, { x: 0.9, y: 0, w: 0.09999999999999998, h: 1 });
  assert.equal(normalizeDetection({ is_food: true, notes: "", items: [] }).is_food, false);
});

test("provider selection from .env", () => {
  assert.throws(() => visionFromEnv({}), /VISION_PROVIDER/);
  assert.throws(() => visionFromEnv({ VISION_PROVIDER: "openai", VISION_API_KEY: "k" }), /VISION_MODEL/);
  assert.throws(() => visionFromEnv({ VISION_PROVIDER: "gemini", VISION_MODEL: "m" }), /VISION_API_KEY/);
  assert.throws(() => visionFromEnv({ VISION_PROVIDER: "anthropic" }), VisionConfigError);
  assert.throws(() => visionFromEnv({ VISION_PROVIDER: "bogus" }), /Unknown/);
  assert.equal(visionFromEnv({ VISION_PROVIDER: "anthropic", VISION_API_KEY: "k" }).model, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(visionFromEnv({ VISION_PROVIDER: "mock" }).name, "mock");
  assert.deepEqual(lazyVision({}).status().configured, false);
  assert.deepEqual(lazyVision({ VISION_PROVIDER: "mock" }).status(), { configured: true, provider: "mock", model: "mock-thali" });
});

type Captured = { url: string; headers: Record<string, string>; body: any };
function fakeFetch(respond: (c: Captured) => { status?: number; json: unknown }) {
  const calls: Captured[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const c = { url: String(input instanceof Request ? input.url : input), headers, body: JSON.parse(String(init?.body ?? "{}")) };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

test("Claude adapter: structured output, fallbacks, image, refusal handling", async () => {
  const ok = fakeFetch(() => ({ json: {
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify(ONE_ITEM) }], usage: { input_tokens: 1, output_tokens: 1 },
  } }));
  const v = new AnthropicVision({ apiKey: "test-key", fetch: ok.fn });
  const r = await v.detect(JPEG, { mealName: "Lunch" });
  assert.equal(r.detection.items[0]?.name, "chapati");
  const req = ok.calls[0]!;
  assert.match(req.url, /\/v1\/messages/);
  assert.equal(req.body.model, "claude-opus-5-5");
  assert.equal(req.body.fallbacks, "default");
  assert.match(req.headers["anthropic-beta"] ?? "", /server-side-fallback-2026-07-01/);
  assert.equal(req.body.output_config.format.type, "json_schema");
  assert.equal(req.body.output_config.effort, "medium");
  assert.equal(req.body.thinking, undefined); // Opus 5.5: never send disabled thinking
  assert.equal(req.body.messages[0].content[0].source.media_type, "image/jpeg");
  assert.match(req.body.messages[0].content[1].text, /Lunch/);

  const refusal = fakeFetch(() => ({ json: {
    id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "refusal", stop_sequence: null,
    stop_details: { type: "refusal", category: null, explanation: null }, content: [], usage: { input_tokens: 1, output_tokens: 0 },
  } }));
  await assert.rejects(new AnthropicVision({ apiKey: "k", fetch: refusal.fn }).detect(JPEG), /declined/);
});

test("OpenAI-compatible and Gemini adapters send the image and parse JSON", async () => {
  const realFetch = globalThis.fetch;
  try {
    const oa = fakeFetch(() => ({ json: { model: "m1", choices: [{ message: { content: JSON.stringify(ONE_ITEM) } }] } }));
    globalThis.fetch = oa.fn;
    const r1 = await new OpenAICompatibleVision({ name: "openai", apiKey: "k", model: "m1" }).detect(JPEG);
    assert.equal(r1.detection.items.length, 1);
    assert.equal(oa.calls[0]!.headers.authorization, "Bearer k");
    assert.equal(oa.calls[0]!.body.response_format.type, "json_schema");
    assert.match(oa.calls[0]!.body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);

    const local = fakeFetch(() => ({ json: { choices: [{ message: { content: JSON.stringify(ONE_ITEM) } }] } }));
    globalThis.fetch = local.fn;
    await new OpenAICompatibleVision({ name: "openai_compatible", model: "llava", baseURL: "http://localhost:11434/v1/" }).detect(JPEG);
    assert.equal(local.calls[0]!.url, "http://localhost:11434/v1/chat/completions");
    assert.equal(local.calls[0]!.body.response_format.type, "json_object");
    assert.equal(local.calls[0]!.headers.authorization, undefined);

    const gm = fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(ONE_ITEM) }] } }] } }));
    globalThis.fetch = gm.fn;
    await new GeminiVision({ apiKey: "g", model: "gem" }).detect(JPEG);
    assert.match(gm.calls[0]!.url, /models\/gem:generateContent$/);
    assert.equal(gm.calls[0]!.headers["x-goog-api-key"], "g");
    assert.equal(gm.calls[0]!.body.contents[0].parts[1].inline_data.mime_type, "image/jpeg");

    globalThis.fetch = fakeFetch(() => ({ status: 401, json: {} })).fn;
    await assert.rejects(new OpenAICompatibleVision({ name: "openai", apiKey: "bad", model: "m" }).detect(JPEG), VisionConfigError);
  } finally {
    globalThis.fetch = realFetch;
  }
});
