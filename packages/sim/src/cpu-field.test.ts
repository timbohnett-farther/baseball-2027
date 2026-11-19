// W43 (rules 10): the computer uses fielding abilities and Vortex under the user's costs, windows and information.
// Fixture: cpu-field.fixture.json (regenerate with UPDATE_CPU_FIELD_GOLDEN=1 only after a deliberate, versioned rules change).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ABILITIES, fieldContextOk, type FieldContext } from "./ability.ts";
import { PROFILES, chooseAbility, makeBot, utility, type CpuProfile, type Scene } from "./cpu.ts";
import { autoLineup, playInteractive } from "./game.ts";
import { createRng } from "./rng.ts";
import type { AbilityId, GameEvent, Side, SimPlayer, SimTeam, UserInput } from "./types.ts";

let nextId = 40_000;
const hitter = (r: number, position = "LF"): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position, bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
const team = (r: number, name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: [hitter(r, "C"), ...Array.from({ length: 8 }, () => hitter(r))], pitchers: [pitcher(r), pitcher(r)],
});
const away = team(70, "Away"), home = team(70, "Home");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const INNINGS = 3;

/** A user seat played by the scripted bot against the engine's computer, at full Heat so abilities are affordable. */
function game(seed: number, rules: 9 | 10, userSide: Side = "home", startHeat = 100) {
  const inputs: UserInput[] = [];
  const g = playInteractive({ away, home, seed, innings: INNINGS, rules, difficulty: "allstar", userSide, inputs, startHeat,
    auto: makeBot("pro", seed, userSide, { away, home }, INNINGS, rules) });
  assert.ok(g.result, "game ended");
  return { g, inputs, userSide };
}

const SEEDS = Array.from({ length: 40 }, (_, i) => 700 + i);
/** Always-ask profile: isolates the Heat, window and cost rules from the profile's taste. */
const EAGER: CpuProfile = { ...PROFILES.allstar, abilityMin: 0, abilityRate: 1 };
const scene = (over: Partial<Scene>): Scene => ({
  role: "field", heat: 100, balls: 0, strikes: 0, outs: 1, risp: false, loaded: false, late: false, margin: 0,
  batting: { contact: 70, power: 70, eye: 70, speed: 70, fielding: 70 }, pitching: { stuff: 70, control: 70, movement: 70, stamina: 90 },
  fastShare: 0.5, rules: 10, ...over,
});
const ask = (s: Scene) => chooseAbility(EAGER, createRng(1), s)?.id;

const FIELD: { id: AbilityId; ok: FieldContext; bad: FieldContext[] }[] = [
  { id: "FIELD_WALL_REAPER", ok: { kind: "fly", doublePlay: false }, bad: [{ kind: "grounder", doublePlay: false }, { kind: "liner", doublePlay: false }] },
  { id: "FIELD_ACROBAT", ok: { kind: "liner", doublePlay: false }, bad: [{ kind: "grounder", doublePlay: true }] },
  { id: "FIELD_CANNON_ARM", ok: { kind: "grounder", doublePlay: true }, bad: [{ kind: "grounder", doublePlay: false }, { kind: "fly", doublePlay: false }, { kind: "liner", doublePlay: false }] },
];

for (const f of FIELD) {
  test(`${f.id}: the computer asks only with enough Heat, only on a legal ball, and never under rules 9`, () => {
    const cost = ABILITIES[f.id as keyof typeof ABILITIES].cost;
    assert.ok(fieldContextOk(f.id, f.ok));
    // Heat: affordable at exactly the cost, nothing one point short.
    assert.equal(ask(scene({ ball: f.ok, heat: cost })), f.id, "fires at exactly the user's cost");
    assert.notEqual(ask(scene({ ball: f.ok, heat: cost - 1 })), f.id, "one point short never fires");
    // Window: the same ball gate the user's chip uses.
    for (const bad of f.bad) {
      assert.ok(!fieldContextOk(f.id, bad));
      assert.notEqual(ask(scene({ ball: bad })), f.id, `${f.id} never on ${bad.kind}${bad.doublePlay ? "+DP" : ""}`);
    }
    assert.equal(ask(scene({ ball: undefined })), undefined, "no ball, no fielding ability");
    // Ruleset: rules <= 9 never.
    for (const rules of [1, 5, 9, undefined]) assert.equal(ask(scene({ ball: f.ok, rules })), undefined, `rules ${rules}`);
    assert.ok(utility(f.id as never, scene({ ball: f.ok, rules: 9 })) < 0);
  });
}

