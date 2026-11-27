import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, Plus } from "lucide-react";
import type { TrackerDayDTO, TrackerKind } from "../../../../../packages/shared/src/trackers.ts";
import { Card, cx } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { addDays, shortDate, today } from "../../lib/dates.ts";
import { useInvalidateTrackers } from "../../lib/queries.ts";
import { glassesOf, hoursMinutes, litres, plural, TRACKER_META } from "./meta.tsx";
import { SleepSheet, WeightSheet, WorkoutSheet } from "./sheets.tsx";

/** Diary card: today's water, weight, workout and sleep, each one tap from logging. */
export function TrackersCard({ day }: { day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const [sheet, setSheet] = useState<TrackerKind | null>(null);
  const { settings: s } = day;

  const addGlass = async () => {
    const entry = await api.addWater({ date: day.date, ml: day.water.glassMl });
    await invalidate();
    const total = day.water.ml + entry.ml;
    toast(`${litres(total)} of ${litres(day.water.goalMl)}`, {
      label: "Undo",
      run: () => void api.deleteWater(entry.id).then(invalidate),
    });
  };

  const w = day.weight;
  const weightDetail = w.today ? `${w.today.kg} kg today`
    : w.latest ? `${w.latest.kg} kg · ${w.latest.date === addDays(today(), -1) ? "yesterday" : shortDate(w.latest.date)}` : "Not logged yet";
  const healthy = w.healthy ? `Healthy ${w.healthy.minKg}–${w.healthy.maxKg} kg` : null;

  const rows: { kind: TrackerKind; detail: ReactNode; progress?: number; onAdd: () => void; addLabel: string }[] = [];
  if (s.water.enabled) rows.push({
    kind: "water",
    detail: <>{glassesOf(day.water.ml, day.water.glassMl)} of {plural(glassesOf(day.water.goalMl, day.water.glassMl), "glass", "glasses")} · {litres(day.water.ml)}</>,
    progress: day.water.ml / day.water.goalMl,
    onAdd: () => void addGlass(),
    addLabel: `Add a glass of water (${day.water.glassMl} ml)`,
  });
  if (s.weight.enabled) rows.push({
    kind: "weight",
    detail: <>{weightDetail}{healthy && <span className="text-ink-3"> · {healthy}</span>}</>,
    onAdd: () => setSheet("weight"),
    addLabel: "Log weight",
  });
  if (s.workout.enabled) rows.push({
    kind: "workout",
    detail: <>{day.workout.minutes} of {day.workout.goalMin} min{day.workout.kcal ? ` · ${day.workout.kcal} kcal` : ""}</>,
    progress: day.workout.minutes / day.workout.goalMin,
    onAdd: () => setSheet("workout"),
    addLabel: "Add workout",
  });
  if (s.sleep.enabled) rows.push({
    kind: "sleep",
    detail: day.sleep.entry ? <>{hoursMinutes(day.sleep.entry.minutes)} of {hoursMinutes(day.sleep.goalMin)}</> : "Not logged",
    progress: day.sleep.entry ? day.sleep.entry.minutes / day.sleep.goalMin : 0,
    onAdd: () => setSheet("sleep"),
    addLabel: day.sleep.entry ? "Edit sleep" : "Log sleep",
  });

  return (
    <Card>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const m = TRACKER_META[r.kind];
          return (
            <li key={r.kind} className="flex items-center gap-3 px-4 py-3">
              <Link to={`/trackers/${r.kind}?date=${day.date}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", m.soft, m.text)}>{m.icon()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.title}</span>
                  <span className="block truncate text-xs text-ink-2">{r.detail}</span>
                  {r.progress !== undefined && (
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.progress * 100)}%`, background: m.color }} />
                    </span>
                  )}
                </span>
              </Link>
              <button type="button" onClick={r.onAdd} aria-label={r.addLabel} title={r.addLabel}
                className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line hover:bg-surface-2", m.text)}>
                <Plus size={20} />
              </button>
            </li>
          );
        })}
        <li>
          <Link to="/trackers" className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-brand">
            <span className="flex-1">{rows.length ? "Track more" : "Turn on trackers: water, weight, workout, sleep"}</span>
            <ChevronRight size={18} />
          </Link>
        </li>
      </ul>
      <WeightSheet open={sheet === "weight"} onClose={() => setSheet(null)} day={day} />
      <WorkoutSheet open={sheet === "workout"} onClose={() => setSheet(null)} day={day} />
      <SleepSheet open={sheet === "sleep"} onClose={() => setSheet(null)} day={day} />
    </Card>
  );
}
