/** Blood glucose, heart and breathing rate, and medicines (schedules, doses, adherence, reminders). */
import type { Db } from "../db/types.ts";
import { newId, transaction } from "../db/types.ts";
import { NotFoundError, ValidationError } from "../foods/repo.ts";
import type { MealTypeCode } from "../../../../packages/shared/src/meals.ts";
import {
  glucoseToMgdl, scheduledOn,
  type AdherenceDayDTO, type DoseBody, type DoseDTO, type GlucoseBody, type GlucoseDTO, type GlucoseTag, type MedicineBody,
  type MedicineDayDTO, type MedicineDTO, type VitalBody, type VitalContext, type VitalDTO, type VitalKind,
} from "../../../../packages/shared/src/health.ts";
import { VITALS } from "../../../../packages/shared/src/health.ts";

// ── Glucose ──

type GlucoseRow = { id: string; date: string; measured_at: number; mgdl: number; tag: GlucoseTag; meal_type: MealTypeCode | null; note: string | null };
const glucoseDto = (r: GlucoseRow): GlucoseDTO => ({
  id: r.id, date: r.date, measuredAt: r.measured_at, mgdl: r.mgdl, tag: r.tag, mealType: r.meal_type, note: r.note,
});

export function addGlucose(db: Db, b: GlucoseBody): GlucoseDTO {
  const mgdl = glucoseToMgdl(b.value, b.unit);
  if (!(mgdl >= 10 && mgdl <= 1000)) throw new ValidationError("That reading is outside what a glucose meter shows (10–1000 mg/dL)");
  const id = newId();
  db.prepare("INSERT INTO glucose_logs (id, date, measured_at, mgdl, tag, meal_type, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, b.date, b.measuredAt, mgdl, b.tag, b.mealType ?? null, b.note?.trim() || null);
  return glucoseDto(db.prepare("SELECT * FROM glucose_logs WHERE id = ?").get(id) as GlucoseRow);
}

export function deleteGlucose(db: Db, id: string) {
  const r = db.prepare("DELETE FROM glucose_logs WHERE id = ?").run(id) as { changes: number };
  if (!r.changes) throw new NotFoundError("Reading not found");
}

export function glucoseBetween(db: Db, from: string, to: string): GlucoseDTO[] {
  return (db.prepare("SELECT * FROM glucose_logs WHERE date BETWEEN ? AND ? ORDER BY measured_at").all(from, to) as GlucoseRow[]).map(glucoseDto);
}

// ── Heart and breathing rate ──

type VitalRow = { id: string; kind: VitalKind; date: string; measured_at: number; value: number; context: VitalContext; note: string | null };
const vitalDto = (r: VitalRow): VitalDTO => ({
  id: r.id, kind: r.kind, date: r.date, measuredAt: r.measured_at, value: r.value, context: r.context, note: r.note,
});

export function addVital(db: Db, b: VitalBody): VitalDTO {
  const info = VITALS[b.kind];
  if (!(b.value >= info.min && b.value <= info.max)) throw new ValidationError(`${info.title} must be between ${info.min} and ${info.max} ${info.unit}`);
  const id = newId();
  db.prepare("INSERT INTO vital_logs (id, kind, date, measured_at, value, context, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, b.kind, b.date, b.measuredAt, Math.round(b.value), b.context, b.note?.trim() || null);
  return vitalDto(db.prepare("SELECT * FROM vital_logs WHERE id = ?").get(id) as VitalRow);
}

export function deleteVital(db: Db, id: string) {
  const r = db.prepare("DELETE FROM vital_logs WHERE id = ?").run(id) as { changes: number };
  if (!r.changes) throw new NotFoundError("Reading not found");
}

export function vitalsBetween(db: Db, kind: VitalKind, from: string, to: string): VitalDTO[] {
  return (db.prepare("SELECT * FROM vital_logs WHERE kind = ? AND date BETWEEN ? AND ? ORDER BY measured_at").all(kind, from, to) as VitalRow[]).map(vitalDto);
}

// ── Medicines ──

type MedicineRow = {
  id: string; name: string; dose: string | null; times: string; days: string | null; as_needed: number; start_date: string;
  end_date: string | null; notes: string | null; timezone: string; active: number; created_at: number; deleted_at: number | null;
};
const medicineDto = (r: MedicineRow): MedicineDTO => ({
  id: r.id, name: r.name, dose: r.dose, times: JSON.parse(r.times) as number[], days: r.days ? (JSON.parse(r.days) as number[]) : null,
  asNeeded: !!r.as_needed, startDate: r.start_date, endDate: r.end_date, notes: r.notes, timezone: r.timezone, active: !!r.active,
});

function cleanMedicine(b: MedicineBody) {
  const times = b.asNeeded ? [] : [...new Set(b.times.map((t) => Math.round(t)))].sort((a, c) => a - c);
  if (!b.asNeeded && !times.length) throw new ValidationError("Add at least one time, or mark it as needed");
  const days = b.days && b.days.length && b.days.length < 7 ? [...new Set(b.days)].sort() : null;
  if (b.endDate && b.endDate < b.startDate) throw new ValidationError("The end date is before the start date");
  return { times, days };
}

export function listMedicines(db: Db): MedicineDTO[] {
  return (db.prepare("SELECT * FROM medicines WHERE deleted_at IS NULL ORDER BY active DESC, name COLLATE NOCASE").all() as MedicineRow[]).map(medicineDto);
}

function getMedicineRow(db: Db, id: string): MedicineRow {
  const r = db.prepare("SELECT * FROM medicines WHERE id = ? AND deleted_at IS NULL").get(id) as MedicineRow | undefined;
  if (!r) throw new NotFoundError("Medicine not found");
  return r;
}

export function createMedicine(db: Db, b: MedicineBody, now: number): MedicineDTO {
  const { times, days } = cleanMedicine(b);
  const id = newId();
  db.prepare(`INSERT INTO medicines (id, name, dose, times, days, as_needed, start_date, end_date, notes, timezone, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.name.trim(), b.dose?.trim() || null, JSON.stringify(times), days ? JSON.stringify(days) : null, b.asNeeded ? 1 : 0,
      b.startDate, b.endDate ?? null, b.notes?.trim() || null, b.timezone, b.active === false ? 0 : 1, now);
  return medicineDto(getMedicineRow(db, id));
}

export function updateMedicine(db: Db, id: string, b: MedicineBody): MedicineDTO {
  getMedicineRow(db, id);
  const { times, days } = cleanMedicine(b);
  db.prepare(`UPDATE medicines SET name = ?, dose = ?, times = ?, days = ?, as_needed = ?, start_date = ?, end_date = ?, notes = ?,
              timezone = ?, active = ? WHERE id = ?`)
    .run(b.name.trim(), b.dose?.trim() || null, JSON.stringify(times), days ? JSON.stringify(days) : null, b.asNeeded ? 1 : 0,
      b.startDate, b.endDate ?? null, b.notes?.trim() || null, b.timezone, b.active === false ? 0 : 1, id);
  return medicineDto(getMedicineRow(db, id));
}

export function deleteMedicine(db: Db, id: string, now: number) {
  getMedicineRow(db, id);
  db.prepare("UPDATE medicines SET deleted_at = ?, active = 0 WHERE id = ?").run(now, id);
}

type DoseRow = { id: string; medicine_id: string; date: string; time_min: number | null; status: "taken" | "skipped"; recorded_at: number };

/** Today's scheduled doses (with their status) plus as-needed doses already taken. */
export function medicineDay(db: Db, date: string): MedicineDayDTO {
  const meds = (db.prepare("SELECT * FROM medicines").all() as MedicineRow[]).map((r) => ({ ...medicineDto(r), deleted: r.deleted_at !== null }));
  const byId = new Map(meds.map((m) => [m.id, m]));
  const recorded = db.prepare("SELECT * FROM medicine_doses WHERE date = ?").all(date) as DoseRow[];
  const slot = (id: string, t: number | null) => recorded.find((d) => d.medicine_id === id && d.time_min === t);

  const doses: DoseDTO[] = [];
  for (const m of meds) {
    if (m.deleted || !scheduledOn(m, date)) continue;
    for (const t of m.times) {
      const d = slot(m.id, t);
      doses.push({ id: d?.id ?? null, medicineId: m.id, name: m.name, dose: m.dose, date, timeMin: t, status: d?.status ?? "pending", recordedAt: d?.recorded_at ?? null });
    }
  }
  for (const d of recorded.filter((x) => x.time_min === null)) {
    const m = byId.get(d.medicine_id);
    if (m) doses.push({ id: d.id, medicineId: m.id, name: m.name, dose: m.dose, date, timeMin: null, status: d.status, recordedAt: d.recorded_at });
  }
  // Scheduled doses by time, then as-needed doses in the order they were taken.
  doses.sort((a, b) => (a.timeMin ?? 1e9 + (a.recordedAt ?? 0) / 1e9) - (b.timeMin ?? 1e9 + (b.recordedAt ?? 0) / 1e9));
  const scheduled = doses.filter((d) => d.timeMin !== null);
  return {
    date,
    doses,
    asNeeded: meds.filter((m) => !m.deleted && m.active && m.asNeeded && date >= m.startDate && (!m.endDate || date <= m.endDate)),
    scheduled: scheduled.length,
    taken: scheduled.filter((d) => d.status === "taken").length,
  };
}

/** Mark a dose taken or skipped (scheduled doses: one record per slot; as-needed: one per dose taken). */
export function recordDose(db: Db, b: DoseBody, now: number): DoseDTO {
  const m = medicineDto(getMedicineRow(db, b.medicineId));
  if (b.timeMin !== null && !m.times.includes(b.timeMin)) throw new ValidationError("That time isn't in this medicine's schedule");
  if (b.timeMin === null && !m.asNeeded) throw new ValidationError("Pick which scheduled dose this is");
  return transaction(db, () => {
    let id: string;
    const existing = b.timeMin === null ? undefined
      : db.prepare("SELECT id FROM medicine_doses WHERE medicine_id = ? AND date = ? AND time_min = ?").get(b.medicineId, b.date, b.timeMin) as { id: string } | undefined;
    if (existing) {
      id = existing.id;
      db.prepare("UPDATE medicine_doses SET status = ?, recorded_at = ? WHERE id = ?").run(b.status, now, id);
    } else {
      id = newId();
      db.prepare("INSERT INTO medicine_doses (id, medicine_id, date, time_min, status, recorded_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, b.medicineId, b.date, b.timeMin, b.status, now);
    }
    return { id, medicineId: m.id, name: m.name, dose: m.dose, date: b.date, timeMin: b.timeMin, status: b.status, recordedAt: now };
  });
}

/** Undo: the dose goes back to pending (or disappears, for as-needed). */
export function deleteDose(db: Db, id: string) {
  const r = db.prepare("DELETE FROM medicine_doses WHERE id = ?").run(id) as { changes: number };
  if (!r.changes) throw new NotFoundError("Dose not found");
}

export function adherence(db: Db, from: string, to: string): AdherenceDayDTO[] {
  const meds = (db.prepare("SELECT * FROM medicines WHERE deleted_at IS NULL").all() as MedicineRow[]).map(medicineDto);
  const taken = db.prepare(`SELECT date, medicine_id, time_min FROM medicine_doses
                            WHERE status = 'taken' AND time_min IS NOT NULL AND date BETWEEN ? AND ?`).all(from, to) as DoseRow[];
  const out: AdherenceDayDTO[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    let scheduled = 0;
    let done = 0;
    for (const m of meds) {
      if (!scheduledOn(m, d)) continue;
      scheduled += m.times.length;
      done += taken.filter((t) => t.date === d && t.medicine_id === m.id && m.times.includes(t.time_min!)).length;
    }
    out.push({ date: d, scheduled, taken: done });
  }
  return out;
}

// ── Calendar reminders (works without notifications from the app) ──

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function medicinesIcs(db: Db, now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//fit-and-health//medicines//EN", "CALSCALE:GREGORIAN"];
  for (const m of listMedicines(db).filter((x) => x.active && !x.asNeeded)) {
    for (const t of m.times) {
      const hh = String(Math.floor(t / 60)).padStart(2, "0");
      const mm = String(t % 60).padStart(2, "0");
      const rule = ["RRULE:FREQ=" + (m.days ? "WEEKLY" : "DAILY")];
      if (m.days) rule.push(`BYDAY=${m.days.map((d) => BYDAY[d]).join(",")}`);
      if (m.endDate) rule.push(`UNTIL=${m.endDate.replace(/-/g, "")}T235959Z`);
      const title = `Take ${m.name}${m.dose ? ` (${m.dose})` : ""}`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:medicine-${m.id}-${t}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${m.timezone}:${m.startDate.replace(/-/g, "")}T${hh}${mm}00`,
        "DURATION:PT5M",
        rule.join(";"),
        `SUMMARY:${icsText(title)}`,
        `DESCRIPTION:${icsText(m.notes ? `${m.notes}\nMark it taken in fit&health.` : "Mark it taken in fit&health.")}`,
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(title)}`, "TRIGGER:PT0M", "END:VALARM",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}
