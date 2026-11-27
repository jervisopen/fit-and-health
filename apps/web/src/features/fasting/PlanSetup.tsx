import { useState } from "react";
import { FASTING_PRESETS, type FastingMode, type FastingPlanDTO } from "../../../../../packages/shared/src/fasting.ts";
import { Button, cx, ErrorNote } from "../../components/ui.tsx";
import { minutesToTime, parseTimeInput, timeInputValue } from "../../lib/dates.ts";
import { api } from "../../lib/api.ts";
import { browserTimeZone, useFastingMutation } from "./hooks.ts";

type Draft = { presetKey: string; fastingHours: number; mode: FastingMode; startsAtMin: number };

function initial(plan: FastingPlanDTO | null): Draft {
  if (plan) return { presetKey: plan.presetKey, fastingHours: plan.fastingHours, mode: plan.mode, startsAtMin: plan.startsAtMin ?? 20 * 60 };
  return { presetKey: "16:8", fastingHours: 16, mode: "schedule", startsAtMin: 20 * 60 };
}

/** Pick a preset (or custom hours), schedule vs. stopwatch, and the daily start time. */
export function PlanSetup({ plan, onSaved }: { plan: FastingPlanDTO | null; onSaved?: () => void }) {
  const [d, setD] = useState<Draft>(() => initial(plan));
  const save = useFastingMutation(() => api.setFastingPlan({
    presetKey: d.presetKey, mode: d.mode, fastingHours: d.fastingHours,
    startsAtMin: d.mode === "schedule" ? d.startsAtMin : null, timezone: browserTimeZone(),
  }));
  const eatStart = (d.startsAtMin + d.fastingHours * 60) % 1440;

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium text-ink-2" id="preset-label">Plan</p>
        <div role="radiogroup" aria-labelledby="preset-label" className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3">
          {FASTING_PRESETS.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={d.presetKey === p.key}
              onClick={() => setD({ ...d, presetKey: p.key, fastingHours: p.fastingHours, startsAtMin: plan?.presetKey === p.key ? d.startsAtMin : p.startsAtMin })}
              className={cx("rounded-xl border p-2.5 text-left", d.presetKey === p.key ? "border-fast bg-fast-soft" : "border-line")}>
              <span className={cx("block text-lg font-bold", d.presetKey === p.key && "text-fast")}>{p.name}</span>
              <span className="block text-[11px] leading-tight text-ink-3">{p.level}</span>
            </button>
          ))}
        </div>
        <button type="button" role="radio" aria-checked={d.presetKey === "custom"}
          onClick={() => setD({ ...d, presetKey: "custom" })}
          className={cx("mt-2 w-full rounded-xl border px-3 py-2.5 text-left text-sm", d.presetKey === "custom" ? "border-fast bg-fast-soft font-semibold text-fast" : "border-line text-ink-2")}>
          Custom length
        </button>
        {d.presetKey === "custom" ? (
          <label className="mt-3 block">
            <span className="flex justify-between text-sm"><span className="text-ink-2">Fast length</span><b className="num">{d.fastingHours} h</b></span>
            <input type="range" min={10} max={d.mode === "manual" ? 48 : 23} step={1} value={d.fastingHours}
              onChange={(e) => setD({ ...d, fastingHours: Number(e.target.value) })} className="mt-2 w-full accent-[var(--fast)]" />
          </label>
        ) : (
          <p className="mt-2 text-sm text-ink-3">{FASTING_PRESETS.find((p) => p.key === d.presetKey)?.description}</p>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-ink-2" id="mode-label">How to track</p>
        <div role="radiogroup" aria-labelledby="mode-label" className="grid grid-cols-2 gap-2">
          {([["schedule", "Daily schedule", "Auto-tracks the same window every day"], ["manual", "Start & stop", "A timer you start and end yourself"]] as const).map(([m, t, sub]) => (
            <button key={m} type="button" role="radio" aria-checked={d.mode === m}
              onClick={() => setD({ ...d, mode: m, fastingHours: m === "schedule" ? Math.min(d.fastingHours, 23) : d.fastingHours })}
              className={cx("rounded-xl border p-3 text-left", d.mode === m ? "border-fast bg-fast-soft" : "border-line")}>
              <span className={cx("block font-semibold", d.mode === m && "text-fast")}>{t}</span>
              <span className="block text-xs text-ink-3">{sub}</span>
            </button>
          ))}
        </div>
      </div>

      {d.mode === "schedule" && (
        <div className="rounded-xl bg-surface-2 p-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Fast starts at</span>
            <input type="time" value={timeInputValue(d.startsAtMin)} onChange={(e) => e.target.value && setD({ ...d, startsAtMin: parseTimeInput(e.target.value) })}
              className="h-10 rounded-lg border border-line bg-surface px-2" />
          </label>
          <p className="mt-2 text-sm text-ink-2">
            Fast {minutesToTime(d.startsAtMin)} → {minutesToTime(eatStart)} · eat {minutesToTime(eatStart)} – {minutesToTime(d.startsAtMin)}
          </p>
          <p className="mt-1 text-xs text-ink-3">Fasts are tracked automatically. You can still start or end any day's fast early.</p>
        </div>
      )}

      {save.error && <ErrorNote error={save.error} />}
      <Button block onClick={async () => { await save.mutateAsync(undefined); onSaved?.(); }} disabled={save.isPending}
        className="bg-fast text-fast-ink">
        {plan ? "Save plan" : "Start this plan"}
      </Button>
    </div>
  );
}
