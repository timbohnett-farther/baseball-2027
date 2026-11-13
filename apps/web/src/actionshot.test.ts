import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { playInteractive, simulateGame, tutorialSetup, type GameEvent, type UserInput } from "@bb/sim";
import {
  ActionShotDirector, BASE_XZ, CATALOG, effectiveMode, holdWithShot, MIN_CAM_Y, MIN_FIGURE_GAP, scoreEvent, shotPose, slideAxes,
  SHOT_CAP, SHOT_MAX_MS, SHOT_MIN_MS, SHOT_SKIP_MS, type ActionShotMode,
} from "./actionshot.ts";
import { FIELD_XZ, contactScene, releaseScene, slideScene } from "./shotscene.ts";
import type { Vec3 } from "./actionshot.ts";
import { ACTION_SHOT_MODES, getActionShots, setActionShots } from "./actionshots.ts";

// W32: events are synthetic here so each rule is tested on its own.
const state = (o: Record<string, unknown> = {}) => ({
  inning: 1, half: "top", outs: 0, balls: 0, strikes: 0, bases: { first: null, second: null, third: null },
  score: { away: 0, home: 0 }, heat: {}, rally: { away: 0, home: 0 }, ...o,
}) as unknown as GameEvent["state"];
const pitch = (o: Record<string, unknown> = {}) => ({ type: "pitch", state: state(o), batterId: 1, pitcherId: 2, result: "strike", mph: 90, zone: true, shot: { type: "fastball", x: 0, y: 0 } }) as unknown as GameEvent;
const play = (outcome: string, o: Record<string, unknown> = {}, st: Record<string, unknown> = {}) =>
  ({ type: "play", state: state(st), batterId: 1, pitcherId: 2, outcome, runs: 0, rbi: 0, text: "", tier: 3, call: null, card: null, stat: null, ...o }) as unknown as GameEvent;
const run = (action: string, shot?: Record<string, unknown>, st: Record<string, unknown> = {}) => ({ type: "run", state: state(st), action, side: "away", runnerId: 3, text: "", shot }) as unknown as GameEvent;
const ability = (a: string) => ({ type: "ability", state: state(), phase: "triggered", side: "away", playerId: 1, ability: a, heat: 0, text: "" }) as unknown as GameEvent;
const half = () => ({ type: "half_start", state: state(), text: "" }) as unknown as GameEvent;
const homer = (o: Record<string, unknown> = {}, st: Record<string, unknown> = {}) => play("home_run", { tier: 1, rbi: 2, runs: 2, ...o }, st);
const director = (mode: ActionShotMode = "full", reducedMotion = false, extra: Record<string, unknown> = {}) => new ActionShotDirector({ mode, reducedMotion, innings: 3, ...extra });

test("routine plays never earn a shot", () => {
  const ev = [half(), pitch(), play("single"), pitch(), play("groundout"), pitch(), play("flyout"), pitch(), play("walk"), pitch(), play("single", { tier: 2 })];
  const d = director();
  ev.forEach((_, i) => assert.equal(d.consider(ev, i), null));
  assert.equal(d.shots, 0);
});

test("a ball in play never starts a shot: pitches and mid-play runner moves are suppressed", () => {
  const d = director();
  const ev = [half(), pitch({ outs: 0 }), homer(), run("advance"), run("thrown_out")];
  assert.equal(d.consider(ev, 1), null); // the pitch itself
  assert.equal(d.consider(ev, 2), null); // result with runners still moving next
  assert.equal(d.consider(ev, 3), null);
  assert.equal(d.consider(ev, 4), null);
  const dead = [half(), pitch(), homer(), half()];
  assert.ok(director().consider(dead, 2), "the same home run with a dead ball gets its shot");
});

test("the same event always gives the same plan and counts once", () => {
  const ev = [half(), pitch(), homer()];
  const d = director();
  const a = d.consider(ev, 2), b = d.consider(ev, 2), c = d.consider(ev, 2);
  assert.ok(a && a === b && b === c);
  assert.equal(d.shots, 1);
  // deciding a later event first still decides the earlier ones in order
  const d2 = director();
  const ev2 = [half(), pitch(), homer(), pitch(), play("strikeout"), pitch(), homer()];
  const late = d2.consider(ev2, 6);
  const d3 = director();
  [0, 1, 2, 3, 4, 5, 6].forEach((i) => d3.consider(ev2, i));
  assert.deepEqual(late, d3.consider(ev2, 6));
  assert.equal(d2.shots, d3.shots);
});

