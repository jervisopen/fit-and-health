/**
 * Blood glucose, heart rate, breathing rate and medicines: shared rules and API types.
 * Reference ranges are general information for adults, not a diagnosis or treatment advice.
 */
import type { MealTypeCode } from "./meals.ts";

// ── Blood glucose ─────────────────────────────────────────────────────────────────────────
export type GlucoseTag = "fasting" | "before_meal" | "after_meal" | "random" | "bedtime";
export const GLUCOSE_TAGS: { key: GlucoseTag; label: string }[] = [
  { key: "fasting", label: "Fasting (8+ h, morning)" },
  { key: "before_meal", label: "Before a meal" },
  { key: "after_meal", label: "2 h after a meal" },
  { key: "random", label: "Random" },
  { key: "bedtime", label: "Bedtime" },
];
export const glucoseTagLabel = (t: GlucoseTag) => GLUCOSE_TAGS.find((x) => x.key === t)?.label ?? t;

export type GlucoseUnit = "mg/dL" | "mmol/L";
export const MGDL_PER_MMOL = 18.016;

/** Stored as mg/dL; shown in the user's unit (mmol/L to one decimal). */
export function glucoseIn(mgdl: number, unit: GlucoseUnit): number {
  return unit === "mmol/L" ? Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10 : Math.round(mgdl);
}
export function glucoseToMgdl(value: number, unit: GlucoseUnit): number {
  return unit === "mmol/L" ? Math.round(value * MGDL_PER_MMOL * 10) / 10 : value;
}

export type GlucoseBand = "low" | "usual" | "above" | "high";

/**
 * Where a reading sits against the usual ranges for adults without diabetes (American Diabetes
 * Association): fasting < 100 mg/dL (100–125 above usual, 126+ high); 2 h after eating or random
 * < 140 (140–199 above usual, 200+ high); below 70 is low. People with diabetes usually have
 * personal targets from their doctor.
 */
export function glucoseBand(mgdl: number, tag: GlucoseTag): GlucoseBand {
  if (mgdl < 70) return "low";
  const [usual, high] = tag === "fasting" || tag === "before_meal" ? [100, 126] : [140, 200];
  if (mgdl < usual) return "usual";
  return mgdl < high ? "above" : "high";
}

export const GLUCOSE_BAND_LABEL: Record<GlucoseBand, string> = {
  low: "Low", usual: "In the usual range", above: "Above the usual range", high: "High",
};

export type GlucoseDTO = {
  id: string; date: string; measuredAt: number; mgdl: number; tag: GlucoseTag;
  mealType: MealTypeCode | null; note: string | null;
};
export type GlucoseBody = {
  date: string; measuredAt: number; value: number; unit: GlucoseUnit; tag: GlucoseTag;
  mealType?: MealTypeCode | null; note?: string | null;
};

// ── Heart rate and breathing rate ─────────────────────────────────────────────────────────
export type VitalKind = "heart" | "breathing";
export type VitalContext = "resting" | "after_activity" | "other";
export const VITAL_CONTEXTS: { key: VitalContext; label: string }[] = [
  { key: "resting", label: "Resting" },
  { key: "after_activity", label: "After activity" },
  { key: "other", label: "Other" },
];

/** Usual resting ranges for adults: heart 60–100 bpm (AHA), breathing 12–20 breaths a minute. */
export const VITALS: Record<VitalKind, { title: string; unit: string; min: number; max: number; resting: [number, number] }> = {
  heart: { title: "Heart rate", unit: "bpm", min: 20, max: 250, resting: [60, 100] },
  breathing: { title: "Breathing rate", unit: "breaths/min", min: 4, max: 60, resting: [12, 20] },
};

/** Only resting readings are compared with the resting range. */
export function vitalBand(kind: VitalKind, value: number, context: VitalContext): "low" | "usual" | "high" | null {
  if (context !== "resting") return null;
  const [lo, hi] = VITALS[kind].resting;
  return value < lo ? "low" : value > hi ? "high" : "usual";
}

export type VitalDTO = { id: string; kind: VitalKind; date: string; measuredAt: number; value: number; context: VitalContext; note: string | null };
export type VitalBody = { kind: VitalKind; date: string; measuredAt: number; value: number; context: VitalContext; note?: string | null };

// ── Medicines ─────────────────────────────────────────────────────────────────────────────
export type MedicineDTO = {
  id: string;
  name: string;
  dose: string | null;
  /** Minutes after midnight, sorted. Empty for "as needed". */
  times: number[];
  /** Weekdays (0 = Sunday); null = every day. */
  days: number[] | null;
  asNeeded: boolean;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  timezone: string;
  active: boolean;
};
export type MedicineBody = {
  name: string; dose?: string | null; times: number[]; days?: number[] | null; asNeeded: boolean;
  startDate: string; endDate?: string | null; notes?: string | null; timezone: string; active?: boolean;
};

export type DoseStatus = "pending" | "taken" | "skipped";
export type DoseDTO = {
  /** Id of the recorded dose; null while still pending. */
  id: string | null;
  medicineId: string;
  name: string;
  dose: string | null;
  date: string;
  /** Scheduled time; null for an as-needed dose. */
  timeMin: number | null;
  status: DoseStatus;
  recordedAt: number | null;
};
export type DoseBody = { medicineId: string; date: string; timeMin: number | null; status: "taken" | "skipped" };
export type MedicineDayDTO = { date: string; doses: DoseDTO[]; asNeeded: MedicineDTO[]; scheduled: number; taken: number };
export type AdherenceDayDTO = { date: string; scheduled: number; taken: number };

/** Is the medicine scheduled on this date (weekday of the ISO date, calendar-wise)? */
export function scheduledOn(m: Pick<MedicineDTO, "asNeeded" | "active" | "startDate" | "endDate" | "days">, date: string): boolean {
  if (m.asNeeded || !m.active || date < m.startDate || (m.endDate && date > m.endDate)) return false;
  if (!m.days) return true;
  return m.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
}
