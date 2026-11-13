import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { playInteractive } from "./game.ts";
import { ABILITIES, BOUNDS, arm, cancel, check, combine, commit, expire, newLedger, statuses } from "./ability.ts";
import type { AbilityDef, Actor } from "./ability.ts";
import type { AbilityRequest, GameEvent, SimPlayer, SimTeam, UserInput } from "./types.ts";

let nextId = 1000;
const hitter = (r: number): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position: "LF", bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
const team = (r: number, name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: Array.from({ length: 9 }, () => hitter(r)), pitchers: [pitcher(r), pitcher(r)],
});
const away = team(70, "Away"), home = team(70, "Home");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const play = (seed: number, inputs: UserInput[], rules: 3 | 4 = 4) =>
  playInteractive({ away, home, seed, innings: 3, rules, userSide: "home", inputs, startHeat: 100 });

const plain = (role: string, n: number, timing: number, swing: "contact" | "power"): UserInput =>
  role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: ((n * 7) % 11) / 8 - 0.6, y: ((n * 3) % 9) / 8 - 0.5 } }
    : role === "field" ? { kind: "field", timing: 0 } : { kind: "swing", swing, timing };
const withAbility = (i: UserInput, ability: AbilityRequest): UserInput => (i.kind === "pitch" || i.kind === "swing" ? { ...i, ability } : i);

interface Pair { a: GameEvent[]; b: GameEvent[]; committed: boolean }

/** First chance the user has to use `req` (as `role`): the same pitch played with and without it, same seed. No ability draws from the RNG, so the two differ only by the ability. */
function pair(seed: number, role: "pitch" | "swing", req: AbilityRequest, timing: number, swing: "contact" | "power"): Pair | null {
  const base: UserInput[] = [];
  for (let n = 0; n < 200; n++) {
    const out = play(seed, base);
    if (!out.awaiting) return null;
    const own = out.awaiting.role === role;
    const next = plain(out.awaiting.role, n, timing, swing);
    if (own) {
      const b = play(seed, [...base, withAbility(next, req)]);
      const fresh = b.events.slice(out.events.length);
      if (fresh.some((e) => e.type === "ability" && e.phase === "committed")) {
        return { a: play(seed, [...base, next]).events.slice(out.events.length), b: fresh, committed: true };
      }
    }
    base.push(next);
  }
  return null;
}

/** Outcome of the first pitch after the ability point: its result, plus the play if it went in play. */
function firstPitch(events: GameEvent[]) {
  const xs = events.filter((e) => e.type !== "ability");
  const i = xs.findIndex((e) => e.type === "pitch");
  const pitch = xs[i] as Extract<GameEvent, { type: "pitch" }>;
  const p = xs.slice(i + 1).find((e) => e.type === "play") as Extract<GameEvent, { type: "play" }> | undefined;
  return { pitch, outcome: pitch.result === "in_play" ? p?.outcome : undefined };
}

const HITS = ["single", "double", "triple", "home_run"];
const SEEDS = Array.from({ length: 500 }, (_, i) => i);
function measure(role: "pitch" | "swing", req: AbilityRequest, timing: number, swing: "contact" | "power") {
  const rows = SEEDS.map((s) => pair(s, role, req, timing, swing)).filter((p): p is Pair => !!p).map((p) => ({ a: firstPitch(p.a), b: firstPitch(p.b) }));
  const rate = (side: "a" | "b", f: (r: ReturnType<typeof firstPitch>) => boolean) => rows.filter((r) => f(r[side])).length / rows.length;
  return { n: rows.length, rate };
}
const log = (name: string, base: number, withIt: number) => console.log(`  ${name}: ${(base * 100).toFixed(1)}% -> ${(withIt * 100).toFixed(1)}%`);

// --- Effect direction over many seeds (the numbers are printed so a tuning change shows up in the log) ---

