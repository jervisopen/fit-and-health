/**
 * Choose the Snap vision provider.
 *   provider = anthropic | openai | gemini | openai_compatible | mock
 * Config comes from the app's own settings (saved on the device / server database) or, as a
 * fallback on a self-hosted server, from VISION_* environment variables (.env).
 * Keys are only ever sent to the chosen provider.
 */
import type { Db } from "../../db/types.ts";
import { AnthropicVision } from "./anthropic.ts";
import { OpenAICompatibleVision } from "./openai.ts";
import { GeminiVision } from "./gemini.ts";
import { MockVision } from "./mock.ts";
import { VisionConfigError, type VisionProvider } from "./types.ts";

export type VisionStatus = { configured: true; provider: string; model: string } | { configured: false; reason: string };

export type VisionConfig = {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseURL?: string;
  effort?: string;
  /** Anthropic only: let the SDK find credentials itself (ANTHROPIC_API_KEY, `ant auth login`). */
  sdkCredentials?: boolean;
};

type Env = Record<string, string | undefined>;

export function envVisionConfig(env: Env): VisionConfig {
  const provider = (env.VISION_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = env.VISION_API_KEY?.trim() || undefined;
  return {
    provider,
    apiKey,
    model: env.VISION_MODEL?.trim() || undefined,
    baseURL: env.VISION_BASE_URL?.trim() || undefined,
    effort: env.VISION_EFFORT?.trim() || undefined,
    sdkCredentials: provider === "anthropic" && !apiKey && Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
  };
}

export function visionFromConfig(c: VisionConfig, opts: { browser?: boolean } = {}): VisionProvider {
  const provider = (c.provider ?? "").trim().toLowerCase();
  switch (provider) {
    case "anthropic":
      if (!c.apiKey && !c.sdkCredentials) throw new VisionConfigError("Add your Anthropic API key to use Snap with Claude");
      return new AnthropicVision({
        apiKey: c.apiKey, model: c.model, baseURL: c.baseURL, browser: opts.browser,
        effort: (c.effort || undefined) as "low" | "medium" | "high" | "xhigh" | "max" | undefined,
      });
    case "openai":
    case "openai_compatible":
      return new OpenAICompatibleVision({ name: provider, apiKey: c.apiKey, model: c.model, baseURL: c.baseURL });
    case "gemini":
      return new GeminiVision({ apiKey: c.apiKey, model: c.model, baseURL: c.baseURL });
    case "mock":
      return new MockVision();
    case "":
      throw new VisionConfigError("Snap needs a vision model. Choose a provider and add your API key in Me → Snap AI.");
    default:
      throw new VisionConfigError(`Unknown vision provider "${provider}" (use anthropic, openai, gemini, openai_compatible or mock)`);
  }
}

/** Kept for the server's .env-only setup and tests. */
export function visionFromEnv(env: Env): VisionProvider {
  return visionFromConfig(envVisionConfig(env));
}

/** Build the provider lazily and rebuild it whenever the configuration changes. */
export function lazyVision(read: () => VisionConfig, opts: { browser?: boolean } = {}) {
  let cachedKey = "";
  let cached: VisionProvider | null = null;
  return {
    get(): VisionProvider {
      const config = read();
      const key = JSON.stringify(config);
      if (!cached || key !== cachedKey) {
        cached = visionFromConfig(config, opts);
        cachedKey = key;
      }
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

// ── Settings saved in the app database (meta.vision_config) ─────────────────────────────────

export function readSavedVisionConfig(db: Db): VisionConfig | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'vision_config'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as VisionConfig) : null;
}

export function saveVisionConfig(db: Db, c: VisionConfig | null) {
  if (!c) db.prepare("DELETE FROM meta WHERE key = 'vision_config'").run();
  else db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('vision_config', ?)").run(JSON.stringify(c));
}

/** Saved settings win; otherwise the environment (self-hosted server .env). */
export function appVision(db: Db, env: Env, opts: { browser?: boolean } = {}): LazyVision {
  return lazyVision(() => readSavedVisionConfig(db) ?? envVisionConfig(env), opts);
}
