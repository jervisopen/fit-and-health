import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import {
  GLUCOSE_BAND_LABEL, glucoseBand, glucoseIn, glucoseTagLabel, MGDL_PER_MMOL, vitalBand, VITALS,
  type GlucoseDTO, type MedicineBody, type MedicineDTO, type VitalDTO, type VitalKind,
} from "../../../../../packages/shared/src/health.ts";
import { MEAL_TYPES } from "../../../../../packages/shared/src/meals.ts";
import type { TrackerDayDTO } from "../../../../../packages/shared/src/trackers.ts";
import { downloadFromApi } from "../../components/ApiImage.tsx";
import { BarChart } from "../../components/charts.tsx";
import { Button, Card, cx, ErrorNote, IconButton, PageHeader, Sheet, Spinner } from "../../components/ui.tsx";
import { useToast } from "../../components/Toast.tsx";
import { api } from "../../lib/api.ts";
import { addDays, isValidIso, minutesToTime, parseTimeInput, timeInputValue, today } from "../../lib/dates.ts";
import { useInvalidateTrackers, useTrackerDay } from "../../lib/queries.ts";
import { clock, dayLabel, TRACKER_META } from "./meta.tsx";
import { DoseChecklist, GlucoseNote, GlucoseSheet, UnitSwitch, VitalNote, VitalSheet } from "./healthSheets.tsx";
import { useSave } from "./sheets.tsx";

function usePageDate() {
  const [params] = useSearchParams();
  const raw = params.get("date");
  return isValidIso(raw) ? raw : today();
}

function RangePicker({ value, options, onChange }: { value: number; options: number[]; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Period">
      {options.map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
          className={cx("rounded-full px-2.5 py-1 text-xs", value === n ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>{n} days</button>
      ))}
    </div>
  );
}

const stat = (label: string, value: string) => (
  <div className="rounded-xl bg-surface-2 p-2.5"><p className="text-[11px] text-ink-3">{label}</p><p className="num font-semibold">{value}</p></div>
);

/** Readings over time as dots, with optional reference lines and a shaded usual band. */
function DotChart({ points, from, to, lines = [], band, color, height = 150 }: {
  points: { t: number; value: number; warn: boolean }[];
  from: string; to: string;
  lines?: { value: number; label: string }[];
  band?: [number, number];
  color: string;
  height?: number;
}) {
  if (!points.length) return <p className="py-10 text-center text-sm text-ink-3">No readings in this period yet.</p>;
  const W = 320;
  const pad = { l: 34, r: 8, t: 10, b: 18 };
  const vals = [...points.map((p) => p.value), ...lines.map((l) => l.value), ...(band ?? [])];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1);
  lo -= span * 0.15; hi += span * 0.15;
  const t0 = new Date(`${from}T00:00:00`).getTime();
  const t1 = new Date(`${to}T23:59:59`).getTime();
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const short = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`${points.length} readings`}>
      {band && <rect x={pad.l} width={W - pad.l - pad.r} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} fill="var(--brand-soft)" opacity={0.8} />}
      {lines.map((l) => (
        <g key={l.label}>
          <line x1={pad.l} x2={W - pad.r} y1={y(l.value)} y2={y(l.value)} stroke="var(--ink-3)" strokeDasharray="4 3" strokeWidth={1} />
          <text x={pad.l - 6} y={y(l.value) + 3.5} textAnchor="end" fontSize={10} fill="var(--ink-3)">{l.label}</text>
        </g>
      ))}
      {band && [band[0], band[1]].map((v) => (
        <text key={v} x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--ink-3)">{v}</text>
      ))}
      {points.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.value)} r={3.5} fill={p.warn ? "var(--warn)" : color} stroke="var(--surface)" strokeWidth={1} />
      ))}
      <text x={pad.l} y={height - 4} fontSize={10} fill="var(--ink-3)">{short.format(t0)}</text>
      <text x={W - pad.r} y={height - 4} fontSize={10} fill="var(--ink-3)" textAnchor="end">{short.format(t1)}</text>
    </svg>
  );
}

// ── Blood glucose ───────────────────────────────────────────────────────────────────────