test("durations sit in the 0.75-1.2 s window for every family and mode", () => {
  for (const def of Object.values(CATALOG)) {
    assert.ok(def.shortMs >= SHOT_MIN_MS && def.fullMs <= SHOT_MAX_MS && def.shortMs <= def.fullMs, def.family);
  }
  for (const m of ["full", "reduced"] as const) {
    const p = director(m).consider([half(), pitch(), homer()], 2);
    assert.ok(p && p.durMs >= SHOT_MIN_MS && p.durMs <= SHOT_MAX_MS);
  }
});

test("off gives nothing; reduced is short and still; reduced motion caps full at reduced", () => {
  const ev = [half(), pitch(), homer()];
  assert.equal(director("off").consider(ev, 2), null);
  const r = director("reduced").consider(ev, 2);
  assert.ok(r && r.still && r.durMs === CATALOG.CONTACT.shortMs);
  const f = director("full").consider(ev, 2);
  assert.ok(f && !f.still && f.durMs === CATALOG.CONTACT.fullMs);
  const m = director("full", true).consider(ev, 2);
  assert.ok(m && m.still);
  assert.equal(effectiveMode("full", true), "reduced");
  assert.equal(effectiveMode("off", true), "off");
  assert.equal(effectiveMode("reduced", false), "reduced");
});

test("reduced mode is pickier than full", () => {
  const ev = [half(), pitch(), homer({ tier: 2, rbi: 2, runs: 2 })]; // scores 60: full yes, reduced (70) no
  assert.ok(director("full").consider(ev, 2));
  assert.equal(director("reduced").consider(ev, 2), null);
});

test("cap: 4 in full, 3 in reduced", () => {
  const ev: GameEvent[] = [half()];
  const idx: number[] = [];
  for (let i = 0; i < 12; i++) { ev.push(pitch({ inning: 1 + (i % 2) }), pitch(), play("strikeout", { tier: 3 }, { outs: 3 }), pitch(), pitch(), homer({}, { inning: 3, half: "bottom", score: { away: 0, home: 3 } })); idx.push(ev.length - 1); }
  for (const [mode, cap] of [["full", SHOT_CAP], ["reduced", 3]] as const) {
    const d = director(mode);
    ev.forEach((_, i) => d.consider(ev, i));
    assert.ok(d.shots <= cap, `${mode} ${d.shots}`);
    assert.equal(d.shots, cap);
  }
});

test("back-to-back plate appearances do not both get a shot unless it ends the match or is a first spectacular", () => {
  const ev = [half(), pitch(), homer({ rbi: 2, runs: 2, tier: 2 }), pitch(), homer({ rbi: 2, runs: 2, tier: 2 })];
  const d = director();
  assert.ok(d.consider(ev, 2));
  assert.equal(d.consider(ev, 4), null);
});

test("one shot per dead-ball sequence", () => {
  const ev = [half(), pitch(), run("steal", { play: "steal", base: "second", safe: false, close: 0.95 }), run("caught", { play: "steal", base: "third", safe: false, close: 0.95 })];
  const d = director();
  assert.ok(d.consider(ev, 2));
  assert.equal(d.consider(ev, 3), null);
});

test("MOUND_RELEASE needs the recorded pitch; a strikeout without one stays on broadcast", () => {
  const withPitch = [half(), pitch(), play("strikeout", { tier: 3 }, { outs: 3, inning: 3, half: "bottom", score: { away: 2, home: 0 } })];
  const p = director().consider(withPitch, 2);
  assert.equal(p?.family, "MOUND_RELEASE");
  const noShot = [half(), { ...pitch(), shot: undefined } as GameEvent, withPitch[2]];
  assert.equal(director().consider(noShot, 2), null);
});

