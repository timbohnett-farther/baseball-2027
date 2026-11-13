import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { GameEvent } from "@bb/sim";
import { applyPose, handWorld, makeShotFigure, reachTo } from "./shotfigure.ts";
import { shotPose } from "./actionshot.ts";
import {
  BALL_RADIUS, BALL_SCALE, CONTACT_Q, CONTACT_SLOW, FIELDER_BACK, HIT_DEFAULT, contactBall, tagPoint, throwIndex, FIELD_XZ, RELEASE_Q, REC_MAX_FRAMES, SLIDER_HIP, SLIDER_TILT, TAG_Q, TransformRecorder,
  batSide, canFrame, contactPose, contactScene, fielderPose, footHeights, framesFor, hiddenBy, mirrorPose, project, releasePose, releaseScene,
  sliderPose, slideScene, slideSubject, type Placement,
} from "./shotscene.ts";

const P = (x: number, z: number): Placement => ({ x, y: 0, z, ry: 0 });
const frame = (event: number, t: number, actors: Record<string, Placement> = {}, ball: [number, number, number] | null = null) => ({ event, t, actors, ball });

test("recorder: ring is capped by frames and by seconds, and looks up by event id", () => {
  const r = new TransformRecorder(2, 5);
  for (let i = 0; i < 20; i++) r.record(frame(i < 10 ? 1 : 2, i * 0.1, { batter: P(i, 0) }));
  assert.ok(r.size <= 5);
  const small = new TransformRecorder(1, REC_MAX_FRAMES);
  for (let i = 0; i < 100; i++) small.record(frame(1, i * 0.1));
  assert.ok(small.size <= 11, "older than the window is dropped");
  assert.equal(r.placement(2, "batter", "last")?.x, 19);
  assert.ok(r.placement(2, "batter", "first")!.x < 19);
  assert.equal(r.placement(99, "batter", "first"), null);
  assert.equal(r.latest(99, "batter")?.x, 19);
  r.record(frame(2, 3, {}, [0, 1, 0])); r.record(frame(2, 3.2, {}, [0, 2, -1]));
  assert.deepEqual(r.ballPath(2).map((s) => s.p[1]), [1, 2]);
  assert.ok(Math.abs(r.ballPath(2)[1].t - 0.2) < 1e-9);
});

test("ball size is one world constant, never scaled per camera", () => {
  assert.equal(BALL_SCALE, 1);
  assert.ok(BALL_RADIUS > 0);
});

test("handedness: lefties mirror the contact scene; switch hitters bat right", () => {
  assert.equal(batSide("L"), -1); assert.equal(batSide("R"), 1); assert.equal(batSide("S"), 1);
  const r = contactScene(null, 0, "R", undefined), l = contactScene(null, 0, "L", undefined);
  assert.equal(l.batter.x, -r.batter.x); assert.equal(l.batter.ry, -r.batter.ry); assert.equal(l.side, -1);
  const rec = new TransformRecorder();
  rec.record(frame(3, 0, { batter: P(-1, 0.4) }, [0, 1, 0])); rec.record(frame(3, 0.1, {}, [0, 1.5, -3]));
  const live = contactScene(rec, 3, "R", undefined);
  assert.equal(live.recorded, true); assert.equal(live.batter.x, -1);
  assert.ok(live.dir[2] < 0, "ball leaves toward the park");
  assert.equal(contactScene(null, 3, "R", undefined).recorded, false);
});

const bases = (first: number | null = null, second: number | null = null, third: number | null = null) => ({ first, second, third });
const ev = (type: string, st: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ type, state: { bases: bases(), ...st }, ...o }) as unknown as GameEvent;

test("slideSubject uses the actual runner and base", () => {
  const run = ev("run", {}, { runnerId: 7, shot: { base: "third" } });
  assert.deepEqual(slideSubject([run], 0), { runnerId: 7, base: 3 });
  assert.equal(slideSubject([ev("run", {}, { runnerId: 7 })], 0), null);
  const before = ev("pitch", { bases: bases(4, null, null) });
  const adv = ev("play", { bases: bases(null, 4, null) }, { batterId: 9, outcome: "single" });
  assert.deepEqual(slideSubject([before, adv], 1), { runnerId: 4, base: 2 });
  const plain = ev("play", { bases: bases(9) }, { batterId: 9, outcome: "single" });
  assert.deepEqual(slideSubject([ev("pitch", {}), plain], 1), { runnerId: 9, base: 1 });
  const dp = ev("play", { bases: bases() }, { batterId: 9, outcome: "double_play" });
  assert.deepEqual(slideSubject([ev("pitch", { bases: bases(4) }), dp], 1), { runnerId: 4, base: 2 });
  assert.equal(slideSubject([], 0), null);
});

