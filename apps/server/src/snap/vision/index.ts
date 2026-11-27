/**
 * Pick the vision provider from the environment (see .env.example):
 *   VISION_PROVIDER = anthropic | openai | gemini | openai_compatible | mock
 *   VISION_API_KEY, VISION_MODEL, VISION_BASE_URL, VISION_EFFORT (anthropic only)
 * Keys never leave the server.
 */
import { AnthropicVision } from "./anthropic.ts";
import { OpenAICompatibleVision } from "./openai.ts";
import { GeminiVision } from "./gemini.ts";
import { MockVision } from "./mock.ts";
import { VisionConfigError, type VisionProvider } from "./types.ts";

export type VisionStatus = { configured: true; provider: string; model: string } | { configured: false; reason: string };

export function visionFromEnv(env: NodeJS.ProcessEnv = process.env): VisionProvider {
  const provider = (env.VISION_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = env.VISION_API_KEY?.trim() || undefined;
  const model = env.VISION_MODEL?.trim() || undefined;
  const baseURL = env.VISION_BASE_URL?.trim() || undefined;
  switch (provider) {
    case "anthropic": {
      // An explicit key wins; otherwise the SDK's own resolution (ANTHROPIC_API_KEY, `ant auth login`).
      if (!apiKey && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
        throw new VisionConfigError("Set VISION_API_KEY (or ANTHROPIC_API_KEY) for VISION_PROVIDER=anthropic");
      }
      const effort = env.VISION_EFFORT?.trim() as "low" | "medium" | "high" | "xhigh" | "max" | undefined;
      return new AnthropicVision({ apiKey, model, effort: effort || undefined, baseURL });
    }
    case "openai":
    case "openai_compatible":
      return new OpenAICompatibleVision({ name: provider, apiKey, model, baseURL });
    case "gemini":
      return new GeminiVision({ apiKey, model, baseURL });
    case "mock":
      return new MockVision();
    case "":
      throw new VisionConfigError("Snap needs a vision model. Set VISION_PROVIDER and VISION_API_KEY in .env, then restart the server.");
    default:
      throw new VisionConfigError(`Unknown VISION_PROVIDER "${provider}" (use anthropic, openai, gemini, openai_compatible or mock)`);
  }
}

/** Lazily build the provider once; report configuration problems instead of crashing the server. */
export function lazyVision(env: NodeJS.ProcessEnv = process.env) {
  let cached: VisionProvider | null = null;
  return {
    get(): VisionProvider {
      cached ??= visionFromEnv(env);
      return cached;
    },
    status(): VisionStatus {
      try {
        const p = this.get();
        return { configured: true, provider: p.name, model: p.model };
      } catch (e) {
        return { configured: false, reason: (e as Error).message };
      }
    },
  };
}
export type LazyVision = ReturnType<typeof lazyVision>;
