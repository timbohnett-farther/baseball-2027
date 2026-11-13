import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { playInteractive, simulateGame } from "./game.ts";
import type { SimPlayer, SimTeam, UserInput } from "./types.ts";

// Golden tests for ruleset 1. Saved games are re-simulated from seed + input log, so these hashes
// were captured from the engine BEFORE rules versioning existed and must never change.

let nextId = 1;
const hitter = (r: number): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position: "LF", bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number, stamina: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina },
});
const team = (r: number, name: string, superBat = false): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: Array.from({ length: 9 }, () => hitter(r)),
  pitchers: [pitcher(r, 90), pitcher(r, 60), pitcher(r, 60)],
  ...(superBat ? { gear: { superBat: { id: "b", name: "Test Bat", charges: 2, contact: 6, power: 6 } } } : {}),
});
const away = team(72, "Away"), home = team(68, "Home", true);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

function scriptedLog(innings: number, rules: 1 | 2 | 3 | 4 | 5 | 6, abilities = false, startHeat?: number): { inputs: UserInput[]; result: ReturnType<typeof playInteractive>["result"] } {
  const inputs: UserInput[] = [];
  for (;;) {
    const out = playInteractive({ away, home, seed: 7, innings, rules, userSide: "home", inputs, ...(startHeat === undefined ? {} : { startHeat }) });
    if (!out.awaiting) return { inputs, result: out.result };
    const n = inputs.length, a = out.awaiting;
    const usable = abilities ? a.abilities.filter((x) => x.available && !x.needsDirection) : [];
    const ability = usable.length && n % 2 === 0 ? { ability: { id: usable[0].id } } : {};
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: (["fastball", "slider", "change", "curve"] as const)[n % 4], aim: { x: ((n * 7) % 11) / 5 - 1, y: ((n * 3) % 9) / 4 - 1 }, ...ability }
      : a.role === "field" ? { kind: "field", timing: ((n % 5) - 2) / 2 }
        : { kind: "swing", swing: n % 7 === 0 ? "take" : n % 3 === 0 ? "power" : "contact", timing: ((n % 9) - 4) / 4, super: n % 5 === 0, ...ability });
  }
}

test("rules 1: simulateGame output is unchanged", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 1 })));
  assert.equal(hash(all.flat()), "5745de525c5efa55");
});

test("rules 1: a game still level after 9 innings is a tie", () => {
  const even = (base: number): SimTeam => ({
    name: "T", abbr: "T", color: "#000",
    lineup: Array.from({ length: 9 }, (_, i) => ({ ...hitter(70), id: base + i })),
    pitchers: [{ ...pitcher(70, 90), id: base + 20 }, { ...pitcher(70, 90), id: base + 21 }],
  });
  const g = simulateGame({ away: even(0), home: even(100), seed: 7607, innings: 1, rules: 1 });
  assert.equal(g.winner, null);
  assert.equal(g.box.linescore.away.length, 9);
  assert.equal(hash(g), "90fadec1a52e7e29");
});

test("rules 1: an interactive input log replays to the same game", () => {
  const { inputs, result } = scriptedLog(3, 1);
  assert.equal(inputs.length, 41);
  assert.equal(hash(result), "830262917f7ac5d4");
});

// Golden tests for ruleset 2, captured before rules 3 (Heat economy) existed.
test("rules 2: simulateGame output is unchanged", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 2 })));
  assert.equal(hash(all.flat()), "5745de525c5efa55");
});

test("rules 2: an interactive input log replays to the same game", () => {
  const { inputs, result } = scriptedLog(3, 2);
  assert.equal(inputs.length, 41);
  assert.equal(hash(result), "830262917f7ac5d4");
});

// Golden tests for ruleset 3 (Heat economy), captured before abilities (rules 4) existed.
test("rules 3: simulateGame output is unchanged", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 3 })));
  assert.equal(hash(all.flat()), "2fe9c63061335065");
});

