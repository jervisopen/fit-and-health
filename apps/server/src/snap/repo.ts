/**
 * Snap: store a meal photo, detect foods with the configured vision model, match them to the
 * database, and log the confirmed items. Mirrors the reference flow
 * upload → detect_foods → confirm (snap/track) → review, without its async queue.
 */
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FoodLogDTO, SnapDetectionDTO, SnapImageDTO, SnapStatus, SnapTrackBody } from "../../../../packages/shared/src/api.ts";
import type { MealTypeCode } from "../../../../packages/shared/src/meals.ts";
import { transaction } from "../db/index.ts";
import { foodSummary, getFoodRow, NotFoundError, resolveMeasure, ValidationError } from "../foods/repo.ts";
import { getLog, insertLog } from "../diary/repo.ts";
import { matchItem } from "./match.ts";
import { VisionConfigError, VisionResponseError, type VisionImage, type VisionProvider } from "./vision/types.ts";
import { describeAnthropicError } from "./vision/anthropic.ts";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Recognise the image type from its first bytes; never trust the client's content-type. */
export function sniffImage(bytes: Uint8Array): VisionImage["mime"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const head = Buffer.from(bytes.subarray(0, 12)).toString("latin1");
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

const EXT: Record<VisionImage["mime"], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

type ImageRow = {
  id: string; file_path: string; sha256: string; captured_at: number; meal_type: MealTypeCode | null; status: SnapStatus;
  provider: string | null; model: string | null; error: string | null; mime: VisionImage["mime"]; notes: string | null;
};
type DetRow = {
  id: string; label: string; local_name: string | null; matched_food_id: string | null; confidence: number | null;
  bbox_x: number | null; bbox_y: number | null; bbox_w: number | null; bbox_h: number | null;
  est_measure_id: string | null; est_quantity: number | null; est_weight_g: number | null; selected: number;
  food_log_id: string | null; alternatives: string | null;
};

export class SnapService {
  private db: DatabaseSync;
  private dataDir: string;
  private vision: { get(): VisionProvider };

  constructor(db: DatabaseSync, dataDir: string, vision: { get(): VisionProvider }) {
    this.db = db;
    this.dataDir = dataDir;
    this.vision = vision;
  }

  private absPath(rel: string) {
    return path.join(this.dataDir, rel);
  }

  /** Save the photo, run detection, match foods. Detection failures are stored, not thrown. */
  async create(bytes: Uint8Array, opts: { mealType?: MealTypeCode; mealName?: string; capturedAt?: number }): Promise<SnapImageDTO> {
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ValidationError("Photo is larger than 8 MB");
    const mime = sniffImage(bytes);
    if (!mime) throw new ValidationError("Upload a JPEG, PNG or WebP photo");
    const provider = this.vision.get(); // throws VisionConfigError before anything is stored

    const id = randomUUID();
    const capturedAt = opts.capturedAt ?? Date.now();
    const month = new Date(capturedAt).toISOString().slice(0, 7);
    const rel = path.join("snaps", month, `${id}.${EXT[mime]}`);
    mkdirSync(path.dirname(this.absPath(rel)), { recursive: true });
    writeFileSync(this.absPath(rel), bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    this.db.prepare(`INSERT INTO snap_images (id, file_path, sha256, captured_at, meal_type, status, provider, model, mime)
                     VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?)`)
      .run(id, rel.replace(/\\/g, "/"), sha, Math.floor(capturedAt / 1000), opts.mealType ?? null, provider.name, provider.model, mime);
    await this.detect(id, { bytes, mime }, provider, opts);
    return this.get(id);
  }

  async retry(id: string): Promise<SnapImageDTO> {
    const row = this.row(id);
    if (row.status === "tracked") throw new ValidationError("This photo is already logged");
    const bytes = new Uint8Array(readFileSync(this.absPath(row.file_path)));
    const provider = this.vision.get();
    this.db.prepare("DELETE FROM snap_detections WHERE image_id = ?").run(id);
    this.db.prepare("UPDATE snap_images SET status = 'processing', error = NULL, provider = ?, model = ? WHERE id = ?").run(provider.name, provider.model, id);
    await this.detect(id, { bytes, mime: row.mime }, provider, { mealType: row.meal_type ?? undefined });
    return this.get(id);
  }

  private async detect(id: string, image: VisionImage, provider: VisionProvider, opts: { mealType?: MealTypeCode; mealName?: string }) {
    try {
      const result = await provider.detect(image, { mealName: opts.mealName });
      const d = result.detection;
      transaction(this.db, () => {
        const ins = this.db.prepare(`INSERT INTO snap_detections (id, image_id, label, local_name, portion_unit, matched_food_id, confidence,
          bbox_x, bbox_y, bbox_w, bbox_h, est_measure_id, est_quantity, est_weight_g, selected, alternatives, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        d.items.forEach((item, i) => {
          const m = matchItem(this.db, item, opts.mealType);
          ins.run(randomUUID(), id, item.name, item.local_name || null, item.portion_unit, m.foodId, item.confidence,
            item.bbox.x, item.bbox.y, item.bbox.w, item.bbox.h, m.measureId, m.quantity, m.weightG,
            Number(m.foodId !== null && item.confidence >= 0.35), JSON.stringify(m.alternativeIds), i);
        });
        this.db.prepare("UPDATE snap_images SET status = ?, model = ?, notes = ?, raw_response = ? WHERE id = ?")
          .run(d.is_food ? "detected" : "no_food", result.model, d.notes || null, JSON.stringify(result.raw).slice(0, 50_000), id);
      });
    } catch (e) {
      const message = e instanceof VisionConfigError || e instanceof VisionResponseError
        ? e.message
        : describeAnthropicError(e) ?? `Detection failed: ${(e as Error).message}`;
      if (!(e instanceof VisionConfigError || e instanceof VisionResponseError)) console.error("snap detect", e);
      this.db.prepare("UPDATE snap_images SET status = 'failed', error = ? WHERE id = ?").run(message, id);
    }
  }

  private row(id: string): ImageRow {
    const r = this.db.prepare("SELECT * FROM snap_images WHERE id = ?").get(id) as ImageRow | undefined;
    if (!r) throw new NotFoundError(`Snap ${id} not found`);
    return r;
  }

  get(id: string): SnapImageDTO {
    const r = this.row(id);
    const dets = this.db.prepare("SELECT * FROM snap_detections WHERE image_id = ? ORDER BY position").all(id) as DetRow[];
    return {
      id: r.id,
      status: r.status,
      capturedAt: r.captured_at * 1000,
      mealType: r.meal_type,
      provider: r.provider,
      model: r.model,
      notes: r.notes,
      error: r.error,
      imageUrl: `/api/snap/${r.id}/image`,
      detections: dets.map((d): SnapDetectionDTO => ({
        id: d.id,
        label: d.label,
        localName: d.local_name,
        confidence: d.confidence,
        bbox: d.bbox_x === null ? null : { x: d.bbox_x, y: d.bbox_y!, w: d.bbox_w!, h: d.bbox_h! },
        food: d.matched_food_id ? foodSummary(this.db, d.matched_food_id) : null,
        measureId: d.est_measure_id,
        quantity: d.est_quantity,
        weightG: d.est_weight_g,
        alternatives: (JSON.parse(d.alternatives ?? "[]") as string[]).flatMap((fid) => foodSummary(this.db, fid) ?? []),
        selected: Boolean(d.selected),
        foodLogId: d.food_log_id,
      })),
    };
  }

  list(limit = 30): SnapImageDTO[] {
    const ids = this.db.prepare("SELECT id FROM snap_images ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as { id: string }[];
    return ids.map(({ id }) => this.get(id));
  }

  image(id: string): { bytes: Buffer; mime: string } {
    const r = this.row(id);
    return { bytes: readFileSync(this.absPath(r.file_path)), mime: r.mime };
  }

  /** Log the confirmed items (possibly swapped foods / edited portions) in one transaction. */
  track(id: string, body: SnapTrackBody): FoodLogDTO[] {
    const r = this.row(id);
    if (r.status === "tracked") throw new ValidationError("This photo is already logged");
    if (!body.items.length) throw new ValidationError("Select at least one food to log");
    const known = new Set((this.db.prepare("SELECT id FROM snap_detections WHERE image_id = ?").all(id) as { id: string }[]).map((x) => x.id));
    const logIds = transaction(this.db, () => {
      const out: string[] = [];
      this.db.prepare("UPDATE snap_detections SET selected = 0 WHERE image_id = ?").run(id);
      for (const item of body.items) {
        if (item.detectionId && !known.has(item.detectionId)) throw new ValidationError("Unknown detection for this photo");
        const food = getFoodRow(this.db, item.foodId);
        if (!food) throw new NotFoundError(`Food ${item.foodId} not found`);
        resolveMeasure(this.db, food, item.measureId);
        const logId = insertLog(this.db, { date: body.date, mealType: body.mealType, foodId: item.foodId, measureId: item.measureId,
          quantity: item.quantity, source: "snap", snapImageId: id });
        if (item.detectionId) {
          this.db.prepare("UPDATE snap_detections SET selected = 1, matched_food_id = ?, est_measure_id = ?, est_quantity = ?, food_log_id = ? WHERE id = ?")
            .run(item.foodId, item.measureId, item.quantity, logId, item.detectionId);
        }
        out.push(logId);
      }
      this.db.prepare("UPDATE snap_images SET status = 'tracked', meal_type = ? WHERE id = ?").run(body.mealType, id);
      return out;
    });
    return logIds.map((lid) => getLog(this.db, lid));
  }

  /** Delete the photo and its detections. Logged foods stay in the diary. */
  remove(id: string) {
    const r = this.row(id);
    transaction(this.db, () => {
      this.db.prepare("UPDATE food_logs SET snap_image_id = NULL WHERE snap_image_id = ?").run(id);
      this.db.prepare("DELETE FROM snap_images WHERE id = ?").run(id);
    });
    rmSync(this.absPath(r.file_path), { force: true });
  }
}
