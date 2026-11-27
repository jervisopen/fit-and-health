/** Google Gemini adapter (raw HTTP generateContent, JSON response mode). */
import { DETECTION_JSON_SCHEMA, parseDetectionText, VisionConfigError, VisionResponseError, type VisionImage, type VisionProvider, type VisionResult } from "./types.ts";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.ts";
import { toBase64 } from "../../../../../packages/shared/src/bytes.ts";

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** "models/gemini-x" or a pasted display name like "Gemini 2.5 Flash" → the ID the API expects. */
export function geminiModelId(model: string): string {
  return model.trim().replace(/^models\//i, "").toLowerCase().replace(/\s+/g, "-");
}

/** Google's error JSON → its message (or the raw text). */
function googleError(text: string): string {
  try {
    const m = (JSON.parse(text) as { error?: { message?: string } }).error?.message;
    if (m) return m.replace(/^\*\s*/, "").trim();
  } catch { /* not JSON */ }
  return text.slice(0, 200);
}

export class GeminiVision implements VisionProvider {
  readonly name = "gemini";
  readonly model: string;
  private apiKey: string;
  private baseURL: string;

  constructor(opts: { apiKey?: string; model?: string; baseURL?: string }) {
    if (!opts.apiKey) throw new VisionConfigError("Add your Gemini API key (VISION_API_KEY)");
    if (!opts.model) throw new VisionConfigError("Choose a Gemini model that accepts images (VISION_MODEL)");
    this.apiKey = opts.apiKey;
    this.model = geminiModelId(opts.model);
    this.baseURL = (opts.baseURL || GEMINI_BASE_URL).replace(/\/+$/, "");
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
          { inline_data: { mime_type: image.mime, data: toBase64(image.bytes) } },
        ] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      const msg = googleError(await res.text());
      if (/API key/i.test(msg)) throw new VisionConfigError("Gemini rejected the API key. Check it in Me → Snap AI.");
      if (res.status === 404 || /model/i.test(msg)) {
        throw new VisionConfigError(`Gemini doesn't recognise the model "${this.model}". Pick one from the list in Me → Snap AI.`);
      }
      throw new VisionResponseError(`Gemini rejected the request: ${msg}`);
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