test("rules 3: an interactive input log replays to the same game", () => {
  const { inputs, result } = scriptedLog(3, 3);
  assert.equal(inputs.length, 65);
  assert.equal(hash(result), "e64775c8594cd0d4");
});

// Golden tests for ruleset 4 (abilities), captured before fielding inputs and rules 5 existed.
test("rules 4: simulateGame output is unchanged", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 4 })));
  assert.equal(hash(all.flat()), "2fe9c63061335065");
});

test("rules 4: an interactive input log replays to the same game", () => {
  const { inputs, result } = scriptedLog(3, 4);
  assert.equal(inputs.length, 65);
  assert.equal(hash(result), "e64775c8594cd0d4");
});

test("rules 4: an interactive log that spends abilities replays to the same game", () => {
  const { inputs, result } = scriptedLog(3, 4, true, 100);
  assert.ok(inputs.some((i) => "ability" in i && i.ability));
  assert.equal(hash(result), "76368dd13ed556b4");
});

// Golden tests for ruleset 5 (fielding throws and field abilities), captured before baserunning and rules 6 existed.
test("rules 5: simulateGame output is unchanged", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 5 })));
  assert.equal(hash(all.flat()), "2fe9c63061335065");
});

test("rules 5: an interactive input log replays to the same game", () => {
  const { inputs, result } = scriptedLog(3, 5);
  assert.equal(inputs.length, 65);
  assert.equal(hash(result), "e64775c8594cd0d4");
});

test("rules 5: an interactive log that spends abilities replays to the same game", () => {
  const { inputs, result } = scriptedLog(3, 5, true, 100);
  assert.ok(inputs.some((i) => "ability" in i && i.ability));
  assert.equal(inputs.length, 65);
  assert.equal(hash(result), "76368dd13ed556b4");
});

// The scripted log above never reaches a close ball, so this one pins the v5 field path (throws, glove taps, field abilities).
function fieldLog(seed: number, abilities: boolean): { inputs: UserInput[]; result: ReturnType<typeof playInteractive>["result"] } {
  const inputs: UserInput[] = [];
  for (;;) {
    const out = playInteractive({ away, home, seed, innings: 5, rules: 5, userSide: "home", inputs, startHeat: 100 });
    if (!out.awaiting) return { inputs, result: out.result };
    const n = inputs.length, a = out.awaiting;
    const usable = abilities ? a.abilities.filter((x) => x.available && !x.needsDirection) : [];
    const ability = usable.length ? { ability: { id: usable[0].id } } : {};
    const throwTo = a.ball?.throws ? { throwTo: a.ball.throws.options[n % a.ball.throws.options.length] } : {};
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: (["fastball", "slider", "change", "curve"] as const)[n % 4], aim: { x: ((n * 7) % 11) / 5 - 1, y: ((n * 3) % 9) / 4 - 1 } }
      : a.role === "field" ? { kind: "field", timing: ((n % 5) - 2) / 2, ...throwTo, ...ability }
        : { kind: "swing", swing: n % 4 === 0 ? "take" : "contact", timing: ((n % 9) - 4) / 4 });
  }
}

test("rules 5: interactive logs with glove taps, throws and field abilities replay to the same games", () => {
  const runs = Array.from({ length: 30 }, (_, seed) => [fieldLog(seed, false), fieldLog(seed, true)]).flat();
  const taps = runs.flatMap((r) => r.inputs).filter((i) => i.kind === "field");
  assert.ok(taps.length > 10, `only ${taps.length} glove taps`);
  assert.ok(taps.some((i) => i.kind === "field" && i.ability));
  assert.equal(hash(runs.map((r) => r.result)), "6528f131100a1cb9");
});

// Golden tests for ruleset 6 (baserunning), captured before rules 7 (Rally Breaker, CPU profiles) existed.
test("rules 6: simulateGame output is unchanged", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 6 })));
  assert.equal(hash(all.flat()), "2fe9c63061335065");
});

