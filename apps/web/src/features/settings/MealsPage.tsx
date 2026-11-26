import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { MealSettingDTO } from "../../../../../packages/shared/src/api.ts";
import { MEAL_TYPES } from "../../../../../packages/shared/src/meals.ts";
import { Button, Card, cx, ErrorNote, PageHeader, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { parseTimeInput, timeInputValue, today } from "../../lib/dates.ts";
import { kcal } from "../../lib/format.ts";
import { useInvalidateSettings, useSettings } from "../../lib/queries.ts";

/** Which meals you eat, when, and how the day's calories are split (≈ UserMealPreferences). */
export function MealsPage() {
  const settings = useSettings(today());
  const invalidate = useInvalidateSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const [meals, setMeals] = useState<MealSettingDTO[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { if (settings.data) setMeals(settings.data.meals); }, [settings.data]);
  if (!settings.data || !meals) return <><PageHeader title="Meals" /><Spinner /></>;

  const goal = settings.data.goals.calories;
  const total = meals.filter((m) => m.enabled).reduce((s, m) => s + m.caloriesPct, 0);
  const ok = Math.abs(total - 100) <= 0.5 && meals.some((m) => m.enabled);
  const set = (code: string, patch: Partial<MealSettingDTO>) => setMeals(meals.map((m) => (m.code === code ? { ...m, ...patch } : m)));

  /** Spread 100 % over the enabled meals, keeping their current proportions. */
  const balance = () => {
    const enabled = meals.filter((m) => m.enabled);
    const sum = enabled.reduce((s, m) => s + (m.caloriesPct || 1), 0);
    const next = meals.map((m) => (m.enabled ? { ...m, caloriesPct: Math.round(((m.caloriesPct || 1) / sum) * 100) } : m));
    const drift = 100 - next.filter((m) => m.enabled).reduce((s, m) => s + m.caloriesPct, 0);
    const biggest = next.filter((m) => m.enabled).sort((a, b) => b.caloriesPct - a.caloriesPct)[0];
    if (biggest) biggest.caloriesPct += drift;
    setMeals([...next]);
  };

  const reset = () => setMeals(MEAL_TYPES.map((m) => ({ code: m.code, displayName: m.name, timeMin: m.defaultTimeMin, enabled: true, caloriesPct: m.defaultPct })));

  const save = async () => {
    setError(null);
    try {
      await api.saveMeals(meals, today());
      await invalidate();
      toast("Meals saved");
      navigate(-1);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="min-h-full">
      <PageHeader title="Meals" right={<button type="button" onClick={reset} className="px-3 text-sm font-semibold text-brand">Reset</button>} />
      <div className="mx-auto max-w-xl space-y-3 px-4 pb-10">
        <Card>
          <ul className="divide-y divide-line">
            {meals.map((m) => (
              <li key={m.code} className={cx("space-y-2 px-4 py-3", !m.enabled && "opacity-60")}>
                <div className="flex items-center gap-3">
                  <input aria-label={`${m.displayName} name`} value={m.displayName} onChange={(e) => set(m.code, { displayName: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent font-medium outline-none" />
                  <label className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" aria-label={`Track ${m.displayName}`} checked={m.enabled} onChange={(e) => set(m.code, { enabled: e.target.checked })}
                      className="h-5 w-5 accent-[var(--brand)]" />
                    On
                  </label>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <input type="time" aria-label={`${m.displayName} time`} value={timeInputValue(m.timeMin)} disabled={!m.enabled}
                    onChange={(e) => e.target.value && set(m.code, { timeMin: parseTimeInput(e.target.value) })}
                    className="h-10 rounded-lg border border-line bg-surface px-2" />
                  <span className="flex items-center gap-1">
                    <input inputMode="numeric" aria-label={`${m.displayName} share of calories`} disabled={!m.enabled}
                      value={m.enabled ? m.caloriesPct : 0}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set(m.code, { caloriesPct: v }); }}
                      className="num h-10 w-14 rounded-lg border border-line bg-surface text-center" />
                    %
                  </span>
                  <span className="num ml-auto text-ink-3">{m.enabled ? `${kcal((goal * m.caloriesPct) / 100)} kcal` : "off"}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="flex items-center justify-between px-1 text-sm">
          <span className={cx("num", ok ? "text-ink-3" : "font-semibold text-over")}>Total {Math.round(total * 10) / 10}% {ok ? "" : "(needs 100%)"}</span>
          {!ok && <button type="button" onClick={balance} className="font-semibold text-brand">Balance to 100%</button>}
        </div>
        {error ? <ErrorNote error={error} /> : null}
        <Button block onClick={save} disabled={!ok}>Save meals (from today)</Button>
      </div>
    </div>
  );
}
