/** Water, weight, workout and sleep trackers. Runtime-neutral: runs on the server and in the browser. */
import type { Db } from "../db/types.ts";
import { newId } from "../db/types.ts";
import { NotFoundError, ValidationError } from "../foods/repo.ts";
import { getProfile, setProfile } from "../diary/repo.ts";
import {
  activity, CUSTOM_ACTIVITY, DEFAULT_TRACKER_SETTINGS, FALLBACK_WEIGHT_KG, healthyWeightRange, mergeTrackerSettings,
  suggestedWaterMl, workoutKcal, workoutNetKcal,
  type AddWaterBody, type AddWorkoutBody, type SetSleepBody, type SetWeightBody, type SleepDTO, type TrackerDayDTO,
  type TrackerHistoryDayDTO, type TrackerSettings, type TrackerSettingsPatch, type UpdateWorkoutBody, type WaterEntryDTO,
  type WeightEntryDTO, type WorkoutDTO,
} from "../../../../packages/shared/src/trackers.ts";

// ── Settings ──

export function getTrackerSettings(db: Db): TrackerSettings {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'tracker_settings'").get() as { value: string } | undefined;
  return row ? mergeTrackerSettings(DEFAULT_TRACKER_SETTINGS, JSON.parse(row.value) as TrackerSettingsPatch) : DEFAULT_TRACKER_SETTINGS;
}

export function updateTrackerSettings(db: Db, patch: TrackerSettingsPatch): TrackerSettings {
  const next = mergeTrackerSettings(getTrackerSettings(db), patch);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tracker_settings', ?)").run(JSON.stringify(next));
  return next;
}

// ── Weight ──

type WeightRow = { date: string; kg: number; note: string | null };
const weightDto = (r: WeightRow): WeightEntryDTO => ({ date: r.date, kg: r.kg, note: r.note });

function latestWeight(db: Db, onOrBefore?: string): WeightEntryDTO | null {
  const r = (onOrBefore
    ? db.prepare("SELECT date, kg, note FROM weight_logs WHERE date <= ? ORDER BY date DESC LIMIT 1").get(onOrBefore)
    : db.prepare("SELECT date, kg, note FROM weight_logs ORDER BY date DESC LIMIT 1").get()) as WeightRow | undefined;
  return r ? weightDto(r) : null;
}

/** Weight for calorie estimates on a date: the latest weigh-in on or before it, else the profile. */
export function weightOn(db: Db, date: string): number | null {
  return latestWeight(db, date)?.kg ?? getProfile(db)?.weightKg ?? null;
}

export function setWeight(db: Db, date: string, b: SetWeightBody, now: number): WeightEntryDTO {
  const kg = Math.round(b.kg * 10) / 10;
  db.prepare(`INSERT INTO weight_logs (date, kg, note, logged_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (date) DO UPDATE SET kg = excluded.kg, note = excluded.note, logged_at = excluded.logged_at`)
    .run(date, kg, b.note?.trim() || null, now);
  // Keep the goal profile's weight current, so recalculating goals starts from today's weight.
  const profile = getProfile(db);
  if (profile && latestWeight(db)?.date === date) setProfile(db, { ...profile, weightKg: kg });
  return { date, kg, note: b.note?.trim() || null };
}

export function deleteWeight(db: Db, date: string) {
  const r = db.prepare("DELETE FROM weight_logs WHERE date = ?").run(date) as { changes: number };
  if (!r.changes) throw new NotFoundError("No weigh-in on that date");
}

// ── Water ──

type WaterRow = { id: string; date: string; ml: number; logged_at: number };
const waterDto = (r: WaterRow): WaterEntryDTO => ({ id: r.id, date: r.date, ml: r.ml, loggedAt: r.logged_at });

export function addWater(db: Db, b: AddWaterBody, now: number): WaterEntryDTO {
  const id = newId();
  db.prepare("INSERT INTO water_logs (id, date, ml, logged_at) VALUES (?, ?, ?, ?)").run(id, b.date, Math.round(b.ml), now);
  return { id, date: b.date, ml: Math.round(b.ml), loggedAt: now };
}

export function deleteWater(db: Db, id: string) {
  const r = db.prepare("DELETE FROM water_logs WHERE id = ?").run(id) as { changes: number };
  if (!r.changes) throw new NotFoundError("Water entry not found");
}

// ── Workouts ──

