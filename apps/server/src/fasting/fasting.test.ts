import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createApp } from "../app.ts";
import type { FastingLogDTO, FastingStatusDTO } from "../../../../packages/shared/src/fasting.ts";

const at = (iso: string) => Date.parse(iso);
const IST = "Asia/Kolkata"; // 16:8 from 20:00 IST = 14:30Z → 06:30Z next day

function setup(startIso: string) {
  const db = openDatabase(":memory:");
  migrate(db);
  let now = at(startIso);
  const app = createApp({ db, clock: () => now });
  const call = async <T = unknown>(method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method, headers: json ? { "content-type": "application/json" } : undefined, body: json ? JSON.stringify(json) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as T };
  };
  return { db, call, setNow: (iso: string) => { now = at(iso); } };
}

const plan168 = { presetKey: "16:8", mode: "schedule", fastingHours: 16, startsAtMin: 20 * 60, timezone: IST };

test("plan validation", async () => {
  const { call } = setup("2026-11-26T10:00:00Z");
  assert.equal((await call<FastingStatusDTO>("GET", "/fasting/status")).body.state, "idle");
  assert.equal((await call("PUT", "/fasting/plan", { ...plan168, timezone: "Mars/Olympus" })).status, 400);
  assert.equal((await call("PUT", "/fasting/plan", { ...plan168, startsAtMin: undefined })).status, 400);
  assert.equal((await call("PUT", "/fasting/plan", { ...plan168, fastingHours: 18 })).status, 400); // 16:8 is 16 h
  assert.equal((await call("PUT", "/fasting/plan", { ...plan168, presetKey: "custom", fastingHours: 17 })).status, 200);
});

test("schedule: auto-tracked fasts, end early, start early, delete stays deleted", async () => {
  const { call, setNow } = setup("2026-11-26T10:00:00Z");
  let st = (await call<FastingStatusDTO>("PUT", "/fasting/plan", plan168)).body;
  assert.equal(st.state, "eating");
  assert.equal(st.eating?.nextFastAt, at("2026-11-26T14:30:00Z"));

  // Inside tonight's window: fasting, auto-tracked, nothing written yet.
  setNow("2026-11-26T20:00:00Z");
  st = (await call<FastingStatusDTO>("GET", "/fasting/status")).body;
  assert.equal(st.state, "fasting");
  assert.deepEqual(st.fast, { logId: null, startedAt: at("2026-11-26T14:30:00Z"), targetEndAt: at("2026-11-27T06:30:00Z"), origin: "auto" });

  // After the window: written as a completed, goal-met auto fast.
  setNow("2026-11-27T07:00:00Z");
  st = (await call<FastingStatusDTO>("GET", "/fasting/status")).body;
  assert.equal(st.state, "eating");
  assert.equal(st.lastFast?.origin, "auto");
  assert.equal(st.lastFast?.isGoalMet, true);

  // Next night: end early (1.5 h in).
  setNow("2026-11-27T16:00:00Z");
  const ended = await call<{ status: FastingStatusDTO; log: FastingLogDTO }>("POST", "/fasting/end", {});
  assert.equal(ended.status, 200);
  assert.equal(ended.body.log.isGoalMet, false);
  assert.equal(ended.body.status.state, "eating");
  assert.equal(ended.body.status.eating?.nextFastAt, at("2026-11-28T14:30:00Z"));

  // Next evening: start 2 h early (18:00 IST); it runs to the scheduled end.
  setNow("2026-11-28T12:30:00Z");
  st = (await call<FastingStatusDTO>("POST", "/fasting/start", {})).body;
  assert.equal(st.state, "fasting");
  assert.equal(st.fast?.origin, "manual");
  assert.equal(st.fast?.targetEndAt, at("2026-11-29T06:30:00Z"));
  assert.equal((await call("POST", "/fasting/start", {})).status, 400); // already fasting

  // Past the scheduled end: closed automatically at target, goal met, no duplicate auto fast.
  setNow("2026-11-29T08:00:00Z");
  let hist = (await call<FastingLogDTO[]>("GET", `/fasting/history?from=${at("2026-11-20T00:00:00Z")}`)).body;
  assert.deepEqual(hist.map((l) => [l.origin, l.isGoalMet, (l.endedAt! - l.startedAt) / 3_600_000]), [
    ["manual", true, 18], ["manual", false, 1.5], ["auto", true, 16],
  ]);

  // Deleting an auto fast keeps it deleted when auto-tracking runs again.
  const auto = hist.find((l) => l.origin === "auto")!;
  assert.equal((await call("DELETE", `/fasting/logs/${auto.id}`)).status, 204);
  setNow("2026-11-29T09:00:00Z");
  hist = (await call<FastingLogDTO[]>("GET", `/fasting/history?from=${at("2026-11-20T00:00:00Z")}`)).body;
  assert.equal(hist.length, 2);
  assert.equal(hist.some((l) => l.id === auto.id), false);
});

