import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import type { DiaryDayDTO } from "../../../../../packages/shared/src/api.ts";
import { Card, MacroBar, Ring } from "../../components/ui.tsx";
import { kcal } from "../../lib/format.ts";

/** `exerciseKcal`: workout calories added to the budget (only when that's switched on). */
export function SummaryCard({ day, exerciseKcal = 0 }: { day: DiaryDayDTO; exerciseKcal?: number }) {
  const eaten = day.totals.energy_kcal ?? 0;
  const goal = day.goals.calories + exerciseKcal;
  const left = goal - eaten;
  // Smallest phones (under 360px wide): a smaller ring leaves room for the numbers beside it.
  const narrow = useNarrow();
  return (
    <Card className="p-4 min-[360px]:p-5">
      <div className="flex items-center gap-4 min-[360px]:gap-5">
        <Ring value={eaten} max={goal} size={narrow ? 112 : 144} stroke={narrow ? 11 : 14}>
          <span className={`num font-bold leading-none tracking-tight ${narrow ? "text-[22px]" : "text-[28px]"}`}>{kcal(Math.abs(left))}</span>
          <span className="mt-1 text-xs text-ink-3">{left >= 0 ? "kcal left" : "kcal over"}</span>
        </Ring>
        <dl className="grid min-w-0 flex-1 grid-cols-1 gap-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-ink-3">Eaten</dt><dd className="num font-semibold">{kcal(eaten)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink-3">Goal</dt><dd className="num font-semibold">{kcal(day.goals.calories)}</dd></div>
          {exerciseKcal > 0 && (
            <div className="flex justify-between gap-3"><dt className="text-ink-3">Exercise</dt><dd className="num font-semibold text-workout">+{kcal(exerciseKcal)}</dd></div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">{left >= 0 ? "Remaining" : "Over"}</dt>
            <dd className={left >= 0 ? "num font-semibold text-brand" : "num font-semibold text-over"}>{kcal(Math.abs(left))}</dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <MacroBar label="Protein" value={day.totals.protein_g ?? 0} goal={day.goals.protein_g} color="var(--protein)" />
        <MacroBar label="Carbs" value={day.totals.carbs_g ?? 0} goal={day.goals.carbs_g} color="var(--carbs)" />
        <MacroBar label="Fat" value={day.totals.fat_g ?? 0} goal={day.goals.fat_g} color="var(--fat)" />
        <MacroBar label="Fibre" value={day.totals.fibre_g ?? 0} goal={day.goals.fibre_g} color="var(--fibre)" />
      </div>
      <Link to={`/nutrients?date=${day.date}`} className="mt-3 -mb-1 flex items-center justify-end gap-0.5 text-sm font-medium text-brand">
        All nutrients <ChevronRight size={16} />
      </Link>
    </Card>
  );
}

function useNarrow() {
  const query = "(max-width: 359px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