export function GlucosePage() {
  const date = usePageDate();
  const day = useTrackerDay(date);
  const [range, setRange] = useState(30);
  const from = addDays(date, -(range - 1));
  const readings = useQuery({ queryKey: ["health-log", "glucose", from, date], queryFn: () => api.glucose(from, date) });
  const [open, setOpen] = useState(false);
  const m = TRACKER_META.glucose;
  const d = day.data;

  return (
    <div className="min-h-dvh pb-10">
      <PageHeader title={m.title} right={d ? <IconButton label="Add reading" onClick={() => setOpen(true)} className={m.text}><Plus size={22} /></IconButton> : undefined} />
      <div className="mx-auto max-w-xl space-y-3 px-4">
        {day.error ? <ErrorNote error={day.error} /> : null}
        {!d ? <Spinner /> : (
          <>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-3">{date === today() ? "Today" : dayLabel(date)}</p>
                <UnitSwitch unit={d.glucose.unit} />
              </div>
              <GlucoseList readings={d.glucose.readings} unit={d.glucose.unit} />
              <Button className="mt-3 h-10" onClick={() => setOpen(true)}><Plus size={18} /> Add reading</Button>
            </Card>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">History</h2><RangePicker value={range} options={[7, 30, 90]} onChange={setRange} /></div>
              {!readings.data ? <Spinner /> : <GlucoseHistory readings={readings.data} day={d} from={from} to={date} />}
            </Card>
            <p className="px-1 text-xs leading-relaxed text-ink-3">
              Usual ranges for adults without diabetes (American Diabetes Association): fasting below 100 mg/dL (5.6 mmol/L);
              2 hours after eating below 140 mg/dL (7.8 mmol/L). If you have diabetes, your doctor may set different targets for you.
              This log is a record for you and your doctor, not a diagnosis.
            </p>
          </>
        )}
      </div>
      {d && <GlucoseSheet open={open} onClose={() => setOpen(false)} day={d} />}
    </div>
  );
}