type WorkoutRow = {
  id: string; date: string; activity_key: string; name: string; minutes: number; met: number | null;
  kcal: number; net_kcal: number; note: string | null; logged_at: number;
};
const workoutDto = (r: WorkoutRow): WorkoutDTO => ({
  id: r.id, date: r.date, activityKey: r.activity_key, name: r.name, minutes: r.minutes, met: r.met,
  kcal: Math.round(r.kcal), netKcal: Math.round(r.net_kcal), note: r.note, loggedAt: r.logged_at,
});

/** Calories for a workout: from MET and weight, or as typed for a custom activity. */
function workoutEnergy(db: Db, date: string, activityKey: string, minutes: number, kcal?: number) {
  if (activityKey === CUSTOM_ACTIVITY) {
    if (kcal === undefined) throw new ValidationError("Enter the calories burned for a custom activity");
    // Typed-in calories are usually what a watch shows (total); count it as is.
    return { met: null, kcal: Math.round(kcal), netKcal: Math.round(kcal) };
  }
  const a = activity(activityKey);
  if (!a) throw new ValidationError(`Unknown activity "${activityKey}"`);
  const kg = weightOn(db, date) ?? FALLBACK_WEIGHT_KG;
  if (kcal !== undefined) {
    // Corrected total (e.g. from a watch): keep the same resting share.
    return { met: a.met, kcal: Math.round(kcal), netKcal: Math.round(kcal * Math.max(0, a.met - 1) / a.met) };
  }
  return { met: a.met, kcal: workoutKcal(a.met, kg, minutes), netKcal: workoutNetKcal(a.met, kg, minutes) };
}