test("rules 6: interactive logs replay to the same games", () => {
  const plain = scriptedLog(3, 6), spent = scriptedLog(3, 6, true, 100);
  assert.ok(spent.inputs.some((i) => "ability" in i && i.ability));
  assert.equal(hash([plain.result, spent.result]), "cb0425f7f4ec055a");
});

// Golden tests for rules 7 (CPU abilities, Rally Breaker, throw-overs) and 8 (throw-over limit per batter). The user pitches as home
// and throws over whenever allowed, so rules 8's reset shows up as a different game from rules 7 on the same seed and log policy.
function cpuLog(seed: number, rules: 7 | 8, difficulty: "rookie" | "pro" | "allstar") {
  const inputs: UserInput[] = [];
  let pickoffs = 0;
  for (;;) {
    const out = playInteractive({ away, home, seed, innings: 3, rules, difficulty, userSide: "home", inputs, startHeat: 100 });
    if (!out.awaiting) return { inputs, result: out.result!, pickoffs };
    const n = inputs.length, a = out.awaiting;
    if (a.team?.available && !a.team.needsConfirm && !inputs.some((i) => i.kind === "team")) { inputs.push({ kind: "team", action: "rally_breaker" }); continue; }
    if (a.role === "run") { inputs.push({ kind: "run", action: "advance", send: a.run!.advance!.runners.map((r) => r.base) }); continue; }
    if (a.role === "pitch" && a.run?.pickoff.length && a.run.pickoffsLeft > 0 && n % 3 === 0) { pickoffs++; inputs.push({ kind: "run", action: "pickoff", at: a.run.pickoff[0].base }); continue; }
    const usable = a.abilities.filter((x) => x.available && !x.needsDirection);
    const ability = usable.length && n % 2 === 0 ? { ability: { id: usable[0].id } } : {};
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: (["fastball", "slider", "change", "curve"] as const)[n % 4], aim: { x: ((n * 7) % 11) / 5 - 1, y: ((n * 3) % 9) / 4 - 1 }, ...ability }
      : a.role === "field" ? { kind: "field", timing: ((n % 5) - 2) / 2 }
        : { kind: "swing", swing: n % 7 === 0 ? "take" : n % 3 === 0 ? "power" : "contact", timing: ((n % 9) - 4) / 4, ...ability });
  }
}
const cpuRuns = (rules: 7 | 8) => (["rookie", "pro", "allstar"] as const).flatMap((d) => [1, 2, 3, 4].map((seed) => cpuLog(seed, rules, d)));

test("rules 7: simulateGame output is unchanged", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 7 })));
  assert.equal(hash(all.flat()), "2fe9c63061335065");
});

test("rules 7: interactive logs against each CPU difficulty replay to the same games", () => {
  const runs = cpuRuns(7);
  assert.ok(runs.some((r) => r.result.events.some((e) => e.type === "team")), "Rally Breaker was used");
  assert.ok(runs.some((r) => r.result.events.some((e) => e.type === "ability" && e.side === "away" && e.phase === "committed")), "the computer spent an ability");
  assert.equal(hash(runs.map((r) => r.result)), "9778d6242ebed14e");
});

test("rules 8: simulateGame output is unchanged from rules 7", () => {
  const all = [1, 3, 5, 9].map((innings) => Array.from({ length: 25 }, (_, seed) => simulateGame({ away, home, seed, innings, rules: 8 })));
  assert.equal(hash(all.flat()), "2fe9c63061335065");
});

test("rules 8: interactive logs replay to the same games, and the throw-over limit resets per batter", () => {
  const v7 = cpuRuns(7), v8 = cpuRuns(8);
  const throws = (rs: ReturnType<typeof cpuRuns>) => rs.reduce((n, r) => n + r.pickoffs, 0);
  assert.ok(throws(v8) > throws(v7), `v8 ${throws(v8)} throw-overs vs v7 ${throws(v7)}`);
  assert.equal(hash(v8.map((r) => r.result)), "57773509544fe732");
});
