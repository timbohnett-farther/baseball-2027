import { test } from "node:test";
import assert from "node:assert/strict";
import { playInteractive, rallyAssist, simulateGame } from "./game.ts";
import type { GameEvent, GameState, Side, SimPlayer, SimTeam, UserInput } from "./types.ts";

let nextId = 5000;
const hitter = (r: number): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position: "LF", bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
const team = (bat: number, arm: number, name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: Array.from({ length: 9 }, () => hitter(bat)),
  pitchers: [pitcher(arm), pitcher(arm), pitcher(arm)],
});
const mashers = team(95, 95, "Mashers"), cans = team(40, 40, "Cans");
const even = [team(70, 70, "Alpha"), team(70, 70, "Bravo")] as const;

const sideOf = (s: GameState): Side => (s.half === "top" ? "away" : "home");
const opp = (s: Side): Side => (s === "away" ? "home" : "away");
const games = (n: number, away: SimTeam, home: SimTeam) =>
  Array.from({ length: n }, (_, seed) => simulateGame({ away, home, seed, innings: 5 }));
/** What a base award pays: x1.25 rounded when the athlete's team trails by 3+ at the start of the pitch. */
const pay = (base: number, assisted: boolean) => (assisted && base > 0 ? Math.round(base * 1.25) : base);
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

test("v3 start: every rostered athlete, substitutes included, is at 25 Heat with an empty Rally", () => {
  const g = simulateGame({ away: even[0], home: even[1], seed: 3, innings: 1 });
  const first = g.events[0].state;
  for (const t of even) for (const p of [...t.lineup, ...t.pitchers]) assert.equal(first.heat[p.id] ?? 25, 25);
  assert.equal(first.rally.away + first.rally.home, 0);
  const all = Object.keys(g.events[g.events.length - 1].state.heat);
  assert.equal(all.length, 2 * (9 + 3), "substitutes are tracked from the first pitch");
});

test("v3 caps: Heat stays in 0-100, Rally in 0-100 and never falls, fire never lights", () => {
  let hot = 0, cold = 0;
  for (const g of games(40, mashers, cans)) {
    let last = { away: 0, home: 0 };
    for (const e of g.events) {
      for (const h of Object.values(e.state.heat)) { assert.ok(Number.isInteger(h) && h >= 0 && h <= 100); if (h === 100) hot++; if (h === 0) cold++; }
      for (const s of ["away", "home"] as const) {
        assert.ok(e.state.rally[s] >= last[s] && e.state.rally[s] <= 100, "Rally only grows, to 100");
        last = { ...last, [s]: e.state.rally[s] };
      }
      assert.equal(e.state.fire, null);
    }
  }
  assert.ok(hot > 0 && cold > 0, `both caps are reached (hot ${hot}, cold ${cold})`);
});

test("v3 awards: pitch and play Heat match the PUP table, with Rally Assist when trailing by 3+", () => {
  const seen = { assisted: 0, plain: 0, ball: 0, swing: 0, called: 0, walk: 0, k: 0, hr: 0 };
  for (const g of games(60, mashers, cans)) {
    const ev = g.events;
    for (let i = 1; i < ev.length; i++) {
      const e = ev[i], prev = ev[i - 1].state;
      const bSide = sideOf(e.state), fSide = opp(bSide);
      const assist = rallyAssist(prev);
      const batter = (e as Extract<GameEvent, { type: "pitch" | "play" }>).batterId, arm = (e as Extract<GameEvent, { type: "pitch" | "play" }>).pitcherId;
      const dBat = (e.state.heat[batter] ?? 25) - (prev.heat[batter] ?? 25), dArm = (e.state.heat[arm] ?? 25) - (prev.heat[arm] ?? 25);
      const bBefore = prev.heat[batter] ?? 25, aBefore = prev.heat[arm] ?? 25;
      const same = (before: number, delta: number, base: number, side: Side) => {
        assert.equal(before + delta, clamp100(before + pay(base, assist === side)));
        assist === side && base > 0 ? seen.assisted++ : seen.plain++;
      };
      if (e.type === "pitch" && e.result === "ball" && e.state.balls < 4) { same(bBefore, dBat, 3, bSide); seen.ball++; }
      if (e.type === "pitch" && e.result === "called_strike" && e.state.strikes < 3) { same(aBefore, dArm, 5, fSide); seen.called++; }
      if (e.type === "pitch" && e.result === "swinging_strike" && e.state.strikes < 3) {
        same(aBefore, dArm, 7, fSide);
        assert.equal(bBefore + dBat, clamp100(bBefore - 5));
        seen.swing++;
      }
      if (e.type === "play" && e.outcome === "walk") { same(bBefore, dBat, 8, bSide); same(aBefore, dArm, -12, fSide); seen.walk++; }
      if (e.type === "play" && e.outcome === "strikeout") { assert.equal(bBefore + dBat, clamp100(bBefore - 20)); same(aBefore, dArm, 10, fSide); seen.k++; }
      if (e.type === "play" && e.outcome === "home_run") {
        // 25 for the homer and 8 for scoring, plus 5 when the contact was hard.
        const a = assist === bSide, base = pay(25, a) + pay(8, a);
        assert.ok([base, base + pay(5, a)].some((d) => clamp100(bBefore + d) === bBefore + dBat), `HR delta ${dBat}`);
        assert.equal(aBefore + dArm, clamp100(aBefore - 20));
        seen.hr++;
      }
    }
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `saw ${k}`);
});

