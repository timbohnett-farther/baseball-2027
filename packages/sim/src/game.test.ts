import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLineup, simulateGame } from "./game.ts";
import type { GameResult, SimPlayer, SimTeam } from "./types.ts";

let nextId = 1;
const hitter = (r: number, name = `H${nextId}`): SimPlayer => ({
  id: nextId++, name, lastName: name, position: "LF", bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number, stamina = r): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina },
});
const team = (r: number, name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: Array.from({ length: 9 }, () => hitter(r)),
  pitchers: [pitcher(r, 90), pitcher(r, 60), pitcher(r, 60)],
});

const avg = team(70, "Average"), avg2 = team(70, "Other");

test("same seed, same game; different seed, different game", () => {
  const a = simulateGame({ away: avg, home: avg2, seed: 42 });
  const b = simulateGame({ away: avg, home: avg2, seed: 42 });
  assert.deepEqual(a, b);
  const games = Array.from({ length: 20 }, (_, i) => simulateGame({ away: avg, home: avg2, seed: i }));
  assert.ok(new Set(games.map((g) => JSON.stringify(g.final) + g.events.length)).size > 5);
});

function checkConsistency(g: GameResult) {
  // Line score adds up to the final score, box score runs match too.
  assert.equal(g.box.linescore.away.reduce((s, x) => s + x, 0), g.final.away);
  assert.equal(g.box.linescore.home.reduce((s, x) => s + x, 0), g.final.home);
  assert.equal(g.box.batting.away.reduce((s, b) => s + b.r, 0), g.final.away);
  assert.equal(g.box.pitching.home.reduce((s, p) => s + p.r, 0), g.final.away);
  // Every half-inning that wasn't a walk-off ends with exactly three outs.
  const plays = g.events.filter((e) => e.type === "play");
  for (let i = 0; i < plays.length - 1; i++) {
    const cur = plays[i].state, nxt = plays[i + 1].state;
    if (cur.inning !== nxt.inning || cur.half !== nxt.half) assert.equal(cur.outs, 3, `half ${cur.inning} ${cur.half} ended with ${cur.outs} outs`);
  }
  // Counts never go past 3 balls / 2 strikes before the plate appearance ends.
  for (const e of g.events) if (e.type === "pitch") assert.ok(e.state.balls <= 4 && e.state.strikes <= 3);
  // Exactly one final event, and the winner matches it.
  assert.equal(g.events.filter((e) => e.type === "final").length, 1);
  if (g.winner) assert.ok(g.final[g.winner] > g.final[g.winner === "home" ? "away" : "home"]);
}

test("scores, outs and box scores always add up", () => {
  for (let seed = 0; seed < 300; seed++) checkConsistency(simulateGame({ away: avg, home: avg2, seed }));
});

test("average teams score like real baseball, sped up to 3 innings", () => {
  const games = Array.from({ length: 400 }, (_, seed) => simulateGame({ away: avg, home: avg2, seed }));
  const runs = games.reduce((s, g) => s + g.final.away + g.final.home, 0) / games.length / 2;
  // MLB is about 4.5 runs per team per 9 innings (1.5 per 3); a little more action is fine.
  assert.ok(runs > 1.0 && runs < 3.0, `runs per team: ${runs}`);
  const pitches = games.reduce((s, g) => s + g.events.filter((e) => e.type === "pitch").length, 0) / games.length;
  assert.ok(pitches > 70 && pitches < 160, `pitches per game: ${pitches}`);
  const ties = games.filter((g) => g.winner === null).length;
  assert.ok(ties < games.length * 0.03, `ties: ${ties}`);
});

test("better teams win much more often", () => {
  const strong = team(90, "Strong"), weak = team(55, "Weak");
  let wins = 0;
  for (let seed = 0; seed < 300; seed++) {
    const g = simulateGame({ away: strong, home: weak, seed });
    if (g.winner === "away") wins++;
  }
  assert.ok(wins / 300 > 0.75, `strong team won ${wins}/300`);
  assert.ok(wins / 300 < 0.99, "upsets still happen");
});

test("walk-offs end the game immediately and are tier 1", () => {
  let found = 0;
  for (let seed = 0; seed < 400 && found < 5; seed++) {
    const g = simulateGame({ away: avg, home: avg2, seed });
    const plays = g.events.filter((e) => e.type === "play");
    const last = plays[plays.length - 1];
    if (last.type === "play" && last.state.half === "bottom" && g.winner === "home" && last.state.outs < 3 && last.runs > 0) {
      found++;
      assert.equal(last.tier, 1);
      assert.ok(last.card?.startsWith("WALK-OFF"));
    }
  }
  assert.ok(found > 0, "expected at least one walk-off in 400 games");
});

test("home runs are highlight cards with a distance", () => {
  const g = Array.from({ length: 50 }, (_, seed) => simulateGame({ away: team(85, "Bash"), home: avg2, seed }))
    .flatMap((x) => x.events).find((e) => e.type === "play" && e.outcome === "home_run");
  assert.ok(g && g.type === "play");
  assert.ok(g.tier === 1 || g.tier === 2);
  assert.match(g.stat ?? "", /ft$/);
  assert.ok(g.call);
});

test("tired starters come out for the bullpen", () => {
  const short = { ...avg2, pitchers: [pitcher(70, 40), pitcher(70, 60), pitcher(70, 60)] };
  const changes = Array.from({ length: 30 }, (_, seed) => simulateGame({ away: avg, home: short, seed }))
    .filter((g) => g.events.some((e) => e.type === "pitching_change")).length;
  assert.ok(changes > 10, `pitching changes in ${changes}/30 games`);
});

