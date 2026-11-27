import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Check } from "lucide-react";
import {
  GLUCOSE_BAND_LABEL, GLUCOSE_TAGS, glucoseBand, glucoseToMgdl, VITAL_CONTEXTS, vitalBand, VITALS,
  type GlucoseBand, type GlucoseTag, type GlucoseUnit, type MedicineDayDTO, type VitalContext, type VitalKind,
} from "../../../../../packages/shared/src/health.ts";
import { closestMealType, MEAL_TYPES, type MealTypeCode } from "../../../../../packages/shared/src/meals.ts";
import { stepsEnergy, type TrackerDayDTO } from "../../../../../packages/shared/src/trackers.ts";
import { Button, cx, ErrorNote, Sheet } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { minutesToTime, parseTimeInput, timeInputValue } from "../../lib/dates.ts";
import { useInvalidateTrackers, useSettings } from "../../lib/queries.ts";
import { clock } from "./meta.tsx";
import { atMinutes, useSave } from "./sheets.tsx";

const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cx("rounded-full px-3 py-1.5 text-sm", on ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>{children}</button>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────────────────

export function StepsSheet({ open, onClose, day }: { open: boolean; onClose: () => void; day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const settings = useSettings(day.date);
  const save = useSave();
  const [text, setText] = useState("");
  useEffect(() => { if (open) { setText(day.steps.steps !== null ? String(day.steps.steps) : ""); save.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = Math.round(Number(text.replace(/[,\s]/g, "")) || 0);
  const e = stepsEnergy(steps, day.weight.currentKg, day.weight.heightCm, settings.data?.profile?.sex);
  const valid = text.trim() !== "" && steps >= 0 && steps <= 200_000;

  return (
    <Sheet open={open} onClose={onClose} title="Steps"
      footer={<Button block disabled={save.busy || !valid} onClick={() => void save.run(async () => {
        await api.setSteps(day.date, steps);
        await invalidate();
        onClose();
        toast(`${steps.toLocaleString()} steps saved`);
      })}>Save</Button>}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Total steps for the day</span>
        <input type="text" inputMode="numeric" value={text} onChange={(ev) => setText(ev.target.value)}
          placeholder="e.g. 6500" className="input num text-lg" />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        {[1000, 2000, 5000].map((n) => (
          <button key={n} type="button" onClick={() => setText(String(steps + n))} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm text-ink-2">
            +{n.toLocaleString()}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-steps-soft p-3"><p className="text-xs text-ink-2">Distance</p><p className="num text-xl font-bold text-steps">{e.km} km</p></div>
        <div className="rounded-xl bg-steps-soft p-3"><p className="text-xs text-ink-2">Calories burned</p><p className="num text-xl font-bold text-steps">{e.kcal} kcal</p></div>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        {steps >= day.steps.goal ? "Goal reached. " : `${Math.max(0, day.steps.goal - steps).toLocaleString()} to go to your goal of ${day.steps.goal.toLocaleString()}. `}
        Copy the number from your phone's health app or watch.{!day.weight.heightCm && " Add your height under Weight for a more accurate distance."}
      </p>
      {save.error ? <div className="mt-3"><ErrorNote error={save.error} /></div> : null}
      {day.steps.steps !== null && (
        <Button variant="danger" className="mt-2 -ml-4" onClick={() => void save.run(async () => {
          await api.deleteSteps(day.date);
          await invalidate();
          onClose();
        })}>Delete</Button>
      )}
    </Sheet>
  );
}

// ── Blood glucose ───────────────────────────────────────────────────────────────────────

export function GlucoseSheet({ open, onClose, day }: { open: boolean; onClose: () => void; day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const save = useSave();
  const unit = day.settings.glucose.unit;
  const [text, setText] = useState("");
  const [tag, setTag] = useState<GlucoseTag>("fasting");
  const [meal, setMeal] = useState<MealTypeCode>("B");
  const [time, setTime] = useState(nowMinutes());
  useEffect(() => {
    if (!open) return;
    save.reset();
    setText("");
    const t = nowMinutes();
    setTime(t);
    setMeal(closestMealType(t));
    setTag(t < 9 * 60 && !day.glucose.readings.length ? "fasting" : "after_meal");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = Number(text.replace(",", "."));
  const mgdl = value > 0 ? glucoseToMgdl(value, unit) : 0;
  const band = mgdl >= 10 ? glucoseBand(mgdl, tag) : null;
  const mealNeeded = tag === "before_meal" || tag === "after_meal";

  return (
    <Sheet open={open} onClose={onClose} title="Blood glucose"
      footer={<Button block disabled={save.busy || !(mgdl >= 10 && mgdl <= 1000)} onClick={() => void save.run(async () => {
        await api.addGlucose({ date: day.date, measuredAt: atMinutes(day.date, time, 0), value, unit, tag, mealType: mealNeeded ? meal : null });
        await invalidate();
        onClose();
        toast("Reading saved");
      })}>Save</Button>}>
      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="mb-1.5 block text-sm font-medium">Reading</span>
          <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={unit === "mg/dL" ? "e.g. 110" : "e.g. 6.1"} className="input num text-lg" />
        </label>
        <UnitSwitch unit={unit} />
      </div>
      {band && <GlucoseNote band={band} />}
      <span className="mb-1.5 mt-4 block text-sm font-medium">When</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="When">
        {GLUCOSE_TAGS.map((t) => <Chip key={t.key} on={tag === t.key} onClick={() => setTag(t.key)}>{t.label}</Chip>)}
      </div>
      {mealNeeded && (
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Meal">
          {MEAL_TYPES.map((m) => <Chip key={m.code} on={meal === m.code} onClick={() => setMeal(m.code)}>{m.name}</Chip>)}
        </div>
      )}
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium">Time</span>
        <input type="time" value={timeInputValue(time)} onChange={(e) => e.target.value && setTime(parseTimeInput(e.target.value))} className="input" />
      </label>
      {save.error ? <div className="mt-3"><ErrorNote error={save.error} /></div> : null}
    </Sheet>
  );
}

export function UnitSwitch({ unit }: { unit: GlucoseUnit }) {
  const invalidate = useInvalidateTrackers();
  return (
    <div className="flex h-11 overflow-hidden rounded-xl border border-line text-sm" role="radiogroup" aria-label="Unit">
      {(["mg/dL", "mmol/L"] as const).map((u) => (
        <button key={u} type="button" role="radio" aria-checked={unit === u}
          onClick={() => void api.updateTrackerSettings({ glucose: { unit: u } }).then(invalidate)}
          className={cx("px-2.5", unit === u ? "bg-ink font-semibold text-bg" : "text-ink-2")}>{u}</button>
      ))}
    </div>
  );
}

export function GlucoseNote({ band }: { band: GlucoseBand }) {
  const text = band === "usual" ? `${GLUCOSE_BAND_LABEL.usual} for adults without diabetes.`
    : band === "low" ? "Low (below 70 mg/dL). If you feel shaky, sweaty or confused, have something sugary and follow your doctor's advice."
    : `${GLUCOSE_BAND_LABEL[band]}. One reading isn't a diagnosis; talk to your doctor if readings like this keep happening.`;
  return <p className={cx("mt-2 rounded-lg p-2 text-xs", band === "usual" ? "bg-brand-soft text-brand" : "bg-warn-soft text-warn")}>{text}</p>;
}

// ── Heart and breathing rate ────────────────────────────────────────────────────────────

export function VitalSheet({ kind, open, onClose, day }: { kind: VitalKind; open: boolean; onClose: () => void; day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const save = useSave();
  const info = VITALS[kind];
  const [text, setText] = useState("");
  const [context, setContext] = useState<VitalContext>("resting");
  const [time, setTime] = useState(nowMinutes());
  useEffect(() => { if (open) { save.reset(); setText(""); setContext("resting"); setTime(nowMinutes()); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = Math.round(Number(text));
  const band = value >= info.min ? vitalBand(kind, value, context) : null;

  return (
    <Sheet open={open} onClose={onClose} title={info.title}
      footer={<Button block disabled={save.busy || !(value >= info.min && value <= info.max)} onClick={() => void save.run(async () => {
        await api.addVital({ kind, date: day.date, measuredAt: atMinutes(day.date, time, 0), value, context });
        await invalidate();
        onClose();
        toast("Reading saved");
      })}>Save</Button>}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">{kind === "heart" ? "Beats per minute" : "Breaths per minute"}</span>
        <input type="number" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={kind === "heart" ? "e.g. 72" : "e.g. 16"} className="input num text-lg" />
      </label>
      {band && <VitalNote kind={kind} band={band} />}
      <span className="mb-1.5 mt-4 block text-sm font-medium">When</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="When">
        {VITAL_CONTEXTS.map((c) => <Chip key={c.key} on={context === c.key} onClick={() => setContext(c.key)}>{c.label}</Chip>)}
      </div>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium">Time</span>
        <input type="time" value={timeInputValue(time)} onChange={(e) => e.target.value && setTime(parseTimeInput(e.target.value))} className="input" />
      </label>
      <p className="mt-3 text-xs text-ink-3">
        {kind === "breathing"
          ? "To measure: sit still for a minute, then count how many times your chest rises in 60 seconds."
          : "Resting means after sitting quietly for 5 minutes. Watches and BP machines show this as pulse or BPM."}
      </p>
      {save.error ? <div className="mt-3"><ErrorNote error={save.error} /></div> : null}
    </Sheet>
  );
}

export function VitalNote({ kind, band }: { kind: VitalKind; band: "low" | "usual" | "high" }) {
  const [lo, hi] = VITALS[kind].resting;
  return (
    <p className={cx("mt-2 rounded-lg p-2 text-xs", band === "usual" ? "bg-brand-soft text-brand" : "bg-warn-soft text-warn")}>
      {band === "usual" ? `In the usual resting range for adults (${lo}–${hi}).`
        : `${band === "low" ? "Below" : "Above"} the usual resting range of ${lo}–${hi}. Talk to a doctor if it stays this way or you feel unwell.`}
    </p>
  );
}

// ── Medicine doses ──────────────────────────────────────────────────────────────────────

export function DosesSheet({ open, onClose, day }: { open: boolean; onClose: () => void; day: TrackerDayDTO }) {
  const navigate = useNavigate();
  return (
    <Sheet open={open} onClose={onClose} title="Medicines today"
      footer={<Button block variant="secondary" onClick={() => { onClose(); navigate(`/trackers/medicine?date=${day.date}`); }}>Manage medicines</Button>}>
      <DoseChecklist day={day.medicine} />
    </Sheet>
  );
}

/** Tick scheduled doses (Taken / Skip, with undo) or log an as-needed one. */
export function DoseChecklist({ day }: { day: MedicineDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await invalidate(); } finally { setBusy(null); }
  };
  if (!day.doses.length && !day.asNeeded.length) {
    return <p className="py-4 text-sm text-ink-3">No medicines due on this day. Add yours under Manage medicines.</p>;
  }
  return (
    <div className="space-y-3">
      {day.doses.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {day.doses.map((d) => {
            const key = `${d.medicineId}-${d.timeMin ?? d.id}`;
            return (
              <li key={key} className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate font-medium", d.status === "skipped" && "text-ink-3 line-through")}>{d.name}</span>
                  <span className="block text-xs text-ink-3">
                    {d.timeMin !== null ? minutesToTime(d.timeMin) : "As needed"}{d.dose ? ` · ${d.dose}` : ""}
                    {d.status === "taken" && d.recordedAt ? ` · taken ${clock(d.recordedAt)}` : d.status === "skipped" ? " · skipped" : ""}
                  </span>
                </span>
                {d.status === "pending" ? (
                  <>
                    <button type="button" disabled={busy === key}
                      onClick={() => void act(key, () => api.recordDose({ medicineId: d.medicineId, date: d.date, timeMin: d.timeMin, status: "skipped" }))}
                      className="rounded-full px-2.5 py-1.5 text-xs text-ink-3 hover:bg-surface-2">Skip</button>
                    <button type="button" disabled={busy === key}
                      onClick={() => void act(key, () => api.recordDose({ medicineId: d.medicineId, date: d.date, timeMin: d.timeMin, status: "taken" }))}
                      className="rounded-full bg-medicine px-3 py-1.5 text-xs font-semibold text-bg">Taken</button>
                  </>
                ) : (
                  <button type="button" disabled={busy === key} onClick={() => void act(key, async () => { await api.deleteDose(d.id!); toast("Undone"); })}
                    aria-label={`Undo ${d.status} for ${d.name}`}
                    className={cx("flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs", d.status === "taken" ? "bg-medicine-soft text-medicine" : "bg-surface-2 text-ink-3")}>
                    {d.status === "taken" ? <><Check size={14} /> Taken</> : "Skipped"} · Undo
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {day.asNeeded.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">As needed</h3>
          <div className="flex flex-wrap gap-2">
            {day.asNeeded.map((m) => (
              <button key={m.id} type="button" disabled={busy === m.id}
                onClick={() => void act(m.id, async () => { await api.recordDose({ medicineId: m.id, date: day.date, timeMin: null, status: "taken" }); toast(`${m.name} logged`); })}
                className="rounded-full bg-surface-2 px-3 py-1.5 text-sm">+ {m.name}{m.dose ? ` (${m.dose})` : ""}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