test("the fielding decision reads only the ball kind and the base state, never whether the ball is a hit", () => {
  // Scene has no field for the outcome: the same scene scores the same however the contact roll lands.
  const s = scene({ ball: { kind: "fly", doublePlay: false }, risp: true, late: true });
  assert.equal(utility("FIELD_WALL_REAPER", s), utility("FIELD_WALL_REAPER", { ...s }));
  assert.deepEqual(Object.keys(s).filter((k) => /hit|outcome|result|robbed|wasHit/i.test(k)), []);
});

test("PITCH_VORTEX: rules 10 scores a two-strike pitch against a weak eye above the pro and allstar bars; rules 9 never did", () => {
  const eyes = [50, 60, 65, 70];
  for (const eye of eyes) {
    const s = scene({ role: "pitch", strikes: 2, batting: { contact: 70, power: 70, eye, speed: 70, fielding: 70 } });
    const u9 = utility("PITCH_VORTEX", { ...s, rules: 9 }), u10 = utility("PITCH_VORTEX", s);
    if (eye < 72) assert.ok(u10 >= 0.55 && u10 > u9, `eye ${eye}: ${u9} -> ${u10}`);
  }
  const weak = scene({ role: "pitch", strikes: 2, batting: { contact: 70, power: 70, eye: 60, speed: 70, fielding: 70 } });
  for (const p of [PROFILES.pro, PROFILES.allstar]) assert.ok(utility("PITCH_VORTEX", weak) >= p.abilityMin, "clears the pro and allstar bars (rookie, at 0.65, needs an eye of 50 or less)");
  // Same gates as before: a loaded board or a wild pitcher never asks, and the cost is the user's.
  assert.notEqual(ask({ ...weak, loaded: true }), "PITCH_VORTEX");
  assert.notEqual(ask({ ...weak, pitching: { stuff: 70, control: 50, movement: 70, stamina: 90 } }), "PITCH_VORTEX");
  assert.equal(chooseAbility(EAGER, createRng(1), { ...weak, heat: ABILITIES.PITCH_VORTEX.cost })?.id, "PITCH_VORTEX");
  assert.equal(chooseAbility(EAGER, createRng(1), { ...weak, heat: ABILITIES.PITCH_VORTEX.cost - 1 })?.id === "PITCH_VORTEX", false);
});

test("makeBot attaches Afterburner to a steal under rules 10 and only then", () => {
  const fast = team(70, "Fast");
  for (const p of fast.lineup) p.batting = { ...p.batting!, speed: 99 };
  const countSteals = (rules: 9 | 10) => {
    let steals = 0, withAb = 0;
    for (const seed of SEEDS) {
      const inputs: UserInput[] = [];
      playInteractive({ away, home: fast, seed, innings: INNINGS, rules, difficulty: "allstar", userSide: "home", inputs, startHeat: 100,
        auto: makeBot("pro", seed, "home", { away, home: fast }, INNINGS, rules) });
      for (const i of inputs) if (i.kind === "run" && i.action === "steal") { steals++; if (i.ability?.id === "RUN_AFTERBURNER") withAb++; }
    }
    return { steals, withAb };
  };
  const r9 = countSteals(9), r10 = countSteals(10);
  assert.equal(r9.withAb, 0, "rules 9 bots never attached it");
  assert.ok(r10.steals > 0 && r10.withAb > 0, `rules 10 steals ${r10.steals}, with Afterburner ${r10.withAb}`);
});

/** Every CPU-side ability event in one game. */
const cpuEvents = (g: { events: GameEvent[] }, userSide: Side) =>
  g.events.filter((e): e is Extract<GameEvent, { type: "ability" }> => e.type === "ability" && e.side !== userSide);

test("engine, rules 10: CPU fielding abilities and Vortex pay exactly the user's cost, open on a put-in-play ball, and settle", () => {
  const seen: Record<string, number> = {};
  for (const seed of SEEDS) {
    const { g, userSide } = game(seed, 10);
    const ev = g.events;
    ev.forEach((e, i) => {
      if (e.type !== "ability" || e.side === userSide || e.phase !== "committed") return;
      const id = e.ability as keyof typeof ABILITIES;
      if (!id.startsWith("FIELD_") && id !== "PITCH_VORTEX") return;
      seen[id] = (seen[id] ?? 0) + 1;
      const prev = ev[i - 1];
      assert.equal(e.heat, Math.max(0, (prev.state.heat[e.playerId] ?? 0) - ABILITIES[id].cost), `${id} costs exactly ${ABILITIES[id].cost}`);
      if (id.startsWith("FIELD_")) assert.equal(ev.slice(0, i).reverse().find((x) => x.type !== "ability")?.type, "pitch", "a fielding ability opens on the pitch that put the ball in play");
      const settle = ev.slice(i + 1).find((x) => x.type === "ability" && x.ability === id && x.playerId === e.playerId && x.phase !== "committed");
      assert.ok(settle, `${id} settles`);
    });
  }
  console.log("  CPU commits (allstar, startHeat 100, 40 games):", JSON.stringify(seen));
  assert.ok((seen.FIELD_WALL_REAPER ?? 0) + (seen.FIELD_ACROBAT ?? 0) + (seen.FIELD_CANNON_ARM ?? 0) > 0, "the CPU fields with an ability at least once");
});