test("slideScene trusts recorded transforms only near the bag", () => {
  const sub = { runnerId: 7, base: 2 as const }, a = slideScene(null, 0, sub).axes;
  const rec = new TransformRecorder();
  rec.record(frame(1, 0, { r7: P(a.bx - 1, a.bz), f3: P(a.bx + 50, a.bz) }));
  const sc = slideScene(rec, 1, sub);
  assert.ok(sc.runner); assert.equal(sc.fielder, null, "a fielder far from the bag is not the cover man");
});

test("canFrame: inside, outside, occluded, portrait", () => {
  const base = { pos: [0, 1.5, 6] as [number, number, number], look: [0, 1, 0] as [number, number, number], fov: 40, aspect: 1.8 };
  assert.equal(canFrame({ ...base, subjects: [[0, 1, 0], [0.5, 0.2, 0]] }), true);
  assert.equal(canFrame({ ...base, subjects: [[20, 1, 0]] }), false, "outside the frame");
  assert.equal(canFrame({ ...base, subjects: [[0, 1, 0]], ball: [[0, 1, 20]] }), false, "behind the lens");
  assert.equal(canFrame({ ...base, subjects: [[0, 1, 0]], blockers: [{ x: 0, z: 3 }] }), false, "hidden behind another figure");
  assert.equal(canFrame({ ...base, subjects: [[0, 1, 0]], blockers: [{ x: 0, z: 0 }] }), true, "a point on the blocker itself is not occluded");
  const edge = { ...base, subjects: [[2.3, 1, 0]] as [number, number, number][] };
  assert.equal(canFrame({ ...edge, aspect: 1.8, margin: 0 }), true);
  assert.equal(canFrame({ ...edge, aspect: 0.5 }), true, "portrait widens the lens to keep the horizontal view");
  assert.equal(canFrame({ ...base, subjects: [[2.3, 40, 0]], aspect: 0.5 }), false, "but a point far above the frame still fails");
  const px = project(base.pos, base.look, 40, 1.8, [1, 1, 0])!, py = project(base.pos, base.look, 40, 1.8, [0, 2, 0])!;
  assert.ok(px.x > 0, "world +x is screen right when looking down -z"); assert.ok(py.y > 0, "higher is screen up");
  assert.equal(project(base.pos, base.look, 40, 1.8, [0, 1, 20]), null);
  assert.equal(hiddenBy([0, 1, 6], [0, 1, 0], { x: 3, z: 3 }), false);
});

test("pose fixtures at early, mid and late: feet never below ground, one foot planted, joints bounded", () => {
  const fam = { contact: contactPose, release: releasePose, fielder: fielderPose, slider: sliderPose };
  for (const [name, f] of Object.entries(fam)) for (const q of [0.15, 0.5, 0.85]) {
    const pose = f(q), [a, b] = footHeights(pose);
    assert.ok(a >= -1e-9 && b >= -1e-9, `${name} ${q} feet at or above the ground`);
    if (name !== "slider") assert.ok(Math.min(a, b) < 1e-9, `${name} ${q} one foot planted`);
    for (const sh of [pose.shinL, pose.shinR]) assert.ok(sh > -0.2 && sh < 2.4, `${name} ${q} knee bends the right way`);
    assert.ok(pose.foreL <= 0.05 && pose.foreR <= 0.05, `${name} ${q} elbows bend the right way`);
  }
  assert.ok(releasePose(RELEASE_Q) && CONTACT_Q > 0 && TAG_Q > 0 && SLIDER_TILT > 1 && SLIDER_HIP > 0);
});

test("mirrorPose is an involution and swaps sides", () => {
  const p = contactPose(0.3), m = mirrorPose(p);
  assert.deepEqual(mirrorPose(m), p);
  assert.deepEqual(m.armL, [p.armR[0], -p.armR[1], -p.armR[2]]);
});

test("release scene: pitcher from the recording, else the mound", () => {
  const rec = new TransformRecorder();
  rec.record(frame(4, 0, { f0: P(0.2, -18.4) }, [0.2, 1.8, -17]));
  assert.equal(releaseScene(rec, 4, undefined).recorded, true);
  const f = releaseScene(null, 4, undefined);
  assert.equal(f.recorded, false); assert.equal(f.pitcher.z, FIELD_XZ[0][1]);
});

test("framesFor: early/mid/late fixtures per family, and the staged scene frames on desktop and phone", () => {
  const play = ev("play", { bases: bases(9) }, { batterId: 9, outcome: "home_run", shot: { kind: "fly", spray: 0.4, strength: 1 } });
  const events = [ev("pitch", {}), play];
  for (const aspect of [1.8, 0.5]) {
    for (const cam of ["contact", "release", "slide"] as const) {
      const fr = framesFor(cam, events, 1, aspect);
      assert.equal(fr.length, 3, `${cam} has early/mid/late`);
      assert.ok(fr.every((c) => canFrame(c)), `${cam} @${aspect} frames its subjects`);
    }
  }
  assert.deepEqual(framesFor("slide", [ev("pitch", {})], 0, 1.8), []);
});

