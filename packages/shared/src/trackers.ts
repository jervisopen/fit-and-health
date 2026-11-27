/**
 * Daily trackers (water, weight, workout, steps, sleep, plus the health logs in health.ts):
 * shared rules and API types. General guidance only, not medical advice.
 */
import type { GlucoseDTO, GlucoseUnit, MedicineDayDTO, VitalDTO } from "./health.ts";

// ── Workouts ───────────────────────────────────────────────────────────────────────────────
/**
 * MET values (energy cost as a multiple of resting) from the Compendium of Physical Activities
 * (Ainsworth et al. 2011). Calories = MET × body weight (kg) × hours. Estimates: real burn varies
 * with fitness, effort and technique.
 */
export type Activity = { key: string; name: string; met: number; group: ActivityGroup };
export type ActivityGroup = "Walking & running" | "Yoga & fitness" | "Sports" | "Everyday";

export const ACTIVITIES: Activity[] = [
  { key: "walk_slow", name: "Walking, slow (3 km/h)", met: 2.8, group: "Walking & running" },
  { key: "walk", name: "Walking, normal (5 km/h)", met: 3.5, group: "Walking & running" },
  { key: "walk_brisk", name: "Walking, brisk (5.5–6 km/h)", met: 4.3, group: "Walking & running" },
  { key: "stairs", name: "Climbing stairs", met: 4.0, group: "Walking & running" },
  { key: "hike", name: "Trekking / hiking", met: 6.0, group: "Walking & running" },
  { key: "run_8", name: "Running, 8 km/h", met: 8.3, group: "Walking & running" },
  { key: "run_10", name: "Running, 10 km/h", met: 9.8, group: "Walking & running" },
  { key: "run_11", name: "Running, 11+ km/h", met: 11.0, group: "Walking & running" },
  { key: "cycle_easy", name: "Cycling, easy", met: 4.0, group: "Walking & running" },
  { key: "cycle", name: "Cycling, moderate (19–22 km/h)", met: 8.0, group: "Walking & running" },

  { key: "yoga", name: "Yoga (hatha)", met: 2.5, group: "Yoga & fitness" },
  { key: "surya_namaskar", name: "Surya namaskar", met: 3.3, group: "Yoga & fitness" },
  { key: "yoga_power", name: "Power yoga", met: 4.0, group: "Yoga & fitness" },
  { key: "pilates", name: "Pilates", met: 3.0, group: "Yoga & fitness" },
  { key: "stretching", name: "Stretching", met: 2.3, group: "Yoga & fitness" },
  { key: "weights", name: "Strength training, moderate", met: 3.5, group: "Yoga & fitness" },
  { key: "weights_hard", name: "Strength training, vigorous", met: 6.0, group: "Yoga & fitness" },
  { key: "hiit", name: "HIIT / circuit training", met: 8.0, group: "Yoga & fitness" },
  { key: "aerobics", name: "Aerobics / Zumba", met: 7.3, group: "Yoga & fitness" },
  { key: "dance", name: "Dancing (Bollywood, garba, bhangra)", met: 5.0, group: "Yoga & fitness" },
  { key: "skipping", name: "Skipping rope", met: 11.8, group: "Yoga & fitness" },
  { key: "elliptical", name: "Elliptical trainer", met: 5.0, group: "Yoga & fitness" },
  { key: "exercise_bike", name: "Exercise bike, moderate", met: 6.8, group: "Yoga & fitness" },
  { key: "rowing", name: "Rowing machine", met: 7.0, group: "Yoga & fitness" },
  { key: "swim_easy", name: "Swimming, leisurely", met: 6.0, group: "Yoga & fitness" },
  { key: "swim", name: "Swimming laps, fast", met: 9.8, group: "Yoga & fitness" },

  { key: "cricket", name: "Cricket", met: 4.8, group: "Sports" },
  { key: "badminton", name: "Badminton", met: 5.5, group: "Sports" },
  { key: "football", name: "Football", met: 7.0, group: "Sports" },
  { key: "basketball", name: "Basketball", met: 6.5, group: "Sports" },
  { key: "volleyball", name: "Volleyball", met: 4.0, group: "Sports" },
  { key: "tennis", name: "Tennis", met: 7.3, group: "Sports" },
  { key: "table_tennis", name: "Table tennis", met: 4.0, group: "Sports" },

  { key: "housework", name: "Housework (sweeping, mopping)", met: 3.3, group: "Everyday" },
  { key: "gardening", name: "Gardening", met: 3.8, group: "Everyday" },
];