test("Comet: a power swing hits more homers and fewer grounders", () => {
  const m = measure("swing", { id: "BAT_COMET" }, 0.1, "power");
  assert.ok(m.n > 300);
  const hr = (r: ReturnType<typeof firstPitch>) => r.outcome === "home_run", gb = (r: ReturnType<typeof firstPitch>) => r.outcome === "groundout" || r.outcome === "double_play";
  log("Comet HR", m.rate("a", hr), m.rate("b", hr)); log("Comet ground outs", m.rate("a", gb), m.rate("b", gb));
  assert.ok(m.rate("b", hr) > m.rate("a", hr));
  assert.ok(m.rate("b", gb) < m.rate("a", gb));
});

test("Laser: more hits, fewer ground balls", () => {
  const m = measure("swing", { id: "BAT_LASER" }, 0.1, "contact");
  const hit = (r: ReturnType<typeof firstPitch>) => !!r.outcome && HITS.includes(r.outcome), gb = (r: ReturnType<typeof firstPitch>) => r.outcome === "groundout" || r.outcome === "double_play";
  log("Laser hit", m.rate("a", hit), m.rate("b", hit)); log("Laser ground outs", m.rate("a", gb), m.rate("b", gb));
  assert.ok(m.rate("b", hit) > m.rate("a", hit));
  assert.ok(m.rate("b", gb) < m.rate("a", gb));
});

test("Gap Master: more doubles, either side", () => {
  for (const direction of ["left", "right"] as const) {
    const m = measure("swing", { id: "BAT_GAP_MASTER", direction }, 0.1, "contact");
    const dbl = (r: ReturnType<typeof firstPitch>) => r.outcome === "double";
    log(`Gap Master ${direction} doubles`, m.rate("a", dbl), m.rate("b", dbl));
    assert.ok(m.rate("b", dbl) > m.rate("a", dbl));
  }
});

test("Second Swing: a badly mistimed miss becomes a foul, and never a better result", () => {
  const m = measure("swing", { id: "BAT_SECOND_SWING" }, 0.95, "contact");
  const whiff = (r: ReturnType<typeof firstPitch>) => r.pitch.result === "swinging_strike", foul = (r: ReturnType<typeof firstPitch>) => r.pitch.result === "foul";
  log("Second Swing whiffs", m.rate("a", whiff), m.rate("b", whiff)); log("Second Swing fouls", m.rate("a", foul), m.rate("b", foul));
  assert.ok(m.rate("b", whiff) < m.rate("a", whiff));
  assert.ok(m.rate("b", foul) > m.rate("a", foul));
  const hit = (r: ReturnType<typeof firstPitch>) => r.pitch.result === "in_play";
  assert.equal(m.rate("b", hit), m.rate("a", hit));
});

test("Vortex: the pitch is harder to control, so fewer land in the zone", () => {
  const m = measure("pitch", { id: "PITCH_VORTEX", direction: "left" }, 0, "contact");
  const zone = (r: ReturnType<typeof firstPitch>) => r.pitch.zone;
  log("Vortex in the zone", m.rate("a", zone), m.rate("b", zone));
  assert.ok(m.n > 300);
  assert.ok(m.rate("b", zone) < m.rate("a", zone));
});

test("Mirage: no physics change, cost still spent", () => {
  const rows = SEEDS.slice(0, 100).map((s) => pair(s, "pitch", { id: "PITCH_MIRAGE" }, 0, "contact")).filter((p): p is Pair => !!p);
  assert.ok(rows.length > 80);
  const core = (r: ReturnType<typeof firstPitch>) => ({ result: r.pitch.result, mph: r.pitch.mph, zone: r.pitch.zone, outcome: r.outcome });
  for (const p of rows) assert.deepEqual(core(firstPitch(p.a)), core(firstPitch(p.b)));
  const c = rows[0].b.find((e) => e.type === "ability" && e.phase === "committed") as Extract<GameEvent, { type: "ability" }>;
  assert.equal(c.heat, 60);
});

// --- Caps ---

