import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import type { FoodDetailDTO, MeasureDTO } from "../../../../../packages/shared/src/api.ts";
import { scaleNutrients } from "../../../../../packages/shared/src/nutrients.ts";
import { cx, Stepper } from "../../components/ui.tsx";
import { grams, kcal, quantity as fmtQty } from "../../lib/format.ts";

export type Portion = { measureId: string; quantity: number };

export function portionNutrients(food: FoodDetailDTO, p: Portion) {
  const m = food.measures.find((x) => x.id === p.measureId) ?? food.measures[0]!;
  const weightG = m.weightG * p.quantity;
  return { measure: m, weightG, nutrients: scaleNutrients(food.per100g, weightG) };
}

/** Starting portion for a food: last-used if given, else its default unit. */
export function initialPortion(food: FoodDetailDTO, last?: { measureId: string | null; quantity: number }): Portion {
  if (last?.measureId && food.measures.some((m) => m.id === last.measureId)) return { measureId: last.measureId, quantity: last.quantity };
  return { measureId: food.defaultMeasureId, quantity: food.defaultMeasureId === "gen:g" ? 100 : 1 };
}

const UNIT_PICKS = [0.5, 1, 1.5, 2, 3];
const GRAM_PICKS = [50, 100, 150, 200, 250];

/**
 * Unit chips + quantity stepper + live nutrition. Shared by the diary, add-food and Snap flows
 * (the reference app's FoodMeasureWeight picker).
 */
export function PortionEditor({ food, value, onChange }: { food: FoodDetailDTO; value: Portion; onChange: (p: Portion) => void }) {
  const { measure, weightG, nutrients } = useMemo(() => portionNutrients(food, value), [food, value]);
  const isGrams = measure.id === "gen:g";

  const pickUnit = (m: MeasureDTO) => {
    if (m.id === measure.id) return;
    // Switching to grams keeps the same amount; switching to a unit starts at 1.
    onChange({ measureId: m.id, quantity: m.id === "gen:g" ? Math.max(1, Math.round(weightG)) : 1 });
  };

  return (
    <div className="space-y-4">
      {food.dataQuality === "suspect_frying_oil" && (
        <p className="flex gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          <TriangleAlert size={18} className="mt-0.5 shrink-0" />
          <span>Calories are probably too high: the source recipe counts all the frying oil as eaten.</span>
        </p>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-ink-2" id="unit-label">Unit</p>
        <div role="radiogroup" aria-labelledby="unit-label" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {food.measures.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === measure.id} onClick={() => pickUnit(m)}
              className={cx("shrink-0 rounded-full border px-3.5 py-2 text-sm",
                m.id === measure.id ? "border-brand bg-brand-soft font-semibold text-brand" : "border-line text-ink-2")}>
              {m.name}
              {m.id !== "gen:g" && <span className="num ml-1 text-ink-3">{grams(m.weightG)} g{m.isEstimated ? "*" : ""}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper label="Quantity" value={value.quantity} min={isGrams ? 1 : 0.25} step={isGrams ? 10 : 0.5}
          onChange={(q) => onChange({ ...value, quantity: q })} />
        <div className="text-right">
          <p className="num text-3xl font-bold leading-none">{kcal(nutrients.energy_kcal)}</p>
          <p className="text-xs text-ink-3">kcal · {grams(weightG)} g</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(isGrams ? GRAM_PICKS : UNIT_PICKS).map((q) => (
          <button key={q} type="button" onClick={() => onChange({ ...value, quantity: q })}
            className={cx("num rounded-lg px-3 py-1.5 text-sm", value.quantity === q ? "bg-ink text-bg" : "bg-surface-2 text-ink-2")}>
            {isGrams ? `${q} g` : fmtQty(q)}
          </button>
        ))}
      </div>

      <dl className="grid grid-cols-4 gap-2 rounded-xl bg-surface-2 p-3 text-center">
        {([
          ["Protein", nutrients.protein_g, "var(--protein)"],
          ["Carbs", nutrients.carbs_g, "var(--carbs)"],
          ["Fat", nutrients.fat_g, "var(--fat)"],
          ["Fibre", nutrients.fibre_g, "var(--fibre)"],
        ] as const).map(([label, v, color]) => (
          <div key={label}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="num font-semibold" style={{ color }}>{v === undefined ? "–" : `${grams(v, v < 10 ? 1 : 0)} g`}</dd>
          </div>
        ))}
      </dl>
      {measure.isEstimated && measure.id !== "gen:g" && (
        <p className="text-xs text-ink-3">* Typical household weight, estimated. Use grams for precision.</p>
      )}
    </div>
  );
}
