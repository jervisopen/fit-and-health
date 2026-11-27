import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./lib/csv.ts";
import { classifyDish, densityFor, isVegDish, pieceWeightsFor } from "./lib/classify.ts";
import "./lib/seeds-node.ts";
import { parseLocalNames } from "./sources/ifct.ts";
import { isSuspectFryingOil, nameVariants, servingWeightG, slashVariants } from "./sources/indb.ts";
import { loadIfct, loadIndb } from "./sources/node-loaders.ts";
import { offToRecord, parsePackGrams } from "./sources/off.ts";

const RAW = path.resolve(import.meta.dirname, "..", "raw");
const hasIfct = existsSync(path.join(RAW, "ifct", "compositions.csv"));
const hasIndb = existsSync(path.join(RAW, "indb", "Anuvaad_INDB_2024.11.xlsx"));

test("CSV parser handles quotes, embedded commas and CRLF", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n'), [["a", "b"], ["x, y", 'he said "hi"']]);
});

test("IFCT local names are split by language", () => {
  const names = parseLocalNames("B. Ata; H. Atta; Tam. Mulu Godumai maavu; Tel. Sampurna godhuma pindi.");
  assert.deepEqual(names.map((n) => [n.lang, n.name]), [
    ["bn", "Ata"], ["hi", "Atta"], ["ta", "Mulu Godumai maavu"], ["te", "Sampurna godhuma pindi"],
  ]);
});

test("INDB name variants: parentheses and slash alternatives", () => {
  assert.deepEqual(nameVariants("Hot tea (Garam Chai)").map((n) => n.name), ["Hot tea (Garam Chai)", "Hot tea", "Garam Chai"]);
  assert.deepEqual(slashVariants("Chapati/Roti"), ["Chapati", "Roti"]);
  assert.deepEqual(slashVariants("Mutton biryani/biriyani"), ["Mutton biryani", "Mutton biriyani"]);
  assert.deepEqual(slashVariants("Idli"), []);
});

test("INDB serving weight derives from per-serving ÷ per-100 g", () => {
  assert.equal(servingWeightG({ energy_kcal: 202.8, unit_serving_energy_kcal: 73.0 })?.toFixed(1), "36.0");
  // Falls back to another macro when energy is ~0 (e.g. black tea).
  assert.equal(servingWeightG({ energy_kcal: 0, carb_g: 10, unit_serving_carb_g: 25 }), 250);
  assert.equal(servingWeightG({}), null);
});

test("frying-oil flag catches deep-fried INDB outliers only", () => {
  assert.equal(isSuspectFryingOil({ energy_kcal: 738, fat_g: 60 }), true); // poori
  assert.equal(isSuspectFryingOil({ energy_kcal: 203, fat_g: 1 }), false); // chapati
  assert.equal(isSuspectFryingOil({ energy_kcal: 480, fat_g: 10 }), false); // sweet, carb-heavy
});

test("dish classifier, veg detection and densities", () => {
  assert.equal(classifyDish("Masala dosa"), "South Indian");
  assert.equal(classifyDish("Chicken biryani"), "Rice dishes");
  assert.equal(classifyDish("Hot tea (Garam Chai)"), "Beverages");
  assert.equal(isVegDish("Paneer butter masala"), true);
  assert.equal(isVegDish("Egg curry (Anda curry)"), false);
  assert.equal(densityFor("Dal makhani"), 1.0);
  assert.equal(densityFor("Coconut oil"), 0.92);
  assert.deepEqual(pieceWeightsFor("Egg, poultry, whole, boiled"), [{ unit: "piece", weightG: 50 }]);
});

test("Open Food Facts: pack sizes and impossible rows", () => {
  assert.equal(parsePackGrams("200 g"), 200);
  assert.equal(parsePackGrams("1 kg"), 1000);
  assert.equal(parsePackGrams("6 x 25 g"), 150);
  assert.equal(parsePackGrams("1.25 L"), 1250);
  assert.equal(parsePackGrams("family pack"), null);

  const ok = offToRecord({ code: "890123", product_name: "Biscuit", brands: "Acme",
    serving_quantity: 25, serving_size: "25 g", quantity: "200 g",
    nutriments: { "energy-kcal_100g": 480, proteins_100g: 7, carbohydrates_100g: 70, fat_100g: 19, salt_100g: 1 } }, 1)!;
  assert.equal(ok.id, "off:890123");
  assert.equal(ok.nutrients.sodium_mg, 400);
  assert.deepEqual(ok.measures.map((m) => [m.name, m.weightG]), [["serving", 25], ["pack", 200]]);
  assert.equal(offToRecord({ code: "1", product_name: "Bad", nutriments: { "energy-kcal_100g": 4000 } }, 1), null);
  // Biscuit typed in as 3 kcal/100 g: disagrees with 4·P + 4·C + 9·F ≈ 450.
  assert.equal(offToRecord({ code: "3", product_name: "Typo", nutriments: {
    "energy-kcal_100g": 3, proteins_100g: 7, carbohydrates_100g: 77, fat_100g: 12 } }, 1), null);
  // Black coffee: too little to compare, kept.
  assert.ok(offToRecord({ code: "4", product_name: "Coffee", nutriments: { "energy-kcal_100g": 2, proteins_100g: 0.1 } }, 1));
  assert.equal(offToRecord({ code: "2", product_name: "No energy", nutriments: {} }, 1), null);
});

test("IFCT dataset loads with correct units", { skip: !hasIfct && "run npm run data:fetch first" }, () => {
  const foods = loadIfct();
  assert.equal(foods.length, 542);
  const milk = foods.find((f) => f.id === "ifct:L002")!;
  assert.equal(Math.round(milk.nutrients.energy_kcal!), 73);
  assert.equal(Math.round(milk.nutrients.calcium_mg!), 118);
  const atta = foods.find((f) => f.id === "ifct:A019")!;
  assert.ok(atta.names.some((n) => n.lang === "hi" && n.name === "Atta"));
});

test("INDB dataset loads with real household servings", { skip: !hasIndb && "run npm run data:fetch first" }, async () => {
  const foods = await loadIndb();
  assert.equal(foods.length, 1014);
  const roti = foods.find((f) => f.name === "Chapati/Roti")!;
  assert.equal(roti.measures[0]?.name, "chapati");
  assert.ok(Math.abs(roti.measures[0]!.weightG - 36) < 1);
  const idli = foods.find((f) => f.name === "Idli")!;
  assert.equal(idli.measures[0]?.name, "idli");
});
