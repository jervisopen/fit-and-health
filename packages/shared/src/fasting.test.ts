import { test } from "node:test";
import assert from "node:assert/strict";
import { dateInZone, formatClock, formatDuration, HOUR, zonedTimeToMs } from "./time.ts";
import {
  computeStatus, computeStreaks, fastedHoursByDay, stageAt, targetEndFor, windowsBetween,
  type FastingLogDTO, type FastingPlanDTO,
} from "./fasting.ts";

const IST = "Asia/Kolkata";

test("zoned time conversion, including a DST change", () => {
  assert.equal(new Date(zonedTimeToMs("2026-11-26", 20 * 60, IST)).toISOString(), "2026-11-26T14:30:00.000Z");
  // New York: EDT (UTC-4) before 1 Nov 2026, EST (UTC-5) after.
  assert.equal(new Date(zonedTimeToMs("2026-10-31", 20 * 60, "America/New_York")).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(new Date(zonedTimeToMs("2026-11-02", 20 * 60, "America/New_York")).toISOString(), "2026-11-03T01:00:00.000Z");
  assert.equal(dateInZone(Date.parse("2026-11-26T20:00:00Z"), IST), "2026-11-27");
  assert.equal(formatDuration(15.5 * HOUR), "15h 30m");
  assert.equal(formatClock(HOUR + 61_000), "01:01:01");
});

const at = (iso: string) => Date.parse(iso);
const plan168: FastingPlanDTO = {
  id: "p1", presetKey: "16:8", mode: "schedule", fastingHours: 16, eatingHours: 8, startsAtMin: 20 * 60,
  timezone: IST, createdAt: at("2026-11-20T00:00:00Z"), endedAt: null,
};
// In IST the daily fast runs 20:00 → 12:00 next day = 14:30Z → 06:30Z.

test("schedule windows cross midnight and start from the plan's creation", () => {
  const ws = windowsBetween(plan168, at("2026-11-25T00:00:00Z"), at("2026-11-27T00:00:00Z"));
  assert.deepEqual(ws.map((w) => [new Date(w.start).toISOString(), new Date(w.end).toISOString()]), [
    ["2026-11-24T14:30:00.000Z", "2026-11-25T06:30:00.000Z"],
    ["2026-11-25T14:30:00.000Z", "2026-11-26T06:30:00.000Z"],
    ["2026-11-26T14:30:00.000Z", "2026-11-27T06:30:00.000Z"],
  ]);
  const late = { ...plan168, createdAt: at("2026-11-26T15:00:00Z") }; // set after tonight's fast began
  assert.equal(windowsBetween(late, at("2026-11-26T00:00:00Z"), at("2026-11-28T00:00:00Z"))[0]?.start, at("2026-11-27T14:30:00Z"));
});

test("status: auto-tracked fasting inside the window, eating outside", () => {
  const fasting = computeStatus(plan168, [], at("2026-11-26T20:00:00Z")); // 01:30 IST
  assert.equal(fasting.state, "fasting");
  assert.equal(fasting.fast?.origin, "auto");
  assert.equal(fasting.fast?.startedAt, at("2026-11-26T14:30:00Z"));
  assert.equal(fasting.fast?.targetEndAt, at("2026-11-27T06:30:00Z"));

  const eating = computeStatus(plan168, [], at("2026-11-26T08:00:00Z")); // 13:30 IST
  assert.equal(eating.state, "eating");
  assert.equal(eating.eating?.nextFastAt, at("2026-11-26T14:30:00Z"));
});

test("status: ending early overrides the window; an open log is always the current fast", () => {
  const ended: FastingLogDTO = {
    id: "l1", planId: "p1", startedAt: at("2026-11-26T14:30:00Z"), endedAt: at("2026-11-27T03:00:00Z"),
    targetEndAt: at("2026-11-27T06:30:00Z"), targetHours: 16, isGoalMet: false, origin: "manual", note: null,
  };
  const s = computeStatus(plan168, [ended], at("2026-11-27T04:00:00Z"));
  assert.equal(s.state, "eating");
  assert.equal(s.lastFast?.id, "l1");
  assert.equal(s.eating?.nextFastAt, at("2026-11-27T14:30:00Z"));

  // A deleted auto fast still claims its window, so it is not resurrected.
  const deleted = { ...ended, deleted: true };
  assert.equal(computeStatus(plan168, [deleted], at("2026-11-27T04:00:00Z")).state, "eating");

  const open: FastingLogDTO = { ...ended, id: "l2", startedAt: at("2026-11-27T12:00:00Z"), endedAt: null, origin: "manual" };
  const o = computeStatus(plan168, [ended, open], at("2026-11-27T13:00:00Z"));
  assert.equal(o.state, "fasting");
  assert.equal(o.fast?.logId, "l2");
});

test("status: manual mode and no plan", () => {
  const manual: FastingPlanDTO = { ...plan168, mode: "manual", startsAtMin: null };
  assert.equal(computeStatus(manual, [], at("2026-11-26T20:00:00Z")).state, "eating");
  assert.equal(computeStatus(null, [], at("2026-11-26T20:00:00Z")).state, "idle");
});

test("targets: early start runs to the scheduled end; manual is start + hours", () => {
  // Started 2 h early (18:00 IST) → still ends at 12:00 IST next day.
  assert.equal(targetEndFor(plan168, at("2026-11-26T12:30:00Z")), at("2026-11-27T06:30:00Z"));
  assert.equal(targetEndFor({ ...plan168, mode: "manual", startsAtMin: null }, at("2026-11-26T12:30:00Z")), at("2026-11-27T04:30:00Z"));
  assert.equal(targetEndFor(null, 0), 16 * HOUR);
});

test("stages by hours fasted", () => {
  assert.equal(stageAt(0).current.key, "fed");
  const s = stageAt(13 * HOUR);
  assert.equal(s.current.key, "metabolic_switch");
  assert.equal(s.next?.key, "fat_burning");
  assert.equal(s.msToNext, 3 * HOUR);
  assert.equal(stageAt(100 * HOUR).next, null);
});

test("streaks and daily totals count by the local day a fast ended", () => {
  const mk = (id: string, endIso: string, hours: number, met: boolean): FastingLogDTO => ({
    id, planId: null, endedAt: at(endIso), startedAt: at(endIso) - hours * HOUR, targetEndAt: at(endIso),
    targetHours: 16, isGoalMet: met, origin: "auto", note: null,
  });
  const logs = [
    mk("a", "2026-11-20T06:30:00Z", 16, true),
    mk("b", "2026-11-21T06:30:00Z", 16, true),
    mk("c", "2026-11-22T06:30:00Z", 16, true),
    mk("d", "2026-11-24T06:30:00Z", 12, false), // missed goal breaks the streak
    mk("e", "2026-11-25T06:30:00Z", 16, true),
    mk("f", "2026-11-26T06:30:00Z", 17, true),
  ];
  assert.deepEqual(computeStreaks(logs, IST, "2026-11-26"), { current: 2, longest: 3 });
  assert.deepEqual(computeStreaks(logs, IST, "2026-11-27"), { current: 2, longest: 3 }); // today not done yet
  assert.deepEqual(computeStreaks(logs, IST, "2026-11-28"), { current: 0, longest: 3 });
  const days = fastedHoursByDay(logs, IST, ["2026-11-24", "2026-11-25", "2026-11-26"]);
  assert.deepEqual(days.map((d) => [d.date, d.hours, d.goalMet]), [["2026-11-24", 12, false], ["2026-11-25", 16, true], ["2026-11-26", 17, true]]);
});