test("setting a schedule mid-window tracks the fast you're already in", async () => {
  const { call } = setup("2026-11-27T00:30:00Z"); // 06:00 IST, 9.5 h into the 20:00 window
  const st = (await call<FastingStatusDTO>("PUT", "/fasting/plan", plan168)).body;
  assert.equal(st.state, "fasting");
  assert.equal(st.fast?.startedAt, at("2026-11-26T14:30:00Z"));
  assert.equal(st.fast?.origin, "auto");
});

test("fasts the app never saw are filled in on the next visit", async () => {
  const { call, setNow } = setup("2026-11-20T10:00:00Z");
  await call("PUT", "/fasting/plan", plan168);
  setNow("2026-11-25T10:00:00Z"); // app closed for 5 days
  const hist = (await call<FastingLogDTO[]>("GET", `/fasting/history?from=${at("2026-11-01T00:00:00Z")}`)).body;
  assert.equal(hist.length, 5);
  assert.ok(hist.every((l) => l.origin === "auto" && l.isGoalMet));
});

test("editing a fast: validation and goal recompute", async () => {
  const { call, setNow } = setup("2026-11-26T10:00:00Z");
  await call("PUT", "/fasting/plan", plan168);
  setNow("2026-11-28T10:00:00Z");
  const [second, first] = (await call<FastingLogDTO[]>("GET", "/fasting/history")).body;
  assert.ok(first && second);

  const tooShort = await call<FastingLogDTO>("PATCH", `/fasting/logs/${first.id}`, { endedAt: first.startedAt + 10 * 3_600_000 });
  assert.equal(tooShort.status, 200);
  assert.equal(tooShort.body.isGoalMet, false);
  assert.equal(tooShort.body.origin, "manual");

  // Moving the start earlier so it lasts 16 h makes it goal-met again, even though it ends before 12:00.
  const shifted = await call<FastingLogDTO>("PATCH", `/fasting/logs/${first.id}`, { startedAt: first.startedAt - 6 * 3_600_000 });
  assert.equal(shifted.body.isGoalMet, true);

  assert.equal((await call("PATCH", `/fasting/logs/${first.id}`, { endedAt: shifted.body.startedAt - 1000 })).status, 400);
  assert.equal((await call("PATCH", `/fasting/logs/${first.id}`, { endedAt: at("2026-12-30T00:00:00Z") })).status, 400);
  const clash = await call<{ error: string }>("PATCH", `/fasting/logs/${first.id}`, { endedAt: second.startedAt + 3_600_000 });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /overlaps/);
  assert.equal((await call("PATCH", "/fasting/logs/nope", { note: "x" })).status, 404);
});

test("manual mode is a stopwatch: start, end, never auto-closed", async () => {
  const { call, setNow } = setup("2026-11-26T10:00:00Z");
  await call("PUT", "/fasting/plan", { presetKey: "18:6", mode: "manual", fastingHours: 18, timezone: IST });
  assert.equal((await call("POST", "/fasting/end", {})).status, 400); // not fasting
  assert.equal((await call("POST", "/fasting/start", { startedAt: at("2026-11-26T11:00:00Z") })).status, 400); // future

  let st = (await call<FastingStatusDTO>("POST", "/fasting/start", { startedAt: at("2026-11-26T09:00:00Z") })).body;
  assert.equal(st.fast?.targetEndAt, at("2026-11-27T03:00:00Z"));
  setNow("2026-11-27T12:00:00Z"); // well past target: still fasting until you end it
  st = (await call<FastingStatusDTO>("GET", "/fasting/status")).body;
  assert.equal(st.state, "fasting");
  const end = (await call<{ log: FastingLogDTO }>("POST", "/fasting/end", { endedAt: at("2026-11-27T05:00:00Z") })).body;
  assert.equal(end.log.isGoalMet, true);
  assert.equal((await call("POST", "/fasting/start", { startedAt: at("2026-11-27T04:00:00Z") })).status, 400); // before last end
});

test("calendar export and ending the plan", async () => {
  const { call } = setup("2026-11-26T10:00:00Z");
  assert.equal((await call("GET", "/fasting/plan.ics")).status, 404);
  await call("PUT", "/fasting/plan", plan168);
  const ics = await call<string>("GET", "/fasting/plan.ics");
  assert.equal(ics.status, 200);
  assert.match(ics.body, /DTSTART;TZID=Asia\/Kolkata:20261126T200000/);
  assert.match(ics.body, /RRULE:FREQ=DAILY/);
  assert.match(ics.body, /DURATION:PT16H0M/);
  const st = (await call<FastingStatusDTO>("DELETE", "/fasting/plan")).body;
  assert.equal(st.plan, null);
});
