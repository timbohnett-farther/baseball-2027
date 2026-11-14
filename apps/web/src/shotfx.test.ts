import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_FOG, dueEvents, fxSchedule, poolSize, rigPositions, shotTreatment, type ShotFamily } from "./shotfx.ts";
import { CONTACT_Q } from "./shotscene.ts";

const FAMILIES: ShotFamily[] = ["contact", "release", "slide"];
const total = (t: { fx: { n: number }[] }) => t.fx.reduce((n, e) => n + e.n, 0);

test("tiers: High full, Standard reduced, Battery lighting only", () => {
  for (const f of FAMILIES) {
    const h = shotTreatment(f, "high", false), s = shotTreatment(f, "standard", false), b = shotTreatment(f, "battery", false);
    assert.ok(h.grade && h.vignette > 0 && h.fx.length > 0);
    assert.ok(!s.grade && s.vignette > 0 && s.fx.length > 0);
    assert.ok(!b.grade && b.vignette === 0 && b.fx.length === 0 && b.pulse === 0);
    assert.ok(total(h) > total(s) && total(s) > 0);
    assert.ok(b.rim > 0 && b.key > 0 && b.fog > BASE_FOG, "Battery still gets the rig and the depth cue");
    assert.ok(h.rim >= s.rim && s.rim >= b.rim);
  }
});

test("calm (reduced motion or still shot): no pulse, fewer particles, static cues stay", () => {
  for (const f of FAMILIES) for (const tier of ["high", "standard", "battery"] as const) {
    const calm = shotTreatment(f, tier, true), full = shotTreatment(f, tier, false);
    assert.equal(calm.pulse, 0);
    assert.ok(total(calm) <= total(full));
    assert.equal(calm.rim, full.rim);
    assert.equal(calm.vignette, full.vignette);
  }
});

test("schedule: contact fires at the contact frame, slide dusts along the run, events stay inside the shot", () => {
  assert.deepEqual(fxSchedule("contact", 1).map((e) => e.q), [CONTACT_Q]);
  assert.ok(fxSchedule("slide", 1).length >= 5);
  assert.deepEqual(fxSchedule("slide", 0), []);
  for (const f of FAMILIES) for (const e of fxSchedule(f, 1)) assert.ok(e.q > 0 && e.q < 1 && e.n > 0 && e.kind === f);
});

test("dueEvents fires each event exactly once as the clock advances", () => {
  const fx = fxSchedule("slide", 1);
  let fired = 0, prev = -1;
  for (let q = 0; q <= 1.0001; q += 0.013) { fired += dueEvents(fx, prev, q).length; prev = q; }
  assert.equal(fired, fx.length);
});

test("pool sizes cover the largest family, zero on Battery, bounded", () => {
  for (const tier of ["high", "standard"] as const) {
    assert.equal(poolSize(tier), Math.max(...FAMILIES.map((f) => total(shotTreatment(f, tier, false)))));
  }
  assert.equal(poolSize("battery"), 0);
  assert.ok(poolSize("high") <= 260, "density limit");
});

test("rig: rim behind the subject, key on the camera side, both above ground", () => {
  const cam: [number, number, number] = [3, 1, 4], look: [number, number, number] = [-1, 1, -1];
  const r = rigPositions(cam, look);
  const dot = (p: number[]) => (p[0] - look[0]) * (look[0] - cam[0]) + (p[2] - look[2]) * (look[2] - cam[2]);
  assert.ok(dot(r.rim) > 0 && dot(r.key) < 0);
  assert.ok(r.rim[1] > 0 && r.key[1] > 0);
});
