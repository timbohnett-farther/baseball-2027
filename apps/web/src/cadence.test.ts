import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRng, playInteractive, tutorialSetup, type GameEvent, type UserInput } from "@bb/sim";
import { ActionShotDirector, holdWithShot, SHOT_CAP, SHOT_MAX_MS, type ActionShotMode, type ShotFamily } from "./actionshot.ts";
import { setComfort, reducedFlash, isLefty } from "./comfort.ts";
import { shotTreatment } from "./shotfx.ts";
import { blockingBudgetMs } from "./presentation.ts";
import { cosmeticRng } from "./cosmetic.ts";
import { QUALITIES, QUALITY_PROFILE, type Quality } from "./quality.ts";
import { CADENCES, FrameClock, frameInterval, schedule, type Cadence } from "./cadence.ts";

// W35b: render cadence, graphics tier and accessibility settings never reach the authoritative replay. The sim is not stepped by
// the renderer (a match is a pure function of seed + input log, replayed whole), so the proof has three legs: (1) the same
// presentation loop the ballpark runs, driven by real 30/60/144 Hz, uneven and stalled frame schedules, decides identical shots for
// identical events; (2) the authoritative hash is unchanged by any of it, and cannot see wall clock, Math.random or the DOM;
// (3) the cosmetic stream really does move with cadence (so the comparison is not vacuous) while staying out of the sim.

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const here = dirname(fileURLToPath(import.meta.url));

type Setup = ReturnType<typeof tutorialSetup>;
const run = (setup: Setup, inputs: UserInput[]) => playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs });

/** A full interactive match: the same scripted inputs for the same seed every time (swing timings sweep the window so hits, outs and big plays all occur). */
function playMatch(seed: number, innings: number, difficulty: Setup["difficulty"] = "rookie") {
  const setup: Setup = { ...tutorialSetup(), seed, innings, difficulty };
  const inputs: UserInput[] = [];
  for (;;) {
    const out = run(setup, inputs);
    if (!out.awaiting) return { setup, inputs, result: out.result! };
    const a = out.awaiting, n = inputs.length;
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: ((n % 3) - 1) / 4, y: 0 } }
      : a.role === "field" ? { kind: "field", timing: ((n % 4) - 1.5) / 3 }
        : a.role === "run" ? { kind: "run", action: "advance", send: a.run!.advance!.runners.map((r) => r.base) }
          : { kind: "swing", swing: n % 7 === 0 ? "power" : "contact", timing: ((n % 9) - 4) / 8 });
  }
}

interface Presented { shots: { index: number; family: ShotFamily; wallMs: number; planMs: number }[]; rendered: number; maxStepSec: number; cosmetic: number; eventsShown: number; endMs: number }

/**
 * The presentation loop of game.tsx + field.tsx, on a virtual clock. Events are shown one hold after another (setTimeout in the
 * app, so wall-clock); the ballpark frame gate (FrameClock) runs on the schedule's frames; a shot's camera clock advances by the
 * clamped frame step and the shot ends when it has run its planned duration; the cosmetic stream draws once a frame.
 */
function present(events: GameEvent[], innings: number, cadence: Cadence, tier: Quality, mode: ActionShotMode, reduced: boolean, speed: number): Presented {
  const director = new ActionShotDirector({ mode, reducedMotion: reduced, innings });
  const at: number[] = [0];
  for (let i = 0; i < events.length; i++) at.push(at[i] + holdWithShot(blockingBudgetMs(events[i]), director.consider(events, i)) / speed);
  const total = at[events.length];
  const frames = schedule(cadence, total + 2500);
  const clock = new FrameClock(QUALITY_PROFILE[tier].minFrameMs, 0);
  const rand = cosmeticRng(events.length), out: Presented = { shots: [], rendered: 0, maxStepSec: 0, cosmetic: 0, eventsShown: 0, endMs: total };
  let next = 0, live: { index: number; durS: number; t: number; since: number; family: ShotFamily } | null = null;
  const end = (i: number, now: number) => { if (live) { out.shots.push({ index: live.index, family: live.family, wallMs: now - live.since, planMs: live.durS * 1000 }); director.finish(i, now); live = null; } };
  for (const now of frames) {
    while (next < events.length && at[next] <= now) { // events land by timer, not by frame
      if (live) end(live.index, at[next]);
      const plan = director.consider(events, next);
      if (plan && director.begin(next, at[next])) live = { index: next, durS: plan.durMs / 1000, t: 0, since: at[next], family: plan.family };
      out.eventsShown++; next++;
    }
    const step = clock.tick(now);
    if (!step) continue;
    out.rendered++; out.maxStepSec = Math.max(out.maxStepSec, step.real); out.cosmetic += rand();
    if (live) { live.t += step.real; if (live.t >= live.durS) end(live.index, now); }
  }
  return out;
}

