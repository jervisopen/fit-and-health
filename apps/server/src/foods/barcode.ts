/**
 * Barcode lookup: local database first, then Open Food Facts live (like HealthifyMe's
 * food_from_barcode). Found products are cached as `off:<barcode>` foods.
 */
import type { DatabaseSync } from "node:sqlite";
import type { FoodDetailDTO } from "../../../../packages/shared/src/api.ts";
import { offToRecord } from "../../../../data/ingest/sources/off.ts";
import { transaction } from "../db/index.ts";
import { findByBarcode, getFoodDetail, ValidationError } from "./repo.ts";
import { writeFoods } from "./write.ts";

export type OffFetcher = (code: string) => Promise<Record<string, unknown> | null>;

const FIELDS = "code,product_name,product_name_en,generic_name,brands,categories_tags,serving_size,serving_quantity,quantity,image_front_small_url,nutriments";
// Generic client id: no personal details are sent to Open Food Facts.
const USER_AGENT = "fit-and-health/0.1 (self-hosted, open-source)";

export const fetchFromOpenFoodFacts: OffFetcher = async (code) => {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${FIELDS}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts responded ${res.status}`);
  const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
  return body.status === 1 && body.product ? body.product : null;
};

export async function lookupBarcode(db: DatabaseSync, code: string, fetcher: OffFetcher = fetchFromOpenFoodFacts): Promise<FoodDetailDTO | null> {
  if (!/^\d{6,14}$/.test(code)) throw new ValidationError("Barcode must be 6–14 digits");
  const local = findByBarcode(db, code);
  if (local) return local;
  const product = await fetcher(code);
  if (!product) return null;
  const rec = offToRecord({ ...product, code } as Parameters<typeof offToRecord>[0], 0.5);
  if (!rec) return null; // missing or implausible nutrition data
  transaction(db, () => {
    db.prepare("DELETE FROM foods WHERE id = ?").run(rec.id);
    writeFoods(db, [rec]);
  });
  return getFoodDetail(db, rec.id);
}