test("v3 Rally: each positive award adds floor(base x 0.5) before the assist bonus", () => {
  let checked = 0;
  for (const g of games(40, mashers, cans)) {
    for (let i = 1; i < g.events.length; i++) {
      const e = g.events[i], prev = g.events[i - 1].state;
      if (e.type === "pitch" && e.result === "ball" && e.state.balls < 4) {
        // A taken ball is +3 Heat, so +1 Rally, assist or not.
        assert.equal(e.state.rally[sideOf(e.state)], Math.min(100, prev.rally[sideOf(e.state)] + 1));
        checked++;
      }
      if (e.type === "play" && e.outcome === "strikeout") {
        const f = opp(sideOf(e.state));
        assert.equal(e.state.rally[f], Math.min(100, prev.rally[f] + 5), "the strikeout completion award is +10");
        assert.equal(e.state.rally[sideOf(e.state)], prev.rally[sideOf(e.state)], "a negative award never drains Rally");
      }
    }
  }
  assert.ok(checked > 50);
});

test("rallyAssist: only the side down 3 or more", () => {
  const s = (away: number, home: number) => ({ score: { away, home } }) as GameState;
  assert.equal(rallyAssist(s(0, 0)), null);
  assert.equal(rallyAssist(s(2, 0)), null);
  assert.equal(rallyAssist(s(0, 3)), "away");
  assert.equal(rallyAssist(s(5, 1)), "home");
});

test("v3 outcomes never depend on Heat: a game starting everyone at 0 or at 100 plays the same", () => {
  for (let seed = 0; seed < 120; seed++) {
    const run = (startHeat: number) => simulateGame({ away: mashers, home: even[0], seed, innings: 3, startHeat });
    const cold = run(0), hot = run(100);
    const plays = (g: typeof cold) => g.events.map((e) => (e.type === "play" ? [e.outcome, e.runs, e.batterId] : e.type === "pitch" ? [e.result, e.mph] : e.type));
    assert.deepEqual(plays(cold), plays(hot));
    assert.deepEqual(cold.final, hot.final);
  }
});

test("v3: Super Bat gear changes nothing and the Super swing is never offered", () => {
  const bat = { id: "thunderclap", name: "Thunderclap", charges: 2, contact: 6, power: 10 };
  const geared = { ...even[1], gear: { superBat: bat } };
  const script = (home: SimTeam) => {
    const inputs: UserInput[] = [];
    let g = playInteractive({ away: even[0], home, seed: 21, innings: 3, userSide: "home", inputs, autoField: true });
    for (let guard = 0; guard < 2000 && !g.result; guard++) {
      const a = g.awaiting!;
      assert.equal(a.super ?? null, null);
      inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } } : { kind: "swing", swing: "power", timing: 0, super: true });
      g = playInteractive({ away: even[0], home, seed: 21, innings: 3, userSide: "home", inputs, autoField: true });
    }
    return g;
  };
  const a = script(geared), b = script(even[1]);
  assert.ok(a.result && b.result);
  assert.deepEqual(a.events.map((e) => JSON.stringify(e)), b.events.map((e) => JSON.stringify(e)));
  assert.equal(a.events.filter((e) => e.type === "play" && e.superSwing).length, 0);
});

test("v3: the user's glove earns the credited fielder Heat on contested plays", () => {
  let fielderAwards = 0;
  for (let seed = 0; seed < 8; seed++) {
    const inputs: UserInput[] = [];
    const go = () => playInteractive({ away: mashers, home: even[1], seed, innings: 3, userSide: "home", inputs });
    let g = go();
    for (let guard = 0; guard < 3000 && !g.result; guard++) {
      const a = g.awaiting!;
      inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } } : a.role === "field" ? { kind: "field", timing: 0 } : a.role === "run" ? { kind: "run", action: "advance", send: [] } : { kind: "swing", swing: "contact", timing: 0 });
      g = go();
    }
    const final = g.events[g.events.length - 1].state.heat;
    const fielding = even[1].lineup.filter((p) => final[p.id] !== undefined && final[p.id] !== 25);
    fielderAwards += fielding.length;
  }
  assert.ok(fielderAwards > 0);
});
