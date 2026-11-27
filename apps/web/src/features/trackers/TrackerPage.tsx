import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { bmi, suggestedWaterMl, type TrackerDayDTO, type TrackerHistoryDayDTO, type WorkoutDTO } from "../../../../../packages/shared/src/trackers.ts";
import { BarChart, LineChart } from "../../components/charts.tsx";
import { Button, Card, cx, ErrorNote, IconButton, PageHeader, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { addDays, isValidIso, today } from "../../lib/dates.ts";
import { useInvalidateTrackers, useTrackerDay, useTrackerHistory } from "../../lib/queries.ts";
import { clock, DAILY_KINDS, dayLabel, glassesOf, hoursMinutes, litres, TRACKER_META, type DailyKind } from "./meta.tsx";
import { QUALITY_LABELS, SleepSheet, WeightSheet, WorkoutSheet } from "./sheets.tsx";
import { StepsSheet } from "./healthSheets.tsx";
import { GlucosePage, MedicinePage, VitalPage } from "./HealthPages.tsx";

const RANGES: Record<DailyKind, number[]> = { water: [7, 30], workout: [7, 30], steps: [7, 30], sleep: [7, 30], weight: [30, 90, 365] };

/** /trackers/:kind → the right page. */
export function TrackerRoute() {
  const { kind } = useParams();
  if (kind === "glucose") return <GlucosePage />;
  if (kind === "medicine") return <MedicinePage />;
  if (kind === "heart" || kind === "breathing") return <VitalPage kind={kind} />;
  return <TrackerPage />;
}

export function TrackerPage() {
  const { kind: raw } = useParams();
  const kind = DAILY_KINDS.includes(raw as DailyKind) ? (raw as DailyKind) : null;
  const [params] = useSearchParams();
  const date = isValidIso(params.get("date")) ? params.get("date")! : today();
  const day = useTrackerDay(date);
  const [range, setRange] = useState(kind ? RANGES[kind][0]! : 7);
  const history = useTrackerHistory(addDays(date, -(range - 1)), date);
  const [sheet, setSheet] = useState<"add" | WorkoutDTO | null>(null);

  if (!kind) return <><PageHeader title="Trackers" /><p className="p-4 text-ink-3">Unknown tracker.</p></>;
  const m = TRACKER_META[kind];
  const d = day.data;

  return (
    <div className="min-h-dvh pb-10">
      <PageHeader title={m.title} right={d && kind !== "water" ? (
        <IconButton label={`Add ${m.title.toLowerCase()}`} onClick={() => setSheet("add")} className={m.text}><Plus size={22} /></IconButton>
      ) : undefined} />
      <div className="mx-auto max-w-xl space-y-3 px-4">
        {day.error ? <ErrorNote error={day.error} /> : null}
        {!d ? <Spinner /> : (
          <>
            <Today kind={kind} day={d} onAdd={() => setSheet("add")} onEditWorkout={(w) => setSheet(w)} />
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">History</h2>
                <div className="flex gap-1" role="radiogroup" aria-label="Period">
                  {RANGES[kind].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={range === n} onClick={() => setRange(n)}
                      className={cx("rounded-full px-2.5 py-1 text-xs", range === n ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>
                      {n === 365 ? "1 year" : `${n} days`}
                    </button>
                  ))}
                </div>
              </div>
              {history.data ? <HistoryChart kind={kind} day={d} days={history.data} /> : <Spinner />}
              {history.data && <Averages kind={kind} day={d} days={history.data} />}
            </Card>
            {kind === "weight" && history.data && <WeighIns days={history.data} />}
            <GoalCard kind={kind} day={d} />
            <Notes kind={kind} />
          </>
        )}
      </div>
      {d && kind === "weight" && <WeightSheet open={sheet === "add"} onClose={() => setSheet(null)} day={d} />}
      {d && kind === "sleep" && <SleepSheet open={sheet === "add"} onClose={() => setSheet(null)} day={d} />}
      {d && kind === "steps" && <StepsSheet open={sheet === "add"} onClose={() => setSheet(null)} day={d} />}
      {d && kind === "workout" && (
        <WorkoutSheet open={sheet !== null} onClose={() => setSheet(null)} day={d} editing={typeof sheet === "object" ? sheet : null} />
      )}
    </div>
  );
}

function Today({ kind, day, onAdd, onEditWorkout }: { kind: DailyKind; day: TrackerDayDTO; onAdd: () => void; onEditWorkout: (w: WorkoutDTO) => void }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const m = TRACKER_META[kind];
  const isToday = day.date === today();
  const when = isToday ? "Today" : dayLabel(day.date);
  const [customMl, setCustomMl] = useState("");

  const addWater = async (ml: number) => {
    await api.addWater({ date: day.date, ml });
    await invalidate();
  };

  if (kind === "water") {
    const pct = Math.min(100, (day.water.ml / day.water.goalMl) * 100);
    return (
      <Card className="p-4">
        <p className="text-xs text-ink-3">{when}</p>
        <p className="num text-3xl font-bold" style={{ color: m.color }}>{litres(day.water.ml)}
          <span className="text-base font-medium text-ink-3"> / {litres(day.water.goalMl)}</span></p>
        <p className="text-sm text-ink-2">{glassesOf(day.water.ml, day.water.glassMl)} of {glassesOf(day.water.goalMl, day.water.glassMl)} glasses ({day.water.glassMl} ml)</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} /></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="h-10 bg-water text-bg" onClick={() => void addWater(day.water.glassMl)}><Plus size={18} /> 1 glass</Button>
          <Button variant="secondary" className="h-10" onClick={() => void addWater(500)}>+ 500 ml</Button>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(customMl); if (v >= 10 && v <= 5000) { void addWater(v); setCustomMl(""); } }}>
            <input type="number" inputMode="numeric" min={10} max={5000} value={customMl} onChange={(e) => setCustomMl(e.target.value)}
              placeholder="ml" aria-label="Custom amount in ml" className="input h-10 w-20" />
            <Button type="submit" variant="secondary" className="h-10" disabled={!customMl}>Add</Button>
          </form>
        </div>
        {day.water.entries.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {[...day.water.entries].reverse().map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="num flex-1">{e.ml} ml</span>
                <span className="text-ink-3">{clock(e.loggedAt)}</span>
                <IconButton label="Delete" onClick={async () => { await api.deleteWater(e.id); await invalidate(); toast("Removed"); }}><Trash2 size={16} /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  if (kind === "weight") {
    const w = day.weight;
    const cur = w.today?.kg ?? w.latest?.kg ?? null;
    return (
      <Card className="p-4">
        <p className="text-xs text-ink-3">{w.today ? when : w.latest ? `Last weigh-in · ${dayLabel(w.latest.date)}` : when}</p>
        {cur !== null ? (
          <p className="num text-3xl font-bold" style={{ color: m.color }}>{cur} <span className="text-base font-medium text-ink-3">kg</span></p>
        ) : <p className="py-2 text-ink-2">No weigh-ins yet.</p>}
        {w.heightCm && cur !== null && (
          <p className="text-sm text-ink-2">BMI {bmi(cur, w.heightCm)}{w.healthy && ` · healthy range ${w.healthy.minKg}–${w.healthy.maxKg} kg`}</p>
        )}
        {day.settings.weight.goalKg && cur !== null && (
          <p className="text-sm text-ink-2">Goal {day.settings.weight.goalKg} kg · {Math.abs(Math.round((cur - day.settings.weight.goalKg) * 10) / 10)} kg to go</p>
        )}
        <Button className="mt-3 h-10" onClick={onAdd}>{w.today ? "Change today's weight" : "Log weight"}</Button>
      </Card>
    );
  }

  if (kind === "steps") {
    const st = day.steps;
    const pct = Math.min(100, ((st.steps ?? 0) / st.goal) * 100);
    return (
      <Card className="p-4">
        <p className="text-xs text-ink-3">{when}</p>
        <p className="num text-3xl font-bold" style={{ color: m.color }}>{(st.steps ?? 0).toLocaleString()}
          <span className="text-base font-medium text-ink-3"> / {st.goal.toLocaleString()} steps</span></p>
        <p className="text-sm text-ink-2">{st.km} km · about {st.kcal} kcal burned</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} /></div>
        <Button className="mt-3 h-10" onClick={onAdd}>{st.steps === null ? "Enter steps" : "Change steps"}</Button>
      </Card>
    );
  }

  if (kind === "workout") {
    const wk = day.workout;
    return (
      <Card className="p-4">
        <p className="text-xs text-ink-3">{when}</p>
        <p className="num text-3xl font-bold" style={{ color: m.color }}>{wk.minutes} <span className="text-base font-medium text-ink-3">/ {wk.goalMin} min</span></p>
        <p className="text-sm text-ink-2">{wk.kcal} kcal burned{day.settings.workout.addToBudget && wk.netKcal ? ` · +${wk.netKcal} kcal added to your food budget` : ""}</p>
        {wk.entries.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {wk.entries.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => onEditWorkout(w)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{w.name}</span>
                    <span className="block text-xs text-ink-3">{w.minutes} min · {clock(w.loggedAt)}</span>
                  </span>
                  <span className="num font-semibold">{w.kcal} kcal</span>
                  <Pencil size={14} className="text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button className="mt-3 h-10" onClick={onAdd}><Plus size={18} /> Add workout</Button>
      </Card>
    );
  }

  const e = day.sleep.entry;
  return (
    <Card className="p-4">
      <p className="text-xs text-ink-3">Night ending {when.toLowerCase() === "today" ? "this morning" : dayLabel(day.date)}</p>
      {e ? (
        <>
          <p className="num text-3xl font-bold" style={{ color: m.color }}>{hoursMinutes(e.minutes)}
            <span className="text-base font-medium text-ink-3"> / {hoursMinutes(day.sleep.goalMin)}</span></p>
          <p className="text-sm text-ink-2">{clock(e.bedAt)} → {clock(e.wakeAt)}{e.quality ? ` · ${QUALITY_LABELS[e.quality - 1]}` : ""}</p>
        </>
      ) : <p className="py-2 text-ink-2">Not logged.</p>}
      <Button className="mt-3 h-10" onClick={onAdd}>{e ? "Edit" : "Log sleep"}</Button>
    </Card>
  );
}

function HistoryChart({ kind, day, days }: { kind: DailyKind; day: TrackerDayDTO; days: TrackerHistoryDayDTO[] }) {
  const m = TRACKER_META[kind];
  if (kind === "weight") {
    const goal = day.settings.weight.goalKg;
    return (
      <LineChart points={days.filter((x) => x.weightKg !== null).map((x) => ({ date: x.date, value: x.weightKg! }))}
        from={days[0]!.date} to={days.at(-1)!.date} band={day.weight.healthy ? { min: day.weight.healthy.minKg, max: day.weight.healthy.maxKg } : null}
        goal={goal} color={m.color} unit="kg" />
    );
  }
  const series = days.map((x) => ({
    date: x.date,
    value: kind === "water" ? x.waterMl : kind === "workout" ? x.workoutMin : kind === "steps" ? x.steps : x.sleepMin,
  }));
  const goal = kind === "water" ? day.water.goalMl : kind === "workout" ? day.workout.goalMin : kind === "steps" ? day.steps.goal : day.sleep.goalMin;
  const format = kind === "water" ? litres : kind === "workout" ? (v: number) => `${v} min`
    : kind === "steps" ? (v: number) => `${v.toLocaleString()} steps` : hoursMinutes;
  return <BarChart days={series} goal={goal} color={m.color} format={format} today={today()} />;
}

function Averages({ kind, day, days }: { kind: DailyKind; day: TrackerDayDTO; days: TrackerHistoryDayDTO[] }) {
  const stat = (label: string, value: string) => (
    <div className="rounded-xl bg-surface-2 p-2.5"><p className="text-[11px] text-ink-3">{label}</p><p className="num font-semibold">{value}</p></div>
  );
  if (kind === "weight") {
    const pts = days.filter((x) => x.weightKg !== null);
    if (pts.length < 2) return null;
    const change = Math.round((pts.at(-1)!.weightKg! - pts[0]!.weightKg!) * 10) / 10;
    return <div className="mt-3 grid grid-cols-2 gap-2">{stat("Change", `${change > 0 ? "+" : ""}${change} kg`)}{stat("Weigh-ins", String(pts.length))}</div>;
  }
  if (kind === "water") {
    const logged = days.filter((x) => x.waterMl > 0);
    const avg = logged.length ? logged.reduce((s, x) => s + x.waterMl, 0) / logged.length : 0;
    const met = days.filter((x) => x.waterMl >= day.water.goalMl).length;
    return <div className="mt-3 grid grid-cols-2 gap-2">{stat("Daily average", logged.length ? litres(Math.round(avg / 50) * 50) : "–")}{stat("Goal reached", `${met} of ${days.length} days`)}</div>;
  }
  if (kind === "steps") {
    const logged = days.filter((x) => x.steps !== null);
    const avg = logged.length ? logged.reduce((s, x) => s + x.steps!, 0) / logged.length : 0;
    const met = days.filter((x) => (x.steps ?? 0) >= day.steps.goal).length;
    return <div className="mt-3 grid grid-cols-2 gap-2">{stat("Daily average", logged.length ? Math.round(avg).toLocaleString() : "–")}{stat("Goal reached", `${met} of ${days.length} days`)}</div>;
  }
  if (kind === "workout") {
    const last7 = days.slice(-7).reduce((s, x) => s + x.workoutMin, 0);
    const kcal = days.reduce((s, x) => s + x.workoutKcal, 0);
    return <div className="mt-3 grid grid-cols-2 gap-2">{stat("Last 7 days", `${last7} of 150 min`)}{stat("Burned in period", `${kcal.toLocaleString()} kcal`)}</div>;
  }
  const nights = days.filter((x) => x.sleepMin !== null);
  const avg = nights.length ? nights.reduce((s, x) => s + x.sleepMin!, 0) / nights.length : 0;
  return <div className="mt-3 grid grid-cols-2 gap-2">{stat("Average night", nights.length ? hoursMinutes(Math.round(avg)) : "–")}{stat("Nights logged", `${nights.length} of ${days.length}`)}</div>;
}

function WeighIns({ days }: { days: TrackerHistoryDayDTO[] }) {
  const pts = days.filter((x) => x.weightKg !== null).reverse();
  if (!pts.length) return null;
  return (
    <Card>
      <h2 className="px-4 pt-3 font-semibold">Weigh-ins</h2>
      <ul className="mt-1 divide-y divide-line">
        {pts.slice(0, 30).map((p, i) => {
          const prev = pts[i + 1]?.weightKg;
          const diff = prev ? Math.round((p.weightKg! - prev) * 10) / 10 : null;
          return (
            <li key={p.date} className="flex items-center px-4 py-2.5 text-sm">
              <Link to={`/trackers/weight?date=${p.date}`} className="flex-1">{dayLabel(p.date)}</Link>
              {diff !== null && diff !== 0 && <span className="mr-3 text-xs text-ink-3">{diff > 0 ? "+" : ""}{diff}</span>}
              <span className="num font-semibold">{p.weightKg} kg</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function GoalCard({ kind, day }: { kind: DailyKind; day: TrackerDayDTO }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const s = day.settings;
  const [value, setValue] = useState("");
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (kind === "water") { setValue(s.water.goalMl ? String(s.water.goalMl) : ""); setExtra(String(s.water.glassMl)); }
    if (kind === "workout") setValue(String(s.workout.goalMin));
    if (kind === "sleep") setValue(String(s.sleep.goalMin / 60));
    if (kind === "steps") setValue(String(s.steps.goal));
    if (kind === "weight") { setValue(s.weight.goalKg ? String(s.weight.goalKg) : ""); setExtra(s.weight.heightCm ? String(s.weight.heightCm) : ""); }
  }, [kind, s]);

  const save = async (patch: Parameters<typeof api.updateTrackerSettings>[0]) => {
    setError(null);
    try {
      await api.updateTrackerSettings(patch);
      await invalidate();
      toast("Saved");
    } catch (e) { setError(e); }
  };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">Goal</h2>
      {kind === "water" && (
        <>
          <Row label="Daily goal (ml)" hint={`Leave empty to use ${litres(suggestedWaterMl(day.weight.currentKg, s.water.glassMl))}, about 35 ml per kg of body weight.`}>
            <input type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Automatic" className="input" />
          </Row>
          <Row label="Glass size (ml)"><input type="number" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} className="input" /></Row>
          <Button variant="secondary" className="h-10" onClick={() => void save({ water: { goalMl: num(value), glassMl: Number(extra) || 250 } })}>Save goal</Button>
        </>
      )}
      {kind === "workout" && (
        <>
          <Row label="Active minutes a day" hint="WHO recommends at least 150 minutes of moderate activity a week (about 30 minutes on 5 days).">
            <input type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="input" />
          </Row>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--brand)]" checked={s.workout.addToBudget}
              onChange={(e) => void save({ workout: { addToBudget: e.target.checked } })} />
            <span className="text-sm">
              <span className="block font-medium">Add workout calories to my food budget</span>
              <span className="block text-xs text-ink-3">Adds only the calories above what you'd burn at rest. Leave this off if you're trying to lose weight and your goal already counts your activity level.</span>
            </span>
          </label>
          <Button variant="secondary" className="h-10" onClick={() => void save({ workout: { goalMin: Number(value) || 30 } })}>Save goal</Button>
        </>
      )}
      {kind === "steps" && (
        <>
          <Row label="Steps a day" hint="For most adults the health benefits keep growing up to about 8,000–10,000 steps a day. Any increase helps.">
            <input type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="input" />
          </Row>
          <Button variant="secondary" className="h-10" onClick={() => void save({ steps: { goal: Number(value) || 8000 } })}>Save goal</Button>
        </>
      )}
      {kind === "sleep" && (
        <>
          <Row label="Hours a night" hint="Most adults need 7–9 hours.">
            <input type="number" inputMode="decimal" step={0.5} value={value} onChange={(e) => setValue(e.target.value)} className="input" />
          </Row>
          <Button variant="secondary" className="h-10" onClick={() => void save({ sleep: { goalMin: Math.round((Number(value) || 8) * 60) } })}>Save goal</Button>
        </>
      )}
      {kind === "weight" && (
        <>
          <Row label="Goal weight (kg, optional)" hint={day.weight.healthy ? `Healthy for your height: ${day.weight.healthy.minKg}–${day.weight.healthy.maxKg} kg.` : undefined}>
            <input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="No goal" className="input" />
          </Row>
          {!day.weight.heightCm || s.weight.heightCm ? (
            <Row label="Height (cm)" hint="Used for BMI and the healthy range. Your Daily goals profile is used instead when you've filled it in.">
              <input type="number" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} className="input" />
            </Row>
          ) : null}
          <Button variant="secondary" className="h-10" onClick={() => void save({ weight: { goalKg: num(value), ...(extra ? { heightCm: Number(extra) } : {}) } })}>Save</Button>
          <Link to="/me/goals" className="block text-sm font-medium text-brand">Recalculate my calorie goal from my weight</Link>
        </>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Notes({ kind }: { kind: DailyKind }) {
  const text: Record<DailyKind, string> = {
    water: "You need more on hot days, when you exercise, and if you're pregnant or breastfeeding. Tea, milk, buttermilk and soups count too. If a doctor has limited your fluids, follow their advice.",
    weight: "BMI 18.5–22.9 is the healthy range used for Indian adults; it's a rough guide and doesn't account for muscle. Day-to-day changes of 1–2 kg are usually water, so look at the trend.",
    workout: "Calories are estimates from published activity energy costs (Compendium of Physical Activities) and your weight. Real burn varies with effort and fitness.",
    steps: "A website can't read your phone's step counter, so copy the number from your phone's health app or watch. Distance uses your height and calories assume walking pace. If you also logged a walk as a workout, it's counted twice, so log each walk in one place.",
    sleep: "Regular bed and wake times help as much as total hours. If you often feel unrested after a full night, talk to a doctor.",
  };
  return <p className="px-1 text-xs leading-relaxed text-ink-3">{text[kind]} General information, not medical advice.</p>;
}
