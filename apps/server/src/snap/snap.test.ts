import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { createApp } from "../app.ts";
import { writeFoods, type FoodRecord } from "../foods/write.ts";
import { writeGenericUnits, writeSynonyms } from "../../../../data/ingest/build-db.ts";
import { choosePortion } from "./match.ts";
import { sniffImage } from "./repo.ts";
import type { DiaryDayDTO, FoodLogDTO, MeasureDTO, SnapImageDTO } from "../../../../packages/shared/src/api.ts";

const rel = { breakfast: 0.5, lunch: 0.5, snack: 0.5, dinner: 0.5 };
const food = (id: string, name: string, extra: Partial<FoodRecord> = {}): FoodRecord => ({
  id, source: "indb", sourceRef: id, name, rank: 3, relevance: rel, nutrients: { energy_kcal: 150, protein_g: 5 },
  names: [{ name, lang: "en", isPrimary: true }], measures: [], defaultMeasureId: "gen:g", ...extra,
});
const FOODS = [
  food("indb:ROTI", "Chapati/Roti", {
    nutrients: { energy_kcal: 202.8 },
    names: [{ name: "Chapati/Roti", lang: "en", isPrimary: true }, { name: "Chapati", lang: "en", isPrimary: false }, { name: "Roti", lang: "en", isPrimary: false }],
    measures: [{ id: "indb:ROTI:serving", name: "chapati", weightG: 36, rank: 1, isEstimated: false, source: "indb" }],
    defaultMeasureId: "indb:ROTI:serving",
  }),
  food("indb:DAL", "Dal tadka (Tadka dal)", { densityGPerMl: 1, names: [{ name: "Dal tadka (Tadka dal)", lang: "en", isPrimary: true }, { name: "Dal tadka", lang: "en", isPrimary: false }] }),
  food("indb:RICE", "Jeera rice (Cumin rice)", {
    densityGPerMl: 0.7,
    names: [{ name: "Jeera rice (Cumin rice)", lang: "en", isPrimary: true }, { name: "Jeera rice", lang: "en", isPrimary: false }],
    measures: [{ id: "indb:RICE:serving", name: "plate", weightG: 200, rank: 1, isEstimated: false, source: "indb" }],
    defaultMeasureId: "indb:RICE:serving",
  }),
];

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);

function setup(env: Record<string, string> = { VISION_PROVIDER: "mock" }) {
  const db = openDatabase(":memory:");
  migrate(db);
  writeGenericUnits(db);
  writeSynonyms(db);
  writeFoods(db, FOODS);
  const app = createApp({ db, env });
  const call = async <T = unknown>(method: string, url: string, init?: { json?: unknown; form?: FormData }) => {
    const res = await app.request(`/api${url}`, {
      method,
      headers: init?.json ? { "content-type": "application/json" } : undefined,
      body: init?.form ?? (init?.json ? JSON.stringify(init.json) : undefined),
    });
    const ct = res.headers.get("content-type") ?? "";
    const body = ct.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, body: body as T, contentType: ct };
  };
  const upload = (bytes: Uint8Array = JPEG, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("image", new Blob([bytes], { type: "image/jpeg" }), "meal.jpg");
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return call<SnapImageDTO>("POST", "/snap", { form });
  };
  return { db, call, upload, cleanup: () => {} };
}

test("image sniffing ignores the claimed type", () => {
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), "image/png");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});

test("portion choice: named unit, implausible count, own unit, grams", () => {
  const m = (id: string, name: string, weightG: number, kind: "food" | "generic" = "food"): MeasureDTO => ({ id, name, weightG, isEstimated: false, kind });
  const grams = m("gen:g", "g", 1, "generic");
  const roti = [m("r", "chapati", 36), grams];
  assert.deepEqual(choosePortion(roti, "chapati", 2, 72), { measure: roti[0], quantity: 2 });
  assert.deepEqual(choosePortion(roti, "roti", 3, 110), { measure: roti[0], quantity: 3 }); // alias
  assert.deepEqual(choosePortion(roti, "chapati", 10, 72), { measure: roti[0], quantity: 2 }); // count disagrees with weight → weight wins
  const dal = [m("gen:katori", "katori", 150, "generic"), grams];
  assert.deepEqual(choosePortion(dal, "katori", 1, 150), { measure: dal[0], quantity: 1 });
  const rice = [m("p", "plate", 200), grams];
  assert.deepEqual(choosePortion(rice, "bowl", 1, 180), { measure: rice[0], quantity: 1 }); // no bowl → own unit
  assert.deepEqual(choosePortion([grams], "piece", 1, 83), { measure: grams, quantity: 85 });
});

test("matching drops words until something matches, never trusting a fuzzy look-alike", async () => {
  const { db, cleanup } = setup();
  try {
    writeFoods(db, [
      food("indb:PBM", "Paneer in butter sauce"),
      food("indb:DECOY", "Masala dosa paneer fillings"),
      food("indb:BIR", "Vegetable biryani"),
    ]);
    const { matchItem } = await import("./match.ts");
    const item = (name: string) => ({ name, local_name: "", portion_unit: "katori", portion_quantity: 1, estimated_grams: 150, confidence: 0.9, bbox: { x: 0, y: 0, w: 1, h: 1 } });
    // Full name has no word match; "paneer butter" (last word dropped) does.
    assert.equal(matchItem(db, item("paneer butter masala")).foodId, "indb:PBM");
    // No "chicken biryani": the biryani family is offered as an alternative.
    const m = matchItem(db, item("chicken biryani"));
    assert.ok(m.foodId === "indb:BIR" || m.alternativeIds.includes("indb:BIR"));
  } finally {
    cleanup();
  }
});