test("global caps hold however abilities stack", () => {
  const all = combine(Object.values(ABILITIES).flatMap((d) => [d.effects("left"), d.effects("left"), d.effects("left")]));
  for (const k of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) {
    assert.ok(all[k] >= BOUNDS[k][0] && all[k] <= BOUNDS[k][1], k);
  }
  assert.equal(all.missScale, 1.5);
  assert.equal(all.dHr <= 0.05, true);
  assert.deepEqual(combine([]), combine([{}]));
});

// --- Activation service ---

const bat: Actor = { id: 1, role: "bat", heat: 100 };
const pit: Actor = { id: 2, role: "pitch", heat: 100 };

test("arm reserves Heat, cancel and take release it in full, commit spends it", () => {
  const l = newLedger();
  assert.ok(arm(ABILITIES, l, bat, { id: "BAT_LASER" }).ok);
  assert.equal(statuses(ABILITIES, l, bat).find((s) => s.id === "BAT_COMET")?.available, false); // one reservation at a time
  cancel(l);
  assert.equal(l.armed, null);
  assert.ok(check(ABILITIES, l, bat, { id: "BAT_LASER" }, "take").ok === false);
  assert.ok(arm(ABILITIES, l, bat, { id: "BAT_LASER" }).ok);
  const done = commit(ABILITIES, l, bat, "contact");
  assert.ok(done.ok);
  assert.equal(done.heat, 50);
  assert.equal(l.armed, null);
});

test("an invalid request costs nothing and says why in plain words", () => {
  const l = newLedger();
  const cases: [Actor, AbilityRequest, string][] = [
    [{ ...bat, heat: 49 }, { id: "BAT_LASER" }, "INSUFFICIENT_HEAT"],
    [bat, { id: "PITCH_VORTEX", direction: "left" }, "INELIGIBLE_ACTOR"],
    [pit, { id: "BAT_LASER" }, "INELIGIBLE_ACTOR"],
    [bat, { id: "BAT_GAP_MASTER" }, "SELECT_DIRECTION"],
    [pit, { id: "PITCH_VORTEX" }, "SELECT_DIRECTION"],
    [bat, { id: "BAT_NOPE" as never }, "WRONG_CONTEXT"],
  ];
  for (const [actor, req, reason] of cases) {
    const v = arm(ABILITIES, l, actor, req);
    assert.equal(v.ok, false);
    if (!v.ok) { assert.equal(v.reason, reason); assert.ok(v.message.length > 5); }
    assert.equal(l.armed, null);
  }
  assert.equal(check(ABILITIES, l, bat, { id: "BAT_COMET" }, "contact").ok, false); // wrong swing
  assert.ok(arm(ABILITIES, l, bat, { id: "BAT_LASER" }).ok);
  assert.equal(arm(ABILITIES, l, bat, { id: "BAT_COMET" }).ok, false); // already reserved
  assert.equal(l.armed?.request.id, "BAT_LASER");
});

test("cooldown counts pitches; an unspent reservation is released when the pitch ends", () => {
  const cat: Record<string, AbilityDef> = { ...ABILITIES, BAT_LASER: { ...ABILITIES.BAT_LASER, cooldownPitches: 2 } };
  const l = newLedger();
  assert.ok(arm(cat, l, bat, { id: "BAT_LASER" }).ok);
  assert.ok(commit(cat, l, bat, "contact").ok);
  expire(l);
  const v = arm(cat, l, bat, { id: "BAT_LASER" });
  assert.equal(v.ok === false && v.reason, "COOLDOWN");
  expire(l); expire(l);
  assert.ok(arm(cat, l, bat, { id: "BAT_LASER" }).ok);
  expire(l); // swing never happened: released, nothing spent
  assert.equal(l.armed, null);
});

// --- In the engine ---

const heatOf = (events: GameEvent[], id: number) => [...events].reverse().find((e) => e.type !== "final")?.state.heat[id];

