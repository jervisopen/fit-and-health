import { Check, Flame, Trophy } from "lucide-react";
import {
  computeStreaks, FASTING_STAGES, fastedHoursByDay, type FastingLogDTO, type FastingPlanDTO,
} from "../../../../../packages/shared/src/fasting.ts";
import { addDaysIso, dateInZone, formatDuration, HOUR } from "../../../../../packages/shared/src/time.ts";
import { Card, cx } from "../../components/ui.tsx";
import { browserTimeZone, clockTime } from "./hooks.ts";

/** All stages, with the ones already reached in this fast ticked. */
export function StagesCard({ elapsedMs }: { elapsedMs: number | null }) {
  const hours = elapsedMs === null ? -1 : elapsedMs / HOUR;
  return (
    <Card className="p-4">
      <h2 className="font-semibold">Fasting stages</h2>
      <ol className="mt-3 space-y-3">
        {FASTING_STAGES.map((s, i) => {
          const next = FASTING_STAGES[i + 1];
          const reached = hours >= s.fromHours;
          const current = reached && (!next || hours < next.fromHours);
          return (
            <li key={s.key} className="flex gap-3">
              <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                current ? "bg-fast text-fast-ink" : reached ? "bg-fast-soft text-fast" : "bg-surface-2 text-ink-3")}>
                {reached && !current ? <Check size={14} /> : `${s.fromHours}h`}
              </span>
              <div className="min-w-0">
                <p className={cx("text-sm font-semibold", current && "text-fast")}>{s.name} <span className="font-normal text-ink-3">· {s.fromHours}h+</span></p>
                <p className="text-xs leading-relaxed text-ink-3">{s.description}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11px] text-ink-3">
        General information, not medical advice. Timings vary with your last meal, activity and metabolism.
        Check with a doctor before fasting if you're pregnant, diabetic, underweight or on medication.
      </p>
    </Card>
  );
}

export function StatsCard({ logs, plan }: { logs: FastingLogDTO[]; plan: FastingPlanDTO | null }) {
  const tz = plan?.timezone ?? browserTimeZone();
  const today = dateInZone(Date.now(), tz);
  const { current, longest } = computeStreaks(logs, tz, today);
  const week = logs.filter((l) => l.endedAt && l.endedAt > Date.now() - 7 * 24 * HOUR);
  const avg = week.length ? week.reduce((s, l) => s + (l.endedAt! - l.startedAt), 0) / week.length : 0;
  const met = logs.filter((l) => l.isGoalMet).length;

  const stats = [
    { icon: <Flame size={18} />, label: "Current streak", value: `${current} day${current === 1 ? "" : "s"}` },
    { icon: <Trophy size={18} />, label: "Longest streak", value: `${longest} day${longest === 1 ? "" : "s"}` },
    { label: "Avg fast (7 days)", value: avg ? formatDuration(avg) : "–" },
    { label: "Goals met", value: `${met}/${logs.length}` },
  ];
  return (
    <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface p-3.5">
          <p className="flex items-center gap-1.5 text-xs text-ink-3">{s.icon && <span className="text-food">{s.icon}</span>}{s.label}</p>
          <p className="num mt-0.5 text-xl font-bold">{s.value}</p>
        </div>
      ))}
    </Card>
  );
}

/** Hours fasted on each of the last 7 days against the plan's goal. */
export function WeekChart({ logs, plan }: { logs: FastingLogDTO[]; plan: FastingPlanDTO | null }) {
  const tz = plan?.timezone ?? browserTimeZone();
  const today = dateInZone(Date.now(), tz);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysIso(today, i - 6));
  const days = fastedHoursByDay(logs, tz, dates);
  const goal = plan?.fastingHours ?? 16;
  const max = Math.max(goal + 4, ...days.map((d) => d.hours));
  const H = 120;
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: "narrow", timeZone: "UTC" });

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Last 7 days</h2>
        <span className="text-xs text-ink-3">goal {goal} h</span>
      </div>
      <div className="relative mt-3" style={{ height: H }}>
        <div className="absolute inset-x-0 border-t border-dashed border-ink-3/60" style={{ bottom: (goal / max) * H }} aria-hidden="true" />
        <ol className="absolute inset-0 grid grid-cols-7 items-end gap-2">
          {days.map((d) => (
            <li key={d.date} className="flex h-full flex-col justify-end">
              <div title={`${d.date}: ${d.hours.toFixed(1)} h`} aria-label={`${d.date}: ${d.hours.toFixed(1)} hours`}
                className="rounded-t-md" style={{ height: Math.max((d.hours / max) * H, d.hours ? 4 : 0), background: d.goalMet ? "var(--fast)" : "var(--food)" }} />
            </li>
          ))}
        </ol>
      </div>
      <ol className="mt-1 grid grid-cols-7 gap-2 text-center text-[11px] text-ink-3">
        {days.map((d) => <li key={d.date} className={d.date === today ? "font-bold text-ink" : ""}>{fmt.format(new Date(`${d.date}T12:00:00Z`))}</li>)}
      </ol>
    </Card>
  );
}

export function HistoryList({ logs, onOpen }: { logs: FastingLogDTO[]; onOpen: (l: FastingLogDTO) => void }) {
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (!logs.length) return null;
  return (
    <Card>
      <h2 className="px-4 pt-3 font-semibold">History</h2>
      <ul className="mt-1 divide-y divide-line">
        {logs.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => onOpen(l)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
              <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                l.isGoalMet ? "bg-fast-soft text-fast" : "bg-food-soft text-food")}>
                {l.isGoalMet ? <Check size={16} /> : <span className="text-xs font-bold">!</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{dayFmt.format(l.endedAt!)}</span>
                <span className="block text-xs text-ink-3">
                  {clockTime(l.startedAt, l.endedAt!)} → {clockTime(l.endedAt!, l.endedAt!)}{l.origin === "auto" ? " · auto" : ""}
                </span>
              </span>
              <span className="num font-semibold">{formatDuration(l.endedAt! - l.startedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