const SEEDS = [11, 22, 33];
const matches = SEEDS.map((s, i) => playMatch(s, 2 + (i % 2), i === 2 ? "allstar" : "rookie"));
const MODES: ActionShotMode[] = ["full", "reduced", "off"];

test("30/60/144 Hz, uneven and stalled frames x High/Standard/Battery x shot modes x reduced motion: the replay hash never moves", () => {
  let cells = 0;
  for (const m of matches) {
    const before = hash(m.result);
    for (const cadence of CADENCES) for (const tier of QUALITIES) for (const mode of MODES) for (const reduced of [false, true]) for (const speed of [1, 2]) {
      const p = present(m.result.events, m.setup.innings, cadence, tier, mode, reduced, speed);
      assert.equal(p.eventsShown, m.result.events.length, `every event is shown (${cadence}/${tier}/${mode}/${reduced}/${speed}x)`);
      assert.equal(hash(run(m.setup, m.inputs).result), before, `${cadence} ${tier} ${mode} reduced=${reduced} ${speed}x seed ${m.setup.seed}`);
      cells++;
    }
    assert.equal(hash(m.result), before);
  }
  assert.equal(cells, SEEDS.length * 5 * 3 * 3 * 2 * 2);
});

test("which action shots run depends on the events, the mode and reduced motion, never on cadence or tier", () => {
  let anyShot = false;
  for (const m of matches) for (const mode of MODES) for (const reduced of [false, true]) {
    const sig = (c: Cadence, q: Quality, sp: number) => JSON.stringify(present(m.result.events, m.setup.innings, c, q, mode, reduced, sp).shots.map((s) => [s.index, s.family, s.planMs]));
    const ref = sig("hz60", "high", 1);
    for (const c of CADENCES) for (const q of QUALITIES) assert.equal(sig(c, q, 1), ref, `${c} ${q} ${mode} reduced=${reduced}`);
    const n = present(m.result.events, m.setup.innings, "hz60", "high", mode, reduced, 1).shots.length;
    assert.ok(n <= SHOT_CAP);
    if (mode === "off") assert.equal(n, 0); else anyShot ||= n > 0;
  }
  assert.ok(anyShot, "the fixtures include at least one shot, so the comparison above is not vacuous");
});