test("snap flow: upload → detect → match → confirm into the diary", async () => {
  const { db, call, upload, cleanup } = setup();
  try {
    assert.deepEqual((await call("GET", "/snap/status")).body, { configured: true, provider: "mock", model: "mock-thali" });
    const up = await upload(JPEG, { mealType: "L", mealName: "Lunch" });
    assert.equal(up.status, 201);
    const snap = up.body;
    assert.equal(snap.status, "detected");
    assert.equal(snap.detections.length, 4);
    const [dal, rice, roti, raita] = snap.detections;
    assert.equal(dal?.food?.id, "indb:DAL");
    assert.equal(dal?.measureId, "gen:katori");
    assert.equal(rice?.food?.id, "indb:RICE");
    assert.equal(roti?.food?.id, "indb:ROTI");
    assert.equal(roti?.quantity, 2);
    assert.equal(raita?.food, null); // nothing in the fixture DB
    assert.equal(raita?.selected, false);
    assert.deepEqual(dal?.bbox, { x: 0.08, y: 0.12, w: 0.36, h: 0.34 });

    const img = await call<Uint8Array>("GET", snap.imageUrl.replace("/api", ""));
    assert.equal(img.contentType, "image/jpeg");
    assert.deepEqual([...img.body], [...JPEG]);
    assert.equal((db.prepare("SELECT count(*) AS n FROM blobs").get() as { n: number }).n, 1); // photo stored in the database

    // Confirm with one portion edited and the rice swapped for chapati.
    const tracked = await call<FoodLogDTO[]>("POST", `/snap/${snap.id}/track`, { json: {
      date: "2026-11-26", mealType: "L",
      items: [
        { detectionId: dal!.id, foodId: "indb:DAL", measureId: "gen:katori", quantity: 1.5 },
        { detectionId: roti!.id, foodId: "indb:ROTI", measureId: "indb:ROTI:serving", quantity: 3 },
      ],
    } });
    assert.equal(tracked.status, 201);
    assert.deepEqual(tracked.body.map((l) => [l.foodId, l.quantity, l.source, l.snapImageId]), [
      ["indb:DAL", 1.5, "snap", snap.id], ["indb:ROTI", 3, "snap", snap.id],
    ]);
    const after = (await call<SnapImageDTO>("GET", `/snap/${snap.id}`)).body;
    assert.equal(after.status, "tracked");
    assert.deepEqual(after.detections.map((d) => d.selected), [true, false, true, false]);
    assert.ok(after.detections[0]?.foodLogId);

    const day = (await call<DiaryDayDTO>("GET", "/diary/2026-11-26")).body;
    assert.equal(day.meals.find((m) => m.code === "L")?.logs.length, 2);
    assert.equal((await call("POST", `/snap/${snap.id}/track`, { json: { date: "2026-11-26", mealType: "L", items: [{ foodId: "indb:DAL", measureId: "gen:g", quantity: 1 }] } })).status, 400);
    assert.equal((await call("POST", `/snap/${snap.id}/retry`)).status, 400);

    // Deleting the photo keeps the diary entries.
    assert.equal((await call("DELETE", `/snap/${snap.id}`)).status, 204);
    assert.equal((await call("GET", `/snap/${snap.id}`)).status, 404);
    const dayAfter = (await call<DiaryDayDTO>("GET", "/diary/2026-11-26")).body;
    assert.equal(dayAfter.meals.find((m) => m.code === "L")?.logs[0]?.snapImageId, null);
  } finally {
    cleanup();
  }
});

test("snap validation: not an image, no vision configured, bad track bodies", async () => {
  const { call, upload, cleanup } = setup();
  try {
    assert.equal((await upload(new TextEncoder().encode("hello"))).status, 400);
    assert.equal((await call("POST", "/snap", { form: new FormData() })).status, 400);
    const snap = (await upload()).body;
    assert.equal((await call("POST", `/snap/${snap.id}/track`, { json: { date: "2026-11-26", mealType: "L", items: [] } })).status, 400);
    assert.equal((await call("POST", `/snap/${snap.id}/track`, { json: { date: "2026-11-26", mealType: "L",
      items: [{ detectionId: "nope", foodId: "indb:DAL", measureId: "gen:g", quantity: 100 }] } })).status, 400);
    assert.equal((await call("POST", `/snap/${snap.id}/track`, { json: { date: "2026-11-26", mealType: "L",
      items: [{ foodId: "indb:ROTI", measureId: "gen:katori", quantity: 1 }] } })).status, 400); // roti has no katori
  } finally {
    cleanup();
  }
  const off = setup({});
  try {
    const r = await off.upload();
    assert.equal(r.status, 503);
    assert.match((r.body as unknown as { error: string }).error, /vision model/);
    assert.equal((await off.call<{ configured: boolean }>("GET", "/snap/status")).body.configured, false);
  } finally {
    off.cleanup();
  }
});
