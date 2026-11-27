/**
 * VISION_PROVIDER=mock: returns a fixed North Indian thali for any photo.
 * For trying the Snap flow and for tests without an API key. Clearly labelled in the UI.
 */
import { normalizeDetection, type VisionImage, type VisionProvider, type VisionResult } from "./types.ts";

export class MockVision implements VisionProvider {
  readonly name = "mock";
  readonly model = "mock-thali";

  async detect(_image: VisionImage): Promise<VisionResult> {
    const detection = normalizeDetection({
      is_food: true,
      notes: "Mock result: the same thali for every photo.",
      items: [
        { name: "dal tadka", local_name: "dal", portion_unit: "katori", portion_quantity: 1, estimated_grams: 150, confidence: 0.9, bbox: { x: 0.08, y: 0.12, w: 0.36, h: 0.34 } },
        { name: "jeera rice", local_name: "jeera chawal", portion_unit: "bowl", portion_quantity: 1, estimated_grams: 180, confidence: 0.85, bbox: { x: 0.5, y: 0.1, w: 0.42, h: 0.38 } },
        { name: "chapati", local_name: "roti", portion_unit: "chapati", portion_quantity: 2, estimated_grams: 72, confidence: 0.95, bbox: { x: 0.1, y: 0.55, w: 0.4, h: 0.36 } },
        { name: "cucumber raita", local_name: "kheere ka raita", portion_unit: "katori", portion_quantity: 1, estimated_grams: 120, confidence: 0.6, bbox: { x: 0.58, y: 0.56, w: 0.3, h: 0.3 } },
      ],
    });
    return { detection, provider: this.name, model: this.model, raw: { mock: true } };
  }
}
