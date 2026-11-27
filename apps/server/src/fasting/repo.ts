import type { Db } from "../db/types.ts";
import {
  computeStatus, isGoalMet, presetByKey, targetEndFor, windowsBetween,
  type FastingLogDTO, type FastingMode, type FastingPlanDTO, type FastingStatusDTO,
} from "../../../../packages/shared/src/fasting.ts";
import { dateInZone, HOUR } from "../../../../packages/shared/src/time.ts";
import { newId, transaction } from "../db/types.ts";
import { NotFoundError, ValidationError } from "../foods/repo.ts";

const DAY = 24 * HOUR;
/** How far back auto-tracking fills in fasts the app didn't see happen. */
const SETTLE_LOOKBACK = 60 * DAY;

const s = (ms: number) => Math.floor(ms / 1000);
const ms = (sec: number | null) => (sec === null ? null : sec * 1000);

type PlanRow = {
  id: string; preset_key: string | null; mode: FastingMode; fasting_hours: number; eating_hours: number;
  fasting_starts_at_min: number | null; timezone: string; created_at: number; ended_at: number | null;
};
type LogRow = {
  id: string; plan_id: string | null; started_at: number; ended_at: number | null; target_end_at: number;
  target_hours: number; is_goal_met: number | null; origin: "auto" | "manual"; note: string | null; deleted_at: number | null;
};

function toPlan(r: PlanRow): FastingPlanDTO {
  return {
    id: r.id, presetKey: r.preset_key ?? "custom", mode: r.mode, fastingHours: r.fasting_hours, eatingHours: r.eating_hours,
    startsAtMin: r.fasting_starts_at_min, timezone: r.timezone, createdAt: r.created_at * 1000, endedAt: ms(r.ended_at),
  };
}

function toLog(r: LogRow): FastingLogDTO {
  return {
    id: r.id, planId: r.plan_id, startedAt: r.started_at * 1000, endedAt: ms(r.ended_at), targetEndAt: r.target_end_at * 1000,
    targetHours: r.target_hours, isGoalMet: r.is_goal_met === null ? null : Boolean(r.is_goal_met), origin: r.origin,
    note: r.note, deleted: r.deleted_at !== null,
  };
}

// ── Plans ───────────────────────────────────────────────────────────────────────────────────

