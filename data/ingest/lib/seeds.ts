/**
 * Our own seed tables (data/seeds). Each host registers how to read them:
 * Node reads the files (seeds-node.ts); the browser bundles them as text.
 */
import { csvObjects } from "./csv.ts";
import type { StaplesFile } from "../sources/usda.ts";

export type SeedName = "generic_units" | "densities" | "piece_weights" | "synonyms";
export type SeedFile = `${SeedName}.csv` | "staples.json";

let loader: ((file: SeedFile) => string) | null = null;
const cache = new Map<SeedName, Record<string, string>[]>();
let staples: StaplesFile | null = null;

export function setSeedLoader(fn: (file: SeedFile) => string) {
  loader = fn;
  cache.clear();
  staples = null;
}

function load(file: SeedFile): string {
  if (!loader) throw new Error("Seed tables are not available: call setSeedLoader() first");
  return loader(file);
}

export function seedRows(name: SeedName): Record<string, string>[] {
  let rows = cache.get(name);
  if (!rows) {
    rows = csvObjects(load(`${name}.csv`));
    cache.set(name, rows);
  }
  return rows;
}

/** Everyday Indian staples with USDA values (made by data/ingest/usda/convert.py). */
export function staplesSeed(): StaplesFile {
  return (staples ??= JSON.parse(load("staples.json")) as StaplesFile);
}
