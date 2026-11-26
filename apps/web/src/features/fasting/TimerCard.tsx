import { FASTING_STAGES, stageAt, type FastingStatusDTO } from "../../../../../packages/shared/src/fasting.ts";
import { formatClock, formatDuration, HOUR } from "../../../../../packages/shared/src/time.ts";
import { Button, Card } from "../../components/ui.tsx";
import { clockTime } from "./hooks.ts";

const SIZE = 248;
const STROKE = 16;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

function point(fraction: number) {
  const a = fraction * 2 * Math.PI - Math.PI / 2;
  return { x: SIZE / 2 + R * Math.cos(a), y: SIZE / 2 + R * Math.sin(a) };
}

/** The big ring: fasting progress toward the goal with stage markers, or the eating window. */
export function TimerCard({ status, now, onStart, onEnd }: {
  status: FastingStatusDTO; now: number; onStart: () => void; onEnd: () => void;
}) {
  const fast = status.fast;
  const fasting = status.state === "fasting" && fast;

  let fraction = 0;
  let color = "var(--food)";
  let label: string;
  let big: string;
  let sub: string;

  if (fasting) {
    const elapsed = now - fast.startedAt;
    const target = fast.targetEndAt - fast.startedAt;
    fraction = Math.min(elapsed / target, 1);
    color = "var(--fast)";
    label = elapsed >= target ? "Goal reached 🎉" : "You're fasting";
    big = formatClock(elapsed);
    sub = elapsed >= target ? `+${formatDuration(elapsed - target)} past your goal` : `${formatDuration(target - elapsed)} left · ends ${clockTime(fast.targetEndAt, now)}`;
  } else {
    const since = status.eating?.since ?? null;
    const next = status.eating?.nextFastAt ?? null;
    label = status.state === "idle" ? "Ready when you are" : "Eating window";
    if (next && since) {
      fraction = Math.min(Math.max((now - since) / (next - since), 0), 1);
    } else if (since && status.plan) {
      fraction = Math.min((now - since) / (status.plan.eatingHours * HOUR), 1);
    }
    big = next ? formatClock(Math.max(next - now, 0)) : since ? formatDuration(now - since) : "--:--";
    sub = next ? `until your fast starts at ${clockTime(next, now)}` : since ? "since your last fast" : "Start a fast whenever you like";
  }

  const stageMarks = fasting
    ? FASTING_STAGES.filter((s) => s.fromHours > 0 && s.fromHours * HOUR < fast.targetEndAt - fast.startedAt)
        .map((s) => ({ ...s, ...point((s.fromHours * HOUR) / (fast.targetEndAt - fast.startedAt)) }))
    : [];
  const stage = fasting ? stageAt(now - fast.startedAt) : null;

  return (
    <Card className="flex flex-col items-center p-5">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} aria-hidden="true">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: "stroke-dashoffset 900ms linear" }} />
          {stageMarks.map((m) => (
            <circle key={m.key} cx={m.x} cy={m.y} r={4} fill="var(--surface)" stroke={color} strokeWidth={2} />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center" aria-live="off">
          <span className="text-sm font-semibold" style={{ color }}>{label}</span>
          <span className="num mt-1 text-4xl font-bold tracking-tight">{big}</span>
          <span className="mt-1 text-xs leading-snug text-ink-3">{sub}</span>
        </div>
      </div>

      {fasting && stage && (
        <p className="mt-3 text-center text-sm">
          <span className="font-semibold text-fast">{stage.current.name}</span>
          {stage.next && <span className="text-ink-3"> · {stage.next.name} in {formatDuration(stage.msToNext!)}</span>}
        </p>
      )}
      {fasting && (
        <p className="mt-1 text-xs text-ink-3">
          Started {clockTime(fast.startedAt, now)}{fast.origin === "auto" ? " · auto-tracked from your schedule" : ""}
        </p>
      )}

      <div className="mt-4 w-full">
        {fasting
          ? <Button block variant="secondary" onClick={onEnd}>End fast</Button>
          : <Button block onClick={onStart} className="bg-fast text-fast-ink">{status.eating?.nextFastAt ? "Start fast early" : "Start fast"}</Button>}
      </div>
    </Card>
  );
}
