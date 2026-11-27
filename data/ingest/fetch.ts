/**
 * Download the open food datasets into data/raw/ (gitignored).
 * The repository ships no third-party data; every install fetches its own copy.
 *
 *   npm run data:fetch            # all sources
 *   npm run data:fetch -- indb    # one source: indb | ifct | off
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const RAW_DIR = path.resolve(import.meta.dirname, "..", "raw");
const MANIFEST = path.join(RAW_DIR, "manifest.json");
// Generic client id on purpose: no personal contact details are sent to third parties.
const USER_AGENT = "fit-and-health-data-fetch/0.1 (self-hosted, open-source)";

type ManifestEntry = { url: string; sha256: string; bytes: number; fetchedAt: string; license: string };
type Manifest = Record<string, ManifestEntry>;

const FILES: Record<string, { file: string; url: string; license: string }[]> = {
  indb: [
    {
      file: "indb/Anuvaad_INDB_2024.11.xlsx",
      url: "https://www.anuvaad.org.in/wp-content/uploads/2020/07/Anuvaad_INDB_2024.11.xlsx",
      license: "Anuvaad INDB, open access, no explicit licence. Cite Vijayakumar et al. 2024, Curr Dev Nutr.",
    },
    {
      file: "indb/recipes_servingsize.xlsx",
      url: "https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/recipes_servingsize.xlsx",
      license: "INDB GitHub, no explicit licence",
    },
    {
      file: "indb/Units.xlsx",
      url: "https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/Units.xlsx",
      license: "INDB GitHub, no explicit licence",
    },
  ],
  ifct: [
    {
      file: "ifct/compositions.csv",
      url: "https://raw.githubusercontent.com/nodef/ifct2017/main/compositions/index.csv",
      license: "IFCT 2017 (c) ICMR-NIN; machine-readable packaging by nodef/ifct2017, AGPL-3.0-or-later",
    },
    {
      file: "ifct/columns.csv",
      url: "https://raw.githubusercontent.com/nodef/ifct2017/main/columns/index.csv",
      license: "IFCT 2017 (c) ICMR-NIN; packaging AGPL-3.0-or-later",
    },
  ],
};

// Only the Open Food Facts nutriment keys we map (per 100 g).
const OFF_NUTRIMENTS = [
  "energy-kcal_100g", "energy_100g", "proteins_100g", "fat_100g", "carbohydrates_100g",
  "fiber_100g", "sugars_100g", "saturated-fat_100g", "trans-fat_100g", "cholesterol_100g",
  "sodium_100g", "salt_100g", "potassium_100g", "calcium_100g", "iron_100g", "magnesium_100g",
  "zinc_100g", "vitamin-a_100g", "vitamin-c_100g", "vitamin-d_100g", "vitamin-b6_100g",
  "vitamin-b12_100g", "folates_100g", "beta-carotene_100g", "omega-3-fat_100g", "omega-6-fat_100g",
];
const OFF_FIELDS = [
  "code", "product_name", "product_name_en", "generic_name", "brands", "categories_tags",
  "serving_size", "serving_quantity", "quantity", "image_front_small_url", "nutriments",
];

async function loadManifest(): Promise<Manifest> {
  if (!existsSync(MANIFEST)) return {};
  return JSON.parse(await readFile(MANIFEST, "utf8")) as Manifest;
}

async function saveBytes(manifest: Manifest, rel: string, url: string, license: string, bytes: Uint8Array) {
  const dest = path.join(RAW_DIR, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  manifest[rel] = { url, sha256, bytes: bytes.byteLength, fetchedAt: new Date().toISOString(), license };
  console.log(`  ✓ ${rel}  ${(bytes.byteLength / 1024).toFixed(0)} KB  sha256:${sha256.slice(0, 12)}…`);
}

async function get(url: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (res.ok) return res;
  if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
    const wait = 10_000 * attempt;
    console.log(`  … HTTP ${res.status}, retrying in ${wait / 1000}s`);
    await sleep(wait);
    return get(url, attempt + 1);
  }
  throw new Error(`GET ${url} → HTTP ${res.status}`);
}

async function fetchFiles(manifest: Manifest, source: string) {
  for (const f of FILES[source] ?? []) {
    const res = await get(f.url);
    await saveBytes(manifest, f.file, f.url, f.license, new Uint8Array(await res.arrayBuffer()));
  }
}

type OffProduct = Record<string, unknown> & { nutriments?: Record<string, unknown> };

/**
 * Open Food Facts, India subset.
 * The classic search API sheds load (HTTP 503) and caps pages at 100, so:
 *  1. list barcodes via the search-a-licious service, most-scanned first;
 *  2. fetch each product's nutriments from the product API (rate limit 100/min),
 *     caching every product so an interrupted run resumes where it stopped.
 * Indian GS1 barcodes (890…) are taken first; the long tail is served at runtime by barcode lookup.
 */
