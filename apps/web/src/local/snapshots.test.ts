import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseToDelete, type SnapshotMeta } from "./snapshots.ts";

const DAY = 86_400_000;
const snap = (day: number, entries: number): SnapshotMeta => ({ id: `d${day}`, takenAt: day * DAY, reason: "daily", entries, size: 1 });

test("keeps the newest seven", () => {
  const all = Array.from({ length: 10 }, (_, i) => snap(i, 100 + i));
  assert.deepEqual(chooseToDelete(all).sort(), ["d0", "d1", "d2"]);
  assert.deepEqual(chooseToDelete(all.slice(0, 7)), []);
});

test("keeps the last big diary when a near-empty one has taken over", () => {
  // Days 0-2: a full diary. Days 3-9: after a mishap, only a few new entries.
  const all = [snap(0, 400), snap(1, 410), snap(2, 420), ...Array.from({ length: 7 }, (_, i) => snap(3 + i, 2 + i))];
  const del = chooseToDelete(all);
  assert.ok(!del.includes("d2"), "the largest older snapshot stays");
  assert.deepEqual(del.sort(), ["d0", "d1"]);
});

test("doesn't keep an old snapshot that's smaller than what's kept", () => {
  const all = [snap(0, 50), ...Array.from({ length: 7 }, (_, i) => snap(1 + i, 100))];
  assert.deepEqual(chooseToDelete(all), ["d0"]);
});
