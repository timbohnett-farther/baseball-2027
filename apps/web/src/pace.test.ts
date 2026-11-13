import { test } from "node:test";
import assert from "node:assert/strict";
import { PaceTracker, IDLE_CAP_MS } from "./pace.ts";

test("pitch gaps aggregate to median and p90", () => {
  const p = new PaceTracker(); p.begin(0);
  let t = 0;
  for (const gap of [0, 4000, 4000, 5000, 6000, 20000]) { t += gap; p.onPitch(t); }
  const r = p.report(t);
  assert.equal(r.pitches, 6);
  assert.equal(r.gapMedianMs, 5000);
  assert.equal(r.gapP90Ms, 20000);
  assert.equal(r.totalMs, t);
});

test("an idle gap is dropped, not counted as pace", () => {
  const p = new PaceTracker(); p.begin(0);
  p.onPitch(0); p.onPitch(3000); p.onPitch(3000 + IDLE_CAP_MS + 1); p.onPitch(3000 + IDLE_CAP_MS + 5001);
  assert.deepEqual([p.report(1e6).gapMedianMs], [5000]);
});

test("half-inning durations close at the next half and at the end", () => {
  const p = new PaceTracker(); p.begin(0);
  p.onHalfStart(0); p.onHalfStart(60_000); p.onHalfStart(100_000);
  assert.deepEqual(p.report(130_000).halfInningMs, [60_000, 40_000, 30_000]);
});

test("presentation time accumulates between busy spans and closes open ones", () => {
  const p = new PaceTracker(); p.begin(0);
  p.setBusy(true, 1000); p.setBusy(false, 2500); p.setBusy(true, 5000);
  assert.equal(p.report(6000).presentationMs, 2500);
});

test("an empty match reports zeros", () => {
  const r = new PaceTracker().report(0);
  assert.deepEqual([r.pitches, r.gapMedianMs, r.gapP90Ms, r.halfInningMs.length], [0, 0, 0, 0]);
});
