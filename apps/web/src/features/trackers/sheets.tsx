import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ChevronLeft, Search } from "lucide-react";
import {
  ACTIVITIES, CUSTOM_ACTIVITY, FALLBACK_WEIGHT_KG, workoutKcal, workoutNetKcal,
  type Activity, type ActivityGroup, type TrackerDayDTO, type WorkoutDTO,
} from "../../../../../packages/shared/src/trackers.ts";
import { Button, cx, ErrorNote, Sheet, Stepper } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { fromIso, parseTimeInput, timeInputValue } from "../../lib/dates.ts";
import { useInvalidateTrackers, useSettings } from "../../lib/queries.ts";
import { hoursMinutes } from "./meta.tsx";

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  };
  return { busy, error, run, reset: () => setError(null) };
}

// ── Weight ──────────────────────────────────────────────────────────────────────────────

export function WeightSheet({ open, onClose, day }: { open: boolean; onClose: () => void; day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const navigate = useNavigate();
  const settings = useSettings(day.date);
  const save = useSave();
  const start = day.weight.today?.kg ?? day.weight.currentKg ?? FALLBACK_WEIGHT_KG;
  const [kg, setKg] = useState(start);
  const [height, setHeight] = useState<number | "">("");
  useEffect(() => { if (open) { setKg(start); setHeight(""); save.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const askHeight = !day.weight.heightCm;
  const hasGoals = settings.data && !settings.data.goalsAreDefault && settings.data.profile;

  const submit = () => save.run(async () => {
    if (askHeight && height) await api.updateTrackerSettings({ weight: { heightCm: Number(height) } });
    await api.setWeight(day.date, { kg });
    await invalidate();
    onClose();
    if (hasGoals && Math.abs(kg - (settings.data!.profile!.weightKg)) >= 1) {
      toast("Weight saved. Your calorie goal was set for a different weight.", { label: "Update goal", run: () => navigate("/me/goals") });
    } else toast("Weight saved");
  });

  return (
    <Sheet open={open} onClose={onClose} title="Log weight"
      footer={<Button block onClick={() => void submit()} disabled={save.busy || !(kg >= 20 && kg <= 400)}>Save</Button>}>
      <div className="flex flex-col items-center gap-2 py-3">
        <Stepper value={kg} onChange={setKg} step={0.1} min={20} label="Weight in kg" />
        <span className="text-sm text-ink-3">kg</span>
      </div>
      {askHeight && (
        <label className="mt-2 block">
          <span className="mb-1.5 block text-sm font-medium">Your height (cm), for your healthy range</span>
          <input type="number" inputMode="decimal" min={100} max={250} value={height}
            onChange={(e) => setHeight(e.target.value === "" ? "" : Number(e.target.value))} className="input" placeholder="e.g. 165" />
        </label>
      )}
      <p className="mt-3 text-xs text-ink-3">One weigh-in per day; saving again replaces it. Weigh at the same time each day for a fair trend.</p>
      {save.error ? <div className="mt-3"><ErrorNote error={save.error} /></div> : null}
      {day.weight.today && (
        <Button variant="danger" className="mt-2 -ml-4" onClick={() => void save.run(async () => {
          await api.deleteWeight(day.date);
          await invalidate();
          onClose();
        })}>Delete this weigh-in</Button>
      )}
    </Sheet>
  );
}

// ── Workout ─────────────────────────────────────────────────────────────────────────────

const GROUPS: ActivityGroup[] = ["Walking & running", "Yoga & fitness", "Sports", "Everyday"];

/** New workout (pick an activity, then duration) or edit one (`editing`). */
export function WorkoutSheet({ open, onClose, day, editing }: {
  open: boolean; onClose: () => void; day: TrackerDayDTO; editing?: WorkoutDTO | null;
}) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const save = useSave();
  const recent = useQuery({ queryKey: ["tracker-history", "recent-activities"], queryFn: api.recentActivities, enabled: open && !editing });
  const [picked, setPicked] = useState<Activity | "custom" | null>(null);
  const [query, setQuery] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [kcalText, setKcalText] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) return;
    save.reset();
    setQuery("");
    if (editing) {
      setPicked(editing.activityKey === CUSTOM_ACTIVITY ? "custom" : ACTIVITIES.find((a) => a.key === editing.activityKey) ?? "custom");
      setMinutes(editing.minutes);
      setKcalText(editing.activityKey === CUSTOM_ACTIVITY ? String(editing.kcal) : "");
      setName(editing.name);
    } else {
      setPicked(null);
      setMinutes(30);
      setKcalText("");
      setName("");
    }
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const kg = day.weight.currentKg ?? FALLBACK_WEIGHT_KG;
  const typedKcal = kcalText.trim() ? Number(kcalText) : undefined;
  const estimate = picked && picked !== "custom" ? workoutKcal(picked.met, kg, minutes) : null;
  const net = picked && picked !== "custom" ? workoutNetKcal(picked.met, kg, minutes) : null;
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ACTIVITIES.filter((a) => a.name.toLowerCase().includes(q)) : ACTIVITIES;
  }, [query]);

  const valid = picked && minutes >= 1 && minutes <= 1440 && (picked !== "custom" || (typedKcal !== undefined && typedKcal >= 0));
  const submit = () => save.run(async () => {
    if (!picked) return;
    if (editing) {
      await api.updateWorkout(editing.id, { minutes, ...(typedKcal !== undefined ? { kcal: typedKcal } : {}) });
    } else {
      await api.addWorkout({
        date: day.date, minutes,
        activityKey: picked === "custom" ? CUSTOM_ACTIVITY : picked.key,
        ...(picked === "custom" ? { name: name.trim() || "Workout" } : {}),
        ...(typedKcal !== undefined ? { kcal: typedKcal } : {}),
      });
    }
    await invalidate();
    onClose();
    toast(editing ? "Workout updated" : "Workout logged");
  });

  const title = editing ? "Edit workout" : picked ? (
    <button type="button" className="-ml-1 flex items-center gap-1 text-left" onClick={() => setPicked(null)} aria-label="Choose another activity">
      <ChevronLeft size={20} /> {picked === "custom" ? "Other activity" : picked.name}
    </button>
  ) : "Add workout";

  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={picked ? <Button block onClick={() => void submit()} disabled={save.busy || !valid}>Save</Button> : undefined}>
      {!picked ? (
        <>
          <label className="relative block">
            <Search size={18} className="absolute left-3 top-3 text-ink-3" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activities"
              className="input pl-10" autoComplete="off" />
          </label>
          {!query && recent.data && recent.data.length > 0 && (
            <ActivityGroupList title="Recent" items={recent.data.map((k) => ACTIVITIES.find((a) => a.key === k)).filter(Boolean) as Activity[]} onPick={setPicked} />
          )}
          {GROUPS.map((g) => {
            const items = list.filter((a) => a.group === g);
            return items.length ? <ActivityGroupList key={g} title={g} items={items} onPick={setPicked} /> : null;
          })}
          <button type="button" onClick={() => { setPicked("custom"); setName(query.trim()); }}
            className="mt-3 w-full rounded-xl bg-surface-2 px-4 py-3 text-left text-sm font-medium">
            Other activity: enter calories yourself
          </button>
        </>
      ) : (
        <div className="space-y-4 py-2">
          {picked === "custom" && !editing && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Activity</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kabaddi" className="input" maxLength={60} />
            </label>
          )}
          <div>
            <span className="mb-1.5 block text-sm font-medium">Duration (minutes)</span>
            <Stepper value={minutes} onChange={(v) => setMinutes(Math.round(v))} step={5} min={1} label="Minutes" />
          </div>
          {estimate !== null && (
            <div className="rounded-xl bg-workout-soft p-3">
              <p className="num text-2xl font-bold text-workout">{typedKcal ?? estimate} kcal</p>
              <p className="text-xs text-ink-2">
                Estimated for {kg} kg{day.weight.currentKg ? "" : " (log your weight for a better estimate)"}. About {net} kcal is on top
                of what your body burns at rest anyway.
              </p>
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">
              {picked === "custom" ? "Calories burned" : "Calories from your watch (optional)"}
            </span>
            <input type="number" inputMode="numeric" min={0} max={10000} value={kcalText} onChange={(e) => setKcalText(e.target.value)}
              placeholder={estimate !== null ? String(estimate) : "kcal"} className="input" />
          </label>
          {save.error ? <ErrorNote error={save.error} /> : null}
          {editing && (
            <Button variant="danger" className="-ml-4" onClick={() => void save.run(async () => {
              await api.deleteWorkout(editing.id);
              await invalidate();
              onClose();
              toast("Workout deleted");
            })}>Delete workout</Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ActivityGroupList({ title, items, onPick }: { title: string; items: Activity[]; onPick: (a: Activity) => void }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {items.map((a) => (
          <li key={a.key}>
            <button type="button" onClick={() => onPick(a)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface-2">
              <span>{a.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Sleep ───────────────────────────────────────────────────────────────────────────────

const QUALITY = ["Poor", "Fair", "OK", "Good", "Great"];

/** The night that ended on the diary date. */
export function SleepSheet({ open, onClose, day }: { open: boolean; onClose: () => void; day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const save = useSave();
  const [bed, setBed] = useState(23 * 60);
  const [wake, setWake] = useState(7 * 60);
  const [quality, setQuality] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    save.reset();
    const e = day.sleep.entry;
    if (e) {
      const b = new Date(e.bedAt);
      const w = new Date(e.wakeAt);
      setBed(b.getHours() * 60 + b.getMinutes());
      setWake(w.getHours() * 60 + w.getMinutes());
      setQuality(e.quality);
    } else {
      setBed(23 * 60);
      setWake(7 * 60);
      setQuality(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bedtime later in the clock than wake-up means the night before.
  const wakeAt = atMinutes(day.date, wake, 0);
  const bedAt = atMinutes(day.date, bed, bed >= wake ? -1 : 0);
  const minutes = Math.round((wakeAt - bedAt) / 60_000);

  const submit = () => save.run(async () => {
    await api.setSleep(day.date, { bedAt, wakeAt, quality });
    await invalidate();
    onClose();
    toast("Sleep saved");
  });

  return (
    <Sheet open={open} onClose={onClose} title="Log sleep"
      footer={<Button block onClick={() => void submit()} disabled={save.busy || minutes <= 0}>Save</Button>}>
      <p className="text-sm text-ink-3">The night that ended this morning.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Went to bed</span>
          <input type="time" value={timeInputValue(bed)} onChange={(e) => e.target.value && setBed(parseTimeInput(e.target.value))} className="input" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Woke up</span>
          <input type="time" value={timeInputValue(wake)} onChange={(e) => e.target.value && setWake(parseTimeInput(e.target.value))} className="input" />
        </label>
      </div>
      <p className="num mt-4 text-center text-3xl font-bold text-sleep">{hoursMinutes(minutes)}</p>
      <p className="text-center text-xs text-ink-3">goal {hoursMinutes(day.sleep.goalMin)}</p>
      <div className="mt-4">
        <span className="mb-1.5 block text-sm font-medium">How did you sleep? (optional)</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sleep quality">
          {QUALITY.map((q, i) => (
            <button key={q} type="button" role="radio" aria-checked={quality === i + 1} onClick={() => setQuality(quality === i + 1 ? null : i + 1)}
              className={cx("rounded-full px-3 py-1.5 text-sm", quality === i + 1 ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>
              {q}
            </button>
          ))}
        </div>
      </div>
      {save.error ? <div className="mt-3"><ErrorNote error={save.error} /></div> : null}
      {day.sleep.entry && (
        <Button variant="danger" className="mt-2 -ml-4" onClick={() => void save.run(async () => {
          await api.deleteSleep(day.date);
          await invalidate();
          onClose();
        })}>Delete</Button>
      )}
    </Sheet>
  );
}

function atMinutes(iso: string, min: number, dayOffset: number): number {
  const d = fromIso(iso);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.getTime();
}

export const QUALITY_LABELS = QUALITY;