const OFF_INDIAN_LIMIT = 2000;
const OFF_GLOBAL_LIMIT = 500;

async function listOffBarcodes(): Promise<string[]> {
  const q = 'countries:"en:india" AND states:"en:nutrition-facts-completed"';
  const codes: string[] = [];
  for (let page = 1; page <= 100; page++) {
    const params = new URLSearchParams({ q, page: String(page), page_size: "100", sort_by: "-unique_scans_n", fields: "code" });
    const body = (await (await get(`https://search.openfoodfacts.org/search?${params}`)).json()) as {
      hits: { code: string }[]; page_count: number;
    };
    codes.push(...body.hits.map((h) => h.code));
    if (page >= body.page_count) break;
    if (page % 10 === 0) console.log(`  · listed ${codes.length} barcodes`);
    await sleep(1_000);
  }
  const indian = codes.filter((c) => c.startsWith("890")).slice(0, OFF_INDIAN_LIMIT);
  const global = codes.filter((c) => !c.startsWith("890")).slice(0, OFF_GLOBAL_LIMIT);
  console.log(`  · ${codes.length} listed → ${indian.length} Indian (890…) + ${global.length} others`);
  return [...new Set([...indian, ...global])];
}

async function fetchOpenFoodFacts(manifest: Manifest) {
  const cacheFile = path.join(RAW_DIR, "off", "cache.jsonl");
  await mkdir(path.dirname(cacheFile), { recursive: true });
  const cached = new Map<string, OffProduct>();
  if (existsSync(cacheFile)) {
    for (const line of (await readFile(cacheFile, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const p = JSON.parse(line) as OffProduct;
      cached.set(String(p.code), p);
    }
  }
  const codes = await listOffBarcodes();
  const todo = codes.filter((c) => !cached.has(c));
  console.log(`  · ${cached.size} cached, ${todo.length} to fetch (~${Math.ceil((todo.length * 0.7) / 60)} min)`);
  const fields = OFF_FIELDS.join(",");
  let n = 0;
  for (const code of todo) {
    try {
      const body = (await (await get(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${fields}`)).json()) as {
        product?: OffProduct;
      };
      const p = body.product ?? { code };
      const src = p.nutriments ?? {};
      const kept: Record<string, unknown> = {};
      for (const k of OFF_NUTRIMENTS) if (src[k] !== undefined && src[k] !== "") kept[k] = src[k];
      const slim = { ...p, code, nutriments: kept };
      cached.set(code, slim);
      await writeFile(cacheFile, JSON.stringify(slim) + "\n", { flag: "a" });
    } catch (e) {
      console.log(`  ! ${code}: ${(e as Error).message}`);
    }
    if (++n % 100 === 0) console.log(`  · fetched ${n}/${todo.length}`);
    await sleep(650); // stays under 100 product reads per minute
  }
  const products = codes.map((c) => cached.get(c)).filter((p): p is OffProduct => Boolean(p));
  const json = new TextEncoder().encode(JSON.stringify({ source: "search.openfoodfacts.org + api/v2/product", products }));
  await saveBytes(manifest, "off/india_products.json", "https://world.openfoodfacts.org/api/v2/product/{code}",
    "Open Food Facts, ODbL 1.0 (database) / DbCL (contents)", json);
}

async function main() {
  const wanted = process.argv.slice(2);
  const sources = wanted.length ? wanted : ["indb", "ifct", "off"];
  await mkdir(RAW_DIR, { recursive: true });
  const manifest = await loadManifest();
  for (const s of sources) {
    console.log(`Fetching ${s}…`);
    if (s === "off") await fetchOpenFoodFacts(manifest);
    else if (FILES[s]) await fetchFiles(manifest, s);
    else throw new Error(`Unknown source "${s}" (expected indb | ifct | off)`);
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  }
  console.log(`Done. Manifest: ${path.relative(process.cwd(), MANIFEST)}`);
}

await main();