test("engine, rules 9: the CPU never commits a fielding ability", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const { g, userSide } = game(seed, 9);
    for (const e of cpuEvents(g, userSide)) assert.ok(!String(e.ability).startsWith("FIELD_"), `${e.ability} under rules 9`);
  }
});

test("rules 10 is deterministic: the same seed and inputs give the same event hash, and the log replays it", () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const a = game(seed, 10), b = game(seed, 10);
    assert.equal(hash(a.g.events), hash(b.g.events));
    const r = playInteractive({ away, home, seed, innings: INNINGS, rules: 10, difficulty: "allstar", userSide: "home", inputs: a.inputs, startHeat: 100 });
    assert.equal(hash(r.events), hash(a.g.events), "replay from seed + input log matches");
  }
});

/** Rules-9 hashes captured at d1fd38f (before this wave) with the same teams, seeds and bot. A rules-9 game must still hash the same. */
const RULES9_PINNED: Record<number, string> = {
  700: "1863e753f23e0a93", 701: "3feb49b26aa3fe4e", 702: "1d6640de0a1b1b17", 703: "f3b43f1115a2d6dc",
  704: "527593628555197a", 705: "ea67d61b86d562c6", 706: "8e8f10907125e3dc", 707: "aeb85ab5e6bc31ec",
};
test("rules 9 is byte-identical to before W43", () => {
  for (const [seed, h] of Object.entries(RULES9_PINNED)) assert.equal(hash(game(Number(seed), 9).g.events), h, `seed ${seed}`);
  assert.ok(Object.keys(RULES9_PINNED).length >= 5, "pinned hashes present");
});

const fixturePath = new URL("./cpu-field.fixture.json", import.meta.url);
test("golden fixture: rules-10 games replay to the pinned event hash", () => {
  const computed = Object.fromEntries(SEEDS.slice(0, 8).map((s) => [s, hash(game(s, 10).g.events)]));
  if (process.env.UPDATE_CPU_FIELD_GOLDEN === "1") writeFileSync(fixturePath, JSON.stringify({ rules: 10, innings: INNINGS, hashes: computed }, null, 2) + "\n");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { rules: number; hashes: Record<string, string> };
  assert.equal(fixture.rules, 10);
  assert.deepEqual(computed, fixture.hashes);
});

test("rules 10: a throw-over logged for the next half is not eaten by the computer's own half-ending pickoff on replay", () => {
  // Seed 49 of the gameplay report (synthetic even 70s, bot away vs pro computer): the computer picks off the third out of the top, then the bot's
  // pickoff opens the bottom. Replaying the log used to hand that pickoff to the top's loop top, which dropped it and desynchronised every later input.
  const seed = 49, side: Side = "away";
  let rid = 1; // the report's own synthetic teams, ids and all: the failing game depends on them
  const rh = (r: number): SimPlayer => ({ id: rid++, name: `H${rid}`, lastName: `H${rid}`, position: "LF", bats: "R", batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null });
  const ra = (r: number): SimPlayer => ({ id: rid++, name: `P${rid}`, lastName: `P${rid}`, position: "P", bats: "R", batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 } });
  const mk = (n: string): SimTeam => ({ name: n, abbr: n.slice(0, 3).toUpperCase(), color: "#e0a458", lineup: autoLineup(Array.from({ length: 9 }, () => rh(70))), pitchers: [ra(70), ra(70)] });
  const a = mk("Away"), h = mk("Home");
  const inputs: UserInput[] = [];
  const live = playInteractive({ away: a, home: h, seed, innings: INNINGS, rules: 10, difficulty: "pro", userSide: side, inputs, auto: makeBot("pro", seed, side, { away: a, home: h }, INNINGS, 10) });
  const again = playInteractive({ away: a, home: h, seed, innings: INNINGS, rules: 10, difficulty: "pro", userSide: side, inputs });
  assert.equal(JSON.stringify(again.events), JSON.stringify(live.events));
  for (let k = 0; k <= inputs.length; k++) playInteractive({ away: a, home: h, seed, innings: INNINGS, rules: 10, difficulty: "pro", userSide: side, inputs: inputs.slice(0, k) }); // no prefix throws
});