function GlucoseList({ readings, unit }: { readings: GlucoseDTO[]; unit: TrackerDayDTO["glucose"]["unit"] }) {
  const invalidate = useInvalidateTrackers();
  if (!readings.length) return <p className="py-3 text-sm text-ink-2">No readings on this day.</p>;
  return (
    <ul className="mt-2 divide-y divide-line">
      {[...readings].reverse().map((r) => {
        const band = glucoseBand(r.mgdl, r.tag);
        const meal = r.mealType ? MEAL_TYPES.find((m) => m.code === r.mealType)?.name : null;
        return (
          <li key={r.id} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="num block text-lg font-bold">{glucoseIn(r.mgdl, unit)} <span className="text-xs font-normal text-ink-3">{unit}</span></span>
              <span className="block text-xs text-ink-3">
                {clock(r.measuredAt)} · {r.tag === "after_meal" && meal ? `2 h after ${meal}` : r.tag === "before_meal" && meal ? `Before ${meal}` : glucoseTagLabel(r.tag)}
              </span>
            </span>
            <span className={cx("rounded-full px-2 py-0.5 text-[11px]", band === "usual" ? "bg-brand-soft text-brand" : "bg-warn-soft text-warn")}>
              {GLUCOSE_BAND_LABEL[band].replace("In the usual range", "Usual")}
            </span>
            <IconButton label="Delete reading" onClick={async () => { if (confirm("Delete this reading?")) { await api.deleteGlucose(r.id); await invalidate(); } }}>
              <Trash2 size={16} />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}

function GlucoseHistory({ readings, day, from, to }: { readings: GlucoseDTO[]; day: TrackerDayDTO; from: string; to: string }) {
  const unit = day.glucose.unit;
  const conv = (mgdl: number) => glucoseIn(mgdl, unit);
  const fasting = readings.filter((r) => r.tag === "fasting" || r.tag === "before_meal");
  const after = readings.filter((r) => r.tag === "after_meal");
  const avg = (rs: GlucoseDTO[]) => (rs.length ? `${conv(rs.reduce((s, r) => s + r.mgdl, 0) / rs.length)} ${unit}` : "–");
  const usual = readings.filter((r) => glucoseBand(r.mgdl, r.tag) === "usual").length;
  return (
    <>
      <DotChart
        points={readings.map((r) => ({ t: r.measuredAt, value: conv(r.mgdl), warn: glucoseBand(r.mgdl, r.tag) !== "usual" }))}
        from={from} to={to} color={TRACKER_META.glucose.color}
        lines={unit === "mg/dL" ? [{ value: 100, label: "100" }, { value: 140, label: "140" }]
          : [{ value: Math.round((100 / MGDL_PER_MMOL) * 10) / 10, label: "5.6" }, { value: Math.round((140 / MGDL_PER_MMOL) * 10) / 10, label: "7.8" }]} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {stat("Avg fasting / before meals", avg(fasting))}
        {stat("Avg 2 h after meals", avg(after))}
        {stat("Readings", String(readings.length))}
        {stat("In the usual range", readings.length ? `${Math.round((usual / readings.length) * 100)}%` : "–")}
      </div>
    </>
  );
}

// ── Heart and breathing rate ────────────────────────────────────────────────────────────

export function VitalPage({ kind }: { kind: VitalKind }) {
  const date = usePageDate();
  const day = useTrackerDay(date);
  const invalidate = useInvalidateTrackers();
  const [range, setRange] = useState(30);
  const from = addDays(date, -(range - 1));
  const readings = useQuery({ queryKey: ["health-log", kind, from, date], queryFn: () => api.vitals(kind, from, date) });
  const [open, setOpen] = useState(false);
  const m = TRACKER_META[kind];
  const info = VITALS[kind];
  const d = day.data;
  const todays: VitalDTO[] = d ? d[kind].readings : [];
  const resting = (readings.data ?? []).filter((r) => r.context === "resting");

  return (
    <div className="min-h-dvh pb-10">
      <PageHeader title={m.title} right={d ? <IconButton label="Add reading" onClick={() => setOpen(true)} className={m.text}><Plus size={22} /></IconButton> : undefined} />
      <div className="mx-auto max-w-xl space-y-3 px-4">
        {!d ? <Spinner /> : (
          <>
            <Card className="p-4">
              <p className="text-xs text-ink-3">{date === today() ? "Today" : dayLabel(date)}</p>
              {!todays.length ? <p className="py-3 text-sm text-ink-2">No readings on this day.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {[...todays].reverse().map((r) => {
                    const band = vitalBand(kind, r.value, r.context);
                    return (
                      <li key={r.id} className="flex items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="num block text-lg font-bold" style={{ color: m.color }}>{r.value} <span className="text-xs font-normal text-ink-3">{info.unit}</span></span>
                          <span className="block text-xs text-ink-3">{clock(r.measuredAt)} · {r.context === "resting" ? "Resting" : r.context === "after_activity" ? "After activity" : "Other"}</span>
                        </span>
                        {band && (
                          <span className={cx("rounded-full px-2 py-0.5 text-[11px]", band === "usual" ? "bg-brand-soft text-brand" : "bg-warn-soft text-warn")}>
                            {band === "usual" ? "Usual" : band === "low" ? "Low" : "High"}
                          </span>
                        )}
                        <IconButton label="Delete reading" onClick={async () => { if (confirm("Delete this reading?")) { await api.deleteVital(r.id); await invalidate(); } }}>
                          <Trash2 size={16} />
                        </IconButton>
                      </li>
                    );
                  })}
                </ul>
              )}
              {todays.at(-1) && vitalBand(kind, todays.at(-1)!.value, todays.at(-1)!.context) && (
                <VitalNote kind={kind} band={vitalBand(kind, todays.at(-1)!.value, todays.at(-1)!.context)!} />
              )}
              <Button className="mt-3 h-10" onClick={() => setOpen(true)}><Plus size={18} /> Add reading</Button>
            </Card>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">History</h2><RangePicker value={range} options={[7, 30, 90]} onChange={setRange} /></div>
              {!readings.data ? <Spinner /> : (
                <>
                  <DotChart points={readings.data.map((r) => ({ t: r.measuredAt, value: r.value, warn: !!vitalBand(kind, r.value, r.context) && vitalBand(kind, r.value, r.context) !== "usual" }))}
                    from={from} to={date} band={info.resting} color={m.color} />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {stat("Average resting", resting.length ? `${Math.round(resting.reduce((s, r) => s + r.value, 0) / resting.length)} ${info.unit}` : "–")}
                    {stat("Readings", String(readings.data.length))}
                  </div>
                </>
              )}
            </Card>
            <p className="px-1 text-xs leading-relaxed text-ink-3">
              {kind === "heart"
                ? "A usual resting heart rate for adults is 60–100 beats per minute (American Heart Association); fit people are often lower. Get urgent help for chest pain, fainting or a racing heartbeat that doesn't settle."
                : "A usual resting breathing rate for adults is 12–20 breaths per minute. Get urgent help if you're struggling to breathe."}
              {" "}General information, not medical advice.
            </p>
          </>
        )}
      </div>
      {d && <VitalSheet kind={kind} open={open} onClose={() => setOpen(false)} day={d} />}
    </div>
  );
}

// ── Medicines ───────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleText(m: MedicineDTO): string {
  if (m.asNeeded) return "As needed";
  const days = m.days ? m.days.map((d) => WEEKDAYS[d]).join(", ") : "Every day";
  return `${days} · ${m.times.map(minutesToTime).join(", ")}`;
}

export function MedicinePage() {
  const date = usePageDate();
  const day = useTrackerDay(date);
  const meds = useQuery({ queryKey: ["health-log", "medicines"], queryFn: api.medicines });
  const [range, setRange] = useState(30);
  const from = addDays(date, -(range - 1));
  const adh = useQuery({ queryKey: ["health-log", "adherence", from, date], queryFn: () => api.adherence(from, date) });
  const [editing, setEditing] = useState<MedicineDTO | "new" | null>(null);
  const toast = useToast();
  const m = TRACKER_META.medicine;
  const d = day.data;

  const totals = (adh.data ?? []).reduce((s, x) => ({ scheduled: s.scheduled + x.scheduled, taken: s.taken + x.taken }), { scheduled: 0, taken: 0 });
  const hasSchedule = (meds.data ?? []).some((x) => x.active && !x.asNeeded);

  return (
    <div className="min-h-dvh pb-10">
      <PageHeader title={m.title} right={<IconButton label="Add medicine" onClick={() => setEditing("new")} className={m.text}><Plus size={22} /></IconButton>} />
      <div className="mx-auto max-w-xl space-y-3 px-4">
        {!d ? <Spinner /> : (
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{date === today() ? "Today" : dayLabel(date)}</h2>
            <DoseChecklist day={d.medicine} />
          </Card>
        )}
        <Card>
          <div className="flex items-center justify-between px-4 pt-3">
            <h2 className="font-semibold">Your medicines</h2>
            <Button variant="ghost" className="-mr-2 h-9 text-sm" onClick={() => setEditing("new")}><Plus size={16} /> Add</Button>
          </div>
          {!meds.data ? <Spinner /> : !meds.data.length ? (
            <p className="px-4 pb-4 text-sm text-ink-2">Add the medicines and supplements you take, with their times, to get a daily checklist.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {meds.data.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setEditing(x)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate font-medium", !x.active && "text-ink-3")}>{x.name}{x.dose ? <span className="font-normal text-ink-3"> · {x.dose}</span> : null}</span>
                      <span className="block truncate text-xs text-ink-3">{x.active ? scheduleText(x) : "Paused"}{x.endDate ? ` · until ${dayLabel(x.endDate)}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasSchedule && (
            <button type="button" onClick={() => void downloadFromApi("/medicines/reminders.ics", "medicine-reminders.ics").then(() => toast("Open the file to add the reminders to your calendar"))}
              className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-sm font-semibold text-brand">
              <CalendarPlus size={18} /> Add reminders to your calendar
            </button>
          )}
        </Card>
        {hasSchedule && (
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Doses taken</h2><RangePicker value={range} options={[7, 30]} onChange={setRange} /></div>
            {!adh.data ? <Spinner /> : (
              <>
                <BarChart days={adh.data.map((x) => ({ date: x.date, value: x.scheduled ? Math.round((x.taken / x.scheduled) * 100) : null }))}
                  goal={100} color={m.color} format={(v) => `${v}%`} today={today()} />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {stat("Doses taken", totals.scheduled ? `${Math.round((totals.taken / totals.scheduled) * 100)}%` : "–")}
                  {stat("Taken of scheduled", `${totals.taken} of ${totals.scheduled}`)}
                </div>
              </>
            )}
          </Card>
        )}
        <p className="px-1 text-xs leading-relaxed text-ink-3">
          Reminders come from your phone's calendar, so they work even when this app is closed. Re-download the file after you change a schedule.
          Don't change or stop a medicine without talking to your doctor.
        </p>
      </div>
      <MedicineSheet editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function MedicineSheet({ editing, onClose }: { editing: MedicineDTO | "new" | null; onClose: () => void }) {
  const invalidate = useInvalidateTrackers();
  const toast = useToast();
  const save = useSave();
  const existing = editing && editing !== "new" ? editing : null;
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [asNeeded, setAsNeeded] = useState(false);
  const [times, setTimes] = useState<number[]>([9 * 60]);
  const [days, setDays] = useState<number[] | null>(null);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!editing) return;
    save.reset();
    const e = editing === "new" ? null : editing;
    setName(e?.name ?? "");
    setDose(e?.dose ?? "");
    setAsNeeded(e?.asNeeded ?? false);
    setTimes(e?.times.length ? e.times : [9 * 60]);
    setDays(e?.days ?? null);
    setStartDate(e?.startDate ?? today());
    setEndDate(e?.endDate ?? "");
    setNotes(e?.notes ?? "");
    setActive(e?.active ?? true);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const body: MedicineBody = {
    name, dose: dose || null, asNeeded, times: asNeeded ? [] : times, days, startDate, endDate: endDate || null, notes: notes || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, active,
  };
  const valid = name.trim().length > 0 && (asNeeded || times.length > 0) && (!days || days.length > 0);

  return (
    <Sheet open={editing !== null} onClose={onClose} title={existing ? "Edit medicine" : "Add medicine"}
      footer={<Button block disabled={save.busy || !valid} onClick={() => void save.run(async () => {
        if (existing) await api.updateMedicine(existing.id, body);
        else await api.createMedicine(body);
        await invalidate();
        onClose();
        toast(existing ? "Medicine updated" : "Medicine added");
      })}>Save</Button>}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Metformin" className="input" maxLength={80} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Dose (optional)</span>
          <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 500 mg, 1 tablet" className="input" maxLength={60} />
        </label>
        <label className="flex items-center gap-3">
          <input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} />
          <span className="text-sm">Only when needed (no fixed times)</span>
        </label>
        {!asNeeded && (
          <>
            <div>
              <span className="mb-1.5 block text-sm font-medium">Times</span>
              <div className="space-y-2">
                {times.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="time" value={timeInputValue(t)} className="input"
                      onChange={(e) => e.target.value && setTimes(times.map((x, j) => (j === i ? parseTimeInput(e.target.value) : x)))} />
                    {times.length > 1 && (
                      <IconButton label="Remove time" onClick={() => setTimes(times.filter((_, j) => j !== i))}><Trash2 size={16} /></IconButton>
                    )}
                  </div>
                ))}
              </div>
              {times.length < 6 && (
                <Button variant="ghost" className="-ml-4 h-9 text-sm" onClick={() => setTimes([...times, Math.min(23 * 60, (times.at(-1) ?? 480) + 12 * 60) % (24 * 60)])}>
                  <Plus size={16} /> Add a time
                </Button>
              )}
            </div>
            <div>
              <span className="mb-1.5 block text-sm font-medium">Days</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setDays(null)}
                  className={cx("rounded-full px-3 py-1.5 text-sm", !days ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>Every day</button>
                {WEEKDAYS.map((w, i) => {
                  const on = !!days?.includes(i);
                  return (
                    <button key={w} type="button" aria-pressed={on}
                      onClick={() => setDays(on ? (days!.filter((x) => x !== i)) : [...(days ?? []), i].sort())}
                      className={cx("rounded-full px-2.5 py-1.5 text-sm", on ? "bg-ink font-semibold text-bg" : "bg-surface-2 text-ink-2")}>{w}</button>
                  );
                })}
              </div>
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Start</span>
            <input type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">End (optional)</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. after food" className="input" maxLength={300} />
        </label>
        {existing && (
          <label className="flex items-center gap-3">
            <input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="text-sm">Active (untick to pause it without losing its history)</span>
          </label>
        )}
        {save.error ? <ErrorNote error={save.error} /> : null}
        {existing && (
          <Button variant="danger" className="-ml-4" onClick={() => void save.run(async () => {
            if (!confirm(`Delete ${existing.name}? Its dose history stays in your charts.`)) return;
            await api.deleteMedicine(existing.id);
            await invalidate();
            onClose();
            toast("Medicine deleted");
          })}>Delete medicine</Button>
        )}
      </div>
    </Sheet>
  );
}
