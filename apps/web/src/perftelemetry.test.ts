import test from "node:test";
import assert from "node:assert/strict";
import { PerfLog, assessGrowth, frameStats, type ResourceSample } from "./perftelemetry.ts";

const s = (g: number, t: number, p: number): ResourceSample => ({ t: 0, geometries: g, textures: t, programs: p, heapMB: null });

test("frameStats: median, nearest-rank p95, worst, empty", () => {
  assert.deepEqual(frameStats([]), { n: 0, medianMs: 0, p95Ms: 0, worstMs: 0 });
  const r = frameStats(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(r.n, 100); assert.equal(r.p95Ms, 95); assert.equal(r.worstMs, 100); assert.equal(r.medianMs, 51);
});

test("assessGrowth: plateau after warm-up is flat", () => {
  const r = assessGrowth([s(10, 5, 8), s(40, 20, 12), s(60, 30, 14), s(60, 30, 14), s(60, 30, 14), s(60, 30, 14)]);
  assert.equal(r.verdict, "flat"); assert.equal(r.metrics.geometries.delta, 0);
});

test("assessGrowth: a ramp is growing", () => {
  const r = assessGrowth([s(10, 5, 8), s(40, 20, 12), s(60, 30, 14), s(64, 31, 14), s(68, 32, 14), s(72, 33, 14)]);
  assert.equal(r.verdict, "growing"); assert.equal(r.metrics.geometries.delta, 12);
});

test("assessGrowth: too few samples is insufficient, tolerance absorbs noise", () => {
  assert.equal(assessGrowth([s(1, 1, 1), s(2, 2, 2), s(3, 3, 3)]).verdict, "insufficient");
  const noisy = [s(0, 0, 0), s(0, 0, 0), s(60, 30, 14), s(61, 30, 14), s(60, 30, 14), s(61, 30, 14)];
  assert.equal(assessGrowth(noisy, { tolerance: 1 }).verdict, "flat");
});

test("PerfLog: marks are first-only; first use captures sync cost and the next frame", () => {
  let t = 100; const log = new PerfLog(() => t);
  log.mark("a"); t = 200; log.mark("a"); assert.equal(log.snapshot(null).marks.a, 100);
  log.timed("shot:contact", () => { t += 12; });
  log.frame(40);
  log.timed("shot:contact", () => { t += 2; });
  log.frame(17);
  const snap = log.snapshot(null);
  assert.equal(snap.firsts["shot:contact"].syncMs, 12);
  assert.equal(snap.firsts["shot:contact"].frameMs, 40);
  assert.equal(snap.repeats["shot:contact"].n, 1); assert.equal(snap.repeats["shot:contact"].worstMs, 2);
  assert.equal(snap.heap.supported, false);
});

test("PerfLog: lifecycle counters and renderer source are reported", () => {
  const log = new PerfLog(() => 0);
  log.created = 3; log.disposed = 3; log.jerseysDisposed = 4; log.setJerseyCounter(() => 0);
  log.setRendererSource(() => ({ geometries: 1, textures: 2, programs: 3 }));
  const snap = log.snapshot({ usedMB: 10, limitMB: 100 });
  assert.deepEqual(snap.lifecycle, { directorsCreated: 3, directorsDisposed: 3, jerseyTextures: 0, jerseysDisposed: 4 });
  assert.deepEqual(snap.renderer, { geometries: 1, textures: 2, programs: 3 });
  assert.equal(snap.heap.usedMB, 10);
});