test("a shot lasts its planned time on every cadence; a stall can only stretch it by the animation clamp (never a delay the sim sees)", () => {
  let checked = 0;
  for (const m of matches) for (const cadence of CADENCES) for (const tier of QUALITIES) {
    const p = present(m.result.events, m.setup.innings, cadence, tier, "full", false, 1);
    assert.ok(p.maxStepSec <= 0.05 + 1e-9, "a long frame never advances animation by more than 50 ms");
    for (const s of p.shots) {
      assert.ok(s.planMs <= SHOT_MAX_MS);
      const slack = cadence === "stall" ? 1100 : 70; // one frame (battery: two) beyond plan on steady cadences
      assert.ok(s.wallMs >= 0 && s.wallMs <= s.planMs + slack, `${cadence}/${tier}: shot ${s.family} ran ${Math.round(s.wallMs)} ms for a ${s.planMs} ms plan`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test("the cosmetic stream does move with cadence and tier (the comparison is not vacuous), yet the sim hash is the same", () => {
  const m = matches[0];
  const digests = new Set<number>();
  for (const c of CADENCES) for (const q of QUALITIES) digests.add(present(m.result.events, m.setup.innings, c, q, "full", false, 1).cosmetic);
  assert.ok(digests.size > 5, "frame count differs per cadence/tier, so cosmetic draws differ");
  assert.equal(hash(run(m.setup, m.inputs).result), hash(m.result));
});

test("wall clock, Math.random and the DOM are invisible to the sim", () => {
  const m = matches[0], before = hash(m.result);
  const real = { random: Math.random, now: Date.now, perf: performance.now.bind(performance) };
  let t = 1_000;
  Math.random = () => { throw new Error("sim read Math.random"); };
  Date.now = () => (t += 777_777);
  performance.now = () => (t += 123.456);
  try {
    assert.equal(hash(run(m.setup, m.inputs).result), before);
    assert.equal(hash(playMatch(11, 2).result), hash(playMatch(11, 2).result));
  } finally { Math.random = real.random; Date.now = real.now; performance.now = real.perf; }
  // and the sim sources do not mention them at all
  const simSrc = join(here, "../../../packages/sim/src");
  for (const f of readdirSync(simSrc).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const src = readFileSync(join(simSrc, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""'); // code only: no comments, no strings
    assert.ok(!/Math\.random|Date\.now|performance\.now|new Date\(|requestAnimationFrame|\bwindow\.|\bdocument\.|localStorage/.test(src), `${f} reads nothing outside its inputs`);
  }
});

test("the three random streams are separate: gameplay, CPU, and the web layer's cosmetic stream", () => {
  const m = matches[0], before = hash(m.result);
  // draining the cosmetic stream (as many frames as a long match draws) leaves the gameplay stream and the replay untouched
  const cosmetic = cosmeticRng(m.setup.seed), gameplay = createRng(m.setup.seed), ref = createRng(m.setup.seed);
  for (let i = 0; i < 100_000; i++) cosmetic();
  for (let i = 0; i < 50; i++) assert.equal(gameplay.next(), ref.next());
  assert.equal(hash(run(m.setup, m.inputs).result), before);
  // the CPU stream is its own seed in the sim
  const sim = readFileSync(join(here, "../../../packages/sim/src/game.ts"), "utf8");
  assert.match(sim, /rng: createRng\(input\.seed\)/);
  assert.match(sim, /cpuRng: createRng\(\(input\.seed \^ 0x5bd1e995\) >>> 0\)/);
  // the web layer's presentation modules never import the sim at runtime (types only), so a draw there cannot be a sim draw
  for (const f of ["cosmetic.ts", "cadence.ts", "quality.ts", "perftelemetry.ts"]) assert.ok(!/from "@bb\/sim"/.test(readFileSync(join(here, f), "utf8")), `${f} does not import @bb/sim`);
  for (const f of ["actionshot.ts", "presentation.ts"]) assert.ok(!/^import \{/m.test(readFileSync(join(here, f), "utf8").split("\n").filter((l) => l.includes('"@bb/sim"')).join("\n")), `${f} imports only types from @bb/sim`);
});

test("FrameClock: 30/60/144 Hz display feeds, the battery cap, and the long-frame clamp", () => {
  const rendered = (cad: Cadence, minMs: number) => { const c = new FrameClock(minMs, 0); let n = 0; for (const t of schedule(cad, 10_000)) if (c.tick(t)) n++; return n / 10; };
  assert.ok(Math.abs(rendered("hz30", 0) - 30) < 1);
  assert.ok(Math.abs(rendered("hz60", 0) - 60) < 1);
  assert.ok(Math.abs(rendered("hz144", 0) - 144) < 1);
  for (const cad of ["hz30", "hz60"] as const) assert.ok(Math.abs(rendered(cad, QUALITY_PROFILE.battery.minFrameMs) - 30) < 1.5, `battery on ${cad}`);
  const b144 = rendered("hz144", QUALITY_PROFILE.battery.minFrameMs);
  assert.ok(b144 > 27 && b144 <= 30, `battery on 144 Hz renders ${b144} fps`);
  const c = new FrameClock(0, 0);
  assert.equal(c.tick(500)!.real, 0.05, "a 500 ms stall advances animation by 50 ms");
  assert.ok(Math.abs(c.tick(516.6)!.real - 0.0166) < 1e-9);
});

test("schedules are repeatable and cover the stated cases", () => {
  assert.deepEqual(schedule("uneven", 5000, 3), schedule("uneven", 5000, 3));
  const iv = (c: Cadence) => { const s = schedule(c, 20_000); return s.slice(1).map((t, i) => t - s[i]); };
  assert.ok(Math.max(...iv("stall")) >= 500 && Math.min(...iv("stall")) < 17);
  assert.ok(Math.max(...iv("uneven")) > 33 && Math.min(...iv("uneven")) < 8);
  assert.equal(frameInterval("hz144", 0), 1000 / 144);
});

test("left-handed layout and reduced flash are presentation-only: the replay hash never moves, and calm only removes flashes", () => {
  for (const m of matches) {
    const before = hash(m.result);
    for (const lefty of [false, true]) for (const calm of [false, true]) {
      setComfort("lefty", lefty); setComfort("calm", calm);
      assert.equal(isLefty(), lefty); assert.equal(reducedFlash() || !calm, true);
      assert.equal(hash(run(m.setup, m.inputs).result), before, `lefty=${lefty} calm=${calm} seed ${m.setup.seed}`);
    }
  }
  setComfort("lefty", false); setComfort("calm", false);
  for (const tier of QUALITIES) {
    const on = shotTreatment("contact", tier, false), off = shotTreatment("contact", tier, true);
    assert.equal(off.pulse, 0); assert.ok(off.fx.length <= on.fx.length);
  }
});
