/**
 * Intermittent fasting model.
 *
 * Recovered from HealthifyMe (docs/BLUEPRINT.md §3): a plan is a daily schedule
 * (fasting_starts_at / fasting_ends_at as minutes of day); fasts are auto-tracked from it, and
 * starting or ending early writes an override log. States: FASTING ↔ EATING; each fast is goal met or not.
 * Added here: a manual stopwatch mode, presets, metabolic stages and streaks.
 */
import { addDaysIso, dateInZone, HOUR, MINUTE, zonedTimeToMs } from "./time.ts";

export type FastingMode = "schedule" | "manual";

export type FastingPlanDTO = {
  id: string;
  presetKey: string;
  mode: FastingMode;
  fastingHours: number;
  eatingHours: number;
  /** Minute of day the daily fast starts (schedule mode); null in manual mode. */
  startsAtMin: number | null;
  timezone: string;
  createdAt: number;
  endedAt: number | null;
};

export type FastingLogDTO = {
  id: string;
  planId: string | null;
  startedAt: number;
  endedAt: number | null;
  targetEndAt: number;
  targetHours: number;
  isGoalMet: boolean | null;
  origin: "auto" | "manual";
  note: string | null;
  deleted?: boolean;
};

export type FastingStatusDTO = {
  now: number;
  plan: FastingPlanDTO | null;
  state: "idle" | "fasting" | "eating";
  /** Present while fasting. logId is null for an auto-tracked fast that hasn't been written yet. */
  fast: { logId: string | null; startedAt: number; targetEndAt: number; origin: "auto" | "manual" } | null;
  /** Present while eating. */
  eating: { since: number | null; nextFastAt: number | null } | null;
  lastFast: FastingLogDTO | null;
};

// ── Presets ─────────────────────────────────────────────────────────────────────────────────
export const FASTING_PRESETS = [
  { key: "12:12", name: "12:12", fastingHours: 12, startsAtMin: 20 * 60, level: "Gentle start", description: "Overnight fast, close to a normal day." },
  { key: "14:10", name: "14:10", fastingHours: 14, startsAtMin: 20 * 60, level: "Beginner", description: "Skip late snacks and have a slightly later breakfast." },
  { key: "16:8", name: "16:8", fastingHours: 16, startsAtMin: 20 * 60, level: "Most popular", description: "Eat between noon and 8 PM." },
  { key: "18:6", name: "18:6", fastingHours: 18, startsAtMin: 18 * 60, level: "Intermediate", description: "A six-hour eating window, e.g. noon to 6 PM." },
  { key: "20:4", name: "20:4", fastingHours: 20, startsAtMin: 18 * 60, level: "Advanced", description: "One large meal and a snack within four hours." },
  { key: "23:1", name: "OMAD", fastingHours: 23, startsAtMin: 20 * 60, level: "Advanced", description: "One meal a day. Check with a doctor first." },
] as const;

export function presetByKey(key: string) {
  return FASTING_PRESETS.find((p) => p.key === key);
}

// ── Stages (general information; timings vary between people) ───────────────────────────────
export const FASTING_STAGES = [
  { fromHours: 0, key: "fed", name: "Digesting", description: "Blood sugar rises after your last meal while your body digests and stores energy." },
  { fromHours: 4, key: "post_absorptive", name: "Blood sugar settling", description: "Insulin falls and blood sugar returns to baseline. The body starts drawing on stored glycogen." },
  { fromHours: 8, key: "glycogen", name: "Using glycogen", description: "Liver glycogen keeps blood sugar steady. Hunger often peaks and then passes." },
  { fromHours: 12, key: "metabolic_switch", name: "Metabolic switch", description: "As glycogen runs low, the body begins shifting toward burning fat for fuel." },
  { fromHours: 16, key: "fat_burning", name: "Fat burning", description: "Fat breakdown increases and the liver starts producing ketones." },
  { fromHours: 18, key: "ketosis", name: "Ketosis begins", description: "Ketone levels rise further and become a meaningful fuel for the brain and muscles." },
  { fromHours: 24, key: "autophagy", name: "Deep fast", description: "Cell clean-up (autophagy) is thought to increase, mostly shown in animal studies. Stay hydrated." },
  { fromHours: 48, key: "extended", name: "Extended fast", description: "Fasts this long should be supervised by a doctor." },
] as const;

export type FastingStage = (typeof FASTING_STAGES)[number];

export function stageAt(elapsedMs: number): { current: FastingStage; next: FastingStage | null; msToNext: number | null } {
  const hours = elapsedMs / HOUR;
  let i = 0;
  while (i + 1 < FASTING_STAGES.length && FASTING_STAGES[i + 1]!.fromHours <= hours) i++;
  const next = FASTING_STAGES[i + 1] ?? null;
  return { current: FASTING_STAGES[i]!, next, msToNext: next ? next.fromHours * HOUR - elapsedMs : null };
}

// ── Schedule windows ────────────────────────────────────────────────────────────────────────
export type Window = { start: number; end: number };

/** The scheduled fast that starts on `dateIso` in the plan's zone (may end the next day). */
export function windowOn(plan: FastingPlanDTO, dateIso: string): Window | null {
  if (plan.mode !== "schedule" || plan.startsAtMin === null) return null;
  const start = zonedTimeToMs(dateIso, plan.startsAtMin, plan.timezone);
  return { start, end: start + plan.fastingHours * HOUR };
}

