import { z } from "zod";

/**
 * What every vision provider must return for a meal photo.
 * Kept as one JSON Schema so providers with structured outputs can enforce it,
 * and validated again with Zod for providers that only promise JSON.
 */
export const DetectedItemSchema = z.object({
  name: z.string().min(1),
  local_name: z.string(),
  portion_unit: z.string(),
  portion_quantity: z.number(),
  estimated_grams: z.number(),
  confidence: z.number(),
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

export const DetectionSchema = z.object({
  is_food: z.boolean(),
  items: z.array(DetectedItemSchema),
  notes: z.string(),
});

export type DetectedItem = z.infer<typeof DetectedItemSchema>;
export type Detection = z.infer<typeof DetectionSchema>;

/** JSON Schema for structured outputs (strict: every property required, no extras). */
export const DETECTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_food", "items", "notes"],
  properties: {
    is_food: { type: "boolean", description: "False when the photo shows no food or drink." },
    notes: { type: "string", description: "One short sentence about anything uncertain; empty if nothing." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "local_name", "portion_unit", "portion_quantity", "estimated_grams", "confidence", "bbox"],
        properties: {
          name: { type: "string", description: "Common English name of the dish or food, e.g. \"dal tadka\", \"jeera rice\", \"chapati\"." },
          local_name: { type: "string", description: "Hindi or regional name in Latin script if there is a common one, else empty." },
          portion_unit: { type: "string", description: "Household unit: piece, chapati, idli, katori, bowl, plate, glass, cup, tbsp, slice, or g." },
          portion_quantity: { type: "number", description: "How many of portion_unit are visible, e.g. 2 for two chapatis, 1 for one katori." },
          estimated_grams: { type: "number", description: "Estimated edible weight in grams of this item as served." },
          confidence: { type: "number", description: "0 to 1: how sure you are about the identification." },
          bbox: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "w", "h"],
            description: "Where the item is in the photo, as fractions of image width/height from the top-left corner.",
            properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
          },
        },
      },
    },
  },
} as const;

export type VisionImage = { bytes: Uint8Array; mime: "image/jpeg" | "image/png" | "image/webp" };

export type VisionResult = { detection: Detection; provider: string; model: string; raw: unknown };

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  detect(image: VisionImage, hint?: { mealName?: string }): Promise<VisionResult>;
}

export class VisionConfigError extends Error {}
export class VisionResponseError extends Error {}

/** Clamp model output into sane ranges; drop items without a usable name. */
export function normalizeDetection(d: Detection): Detection {
  const clamp01 = (v: number) => Math.min(Math.max(Number.isFinite(v) ? v : 0, 0), 1);
  const items = d.items
    .filter((i) => i.name.trim())
    .map((i) => {
      const x = clamp01(i.bbox.x);
      const y = clamp01(i.bbox.y);
      return {
        ...i,
        name: i.name.trim(),
        local_name: i.local_name.trim(),
        portion_unit: (i.portion_unit || "g").trim().toLowerCase(),
        portion_quantity: i.portion_quantity > 0 ? Math.min(i.portion_quantity, 50) : 1,
        estimated_grams: i.estimated_grams > 0 ? Math.min(i.estimated_grams, 3000) : 100,
        confidence: clamp01(i.confidence),
        bbox: { x, y, w: Math.min(clamp01(i.bbox.w), 1 - x), h: Math.min(clamp01(i.bbox.h), 1 - y) },
      };
    })
    .slice(0, 12);
  return { is_food: d.is_food && items.length > 0, items, notes: d.notes.trim() };
}

/** Parse a provider's JSON text (tolerating code fences or leading prose) and validate it. */
export function parseDetectionText(text: string): Detection {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new VisionResponseError("The vision model did not return JSON");
  let json: unknown;
  try {
    json = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new VisionResponseError("The vision model returned malformed JSON");
  }
  const parsed = DetectionSchema.safeParse(json);
  if (!parsed.success) throw new VisionResponseError(`Unexpected detection format: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return normalizeDetection(parsed.data);
}
