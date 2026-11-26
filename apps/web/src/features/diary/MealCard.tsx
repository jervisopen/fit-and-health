import { Link } from "react-router";
import { Copy, Plus, TriangleAlert } from "lucide-react";
import type { FoodLogDTO, MealDTO } from "../../../../../packages/shared/src/api.ts";
import { Card, cx, IconButton } from "../../components/ui.tsx";
import { minutesToTime } from "../../lib/dates.ts";
import { kcal, portion } from "../../lib/format.ts";

export function MealCard({ meal, date, onOpenLog, onCopyPrevious }: {
  meal: MealDTO; date: string; onOpenLog: (log: FoodLogDTO) => void; onCopyPrevious: () => void;
}) {
  const eaten = meal.totals.energy_kcal ?? 0;
  const pct = meal.budgetKcal ? Math.min(eaten / meal.budgetKcal, 1) : 0;
  const over = meal.budgetKcal > 0 && eaten > meal.budgetKcal * 1.1;
  const addHref = `/add?meal=${meal.code}&date=${date}`;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{meal.name}</h2>
          <p className="text-xs text-ink-3">
            {minutesToTime(meal.timeMin)} · <span className={cx("num", over && "font-semibold text-over")}>{kcal(eaten)}</span>
            <span className="num"> / {kcal(meal.budgetKcal)} kcal</span>
          </p>
        </div>
        {meal.logs.length === 0 && (
          <IconButton label={`Copy ${meal.name} from the previous day`} onClick={onCopyPrevious}><Copy size={18} /></IconButton>
        )}
        <Link to={addHref} aria-label={`Add food to ${meal.name}`}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-food-soft text-food">
          <Plus size={22} strokeWidth={2.4} />
        </Link>
      </div>
      <div className="mx-4 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: over ? "var(--over)" : "var(--food)" }} />
      </div>

      {meal.logs.length > 0 ? (
        <ul className="mt-1 divide-y divide-line">
          {meal.logs.map((log) => (
            <li key={log.id}>
              <button type="button" onClick={() => onOpenLog(log)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{log.foodName}</p>
                  <p className="truncate text-xs text-ink-3">{portion(log.quantity, log.measureName, log.measureName === "g" ? undefined : log.weightG)}</p>
                </div>
                {log.dataQuality && <TriangleAlert size={16} className="shrink-0 text-warn" aria-label="Calories may be overstated" />}
                <span className="num shrink-0 font-semibold">{kcal(log.nutrients.energy_kcal)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Link to={addHref} className="block px-4 py-3 text-sm text-ink-3">Nothing logged yet. Tap + to add food.</Link>
      )}
    </Card>
  );
}