test("SLIDE_TAG: close runner plays and ability plays; a comfortable steal is routine", () => {
  const close = [half(), pitch(), run("caught", { play: "steal", base: "third", safe: false, close: 0.9 }, { inning: 3 })];
  assert.equal(director().consider(close, 2)?.family, "SLIDE_TAG");
  const easy = [half(), pitch(), run("steal", { play: "steal", base: "second", safe: true, close: 0.2 })];
  assert.equal(director().consider(easy, 2), null);
  const cannon = [half(), pitch(), ability("FIELD_CANNON_ARM"), play("groundout", { tier: 3 })];
  assert.equal(director().consider(cannon, 3)?.family, "SLIDE_TAG");
});

test("wall / acrobat catches are CONTACT shots", () => {
  const ev = [half(), pitch(), ability("FIELD_WALL_REAPER"), play("flyout", { tier: 2 })];
  const p = director().consider(ev, 3);
  assert.equal(p?.family, "CONTACT");
  assert.ok(p!.reasons.length > 0);
});

test("canFrame false falls back to the broadcast camera", () => {
  const ev = [half(), pitch(), homer()];
  assert.equal(director("full", false, { canFrame: () => false }).consider(ev, 2), null);
  assert.ok(director("full", false, { canFrame: () => true }).consider(ev, 2));
});

test("scorer reasons are recorded and routine events score null", () => {
  const ev = [half(), pitch(), homer({ rbi: 4 }, { inning: 3, half: "bottom", score: { away: 3, home: 4 } })];
  const s = scoreEvent(ev, 2, { innings: 3 });
  assert.equal(s?.family, "CONTACT");
  assert.ok(s!.reasons.includes("walk-off") && s!.reasons.includes("4 RBI"));
  assert.equal(scoreEvent([half(), pitch(), play("single")], 2, { innings: 3 }), null);
});

test("skip: refused before 250 ms, allowed after, and a skipped shot never restarts", () => {
  const ev = [half(), pitch(), homer()];
  const d = director();
  d.consider(ev, 2);
  assert.equal(d.skip(2, 0), false, "not playing yet");
  assert.ok(d.begin(2, 1000));
  assert.equal(d.active(2), true);
  assert.equal(d.skip(2, 1000 + SHOT_SKIP_MS - 1), false);
  assert.equal(d.skip(2, 1000 + SHOT_SKIP_MS), true);
  assert.equal(d.active(2), false);
  assert.equal(d.begin(2, 5000), null, "no restart after skip");
  d.consider(ev, 2);
  assert.equal(d.begin(2, 6000), null, "a repeated consider (resume, re-render) does not re-arm it");
});

test("a finished shot does not replay on resume", () => {
  const ev = [half(), pitch(), homer()];
  const d = director();
  d.consider(ev, 2);
  assert.ok(d.begin(2, 0));
  d.finish(2);
  assert.equal(d.begin(2, 10), null);
  assert.equal(d.skip(2, 5000), false);
});

test("hold timers: the shot fits the existing budget when it can and never exceeds 1.2 s", () => {
  const ev = [half(), pitch(), homer()];
  const plan = director().consider(ev, 2)!;
  const e = ev[2];
  assert.equal(holdWithShot(1200, plan), 1200);
  assert.equal(holdWithShot(500, plan), plan.durMs);
  assert.ok(holdWithShot(0, plan) <= SHOT_MAX_MS);
  assert.equal(holdWithShot(700, null), 700, "no plan: unchanged");
  void e;
});

