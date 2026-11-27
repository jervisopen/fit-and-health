/**
 * Claude vision adapter (official @anthropic-ai/sdk).
 * Structured output via output_config.format, validated again with Zod; server-side refusal
 * fallbacks enabled ("default" routes by refusal category); refusals handled before reading content.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DETECTION_JSON_SCHEMA, parseDetectionText, VisionResponseError, type VisionImage, type VisionProvider, type VisionResult } from "./types.ts";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.ts";
import { toBase64 } from "../../../../../packages/shared/src/bytes.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicVision implements VisionProvider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;
  private effort: Effort;

  constructor(opts: { apiKey?: string; model?: string; effort?: Effort; baseURL?: string; fetch?: typeof fetch; browser?: boolean }) {
    // With no explicit key the SDK resolves ANTHROPIC_API_KEY / an `ant auth login` profile itself.
    this.client = new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch, maxRetries: 0 } : {}),
      // In-browser mode the key is the user's own, typed into their own device; it goes only to Anthropic.
      ...(opts.browser ? { dangerouslyAllowBrowser: true } : {}),
    });
    this.model = opts.model || DEFAULT_ANTHROPIC_MODEL;
    // Medium is this model's default; set explicitly. Raise to "high" if identification quality needs it.
    this.effort = opts.effort ?? "medium";
  }

  async detect(image: VisionImage, hint?: { mealName?: string }): Promise<VisionResult> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { effort: this.effort, format: { type: "json_schema", schema: DETECTION_JSON_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mime, data: toBase64(image.bytes) } },
          { type: "text", text: userPrompt(hint?.mealName) },
        ],
      }],
    });

    if (response.stop_reason === "refusal") {
      throw new VisionResponseError("The model declined to analyse this photo. Try another photo or add foods by search.");
    }
    if (response.stop_reason === "max_tokens") throw new VisionResponseError("The model's answer was cut off. Try again.");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { detection: parseDetectionText(text), provider: this.name, model: response.model, raw: text };
  }
}

/** Map SDK errors to messages a user can act on (most specific first). */
export function describeAnthropicError(e: unknown): string | null {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check VISION_API_KEY in .env.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key can't use the configured model.";
  if (e instanceof Anthropic.NotFoundError) return "The configured VISION_MODEL wasn't found.";
  if (e instanceof Anthropic.RateLimitError) return "The vision API is rate limited. Wait a moment and try again.";
  if (e instanceof Anthropic.BadRequestError) return `The vision API rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `The vision API failed (${e.status ?? "network"}). Try again.`;
  return null;
}
