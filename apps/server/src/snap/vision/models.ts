/**
 * List the models a key can use, so Me → Snap AI offers a pick list instead of a free-text box.
 * Gemini and OpenAI(-compatible) only; Claude has a fixed default.
 */
import { GEMINI_BASE_URL } from "./gemini.ts";
import { VisionConfigError } from "./types.ts";

export type ModelOption = { id: string; label: string };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// Model families that can't read a photo and answer in text.
const NOT_VISION = /embed|aqa|tts|whisper|dall-e|moderation|audio|realtime|transcribe|davinci|babbage|imagen|veo|image-generation|gpt-image|search|computer-use|-live/i;

async function readJson(res: Response, provider: string): Promise<unknown> {
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new VisionConfigError(`${provider} rejected the API key. Check that it's copied in full.`);
  }
  if (!res.ok) throw new VisionConfigError(`Couldn't load the model list from ${provider} (HTTP ${res.status}).`);
  return res.json();
}

export async function listVisionModels(
  c: { provider: string; apiKey?: string; baseURL?: string },
  fetchImpl: Fetch = (i, init) => fetch(i, init),
): Promise<ModelOption[]> {
  const timeout = { signal: AbortSignal.timeout(20_000) };
  if (c.provider === "gemini") {
    if (!c.apiKey) throw new VisionConfigError("Paste your Gemini API key first.");
    const base = (c.baseURL || GEMINI_BASE_URL).replace(/\/+$/, "");
    const out: ModelOption[] = [];
    let page = "";
    for (let i = 0; i < 5; i++) {
      const res = await fetchImpl(`${base}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
        { headers: { "x-goog-api-key": c.apiKey }, ...timeout });
      const json = (await readJson(res, "Gemini")) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
        nextPageToken?: string;
      };
      for (const m of json.models ?? []) {
        const id = m.name.replace(/^models\//, "");
        if (!m.supportedGenerationMethods?.includes("generateContent") || NOT_VISION.test(id)) continue;
        out.push({ id, label: m.displayName || id });
      }
      if (!json.nextPageToken) break;
      page = json.nextPageToken;
    }
    return sortNewestFirst(out);
  }
  if (c.provider === "openai" || c.provider === "openai_compatible") {
    const base = (c.baseURL || (c.provider === "openai" ? "https://api.openai.com/v1" : "")).replace(/\/+$/, "");
    if (!base) throw new VisionConfigError("Add the base URL first.");
    if (c.provider === "openai" && !c.apiKey) throw new VisionConfigError("Paste your OpenAI API key first.");
    const res = await fetchImpl(`${base}/models`, { headers: c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}, ...timeout });
    const json = (await readJson(res, c.provider === "openai" ? "OpenAI" : "The server")) as { data?: { id: string }[] };
    const ids = (json.data ?? []).map((m) => m.id).filter((id) => !NOT_VISION.test(id));
    return sortNewestFirst(ids.map((id) => ({ id, label: id })));
  }
  throw new VisionConfigError("This provider has no model list.");
}

/** Higher version numbers first ("gemini-3…" before "gemini-2.5…"), then by name. */
function sortNewestFirst(models: ModelOption[]): ModelOption[] {
  const version = (id: string) => Number(id.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return [...new Map(models.map((m) => [m.id, m])).values()]
    .sort((a, b) => version(b.id) - version(a.id) || a.id.localeCompare(b.id));
}
