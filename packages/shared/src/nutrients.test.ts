import { test } from "node:test";
import assert from "node:assert/strict";
import { NUTRIENT_KEYS, nutrient, readMapped, scaleNutrients, type NutrientKey } from "./nutrients.ts";
import { closestMealType } from "./meals.ts";

test("IFCT mapping converts kJ → kcal and g → mg/µg", () => {
  // IFCT 2017 cow milk (L002) as packaged by nodef/ifct2017.
  const milk = { enerc: "305", protcnt: "3.26", ca: "0.118", vita: "0.00001367" };
  const get = (key: NutrientKey) => readMapped(milk, nutrient(key).ifct);
  assert.equal(Math.round(get("energy_kcal")!), 73);
  assert.equal(get("protein_g"), 3.26);
  assert.equal(Math.round(get("calcium_mg")!), 118);
  assert.equal(Math.round(get("vit_a_ug")!), 14);
});

test("INDB mapping sums vitamin D2 + D3 and converts SFA mg → g", () => {
  const row = { vitd2_ug: 0.5, vitd3_ug: 1.25, sfa_mg: 2500 };
  assert.equal(readMapped(row, nutrient("vit_d_ug").indb), 1.75);
  assert.equal(readMapped(row, nutrient("sat_fat_g").indb), 2.5);
});

test("readMapped ignores blanks and non-numbers, falls through to the next column", () => {
  const map = { cols: ["a", "b"], factor: 2 };
  assert.equal(readMapped({ a: "", b: "3" }, map), 6);
  assert.equal(readMapped({ a: "n/a" }, map), null);
  assert.equal(readMapped({}, undefined), null);
});

test("scaleNutrients scales per-100 g values to a portion", () => {
  const out = scaleNutrients({ energy_kcal: 203, protein_g: 7.85 }, 36);
  assert.equal(out.energy_kcal, 73.1);
  assert.equal(out.protein_g, 2.826);
  assert.equal(out.fat_g, undefined);
});

test("nutrient keys are unique", () => {
  assert.equal(new Set(NUTRIENT_KEYS).size, NUTRIENT_KEYS.length);
});

test("closestMealType picks the nearest slot", () => {
  assert.equal(closestMealType(7 * 60), "B");
  assert.equal(closestMealType(14 * 60), "L");
  assert.equal(closestMealType(22 * 60), "D");
});