const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const events = (shot: object) => [ev("pitch", {}), ev("play", { bases: bases(9) }, { batterId: 9, outcome: "home_run", shot })];

test("release: the camera is on the throwing-arm side and the throwing hand is in frame, for both hands", () => {
  for (const hand of ["R", "L"] as const) for (const aspect of [1.8, 0.5]) {
    const fig = makeShotFigure(new THREE.Color("#c33"), "#e0b090", false, false, throwIndex(hand) === 0 ? 1 : 0);
    const rs = releaseScene(null, 0, undefined);
    fig.position.set(rs.pitcher.x, 0, rs.pitcher.z + 0.44);
    applyPose(fig, releasePose(RELEASE_Q, hand));
    const throwing = handWorld(fig, throwIndex(hand)).toArray() as [number, number, number];
    const glove = handWorld(fig, throwIndex(hand) === 0 ? 1 : 0).toArray() as [number, number, number];
    const [fr] = framesFor("release", events({ kind: "fly", spray: 0.5, strength: 1 }), 1, aspect, undefined, hand);
    assert.equal(Math.sign(fr.pos[0] - rs.pitcher.x), Math.sign(throwing[0] - rs.pitcher.x), `${hand}: camera is on the throwing side`);
    assert.notEqual(Math.sign(fr.pos[0] - rs.pitcher.x), Math.sign(glove[0] - rs.pitcher.x), `${hand}: glove arm is on the far side`);
    const p = shotPose("release", RELEASE_Q, false, 1, hand === "L" ? 1 : -1);
    assert.ok(canFrame({ pos: p.pos, look: p.look, fov: p.fov, aspect, subjects: [throwing], blockers: [] }), `${hand} @${aspect}: throwing hand in frame`);
    assert.ok(throwing[1] > 1.5, `${hand}: arm is up at release`);
  }
});

test("contact: the ball is inside the frame near the bat at early and mid, for lefties, righties and every hit kind", () => {
  for (const bats of ["R", "L"] as const) for (const kind of ["grounder", "liner", "fly"] as const) for (const spray of [0, 0.5, 1]) for (const aspect of [1.8, 0.5]) {
    const fr = framesFor("contact", events({ kind, spray, strength: 1 }), 1, aspect, bats);
    assert.equal(fr.length, 3);
    for (const q of [0, 1]) assert.equal(fr[q].ball?.length, 1, "early and mid carry a ball");
    assert.ok(fr.every((c) => canFrame(c)), `${bats} ${kind} ${spray} @${aspect}`);
  }
  const hit = HIT_DEFAULT[0], b = contactBall(0.5, hit, [0, 0.6, -0.8]);
  assert.ok(dist(b, hit) <= CONTACT_SLOW * 0.25, "shown ball stays within arm's length of the bat early");
  assert.deepEqual(contactBall(CONTACT_Q - 0.1, hit, [0, 1, 0]), [...hit], "no flight before contact");
});

test("the ball is never closer to the camera than 0.8x the subject distance (ball size is fixed, so framing carries it)", () => {
  const ratio = (c: { pos: [number, number, number]; ball?: [number, number, number][]; subjects: [number, number, number][] }) =>
    dist(c.pos, c.ball![0]) / (c.subjects.reduce((n, p) => n + dist(c.pos, p), 0) / c.subjects.length); // vs the subjects' mean distance
  for (const cam of ["release", "slide"] as const) for (const aspect of [1.8, 0.5]) {
    const fr = framesFor(cam, events({ kind: "grounder", spray: 0.5, strength: 1 }), 1, aspect);
    for (const c of fr) if (c.ball?.length) assert.ok(ratio(c as never) >= 0.8, `${cam} @${aspect} ball ${ratio(c as never).toFixed(2)}x`);
  }
  assert.equal(BALL_SCALE, 1);
});

test("reachTo: the palm lands on a reachable target and points at an unreachable one", () => {
  const fig = makeShotFigure(new THREE.Color("#33c"), "#e0b090", false);
  fig.position.set(1, 0, -2); fig.rotation.y = 0.7;
  for (const t of [[0.2, 0.4, -1.6], [1.6, 0.9, -1.8], [0.4, 1.4, -1.3]]) {
    applyPose(fig, fielderPose(0.9));
    const target = new THREE.Vector3(...(t as [number, number, number]));
    const left = reachTo(fig, 0, target), palm = handWorld(fig, 0);
    if (left === 0) assert.ok(palm.distanceTo(target) < 0.02, `reached ${t}`);
    else assert.ok(palm.distanceTo(target) < left + 0.02, `reached as far as the arm goes toward ${t}`);
  }
  const far = new THREE.Vector3(5, 0.3, -2); applyPose(fig, fielderPose(0.9));
  assert.ok(reachTo(fig, 0, far) > 3, "unreachable target reports the shortfall");
  assert.ok(tagPoint({ bx: 0, bz: 0, dx: 1, dz: 0 }, 1)[1] < 0.5 && FIELDER_BACK > 0);
});