export function activePlan(db: Db): FastingPlanDTO | null {
  const r = db.prepare("SELECT * FROM fasting_plans WHERE ended_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as PlanRow | undefined;
  return r ? toPlan(r) : null;
}

export type PlanInput = { presetKey: string; mode: FastingMode; fastingHours: number; startsAtMin: number | null; timezone: string };

/** Replace the active plan. Auto-tracking for the new schedule starts now. */
export function setPlan(db: Db, input: PlanInput, now: number): FastingPlanDTO {
  if (input.mode === "schedule" && input.startsAtMin === null) throw new ValidationError("A schedule needs a start time");
  const preset = presetByKey(input.presetKey);
  if (preset && preset.fastingHours !== input.fastingHours) throw new ValidationError(`Preset ${input.presetKey} is ${preset.fastingHours} hours`);
  const id = newId();
  const startsAt = input.mode === "schedule" ? input.startsAtMin : null;
  // Set mid-window (e.g. at 6 AM on a 16:8 from 8 PM)? Track the fast you're already in.
  let trackFrom = now;
  if (startsAt !== null) {
    const draft: FastingPlanDTO = {
      id, presetKey: input.presetKey, mode: "schedule", fastingHours: input.fastingHours, eatingHours: 24 - input.fastingHours,
      startsAtMin: startsAt, timezone: input.timezone, createdAt: 0, endedAt: null,
    };
    const current = windowsBetween(draft, now, now + 1).find((w) => w.start <= now && now < w.end);
    if (current) trackFrom = current.start;
  }
  transaction(db, () => {
    db.prepare("UPDATE fasting_plans SET ended_at = ? WHERE ended_at IS NULL").run(s(now));
    db.prepare(`INSERT INTO fasting_plans (id, preset_key, mode, fasting_hours, eating_hours, fasting_starts_at_min, fasting_ends_at_min,
                start_date, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.presetKey, input.mode, input.fastingHours, 24 - input.fastingHours, startsAt,
        startsAt === null ? null : Math.round(startsAt + input.fastingHours * 60) % 1440,
        dateInZone(trackFrom, input.timezone), input.timezone, s(trackFrom));
  });
  return activePlan(db)!;
}

export function endPlan(db: Db, now: number) {
  db.prepare("UPDATE fasting_plans SET ended_at = ? WHERE ended_at IS NULL").run(s(now));
}

// ── Auto-tracking ───────────────────────────────────────────────────────────────────────────

/**
 * Write auto-tracked fasts for scheduled windows that finished without an override
 * (the schedule is assumed kept unless you start or end early),
 * and close schedule fasts started early once their scheduled end passes.
 */
export function settle(db: Db, now: number) {
  const since = now - SETTLE_LOOKBACK;
  const plans = (db.prepare("SELECT * FROM fasting_plans WHERE mode = 'schedule' AND (ended_at IS NULL OR ended_at > ?)")
    .all(s(since)) as PlanRow[]).map(toPlan);
  const overlapping = db.prepare(`SELECT 1 FROM fasting_logs WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?) LIMIT 1`);
  const insert = db.prepare(`INSERT INTO fasting_logs (id, plan_id, started_at, ended_at, target_end_at, target_hours, is_goal_met, origin)
                             VALUES (?, ?, ?, ?, ?, ?, 1, 'auto')`);
  transaction(db, () => {
    for (const plan of plans) {
      const from = Math.max(plan.createdAt, since);
      const to = Math.min(plan.endedAt ?? now, now);
      for (const w of windowsBetween(plan, from, to)) {
        if (w.end > now) continue;
        if (overlapping.get(s(w.end), s(w.start))) continue; // overridden, edited or deleted
        insert.run(newId(), plan.id, s(w.start), s(w.end), s(w.end), plan.fastingHours);
      }
    }
    db.prepare(`UPDATE fasting_logs SET ended_at = target_end_at, is_goal_met = 1
                WHERE ended_at IS NULL AND deleted_at IS NULL AND target_end_at <= ?
                  AND plan_id IN (SELECT id FROM fasting_plans WHERE mode = 'schedule')`).run(s(now));
  });
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────────

function logsAround(db: Db, from: number, to: number, includeDeleted: boolean): FastingLogDTO[] {
  return (db.prepare(`SELECT * FROM fasting_logs WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
                      ${includeDeleted ? "" : "AND deleted_at IS NULL"} ORDER BY started_at`)
    .all(s(to), s(from)) as LogRow[]).map(toLog);
}

export function getStatus(db: Db, now: number): FastingStatusDTO {
  settle(db, now);
  const plan = activePlan(db);
  const logs = logsAround(db, now - 3 * DAY, now + 3 * DAY, true);
  // The last completed fast may be older than the 3-day window.
  const last = db.prepare("SELECT * FROM fasting_logs WHERE deleted_at IS NULL AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1").get() as LogRow | undefined;
  if (last && !logs.some((l) => l.id === last.id)) logs.push(toLog(last));
  return { now, ...computeStatus(plan, logs, now) };
}

export function history(db: Db, from: number, to: number, now: number): FastingLogDTO[] {
  settle(db, now);
  return logsAround(db, from, to, false).filter((l) => l.endedAt !== null).sort((a, b) => b.startedAt - a.startedAt);
}

function getLogRow(db: Db, id: string): LogRow {
  const r = db.prepare("SELECT * FROM fasting_logs WHERE id = ? AND deleted_at IS NULL").get(id) as LogRow | undefined;
  if (!r) throw new NotFoundError(`Fast ${id} not found`);
  return r;
}

function assertNoOverlap(db: Db, startedAt: number, endedAt: number | null, exceptId?: string) {
  const clash = db.prepare(`SELECT id FROM fasting_logs WHERE deleted_at IS NULL AND id != ?
                            AND started_at < ? AND (ended_at IS NULL OR ended_at > ?) LIMIT 1`)
    .get(exceptId ?? "", s(endedAt ?? Number.MAX_SAFE_INTEGER), s(startedAt));
  if (clash) throw new ValidationError("This overlaps another fast in your history");
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────

export function startFast(db: Db, startedAt: number, now: number): FastingStatusDTO {
  if (startedAt > now + 60_000) throw new ValidationError("Start time cannot be in the future");
  const status = getStatus(db, now);
  if (status.state === "fasting") throw new ValidationError("You're already fasting");
  if (status.lastFast?.endedAt && startedAt < status.lastFast.endedAt) {
    throw new ValidationError("Start time is before your last fast ended");
  }
  const plan = status.plan;
  const targetEndAt = targetEndFor(plan, startedAt);
  db.prepare(`INSERT INTO fasting_logs (id, plan_id, started_at, target_end_at, target_hours, origin) VALUES (?, ?, ?, ?, ?, 'manual')`)
    .run(newId(), plan?.id ?? null, s(startedAt), s(targetEndAt), Math.round(((targetEndAt - startedAt) / HOUR) * 100) / 100);
  return getStatus(db, now);
}

export function endFast(db: Db, input: { endedAt: number; startedAt?: number }, now: number): { status: FastingStatusDTO; log: FastingLogDTO } {
  if (input.endedAt > now + 60_000) throw new ValidationError("End time cannot be in the future");
  const status = getStatus(db, now);
  if (status.state !== "fasting" || !status.fast) throw new ValidationError("You're not fasting right now");
  const startedAt = input.startedAt ?? status.fast.startedAt;
  if (input.endedAt <= startedAt) throw new ValidationError("End time cannot be earlier than start time");
  const targetHours = (status.fast.targetEndAt - status.fast.startedAt) / HOUR;
  const goal = isGoalMet(startedAt, input.endedAt, targetHours);
  let id = status.fast.logId;
  transaction(db, () => {
    if (id) {
      db.prepare("UPDATE fasting_logs SET started_at = ?, ended_at = ?, is_goal_met = ? WHERE id = ?")
        .run(s(startedAt), s(input.endedAt), Number(goal), id);
    } else {
      // Ending an auto-tracked fast writes it as an override for this window.
      id = newId();
      db.prepare(`INSERT INTO fasting_logs (id, plan_id, started_at, ended_at, target_end_at, target_hours, is_goal_met, origin)
                  VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`)
        .run(id, status.plan?.id ?? null, s(startedAt), s(input.endedAt), s(status.fast!.targetEndAt),
          Math.round(targetHours * 100) / 100, Number(goal));
    }
  });
  return { status: getStatus(db, now), log: toLog(getLogRow(db, id!)) };
}

export function updateFast(db: Db, id: string, patch: { startedAt?: number; endedAt?: number; note?: string | null }, now: number): FastingLogDTO {
  const row = getLogRow(db, id);
  const startedAt = patch.startedAt ?? row.started_at * 1000;
  const endedAt = patch.endedAt ?? (row.ended_at === null ? null : row.ended_at * 1000);
  if (startedAt > now + 60_000 || (endedAt !== null && endedAt > now + 60_000)) throw new ValidationError("Times cannot be in the future");
  if (endedAt !== null && endedAt <= startedAt) throw new ValidationError("End time cannot be earlier than start time");
  assertNoOverlap(db, startedAt, endedAt, id);
  const goal = endedAt === null ? null : Number(isGoalMet(startedAt, endedAt, row.target_hours));
  db.prepare("UPDATE fasting_logs SET started_at = ?, ended_at = ?, is_goal_met = ?, note = ?, origin = 'manual' WHERE id = ?")
    .run(s(startedAt), endedAt === null ? null : s(endedAt), goal, patch.note === undefined ? row.note : patch.note, id);
  return toLog(getLogRow(db, id));
}

/** Soft delete: the row keeps claiming its window so auto-tracking doesn't bring it back. */
export function deleteFast(db: Db, id: string) {
  getLogRow(db, id);
  db.prepare("UPDATE fasting_logs SET deleted_at = unixepoch() WHERE id = ?").run(id);
}

// ── Calendar export (reminders without a push server) ────────────────────────────────────────

export function planIcs(plan: FastingPlanDTO): string {
  if (plan.mode !== "schedule" || plan.startsAtMin === null) throw new ValidationError("Calendar export needs a scheduled plan");
  const start = dateInZone(plan.createdAt, plan.timezone).replace(/-/g, "");
  const hh = String(Math.floor(plan.startsAtMin / 60)).padStart(2, "0");
  const mm = String(plan.startsAtMin % 60).padStart(2, "0");
  const dur = `PT${Math.floor(plan.fastingHours)}H${Math.round((plan.fastingHours % 1) * 60)}M`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//fit-and-health//fasting//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:fasting-${plan.id}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${plan.timezone}:${start}T${hh}${mm}00`,
    `DURATION:${dur}`,
    "RRULE:FREQ=DAILY",
    `SUMMARY:Fasting (${plan.presetKey === "custom" ? `${plan.fastingHours}h` : plan.presetKey})`,
    "DESCRIPTION:Your fasting window. Eat before it starts; stay hydrated.",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Fast starts in 30 minutes. Finish your meal.", "TRIGGER:-PT30M", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Fast complete. Your eating window is open.", "TRIGGER;RELATED=END:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
