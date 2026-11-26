/**
 * Try the food search from the terminal:
 *   npm run db:search -- "paneer butter"
 *   npm run db:search -- --meal B "poha"
 */
import { openDatabase } from "../../apps/server/src/db/index.ts";
import { searchFoods } from "../../apps/server/src/foods/search.ts";
import { isMealType } from "../../packages/shared/src/meals.ts";

const args = process.argv.slice(2);
let mealType;
const mi = args.indexOf("--meal");
if (mi >= 0) { const v = args[mi + 1]; if (isMealType(v)) mealType = v; args.splice(mi, 2); }
const q = args.join(" ");
if (!q) { console.log('Usage: npm run db:search -- [--meal B|SM|L|S|D] "query"'); process.exit(1); }

const db = openDatabase();
const t0 = performance.now();
const results = searchFoods(db, q, { limit: 12, mealType });
const ms = (performance.now() - t0).toFixed(1);
console.log(`"${q}"${mealType ? ` [${mealType}]` : ""} → ${results.length} results in ${ms} ms`);
for (const r of results) {
  const m = r.defaultMeasure;
  const serving = m && r.defaultQuantity === 1
    ? `1 ${m.name} (${m.weightG} g) = ${r.kcalPerDefault} kcal`
    : `100 g = ${r.kcalPer100g ?? "?"} kcal`;
  const via = r.matchedName !== r.name ? `  ← "${r.matchedName}"` : "";
  const flag = r.dataQuality ? `  ⚠ ${r.dataQuality}` : "";
  console.log(`  ${r.score.toFixed(2)}  [${r.source}] ${r.name}${r.brand ? ` · ${r.brand}` : ""}  —  ${serving}${via}${flag}`);
}
db.close();
