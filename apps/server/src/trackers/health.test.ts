import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createApp } from "../app.ts";
import { stepsEnergy, strideM } from "../../../../packages/shared/src/trackers.ts";
import { glucoseBand, glucoseIn, glucoseToMgdl, scheduledOn, vitalBand } from "../../../../packages/shared/src/health.ts";

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
    const text = await res.text();
    return { status: res.status, json: text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text } as { status: number; json: any };
  };
  return { db, call };
}

test("steps: distance and calories from height and weight, one total per day", async () => {
  assert.equal(strideM(null), 0.7);
  assert.ok(Math.abs(strideM(170, "male") - 0.7055) < 1e-9);
  const e = stepsEnergy(10_000, 70, 170, "male");
  assert.ok(Math.abs(e.km - 7.055) <= 0.006);
  assert.equal(e.kcal, Math.round(3.5 * 70 * (7.055 / 5)));

  const { call } = setup();
  await call("PUT", "/settings/profile", { sex: "male", age: 30, heightCm: 170, weightKg: 70, activity: "light", goal: "maintain" });
  let day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.deepEqual(day.steps, { steps: null, goal: 8000, km: 0, kcal: 0 });
  const r = await call("PUT", "/steps/2026-11-27", { steps: 6000 });
  assert.equal(r.json.steps, 6000);
  await call("PUT", "/steps/2026-11-27", { steps: 10000 });
  day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.equal(day.steps.steps, 10000);
  assert.equal(day.steps.km, e.km);
  assert.equal((await call("PUT", "/steps/2026-11-27", { steps: -5 })).status, 400);
  assert.equal((await call("GET", "/trackers/history?from=2026-11-27&to=2026-11-27")).json[0].steps, 10000);
  assert.equal((await call("DELETE", "/steps/2026-11-27")).status, 204);
  assert.equal((await call("DELETE", "/steps/2026-11-27")).status, 404);
});

test("glucose: units, bands, readings by day and range", async () => {
  assert.equal(glucoseIn(100, "mmol/L"), 5.6);
  assert.equal(glucoseToMgdl(5.5, "mmol/L"), 99.1);
  assert.equal(glucoseBand(65, "fasting"), "low");
  assert.equal(glucoseBand(95, "fasting"), "usual");
  assert.equal(glucoseBand(110, "fasting"), "above");
  assert.equal(glucoseBand(130, "fasting"), "high");
  assert.equal(glucoseBand(130, "after_meal"), "usual");
  assert.equal(glucoseBand(210, "random"), "high");

  const { call } = setup();
  const a = await call("POST", "/glucose", { date: "2026-11-27", measuredAt: NOW, value: 6.1, unit: "mmol/L", tag: "fasting" });
  assert.equal(a.status, 201);
  assert.equal(a.json.mgdl, 109.9);
  await call("POST", "/glucose", { date: "2026-11-27", measuredAt: NOW + 3_600_000, value: 150, unit: "mg/dL", tag: "after_meal", mealType: "B" });
  await call("POST", "/glucose", { date: "2026-11-25", measuredAt: NOW - 2 * 86_400_000, value: 90, unit: "mg/dL", tag: "fasting" });
  const day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.equal(day.glucose.readings.length, 2);
  assert.equal(day.glucose.unit, "mg/dL");
  assert.equal(day.glucose.readings[1].mealType, "B");
  assert.equal((await call("GET", "/glucose?from=2026-11-20&to=2026-11-27")).json.length, 3);
  assert.equal((await call("POST", "/glucose", { date: "2026-11-27", measuredAt: NOW, value: 2000, unit: "mg/dL", tag: "random" })).status, 400);
  assert.equal((await call("POST", "/glucose", { date: "2026-11-27", measuredAt: NOW, value: 100, unit: "mg/dL", tag: "lunch" })).status, 400);
  assert.equal((await call("DELETE", `/glucose/${a.json.id}`)).status, 204);

  await call("PATCH", "/trackers/settings", { glucose: { unit: "mmol/L" } });
  assert.equal((await call("GET", "/trackers/2026-11-27")).json.glucose.unit, "mmol/L");
});

test("heart and breathing rate: ranges and resting bands", async () => {
  assert.equal(vitalBand("heart", 72, "resting"), "usual");
  assert.equal(vitalBand("heart", 110, "resting"), "high");
  assert.equal(vitalBand("heart", 110, "after_activity"), null);
  assert.equal(vitalBand("breathing", 10, "resting"), "low");

  const { call } = setup();
  const h = await call("POST", "/vitals", { kind: "heart", date: "2026-11-27", measuredAt: NOW, value: 72, context: "resting" });
  assert.equal(h.status, 201);
  await call("POST", "/vitals", { kind: "breathing", date: "2026-11-27", measuredAt: NOW, value: 16, context: "resting" });
  assert.equal((await call("POST", "/vitals", { kind: "heart", date: "2026-11-27", measuredAt: NOW, value: 5, context: "resting" })).status, 400);
  const day = (await call("GET", "/trackers/2026-11-27")).json;
  assert.equal(day.heart.readings[0].value, 72);
  assert.equal(day.breathing.readings[0].value, 16);
  assert.equal((await call("GET", "/vitals?kind=heart&from=2026-11-01&to=2026-11-27")).json.length, 1);
  assert.equal((await call("GET", "/vitals?kind=blood&from=2026-11-01&to=2026-11-27")).status, 400);
  assert.equal((await call("DELETE", `/vitals/${h.json.id}`)).status, 204);
});

