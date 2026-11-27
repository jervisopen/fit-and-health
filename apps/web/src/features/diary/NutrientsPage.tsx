import { useSearchParams } from "react-router";
import { NUTRIENTS, type NutrientKey } from "../../../../../packages/shared/src/nutrients.ts";
import { Card, ErrorNote, MacroBar, PageHeader, Spinner } from "../../components/ui.tsx";
import { isValidIso, relativeLabel, today } from "../../lib/dates.ts";
import { kcal, nutrientValue } from "../../lib/format.ts";
import { useDiary } from "../../lib/queries.ts";

const MACRO_COLORS: Partial<Record<NutrientKey, string>> = {
  protein_g: "var(--protein)", carbs_g: "var(--carbs)", fat_g: "var(--fat)", fibre_g: "var(--fibre)",
};

/** Every tracked nutrient for one day, all of them free to see. */
export function NutrientsPage() {
  const [params] = useSearchParams();
  const raw = params.get("date");
  const date = isValidIso(raw) ? raw : today();
  const { data, isLoading, error } = useDiary(date);

  return (
    <div className="min-h-full">
      <PageHeader title={`Nutrients · ${relativeLabel(date)}`} />
      <div className="mx-auto max-w-xl space-y-3 px-4 pb-8">
        {isLoading && <Spinner />}
        {error && <ErrorNote error={error} />}
        {data && (
          <>
            <Card className="space-y-3 p-4">
              <p className="flex items-baseline justify-between">
                <span className="font-semibold">Calories</span>
                <span className="num text-ink-2">{kcal(data.totals.energy_kcal)} / {kcal(data.goals.calories)} kcal</span>
              </p>
              {(["protein_g", "carbs_g", "fat_g", "fibre_g"] as const).map((k) => (
                <MacroBar key={k} label={NUTRIENTS.find((n) => n.key === k)!.label} value={data.totals[k] ?? 0}
                  goal={data.goals[k]} color={MACRO_COLORS[k]!} />
              ))}
            </Card>
            <Card>
              <h2 className="px-4 pt-3 text-sm font-semibold text-ink-2">Other nutrients</h2>
              <dl className="divide-y divide-line">
                {NUTRIENTS.filter((n) => !("macro" in n)).map((n) => (
                  <div key={n.key} className="flex justify-between px-4 py-2.5 text-sm">
                    <dt>{n.label}</dt>
                    <dd className="num text-ink-2">{nutrientValue(n.key, data.totals[n.key])}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <p className="px-1 text-xs text-ink-3">
              Totals only include foods whose source reports that nutrient, so micronutrients can read low.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
