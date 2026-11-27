/** Google Gemini adapter (raw HTTP generateContent, JSON response mode). */
import { DETECTION_JSON_SCHEMA, parseDetectionText, VisionConfigError, VisionResponseError, type VisionImage, type VisionProvider, type VisionResult } from "./types.ts";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.ts";

export class GeminiVision implements VisionProvider {
  readonly name = "gemini";
  readonly model: string;
  private apiKey: string;
  private baseURL: string;

  constructor(opts: { apiKey?: string; model?: string; baseURL?: string }) {
    if (!opts.apiKey) throw new VisionConfigError("Set VISION_API_KEY for VISION_PROVIDER=gemini");
    if (!opts.model) throw new VisionConfigError("Set VISION_MODEL for VISION_PROVIDER=gemini");
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseURL = (opts.baseURL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  }

  async detect(image: VisionImage, hint?: { mealName?: string }): Promise<VisionResult> {
    const res = await fetch(`${this.baseURL}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      // Key in a header, not the URL, so it never lands in proxy or access logs.
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\nAnswer with JSON matching this schema:\n${JSON.stringify(DETECTION_JSON_SCHEMA)}` }] },
        contents: [{ role: "user", parts: [
          { text: userPrompt(hint?.mealName) },
          { inline_data: { mime_type: image.mime, data: Buffer.from(image.bytes).toString("base64") } },
        ] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 400 || res.status === 403) {
      const t = await res.text();
      if (/API key/i.test(t)) throw new VisionConfigError("The Gemini API key was rejected. Check VISION_API_KEY in .env.");
      throw new VisionResponseError(`The vision API rejected the request (${res.status}): ${t.slice(0, 200)}`);
    }
    if (res.status === 429) throw new VisionResponseError("The vision API is rate limited. Wait a moment and try again.");
    if (!res.ok) throw new VisionResponseError(`The vision API failed (${res.status})`);
    const json = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]; modelVersion?: string };
    const cand = json.candidates?.[0];
    if (cand?.finishReason === "SAFETY") throw new VisionResponseError("The model declined to analyse this photo.");
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new VisionResponseError("The vision API returned an empty answer");
    return { detection: parseDetectionText(text), provider: this.name, model: json.modelVersion ?? this.model, raw: text };
  }
}