test("engine: a refused ability costs nothing, a committed one costs its Heat", () => {
  const first = play(3, []);
  assert.equal(first.awaiting?.role, "pitch"); // the home team starts in the field
  const pitcherId = first.awaiting!.pitcherId;
  const bad = play(3, [withAbility(plain("pitch", 0, 0, "contact"), { id: "BAT_LASER" })]);
  const rej = bad.events.find((e) => e.type === "ability") as Extract<GameEvent, { type: "ability" }>;
  assert.equal(rej.phase, "rejected");
  assert.equal(rej.reason, "INELIGIBLE_ACTOR");
  assert.equal(rej.heat, 100);
  const good = play(3, [withAbility(plain("pitch", 0, 0, "contact"), { id: "PITCH_VORTEX", direction: "right" })]);
  const ev = good.events.filter((e): e is Extract<GameEvent, { type: "ability" }> => e.type === "ability");
  assert.deepEqual(ev.map((e) => e.phase), ["committed", "triggered"]);
  assert.equal(ev[0].heat, 50);
  assert.ok(heatOf(good.events, pitcherId)! < 60); // 50 spent, plus what the pitch itself earns
  assert.ok(good.awaiting?.abilities.length);
});

test("engine: Awaiting reports each chip with a reason when it is not usable", () => {
  const opts = { away, home, seed: 3, innings: 3, rules: 4 as const, userSide: "home" as const, inputs: [] as UserInput[], startHeat: 20 };
  const a = playInteractive(opts).awaiting!;
  assert.deepEqual(a.abilities.map((x) => x.id), ["PITCH_MIRAGE", "PITCH_VORTEX"]);
  assert.ok(a.abilities.every((x) => !x.available && x.reason === "INSUFFICIENT_HEAT" && x.message));
  const rich = playInteractive({ ...opts, startHeat: 100 }).awaiting!;
  assert.ok(rich.abilities.every((x) => x.available));
  assert.equal(playInteractive({ ...opts, rules: 3 }).awaiting!.abilities.length, 0);
});

// --- Replay and versions ---

function scripted(rules: 3 | 4, useAbilities: boolean): UserInput[] {
  const inputs: UserInput[] = [];
  for (let n = 0; n < 400; n++) {
    const out = playInteractive({ away, home, seed: 11, innings: 3, rules, userSide: "home", inputs, startHeat: 100 });
    if (!out.awaiting) return inputs;
    const a = out.awaiting;
    const req: AbilityRequest | undefined = !useAbilities ? undefined
      : a.role === "pitch" ? { id: n % 2 ? "PITCH_VORTEX" : "PITCH_MIRAGE", direction: n % 3 ? "left" : "right" }
        : { id: (["BAT_LASER", "BAT_COMET", "BAT_GAP_MASTER", "BAT_SECOND_SWING"] as const)[n % 4], direction: "right" };
    const base = plain(a.role, n, ((n % 9) - 4) / 4, n % 3 === 0 ? "power" : "contact");
    inputs.push(req ? withAbility(base, req) : base);
  }
  throw new Error("game never finished");
}

test("a log with abilities replays to the same game, events included", () => {
  const inputs = scripted(4, true);
  const run = () => playInteractive({ away, home, seed: 11, innings: 3, rules: 4, userSide: "home", inputs, startHeat: 100 });
  const a = run(), b = run();
  assert.equal(a.awaiting, null);
  assert.equal(hash(a), hash(b));
  const kinds = new Set(a.events.filter((e) => e.type === "ability").map((e) => (e as Extract<GameEvent, { type: "ability" }>).phase));
  assert.ok(kinds.has("committed") && kinds.has("rejected"));
  assert.ok(a.events.some((e) => e.type === "ability" && e.phase === "triggered"));
});

test("rules 3 ignores an ability field; rules 4 with no ability plays the rules 3 game", () => {
  const run = (rules: 3 | 4, inputs: UserInput[]) => playInteractive({ away, home, seed: 11, innings: 3, rules, userSide: "home", inputs, startHeat: 100 });
  const withA = scripted(3, true), without = scripted(3, false);
  assert.equal(hash(run(3, withA)), hash(run(3, without)));
  const v3 = run(3, without), v4 = run(4, without);
  assert.deepEqual(v4.result, v3.result);
  assert.deepEqual(v4.events, v3.events);
});