export const CUSTOM_ACTIVITY = "custom";

export function activity(key: string): Activity | undefined {
  return ACTIVITIES.find((a) => a.key === key);
}

/** Total energy spent during the activity. */
export function workoutKcal(met: number, weightKg: number, minutes: number): number {
  return Math.round(met * weightKg * (minutes / 60));
}

/**
 * Extra energy above resting (MET − 1): what the workout adds to the day on top of the calories
 * the goal already counts, so it is the honest number to add to the food budget.
 */
export function workoutNetKcal(met: number, weightKg: number, minutes: number): number {
  return Math.round(Math.max(0, met - 1) * weightKg * (minutes / 60));
}

/** Used for calorie estimates when no weight has been logged yet. */
export const FALLBACK_WEIGHT_KG = 65;

// ── Steps ─────────────────────────────────────────────────────────────────────────────────
/** Step length is roughly 41% of height (about 0.41 for women and 0.42 for men). */
export function strideM(heightCm: number | null, sex?: "female" | "male" | null): number {
  if (!heightCm) return 0.7;
  return (heightCm / 100) * (sex === "male" ? 0.415 : sex === "female" ? 0.413 : 0.414);
}

/**
 * Distance and calories for a day's steps, treating them as walking at ~5 km/h (MET 3.5):
 * about 0.7 kcal per kg per km in total, of which ~0.5 is above resting.
 */
export function stepsEnergy(steps: number, weightKg: number | null, heightCm: number | null, sex?: "female" | "male" | null) {
  const km = (steps * strideM(heightCm, sex)) / 1000;
  const kg = weightKg ?? FALLBACK_WEIGHT_KG;
  const hours = km / 5;
  return { km: Math.round(km * 100) / 100, kcal: Math.round(3.5 * kg * hours), netKcal: Math.round(2.5 * kg * hours) };
}

// ── Weight ────────────────────────────────────────────────────────────────────────────────
/**
 * Healthy weight for a height using BMI 18.5–22.9, the normal range for Asian Indian adults
 * (WHO expert consultation 2004; Indian consensus guidelines, Misra et al. 2009).
 */
