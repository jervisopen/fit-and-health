import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createApp } from "../app.ts";
import { healthyWeightRange, suggestedWaterMl, workoutKcal, workoutNetKcal } from "../../../../packages/shared/src/trackers.ts";

const NOW = Date.parse("2026-11-27T09:00:00Z");

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const app = createApp({ db, clock: () => NOW });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: res.status === 204 ? null : (await res.json()) as any };
  };
  return { db, call };
}

test("rules: workout calories, healthy range, water goal", () => {
  assert.equal(workoutKcal(3.5, 70, 60), 245);
  assert.equal(workoutNetKcal(3.5, 70, 60), 175);
  assert.deepEqual(healthyWeightRange(165), { minKg: 50, maxKg: 62 });
  assert.equal(healthyWeightRange(20), null);
  assert.equal(suggestedWaterMl(70), 2500);
  assert.equal(suggestedWaterMl(30), 1500);
  assert.equal(suggestedWaterMl(200), 4000);
});

test("water: add glasses, goal from weight, undo", async () => {
  const { call } = setup();
  let day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.equal(day.water.ml, 0);
  assert.equal(day.water.goalMl, suggestedWaterMl(null));

  const a = await call("POST", "/water", { date: "2026-11-27", ml: 250 });
  assert.equal(a.status, 201);
  await call("POST", "/water", { date: "2026-11-27", ml: 250 });
  await call("POST", "/water", { date: "2026-11-26", ml: 500 });
  day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.equal(day.water.ml, 500);
  assert.equal(day.water.entries.length, 2);

  assert.equal((await call("DELETE", `/water/${a.json.id}`)).status, 204);
  assert.equal((await call("GET", "/trackers/2026-11-27")).json.water.ml, 250);
  assert.equal((await call("POST", "/water", { date: "2026-11-27", ml: 0 })).status, 400);

  await call("PATCH", "/trackers/settings", { water: { goalMl: 3000 } });
  assert.equal((await call("GET", "/trackers/2026-11-27")).json.water.goalMl, 3000);
});

test("weight: one per day, latest carried forward, profile kept in sync, healthy range", async () => {
  const { call } = setup();
  await call("PUT", "/settings/profile", { sex: "male", age: 30, heightCm: 175, weightKg: 80, activity: "light", goal: "lose" });
  let day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.equal(day.weight.currentKg, 80, "falls back to the profile");
  assert.deepEqual(day.weight.healthy, healthyWeightRange(175));

  await call("PUT", "/weight/2026-11-20", { kg: 79.46 });
  await call("PUT", "/weight/2026-11-27", { kg: 78.2 });
  await call("PUT", "/weight/2026-11-27", { kg: 78.0, note: "after walk" });
  day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.deepEqual(day.weight.today, { date: "2026-11-27", kg: 78, note: "after walk" });
  assert.equal((await call("GET", "/trackers/2026-11-22")).json.weight.currentKg, 79.5, "rounded, carried forward");
  assert.equal((await call("GET", "/settings")).json.profile.weightKg, 78);

  // An older weigh-in doesn't overwrite the profile's current weight.
  await call("PUT", "/weight/2026-11-01", { kg: 82 });
  assert.equal((await call("GET", "/settings")).json.profile.weightKg, 78);

  assert.equal((await call("DELETE", "/weight/2026-11-27")).status, 204);
  assert.equal((await call("DELETE", "/weight/2026-11-27")).status, 404);
  assert.equal((await call("PUT", "/weight/2026-11-27", { kg: 5 })).status, 400);
});

test("workouts: calories from MET and weight, custom, edits, budget numbers", async () => {
  const { call } = setup();
  await call("PUT", "/weight/2026-11-27", { kg: 70 });
  const walk = await call("POST", "/workouts", { date: "2026-11-27", activityKey: "walk_brisk", minutes: 30 });
  assert.equal(walk.status, 201);
  assert.equal(walk.json.kcal, workoutKcal(4.3, 70, 30));
  assert.equal(walk.json.netKcal, workoutNetKcal(4.3, 70, 30));
  assert.equal(walk.json.name, "Walking, brisk (5.5–6 km/h)");

  const custom = await call("POST", "/workouts", { date: "2026-11-27", activityKey: "custom", name: "Kabaddi", minutes: 40, kcal: 300 });
  assert.equal(custom.json.kcal, 300);
  assert.equal((await call("POST", "/workouts", { date: "2026-11-27", activityKey: "custom", minutes: 40 })).status, 400);
  assert.equal((await call("POST", "/workouts", { date: "2026-11-27", activityKey: "flying", minutes: 40 })).status, 400);

  // Longer duration recalculates; a typed total is kept.
  let w = (await call("PATCH", `/workouts/${walk.json.id}`, { minutes: 60 })).json;
  assert.equal(w.kcal, workoutKcal(4.3, 70, 60));
  w = (await call("PATCH", `/workouts/${walk.json.id}`, { kcal: 250 })).json;
  assert.equal(w.kcal, 250);
  assert.equal(w.netKcal, Math.round(250 * 3.3 / 4.3));

  const day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.equal(day.workout.minutes, 100);
  assert.equal(day.workout.kcal, 550);
  assert.equal(day.workout.goalMin, 30);
  assert.equal((await call("DELETE", `/workouts/${custom.json.id}`)).status, 204);
  assert.ok((await call("GET", "/workouts/activities")).json.length > 20);
  assert.deepEqual((await call("GET", "/workouts/recent")).json, ["walk_brisk"]);
});

test("sleep: one night per wake-up date, validation, history", async () => {
  const { call } = setup();
  const bed = Date.parse("2026-11-26T17:30:00Z");
  const wake = Date.parse("2026-11-27T01:15:00Z");
  const r = await call("PUT", "/sleep/2026-11-27", { bedAt: bed, wakeAt: wake, quality: 4 });
  assert.equal(r.json.minutes, 465);
  assert.equal((await call("PUT", "/sleep/2026-11-27", { bedAt: wake, wakeAt: bed })).status, 400);
  assert.equal((await call("PUT", "/sleep/2026-11-27", { bedAt: bed, wakeAt: bed + 25 * 3_600_000 })).status, 400);

  await call("POST", "/water", { date: "2026-11-25", ml: 750 });
  await call("POST", "/workouts", { date: "2026-11-27", activityKey: "yoga", minutes: 20 });
  await call("PUT", "/weight/2026-11-26", { kg: 64 });
  const h = (await call("GET", "/trackers/history?from=2026-11-25&to=2026-11-27")).json;
  assert.deepEqual(h.map((d: any) => d.date), ["2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.equal(h[0].waterMl, 750);
  assert.equal(h[1].weightKg, 64);
  assert.equal(h[2].sleepMin, 465);
  assert.equal(h[2].workoutMin, 20);
  assert.equal((await call("GET", "/trackers/history?from=2026-11-27&to=2026-11-25")).status, 400);
  assert.equal((await call("GET", "/trackers/history?from=2024-01-01&to=2026-11-25")).status, 400);
});

test("settings: partial updates keep the rest", async () => {
  const { call } = setup();
  const s = (await call("PATCH", "/trackers/settings", { workout: { addToBudget: true }, sleep: { enabled: false } })).json;
  assert.equal(s.workout.addToBudget, true);
  assert.equal(s.workout.goalMin, 30);
  assert.equal(s.sleep.enabled, false);
  assert.equal(s.water.enabled, true);
  assert.equal((await call("PATCH", "/trackers/settings", { sleep: { goalMin: 30 } })).status, 400);
});