const MED = { name: "Metformin", dose: "500 mg", times: [20 * 60, 8 * 60], asNeeded: false, startDate: "2026-11-20", timezone: "Asia/Kolkata" };

test("medicines: schedule, checklist, undo, as-needed, adherence", async () => {
  const { call } = setup();
  const m = (await call("POST", "/medicines", MED)).json;
  assert.deepEqual(m.times, [480, 1200], "sorted");
  assert.equal(m.days, null);
  const weekly = (await call("POST", "/medicines", { ...MED, name: "Vitamin D3", dose: "60,000 IU", times: [540], days: [0] })).json;
  const prn = (await call("POST", "/medicines", { ...MED, name: "Paracetamol", times: [], asNeeded: true })).json;
  assert.equal((await call("POST", "/medicines", { ...MED, times: [] })).status, 400);
  assert.equal((await call("POST", "/medicines", { ...MED, endDate: "2026-11-01" })).status, 400);
  assert.equal((await call("POST", "/medicines", { ...MED, timezone: "Mars/Base" })).status, 400);

  // 2026-11-27 is a Friday: the Sunday-only vitamin isn't due.
  assert.equal(scheduledOn(weekly, "2026-11-27"), false);
  assert.equal(scheduledOn(weekly, "2026-11-29"), true);
  let day = (await call("GET", "/medicines/day/2026-11-27")).json;
  assert.deepEqual(day.doses.map((d: any) => [d.name, d.timeMin, d.status]), [["Metformin", 480, "pending"], ["Metformin", 1200, "pending"]]);
  assert.equal(day.asNeeded[0].name, "Paracetamol");

  const taken = (await call("POST", "/medicines/doses", { medicineId: m.id, date: "2026-11-27", timeMin: 480, status: "taken" })).json;
  // Marking the same slot again updates it rather than adding a second dose.
  await call("POST", "/medicines/doses", { medicineId: m.id, date: "2026-11-27", timeMin: 480, status: "taken" });
  await call("POST", "/medicines/doses", { medicineId: prn.id, date: "2026-11-27", timeMin: null, status: "taken" });
  assert.equal((await call("POST", "/medicines/doses", { medicineId: m.id, date: "2026-11-27", timeMin: 600, status: "taken" })).status, 400);
  assert.equal((await call("POST", "/medicines/doses", { medicineId: m.id, date: "2026-11-27", timeMin: null, status: "taken" })).status, 400);
  day = (await call("GET", "/trackers/2026-11-27")).json.medicine;
  assert.equal(day.scheduled, 2);
  assert.equal(day.taken, 1);
  assert.equal(day.doses.length, 3);
  assert.equal(day.doses[2].name, "Paracetamol");

  assert.equal((await call("DELETE", `/medicines/doses/${taken.id}`)).status, 204);
  assert.equal((await call("GET", "/medicines/day/2026-11-27")).json.taken, 0);

  await call("POST", "/medicines/doses", { medicineId: m.id, date: "2026-11-26", timeMin: 480, status: "taken" });
  await call("POST", "/medicines/doses", { medicineId: m.id, date: "2026-11-26", timeMin: 1200, status: "skipped" });
  const adh = (await call("GET", "/medicines/adherence?from=2026-11-19&to=2026-11-29")).json;
  assert.equal(adh[0].scheduled, 0, "before the start date");
  assert.deepEqual(adh.find((d: any) => d.date === "2026-11-26"), { date: "2026-11-26", scheduled: 2, taken: 1 });
  assert.equal(adh.find((d: any) => d.date === "2026-11-29").scheduled, 3, "Sunday adds the vitamin");

  // Edit and soft delete: history stays, the schedule stops.
  const edited = (await call("PUT", `/medicines/${m.id}`, { ...MED, times: [480], endDate: "2026-11-28" })).json;
  assert.deepEqual(edited.times, [480]);
  assert.equal((await call("GET", "/medicines/day/2026-11-29")).json.doses.filter((d: any) => d.name === "Metformin").length, 0);
  assert.equal((await call("DELETE", `/medicines/${weekly.id}`)).status, 204);
  assert.equal((await call("GET", "/medicines")).json.length, 2);
  assert.equal((await call("GET", "/medicines/day/2026-11-29")).json.doses.length, 0);
});

test("medicine reminders: one calendar event per dose time", async () => {
  const { call } = setup();
  await call("POST", "/medicines", MED);
  await call("POST", "/medicines", { ...MED, name: "Vitamin D3; weekly", dose: "60,000 IU", times: [540], days: [0], endDate: "2027-02-28" });
  await call("POST", "/medicines", { ...MED, name: "Paracetamol", times: [], asNeeded: true });
  const ics = (await call("GET", "/medicines/reminders.ics")).json as string;
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 3);
  assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261120T080000/);
  assert.match(ics, /RRULE:FREQ=DAILY\r\n/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20270228T235959Z/);
  assert.match(ics, /SUMMARY:Take Vitamin D3\\; weekly \(60\\,000 IU\)/);
  assert.ok(!ics.includes("Paracetamol"), "as-needed medicines get no reminders");
});
