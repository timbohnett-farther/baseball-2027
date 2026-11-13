import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPace } from "./pace.ts";

const ok = { pitches: 50, gapMedianMs: 4200, gapP90Ms: 9000, halfInningMs: [60000, 55000], totalMs: 420000, presentationMs: 60000 };

test("a well-formed pace report survives", () => assert.deepEqual(cleanPace(ok), ok));
test("garbage is refused, not coerced", () => {
  assert.equal(cleanPace(null), null);
  assert.equal(cleanPace({ ...ok, pitches: "50" }), null);
  assert.equal(cleanPace({ ...ok, halfInningMs: [1, -5] }), null);
  assert.equal(cleanPace({ ...ok, halfInningMs: new Array(100).fill(1) }), null);
});
test("absurd numbers are clamped", () => assert.equal(cleanPace({ ...ok, totalMs: 9e12 })?.totalMs, 3.6e7));
