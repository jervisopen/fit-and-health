import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Plus, SlidersHorizontal } from "lucide-react";
import type { TrackerDayDTO, TrackerHistoryDayDTO, TrackerKind } from "../../../../../packages/shared/src/trackers.ts";
import { GLUCOSE_BAND_LABEL, glucoseBand, glucoseIn, glucoseTagLabel, vitalBand, VITALS } from "../../../../../packages/shared/src/health.ts";
import { MEAL_TYPES } from "../../../../../packages/shared/src/meals.ts";
import { cx } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { addDays, shortDate, today } from "../../lib/dates.ts";
import { useInvalidateTrackers, useTrackerHistory } from "../../lib/queries.ts";
import { glassesOf, hoursMinutes, litres, TRACKER_META } from "./meta.tsx";
import { SleepSheet, WeightSheet, WorkoutSheet } from "./sheets.tsx";
import { DosesSheet, GlucoseSheet, StepsSheet, VitalSheet } from "./healthSheets.tsx";

type Tile = {
  kind: TrackerKind;
  value: ReactNode;
  unit?: string;
  detail: ReactNode;
  /** Bottom of the tile: a 7-day chart, dose dots or a status pill. */
  footer?: ReactNode;
  onAdd: () => void;
  addLabel: string;
};

/** Diary: one pastel tile per tracker with today's number, a one-line detail and the last 7 days. */
export function TrackersCard({ day }: { day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const [sheet, setSheet] = useState<TrackerKind | null>(null);
  // 30 days so a sparse weight line still has points; bars use the last 7.
  const history = useTrackerHistory(addDays(day.date, -29), day.date);
  const days = history.data ?? [];
  const week = days.slice(-7);
  const { settings: s } = day;

  const addGlass = async () => {
    const entry = await api.addWater({ date: day.date, ml: day.water.glassMl });
    await invalidate();
    toast(`${litres(day.water.ml + entry.ml)} of ${litres(day.water.goalMl)}`, {
      label: "Undo",
      run: () => void api.deleteWater(entry.id).then(invalidate),
    });
  };

  const tiles: Tile[] = [];
  if (s.water.enabled) tiles.push({
    kind: "water",
    value: litres(day.water.ml).replace(" L", ""), unit: "L",
    detail: <>{glassesOf(day.water.ml, day.water.glassMl)} of {glassesOf(day.water.goalMl, day.water.glassMl)} glasses</>,
    footer: <MiniBars days={week} pick={(d) => d.waterMl} goal={day.water.goalMl} kind="water" />,
    onAdd: () => void addGlass(), addLabel: `Add a glass of water (${day.water.glassMl} ml)`,
  });
  if (s.steps.enabled) tiles.push({
    kind: "steps",
    value: day.steps.steps !== null ? day.steps.steps.toLocaleString() : "–",
    detail: day.steps.steps !== null ? <>{day.steps.km} km · {day.steps.kcal} kcal</> : <>Goal {day.steps.goal.toLocaleString()}</>,
    footer: <MiniBars days={week} pick={(d) => d.steps} goal={day.steps.goal} kind="steps" />,
    onAdd: () => setSheet("steps"), addLabel: "Enter steps",
  });
  if (s.workout.enabled) tiles.push({
    kind: "workout",
    value: day.workout.minutes, unit: "min",
    detail: day.workout.kcal ? <>{day.workout.kcal} kcal · goal {day.workout.goalMin}</> : <>Goal {day.workout.goalMin} min</>,
    footer: <MiniBars days={week} pick={(d) => d.workoutMin} goal={day.workout.goalMin} kind="workout" />,
    onAdd: () => setSheet("workout"), addLabel: "Add workout",
  });
  if (s.sleep.enabled) {
    const e = day.sleep.entry;
    tiles.push({
      kind: "sleep",
      value: e ? hoursMinutes(e.minutes).replace(" m", "m").replace(" h", "h") : "–",
      detail: <>Goal {hoursMinutes(day.sleep.goalMin)}</>,
      footer: <MiniBars days={week} pick={(d) => d.sleepMin} goal={day.sleep.goalMin} kind="sleep" />,
      onAdd: () => setSheet("sleep"), addLabel: e ? "Edit sleep" : "Log sleep",
    });
  }
  if (s.weight.enabled) {
    const w = day.weight;
    const shown = w.today ?? w.latest;
    tiles.push({
      kind: "weight",
      value: shown ? shown.kg : "–", unit: shown ? "kg" : undefined,
      detail: !shown ? "Tap + to log"
        : w.today ? (w.healthy ? <>Healthy {w.healthy.minKg}–{w.healthy.maxKg} kg</> : "Today")
        : <>{shown.date === addDays(today(), -1) ? "Yesterday" : shortDate(shown.date)}</>,
      footer: <MiniLine days={days} />,
      onAdd: () => setSheet("weight"), addLabel: "Log weight",
    });
  }
  if (s.glucose.enabled) {
    const last = day.glucose.readings.at(-1);
    const meal = last?.mealType ? MEAL_TYPES.find((m) => m.code === last.mealType)?.name.toLowerCase() : null;
    const band = last ? glucoseBand(last.mgdl, last.tag) : null;
    tiles.push({
      kind: "glucose",
      value: last ? glucoseIn(last.mgdl, day.glucose.unit) : "–", unit: last ? day.glucose.unit : undefined,
      detail: !last ? "No readings today"
        : last.tag === "after_meal" && meal ? `After ${meal}` : last.tag === "before_meal" && meal ? `Before ${meal}` : glucoseTagLabel(last.tag),
      footer: band ? <Pill ok={band === "usual"}>{band === "usual" ? "Usual range" : GLUCOSE_BAND_LABEL[band].replace("Above the usual range", "Above usual")}</Pill> : null,
      onAdd: () => setSheet("glucose"), addLabel: "Add a glucose reading",
    });
  }
  if (s.medicine.enabled) {
    const md = day.medicine;
    tiles.push({
      kind: "medicine",
      value: md.scheduled ? `${md.taken}/${md.scheduled}` : md.doses.length || "–",
      detail: md.scheduled ? "doses taken" : md.doses.length ? "doses logged" : "Nothing due today",
      footer: md.scheduled ? <DoseDots statuses={md.doses.filter((d) => d.timeMin !== null).map((d) => d.status)} /> : null,
      onAdd: () => setSheet("medicine"), addLabel: "Today's medicines",
    });
  }
  for (const k of ["heart", "breathing"] as const) {
    if (!s[k].enabled) continue;
    const last = day[k].readings.at(-1);
    const band = last ? vitalBand(k, last.value, last.context) : null;
    tiles.push({
      kind: k,
      value: last ? last.value : "–", unit: last ? (k === "heart" ? "bpm" : "/min") : undefined,
      detail: last ? (last.context === "resting" ? "Resting" : last.context === "after_activity" ? "After activity" : "Other") : "No readings today",
      footer: band ? <Pill ok={band === "usual"}>{band === "usual" ? "Usual range" : band === "low" ? "Below usual" : "Above usual"}</Pill> : null,
      onAdd: () => setSheet(k), addLabel: `Add ${VITALS[k].title.toLowerCase()}`,
    });
  }

  return (
    <section aria-labelledby="trackers-heading">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 id="trackers-heading" className="text-base font-semibold">Trackers</h2>
        <Link to="/trackers" className="flex items-center gap-1 text-sm font-medium text-brand">
          <SlidersHorizontal size={15} /> Edit
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {tiles.map((t) => <TileView key={t.kind} tile={t} date={day.date} />)}
        <li>
          <Link to="/trackers"
            className="flex h-full min-h-[148px] flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-line p-4 text-sm font-medium text-ink-3">
            <Plus size={22} />
            {tiles.length ? "Track more" : "Turn on trackers"}
          </Link>
        </li>
      </ul>
      <WeightSheet open={sheet === "weight"} onClose={() => setSheet(null)} day={day} />
      <WorkoutSheet open={sheet === "workout"} onClose={() => setSheet(null)} day={day} />
      <SleepSheet open={sheet === "sleep"} onClose={() => setSheet(null)} day={day} />
      <StepsSheet open={sheet === "steps"} onClose={() => setSheet(null)} day={day} />
      <GlucoseSheet open={sheet === "glucose"} onClose={() => setSheet(null)} day={day} />
      <DosesSheet open={sheet === "medicine"} onClose={() => setSheet(null)} day={day} />
      <VitalSheet kind="heart" open={sheet === "heart"} onClose={() => setSheet(null)} day={day} />
      <VitalSheet kind="breathing" open={sheet === "breathing"} onClose={() => setSheet(null)} day={day} />
    </section>
  );
}

function TileView({ tile: t, date }: { tile: Tile; date: string }) {
  const m = TRACKER_META[t.kind];
  return (
    <li className={cx("relative flex min-h-[148px] flex-col rounded-3xl p-4", m.soft)}>
      {/* The whole tile opens the tracker; the + is a separate button on top of it. */}
      <Link to={`/trackers/${t.kind}?date=${date}`} className="absolute inset-0 rounded-3xl" aria-label={`${m.title}: open history`} />
      <span className={cx("pointer-events-none flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface/70", m.text)}>{m.icon(17)}</span>
      <span className="pointer-events-none mt-2 truncate text-sm font-medium text-ink-2">{m.title}</span>
      <button type="button" onClick={t.onAdd} aria-label={t.addLabel} title={t.addLabel}
        className={cx("absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-surface shadow-sm", m.text)}>
        <Plus size={18} strokeWidth={2.4} />
      </button>
      <p className="pointer-events-none mt-1.5 leading-none">
        <span className="num text-[26px] font-bold tracking-tight text-ink">{t.value}</span>
        {t.unit && <span className="ml-1 text-xs font-medium text-ink-2">{t.unit}</span>}
      </p>
      <p className="pointer-events-none mt-1 truncate text-xs text-ink-2">{t.detail}</p>
      <div className="pointer-events-none mt-auto pt-3">{t.footer}</div>
    </li>
  );
}

/** Seven thin bars; today's is solid, days that met the goal are stronger than the rest. */
function MiniBars({ days, pick, goal, kind }: { days: TrackerHistoryDayDTO[]; pick: (d: TrackerHistoryDayDTO) => number | null; goal: number; kind: TrackerKind }) {
  if (!days.length) return <div className="h-8" />;
  const vals = days.map((d) => pick(d) ?? 0);
  const max = Math.max(goal, ...vals, 1);
  const color = TRACKER_META[kind].color;
  return (
    <div className="flex h-8 items-end gap-1" aria-hidden="true">
      {vals.map((v, i) => (
        <span key={days[i]!.date} className="flex-1 rounded-full"
          style={{
            height: `${Math.max(v ? (v / max) * 100 : 0, 10)}%`,
            background: v ? color : "var(--surface)",
            opacity: v ? (i === vals.length - 1 ? 1 : v >= goal ? 0.85 : 0.45) : 0.7,
          }} />
      ))}
    </div>
  );
}

/** Weight over the last 30 days as a small line (nothing until there are two weigh-ins). */
function MiniLine({ days }: { days: TrackerHistoryDayDTO[] }) {
  const pts = days.map((d, i) => ({ i, v: d.weightKg })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (pts.length < 2) return <div className="h-8" />;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const span = Math.max(hi - lo, 0.5);
  const W = 100, H = 32;
  const x = (i: number) => (i / Math.max(days.length - 1, 1)) * W;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const last = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      <polyline fill="none" stroke="var(--weight)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
        points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill="var(--weight)" />
    </svg>
  );
}

function DoseDots({ statuses }: { statuses: ("pending" | "taken" | "skipped")[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden="true">
      {statuses.map((st, i) => (
        <span key={i} className={cx("h-3 w-3 rounded-full border-2 border-medicine", st === "taken" && "bg-medicine", st === "skipped" && "border-ink-3")} />
      ))}
    </div>
  );
}

function Pill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cx("inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", ok ? "bg-surface/80 text-brand" : "bg-warn-soft text-warn")}>
      {children}
    </span>
  );
}
