/** Node host: read seed tables from data/seeds. Import this once for its side effect. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { setSeedLoader } from "./seeds.ts";

const SEEDS = path.resolve(import.meta.dirname, "..", "..", "seeds");
setSeedLoader((name) => readFileSync(path.join(SEEDS, `${name}.csv`), "utf8"));
