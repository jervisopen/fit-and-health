/**
 * OpenAI Chat Completions adapter (raw HTTP, no SDK dependency). Also serves any
 * OpenAI-compatible endpoint (Ollama, vLLM, LM Studio…) via VISION_BASE_URL.
 */
import { DETECTION_JSON_SCHEMA, parseDetectionText, VisionConfigError, VisionResponseError, type VisionImage, type VisionProvider, type VisionResult } from "./types.ts";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.ts";

export class OpenAICompatibleVision implements VisionProvider {
  readonly name: string;
  readonly model: string;
  private baseURL: string;
  private apiKey: string;
  private strictSchema: boolean;

  constructor(opts: { name: "openai" | "openai_compatible"; apiKey?: string; model?: string; baseURL?: string }) {
    if (!opts.model) throw new VisionConfigError(`Set VISION_MODEL for VISION_PROVIDER=${opts.name}`);
    if (opts.name === "openai" && !opts.apiKey) throw new VisionConfigError("Set VISION_API_KEY for VISION_PROVIDER=openai");
    if (opts.name === "openai_compatible" && !opts.baseURL) throw new VisionConfigError("Set VISION_BASE_URL for VISION_PROVIDER=openai_compatible");
    this.name = opts.name;
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? "";
    this.baseURL = (opts.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    // Local servers vary in json_schema support; plain JSON mode plus Zod validation is the safe default there.
    this.strictSchema = opts.name === "openai";
  }

  async detect(image: VisionImage, hint?: { mealName?: string }): Promise<VisionResult> {
    const dataUrl = `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: this.strictSchema ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\nAnswer with JSON matching this schema:\n${JSON.stringify(DETECTION_JSON_SCHEMA)}` },
        { role: "user", content: [{ type: "text", text: userPrompt(hint?.mealName) }, { type: "image_url", image_url: { url: dataUrl } }] },
      ],
      response_format: this.strictSchema
        ? { type: "json_schema", json_schema: { name: "food_detection", strict: true, schema: DETECTION_JSON_SCHEMA } }
        : { type: "json_object" },
    };
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 401 || res.status === 403) throw new VisionConfigError("The vision API key was rejected. Check VISION_API_KEY in .env.");
    if (res.status === 429) throw new VisionResponseError("The vision API is rate limited. Wait a moment and try again.");
    if (!res.ok) throw new VisionResponseError(`The vision API failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
    const msg = json.choices?.[0]?.message;
    if (msg?.refusal) throw new VisionResponseError("The model declined to analyse this photo.");
    if (!msg?.content) throw new VisionResponseError("The vision API returned an empty answer");
    return { detection: parseDetectionText(msg.content), provider: this.name, model: json.model ?? this.model, raw: msg.content };
  }
}
