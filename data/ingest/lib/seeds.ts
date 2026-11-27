/**
 * Our own seed tables (data/seeds/*.csv). Each host registers how to read them:
 * Node reads the files (seeds-node.ts); the browser bundles them as text.
 */
import { csvObjects } from "./csv.ts";

export type SeedName = "generic_units" | "densities" | "piece_weights" | "synonyms";

let loader: ((name: SeedName) => string) | null = null;
const cache = new Map<SeedName, Record<string, string>[]>();

export function setSeedLoader(fn: (name: SeedName) => string) {
  loader = fn;
  cache.clear();
}

export function seedRows(name: SeedName): Record<string, string>[] {
  let rows = cache.get(name);
  if (!rows) {
    if (!loader) throw new Error("Seed tables are not available: call setSeedLoader() first");
    rows = csvObjects(loader(name));
    cache.set(name, rows);
  }
  return rows;
}
