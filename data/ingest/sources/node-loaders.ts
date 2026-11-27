/** Node host: read the downloaded datasets from data/raw (written by `npm run data:fetch`). */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import readXlsxFile from "read-excel-file/node";
import type { FoodRecord } from "../lib/types.ts";
import { ifctRecords } from "./ifct.ts";
import { indbRecords } from "./indb.ts";
import { offRecords, type OffProduct } from "./off.ts";

const RAW = path.resolve(import.meta.dirname, "..", "..", "raw");
export const IFCT_FILE = path.join(RAW, "ifct", "compositions.csv");
export const INDB_FILE = path.join(RAW, "indb", "Anuvaad_INDB_2024.11.xlsx");
export const OFF_FILE = path.join(RAW, "off", "india_products.json");
export const OFF_CACHE = path.join(RAW, "off", "cache.jsonl");

export function loadIfct(): FoodRecord[] {
  if (!existsSync(IFCT_FILE)) throw new Error(`Missing ${IFCT_FILE}. Run: npm run data:fetch -- ifct`);
  return ifctRecords(readFileSync(IFCT_FILE, "utf8"));
}

export async function loadIndb(): Promise<FoodRecord[]> {
  if (!existsSync(INDB_FILE)) throw new Error(`Missing ${INDB_FILE}. Run: npm run data:fetch -- indb`);
  return indbRecords(await readXlsxFile(INDB_FILE));
}

/** Products from the finished export, or from the resumable fetch cache if a fetch was interrupted. */
export function loadOff(): FoodRecord[] {
  let products: OffProduct[] = [];
  if (existsSync(OFF_FILE)) products = (JSON.parse(readFileSync(OFF_FILE, "utf8")) as { products: OffProduct[] }).products;
  else if (existsSync(OFF_CACHE)) {
    products = readFileSync(OFF_CACHE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as OffProduct);
  }
  return offRecords(products);
}