export function addWorkout(db: Db, b: AddWorkoutBody, now: number): WorkoutDTO {
  const name = b.activityKey === CUSTOM_ACTIVITY ? (b.name?.trim() || "Workout") : activity(b.activityKey)?.name ?? b.activityKey;
  const e = workoutEnergy(db, b.date, b.activityKey, b.minutes, b.kcal);
  const id = newId();
  db.prepare(`INSERT INTO workout_logs (id, date, activity_key, name, minutes, met, kcal, net_kcal, note, logged_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.date, b.activityKey, name, Math.round(b.minutes), e.met, e.kcal, e.netKcal, b.note?.trim() || null, now);
  return getWorkout(db, id);
}

export function getWorkout(db: Db, id: string): WorkoutDTO {
  const r = db.prepare("SELECT * FROM workout_logs WHERE id = ?").get(id) as WorkoutRow | undefined;
  if (!r) throw new NotFoundError("Workout not found");
  return workoutDto(r);
}

export function updateWorkout(db: Db, id: string, b: UpdateWorkoutBody): WorkoutDTO {
  const cur = getWorkout(db, id);
  const minutes = b.minutes ?? cur.minutes;
  // A new duration recalculates calories unless the user typed them (or the activity is custom).
  const kcal = b.kcal ?? (cur.activityKey === CUSTOM_ACTIVITY ? cur.kcal : undefined);
  const e = workoutEnergy(db, cur.date, cur.activityKey, minutes, kcal);
  db.prepare("UPDATE workout_logs SET minutes = ?, met = ?, kcal = ?, net_kcal = ?, note = ? WHERE id = ?")
    .run(Math.round(minutes), e.met, e.kcal, e.netKcal, b.note === undefined ? cur.note : b.note?.trim() || null, id);
  return getWorkout(db, id);
}

/** Up to 5 activities used most recently (custom ones excluded), for the picker. */
export function recentActivities(db: Db): string[] {
  return (db.prepare(`SELECT activity_key FROM workout_logs WHERE activity_key != ?
                      GROUP BY activity_key ORDER BY MAX(logged_at) DESC LIMIT 5`).all(CUSTOM_ACTIVITY) as { activity_key: string }[])
    .map((r) => r.activity_key);
}

export function deleteWorkout(db: Db, id: string) {
  const r = db.prepare("DELETE FROM workout_logs WHERE id = ?").run(id) as { changes: number };
  if (!r.changes) throw new NotFoundError("Workout not found");
}

// ── Sleep ──

type SleepRow = { date: string; bed_at: number; wake_at: number; quality: number | null; note: string | null };
const sleepDto = (r: SleepRow): SleepDTO => ({
  date: r.date, bedAt: r.bed_at, wakeAt: r.wake_at, minutes: Math.round((r.wake_at - r.bed_at) / 60_000),
  quality: r.quality, note: r.note,
});

/** The night that ended on `date` (the wake-up day). */
export function setSleep(db: Db, date: string, b: SetSleepBody): SleepDTO {
  if (b.wakeAt <= b.bedAt) throw new ValidationError("Wake-up time must be after bedtime");
  if (b.wakeAt - b.bedAt > 24 * 3_600_000) throw new ValidationError("A night's sleep can't be longer than 24 hours");
  db.prepare(`INSERT INTO sleep_logs (date, bed_at, wake_at, quality, note) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (date) DO UPDATE SET bed_at = excluded.bed_at, wake_at = excluded.wake_at,
                quality = excluded.quality, note = excluded.note`)
    .run(date, b.bedAt, b.wakeAt, b.quality ?? null, b.note?.trim() || null);
  return sleepDto(db.prepare("SELECT * FROM sleep_logs WHERE date = ?").get(date) as SleepRow);
}

export function deleteSleep(db: Db, date: string) {
  const r = db.prepare("DELETE FROM sleep_logs WHERE date = ?").run(date) as { changes: number };
  if (!r.changes) throw new NotFoundError("No sleep logged for that night");
}

// ── Day and history ──

export function trackerDay(db: Db, date: string): TrackerDayDTO {
  const settings = getTrackerSettings(db);
  const profile = getProfile(db);
  const currentKg = weightOn(db, date);
  const heightCm = profile?.heightCm ?? settings.weight.heightCm;

  const water = (db.prepare("SELECT * FROM water_logs WHERE date = ? ORDER BY logged_at").all(date) as WaterRow[]).map(waterDto);
  const workouts = (db.prepare("SELECT * FROM workout_logs WHERE date = ? ORDER BY logged_at").all(date) as WorkoutRow[]).map(workoutDto);
  const todayWeight = db.prepare("SELECT date, kg, note FROM weight_logs WHERE date = ?").get(date) as WeightRow | undefined;
  const sleep = db.prepare("SELECT * FROM sleep_logs WHERE date = ?").get(date) as SleepRow | undefined;

  return {
    date,
    settings,
    water: {
      ml: water.reduce((s, w) => s + w.ml, 0),
      goalMl: settings.water.goalMl ?? suggestedWaterMl(currentKg, settings.water.glassMl),
      glassMl: settings.water.glassMl,
      entries: water,
    },
    weight: {
      today: todayWeight ? weightDto(todayWeight) : null,
      latest: latestWeight(db, date),
      currentKg,
      heightCm: heightCm ?? null,
      healthy: heightCm ? healthyWeightRange(heightCm) : null,
    },
    workout: {
      entries: workouts,
      minutes: workouts.reduce((s, w) => s + w.minutes, 0),
      kcal: workouts.reduce((s, w) => s + w.kcal, 0),
      netKcal: workouts.reduce((s, w) => s + w.netKcal, 0),
      goalMin: settings.workout.goalMin,
    },
    sleep: { entry: sleep ? sleepDto(sleep) : null, goalMin: settings.sleep.goalMin },
  };
}

/** One row per date in [from, to], for charts. */
export function trackerHistory(db: Db, from: string, to: string): TrackerHistoryDayDTO[] {
  const byDate = new Map<string, TrackerHistoryDayDTO>();
  const day = (date: string) => {
    let d = byDate.get(date);
    if (!d) byDate.set(date, d = { date, waterMl: 0, workoutMin: 0, workoutKcal: 0, sleepMin: null, weightKg: null });
    return d;
  };
  for (const r of db.prepare("SELECT date, SUM(ml) AS ml FROM water_logs WHERE date BETWEEN ? AND ? GROUP BY date").all(from, to) as { date: string; ml: number }[]) {
    day(r.date).waterMl = r.ml;
  }
  for (const r of db.prepare("SELECT date, SUM(minutes) AS m, SUM(kcal) AS k FROM workout_logs WHERE date BETWEEN ? AND ? GROUP BY date").all(from, to) as { date: string; m: number; k: number }[]) {
    Object.assign(day(r.date), { workoutMin: r.m, workoutKcal: Math.round(r.k) });
  }
  for (const r of db.prepare("SELECT date, bed_at, wake_at FROM sleep_logs WHERE date BETWEEN ? AND ?").all(from, to) as SleepRow[]) {
    day(r.date).sleepMin = Math.round((r.wake_at - r.bed_at) / 60_000);
  }
  for (const r of db.prepare("SELECT date, kg FROM weight_logs WHERE date BETWEEN ? AND ?").all(from, to) as WeightRow[]) {
    day(r.date).weightKg = r.kg;
  }
  // Fill every date so charts get a continuous axis.
  const out: TrackerHistoryDayDTO[] = [];
  for (let d = from; d <= to; d = nextDate(d)) out.push(byDate.get(d) ?? day(d));
  return out;
}

function nextDate(iso: string): string {
  const t = Date.parse(`${iso}T12:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