test("camera poses stay above the ground and clear of every figure in the staged scene", () => {
  // W32c: the staged scene (batter/pitcher/runner/fielder placed by shotscene, both handednesses) replaces the fixed figure list.
  const gap = (pos: Vec3, fig: [number, number][]) => fig.every(([fx, fz]) => Math.hypot(pos[0] - fx, pos[2] - fz) >= MIN_FIGURE_GAP);
  const field = FIELD_XZ.map(([x, z]) => [x, z] as [number, number]);
  for (const still of [false, true]) for (let p = 0; p <= 1; p += 0.25) {
    for (const bats of ["R", "L"] as const) {
      const sc = contactScene(null, 0, bats, undefined), c = shotPose("contact", p, still, 1, sc.side);
      assert.ok(c.pos[1] >= MIN_CAM_Y);
      assert.ok(gap(c.pos, [[sc.batter.x, sc.batter.z], ...field]), `contact ${bats} ${p}`);
    }
    const rs = releaseScene(null, 0, undefined), r = shotPose("release", p, still);
    assert.ok(r.pos[1] >= MIN_CAM_Y && gap(r.pos, [[rs.pitcher.x, rs.pitcher.z + 0.6], ...field.slice(1)]), `release ${p}`);
    for (let b = 0; b < 3; b++) {
      const sub = { runnerId: 3, base: (b + 1) as 1 | 2 | 3 }, sl = slideScene(null, 0, sub), a = sl.axes;
      const s = shotPose("slide", p, still, sub.base);
      const run = 1.7 - 1.35 * p;
      assert.ok(s.pos[1] >= MIN_CAM_Y);
      assert.ok(gap(s.pos, [[a.bx - a.dx * run, a.bz - a.dz * run], [a.bx - a.nx * 0.6, a.bz - a.nz * 0.6]]), `slide ${sub.base} ${p}`);
    }
    const s = shotPose("slide", p, still, 0);
    assert.ok(s.pos[1] >= MIN_CAM_Y && Math.hypot(s.pos[0] - BASE_XZ[0][0], s.pos[2] - BASE_XZ[0][1]) >= MIN_FIGURE_GAP + 1, `slide home ${p}`);
  }
  assert.deepEqual(shotPose("contact", 0, true), shotPose("contact", 1, true), "still means no camera move");
});

test("every action camera looks toward -z, where the park is built", () => {
  for (const p of [0, 0.5, 1]) {
    for (const c of ["contact", "release"] as const) { const s = shotPose(c, p, false); assert.ok(s.look[2] < s.pos[2], `${c} ${p}`); }
    for (let b = 0; b < 4; b++) {
      const s = shotPose("slide", p, false, b), a = slideAxes(b);
      assert.ok(s.look[2] < s.pos[2], `slide ${b} ${p}`);
      assert.ok(a.nz > 0 && Math.abs(Math.hypot(a.dx, a.dz) - 1) < 1e-9 && Math.abs(a.dx * a.nx + a.dz * a.nz) < 1e-9, `axes ${b}`);
    }
  }
});

test("the actionShots setting defaults to reduced and round-trips", () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.deepEqual([...ACTION_SHOT_MODES], ["full", "reduced", "off"]);
  assert.equal(getActionShots(), "reduced");
  for (const m of ["full", "reduced", "off"] as const) { setActionShots(m); assert.equal(getActionShots(), m); }
  assert.equal(store.get("bb.actionShots"), "off", "persisted under the same key style as bb.quality");
});

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
function playGame() {
  const setup = tutorialSetup();
  const inputs: UserInput[] = [];
  for (;;) {
    const out = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs, facts: true });
    if (!out.awaiting) return out.result!;
    const a = out.awaiting, n = inputs.length;
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.1, y: 0 } }
      : a.role === "field" ? { kind: "field", timing: 0 }
        : a.role === "run" ? { kind: "run", action: "advance", send: a.run!.advance!.runners.map((r) => r.base) }
          : { kind: "swing", swing: "contact", timing: ((n % 5) - 2) / 4 });
  }
}

test("the setting and shot playback leave the replay hash unchanged", () => {
  const baseline = hash(playGame());
  for (const m of ACTION_SHOT_MODES) {
    setActionShots(m);
    const result = playGame();
    const d = director(m);
    result.events.forEach((_, i) => { const p = d.consider(result.events, i); if (p) { d.begin(i, 0); d.skip(i, 1000); } });
    assert.equal(hash(result), baseline, m);
  }
  setActionShots("reduced");
});

test("shots per simulated 3-inning match stay within the cap", () => {
  const setup = tutorialSetup();
  for (const [mode, cap] of [["full", SHOT_CAP], ["reduced", 3]] as const) {
    const counts: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const r = simulateGame({ ...setup.teams, seed, innings: 3, rules: setup.rules, difficulty: setup.difficulty, facts: true });
      const d = director(mode);
      r.events.forEach((_, i) => d.consider(r.events, i));
      counts.push(d.shots);
    }
    assert.ok(Math.max(...counts) <= cap, `${mode} max ${Math.max(...counts)}`);
    if (process.env.SHOT_STATS) console.log(mode, "shots/match", counts.join(","), "mean", (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(2));
  }
});