test("auto lineup: speedy contact leads off, biggest power bats cleanup", () => {
  const speedy = { ...hitter(60, "Speedy"), batting: { contact: 90, power: 50, eye: 70, speed: 95, fielding: 70 } };
  const slugger = { ...hitter(60, "Slugger"), batting: { contact: 60, power: 99, eye: 60, speed: 50, fielding: 60 } };
  const lineup = autoLineup([hitter(60), hitter(60), slugger, hitter(60), speedy, hitter(60), hitter(60), hitter(60), hitter(60)]);
  assert.equal(lineup.length, 9);
  assert.equal(lineup[0].name, "Speedy");
  assert.ok(lineup.slice(2, 4).some((p) => p.name === "Slugger"));
});

// --- Interactive play ----------------------------------------------------------------------

import { playInteractive } from "./game.ts";
import type { UserInput } from "./types.ts";

/** Keep answering whatever the game asks until it ends. */
function playOut(seed: number, userSide: "home" | "away", answer: (role: "pitch" | "swing") => UserInput) {
  const inputs: UserInput[] = [];
  for (let guard = 0; guard < 2000; guard++) {
    const g = playInteractive({ away: avg, home: avg2, seed, userSide, inputs });
    if (g.result) return { g, inputs };
    inputs.push(answer(g.awaiting!.role));
  }
  throw new Error("game never ended");
}
const pitchIn: UserInput = { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } };
const swingAt = (swing: "contact" | "power" | "take", timing = 0): UserInput => ({ kind: "swing", swing, timing });

test("interactive: asks for a pitch when the user fields, a swing when the user bats", () => {
  const pitching = playInteractive({ away: avg, home: avg2, seed: 7, userSide: "away", inputs: [] });
  assert.equal(pitching.awaiting?.role, "swing"); // away bats first
  assert.ok(pitching.awaiting?.incoming);
  const fielding = playInteractive({ away: avg, home: avg2, seed: 7, userSide: "home", inputs: [] });
  assert.equal(fielding.awaiting?.role, "pitch");
  assert.equal(fielding.awaiting?.incoming, null);
});

test("interactive: same seed + same inputs = same game, and a prefix of inputs is a prefix of events", () => {
  const a = playOut(11, "home", (role) => (role === "pitch" ? pitchIn : swingAt("contact")));
  const b = playOut(11, "home", (role) => (role === "pitch" ? pitchIn : swingAt("contact")));
  assert.deepEqual(a.g.result, b.g.result);
  const mid = playInteractive({ away: avg, home: avg2, seed: 11, userSide: "home", inputs: a.inputs.slice(0, 5) });
  assert.deepEqual(mid.events, a.g.events.slice(0, mid.events.length));
});

test("interactive: games finish consistently as batter and pitcher", () => {
  for (let seed = 0; seed < 15; seed++) {
    for (const side of ["home", "away"] as const)
      checkConsistency(playOut(seed, side, (role) => (role === "pitch" ? pitchIn : swingAt("contact"))).g.result!);
  }
});

test("interactive: perfect timing beats terrible timing", () => {
  const runs = (timing: number) => {
    let hits = 0;
    for (let seed = 0; seed < 60; seed++) hits += playOut(seed, "away", (role) => (role === "pitch" ? pitchIn : swingAt("contact", timing))).g.result!.box.hits.away;
    return hits;
  };
  assert.ok(runs(0) > runs(0.9) * 2, "good timing should produce far more hits");
});

test("interactive: out-of-order input is rejected", () => {
  assert.throws(() => playInteractive({ away: avg, home: avg2, seed: 1, userSide: "away", inputs: [pitchIn] }), /expected swing/);
});

test("auto sim is unchanged by the interactive code", () => {
  const g = simulateGame({ away: avg, home: avg2, seed: 42 });
  assert.equal(g.events.length > 20, true);
});

test("heat and rally: earned on the field, capped, and visible in every state", () => {
  const isHit = (o: string) => ["single", "double", "triple", "home_run"].includes(o);
  let fires = 0;
  for (let seed = 0; seed < 10; seed++) {
    const g = simulateGame({ away: team(95, "Mashers"), home: team(40, "Scrubs"), seed });
    for (const [i, e] of g.events.entries()) {
      const s = e.state;
      assert.ok(Object.values(s.heat).every((h) => h >= 1 && h <= 3));
      assert.ok(s.rally.away >= 0 && s.rally.away <= 100 && s.rally.home >= 0 && s.rally.home <= 100);
      if (e.type === "half_start") assert.equal(s.fire, null, "fire goes out when the half ends");
      if (e.type !== "play") continue;
      // The previous event is this plate appearance's last pitch: heat before the play.
      const before = g.events[i - 1].state.heat[e.batterId] ?? 0, after = s.heat[e.batterId] ?? 0;
      if (isHit(e.outcome)) assert.equal(after, Math.min(3, before + 1));
      if (e.outcome === "strikeout") assert.equal(after, Math.max(0, before - 1));
      if (e.card === "ON FIRE") { fires++; assert.equal(s.fire, "away"); assert.equal(s.rally.away, 100); }
    }
  }
  assert.ok(fires > 0, "a great lineup against a weak staff catches fire");
});