/** Scheduled windows that start within the plan's active period and intersect [from, to). */
export function windowsBetween(plan: FastingPlanDTO, from: number, to: number): Window[] {
  if (plan.mode !== "schedule") return [];
  const out: Window[] = [];
  let d = dateInZone(from - 2 * 24 * HOUR, plan.timezone);
  const last = dateInZone(to, plan.timezone);
  for (let guard = 0; guard < 400 && d <= last; guard++, d = addDaysIso(d, 1)) {
    const w = windowOn(plan, d);
    if (!w || w.end <= from || w.start >= to) continue;
    if (w.start < plan.createdAt) continue; // auto-tracking only from when the plan was set
    if (plan.endedAt !== null && w.start >= plan.endedAt) continue;
    out.push(w);
  }
  return out;
}

export function overlaps(a: { startedAt: number; endedAt: number | null }, w: Window): boolean {
  const aEnd = a.endedAt ?? Number.POSITIVE_INFINITY;
  return a.startedAt < w.end && w.start < aEnd;
}

/** A fast meets its goal when it lasted the target length (1 min grace), however its times were edited. */
export function isGoalMet(startedAt: number, endedAt: number, targetHours: number): boolean {
  return endedAt - startedAt >= targetHours * HOUR - MINUTE;
}

/** When a fast started at `startedAt` is meant to end under this plan. */
export function targetEndFor(plan: FastingPlanDTO | null, startedAt: number, fallbackHours = 16): number {
  if (plan?.mode === "schedule") {
    // A fast started early (or late) runs until the scheduled window it belongs to ends.
    const ws = windowsBetween({ ...plan, createdAt: 0, endedAt: null }, startedAt - 30 * HOUR, startedAt + 30 * HOUR);
    const own = ws.find((w) => w.end > startedAt && w.start - startedAt <= plan.eatingHours * HOUR);
    if (own) return own.end;
  }
  return startedAt + (plan?.fastingHours ?? fallbackHours) * HOUR;
}

/**
 * Current state from the plan and recent logs (including deleted ones, which still "claim" their window).
 * Pure: the server uses it for /status and the client can re-run it as the clock ticks.
 */
export function computeStatus(plan: FastingPlanDTO | null, logs: FastingLogDTO[], now: number): Omit<FastingStatusDTO, "now"> {
  const live = logs.filter((l) => !l.deleted);
  const finished = live.filter((l) => l.endedAt !== null && l.endedAt <= now).sort((a, b) => b.endedAt! - a.endedAt!);
  const lastFast = finished[0] ?? null;

  const open = live.find((l) => l.endedAt === null);
  if (open) {
    return { plan, state: "fasting", fast: { logId: open.id, startedAt: open.startedAt, targetEndAt: open.targetEndAt, origin: open.origin }, eating: null, lastFast };
  }
  if (!plan) return { plan, state: lastFast ? "eating" : "idle", fast: null, eating: lastFast ? { since: lastFast.endedAt, nextFastAt: null } : null, lastFast };

  if (plan.mode === "schedule") {
    const current = windowsBetween(plan, now, now + 1).find((w) => w.start <= now && now < w.end);
    if (current && !logs.some((l) => overlaps(l, current))) {
      return { plan, state: "fasting", fast: { logId: null, startedAt: current.start, targetEndAt: current.end, origin: "auto" }, eating: null, lastFast };
    }
    const upcoming = windowsBetween(plan, now, now + 3 * 24 * HOUR).find((w) => w.start > now && !logs.some((l) => overlaps(l, w)));
    return { plan, state: "eating", fast: null, eating: { since: lastFast?.endedAt ?? null, nextFastAt: upcoming?.start ?? null }, lastFast };
  }
  return { plan, state: "eating", fast: null, eating: { since: lastFast?.endedAt ?? null, nextFastAt: null }, lastFast };
}

// ── History: streaks and per-day totals ──────────────────────────────────────────────────────

/** Consecutive days (by the date each fast ended, in `tz`) with at least one goal-met fast. */
export function computeStreaks(logs: FastingLogDTO[], tz: string, todayIso: string): { current: number; longest: number } {
  const days = new Set(logs.filter((l) => !l.deleted && l.endedAt !== null && l.isGoalMet).map((l) => dateInZone(l.endedAt!, tz)));
  if (!days.size) return { current: 0, longest: 0 };
  let current = 0;
  let d = days.has(todayIso) ? todayIso : addDaysIso(todayIso, -1);
  while (days.has(d)) { current++; d = addDaysIso(d, -1); }
  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = addDaysIso(sorted[i - 1]!, 1) === sorted[i] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current, longest };
}

/** Hours fasted per day, attributing each completed fast to the day it ended. */
export function fastedHoursByDay(logs: FastingLogDTO[], tz: string, dates: string[]): { date: string; hours: number; goalMet: boolean }[] {
  const by = new Map(dates.map((d) => [d, { date: d, hours: 0, goalMet: false }]));
  for (const l of logs) {
    if (l.deleted || l.endedAt === null) continue;
    const row = by.get(dateInZone(l.endedAt, tz));
    if (!row) continue;
    row.hours += (l.endedAt - l.startedAt) / HOUR;
    row.goalMet ||= !!l.isGoalMet;
  }
  return dates.map((d) => by.get(d)!);
}