export function healthyWeightRange(heightCm: number): { minKg: number; maxKg: number } | null {
  if (!(heightCm >= 100 && heightCm <= 250)) return null;
  const m = heightCm / 100;
  return { minKg: Math.round(18.5 * m * m), maxKg: Math.round(22.9 * m * m) };
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

// ── Water ─────────────────────────────────────────────────────────────────────────────────
/** About 35 ml per kg of body weight, in whole glasses, between 1.5 and 4 litres. */
export function suggestedWaterMl(weightKg: number | null, glassMl = 250): number {
  const ml = (weightKg ?? FALLBACK_WEIGHT_KG) * 35;
  const clamped = Math.min(4000, Math.max(1500, ml));
  return Math.round(clamped / glassMl) * glassMl;
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────
export type TrackerKind = "water" | "weight" | "workout" | "steps" | "sleep" | "glucose" | "medicine" | "heart" | "breathing";
export const TRACKER_KINDS: TrackerKind[] = ["water", "weight", "workout", "steps", "sleep", "glucose", "medicine", "heart", "breathing"];

export type TrackerSettings = {
  water: { enabled: boolean; goalMl: number | null; glassMl: number };
  /** heightCm is only used when there's no profile (Me → Daily goals) to take it from. */
  weight: { enabled: boolean; goalKg: number | null; heightCm: number | null };
  /** WHO: at least 150 active minutes a week, i.e. about 30 minutes on 5 days. */
  workout: { enabled: boolean; goalMin: number; addToBudget: boolean };
  /** Benefits keep growing up to roughly 8,000–10,000 steps a day for most adults. */
  steps: { enabled: boolean; goal: number };
  /** Adults: 7–9 hours. */
  sleep: { enabled: boolean; goalMin: number };
  glucose: { enabled: boolean; unit: GlucoseUnit };
  medicine: { enabled: boolean };
  heart: { enabled: boolean };
  breathing: { enabled: boolean };
};

export const DEFAULT_TRACKER_SETTINGS: TrackerSettings = {
  water: { enabled: true, goalMl: null, glassMl: 250 },
  weight: { enabled: true, goalKg: null, heightCm: null },
  workout: { enabled: true, goalMin: 30, addToBudget: false },
  steps: { enabled: true, goal: 8000 },
  sleep: { enabled: true, goalMin: 8 * 60 },
  // Health logs are opt-in so the Diary stays simple for people who don't need them.
  glucose: { enabled: false, unit: "mg/dL" },
  medicine: { enabled: false },
  heart: { enabled: false },
  breathing: { enabled: false },
};

export type TrackerSettingsPatch = { [K in TrackerKind]?: Partial<TrackerSettings[K]> };

export function mergeTrackerSettings(base: TrackerSettings, patch: TrackerSettingsPatch): TrackerSettings {
  return {
    water: { ...base.water, ...patch.water },
    weight: { ...base.weight, ...patch.weight },
    workout: { ...base.workout, ...patch.workout },
    steps: { ...base.steps, ...patch.steps },
    sleep: { ...base.sleep, ...patch.sleep },
    glucose: { ...base.glucose, ...patch.glucose },
    medicine: { ...base.medicine, ...patch.medicine },
    heart: { ...base.heart, ...patch.heart },
    breathing: { ...base.breathing, ...patch.breathing },
  };
}

// ── API types ─────────────────────────────────────────────────────────────────────────────
export type WaterEntryDTO = { id: string; date: string; ml: number; loggedAt: number };
export type WeightEntryDTO = { date: string; kg: number; note: string | null };
export type WorkoutDTO = {
  id: string; date: string; activityKey: string; name: string; minutes: number;
  met: number | null; kcal: number; netKcal: number; note: string | null; loggedAt: number;
};
export type SleepDTO = { date: string; bedAt: number; wakeAt: number; minutes: number; quality: number | null; note: string | null };

export type TrackerDayDTO = {
  date: string;
  settings: TrackerSettings;
  water: { ml: number; goalMl: number; glassMl: number; entries: WaterEntryDTO[] };
  weight: {
    today: WeightEntryDTO | null;
    latest: WeightEntryDTO | null;
    /** Weight used for calorie estimates: latest log on or before the date, else the profile. */
    currentKg: number | null;
    heightCm: number | null;
    healthy: { minKg: number; maxKg: number } | null;
  };
  workout: { entries: WorkoutDTO[]; minutes: number; kcal: number; netKcal: number; goalMin: number };
  /** Steps are typed in (a website can't read the phone's step counter). */
  steps: { steps: number | null; goal: number; km: number; kcal: number };
  sleep: { entry: SleepDTO | null; goalMin: number };
  glucose: { readings: GlucoseDTO[]; unit: GlucoseUnit };
  medicine: MedicineDayDTO;
  heart: { readings: VitalDTO[] };
  breathing: { readings: VitalDTO[] };
};

export type TrackerHistoryDayDTO = {
  date: string;
  waterMl: number;
  workoutMin: number;
  workoutKcal: number;
  sleepMin: number | null;
  weightKg: number | null;
  steps: number | null;
};

export type AddWaterBody = { date: string; ml: number };
export type SetWeightBody = { kg: number; note?: string | null };
export type AddWorkoutBody = { date: string; activityKey: string; minutes: number; name?: string; kcal?: number; note?: string | null };
export type UpdateWorkoutBody = { minutes?: number; kcal?: number; note?: string | null };
export type SetStepsBody = { steps: number };
export type SetSleepBody = { bedAt: number; wakeAt: number; quality?: number | null; note?: string | null };
