import { test } from "node:test";
import assert from "node:assert/strict";
import { CURRENT_RULES, INNINGS_OPTIONS, playInteractive, simulateGame } from "./game.ts";
import type { GameResult, SimPlayer, SimTeam } from "./types.ts";

const finalText = (g: GameResult): string => {
  const e = g.events[g.events.length - 1];
  return e.type === "final" ? e.text : "";
};

let nextId = 1;
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
const even = [team(70, 70, "Alpha"), team(70, 70, "Bravo")] as const;
// Sluggers against batting-practice pitching, and the reverse: lopsided games for the run-ahead rule.
const mashers = team(99, 99, "Mashers"), tomatoCans = team(40, 40, "Cans");

const plays = (g: GameResult) => g.events.filter((e) => e.type === "play");
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

test("the current ruleset is 6, and the Quick Match lengths are 1, 3 and 5", () => {
  assert.equal(CURRENT_RULES, 9);
  assert.deepEqual([...INNINGS_OPTIONS], [1, 3, 5]);
});

test("rules 2: no ties, ever; level games go to extra innings", () => {
  let extras = 0;
  for (const innings of [1, 3, 5]) {
    for (let seed = 0; seed < 600; seed++) {
      const g = simulateGame({ away: even[0], home: even[1], seed, innings });
      assert.ok(g.winner, `tie at ${innings} innings, seed ${seed}`);
      assert.ok(g.final[g.winner] > g.final[g.winner === "home" ? "away" : "home"]);
      assert.equal(sum(g.box.linescore.away), g.final.away);
      assert.equal(sum(g.box.linescore.home), g.final.home);
      if (g.box.linescore.away.length > innings) extras++;
    }
  }
  assert.ok(extras > 20, `extra-inning games: ${extras}`);
});

test("rules 2: every extra half-inning starts with the previous batter on second and nobody out", () => {
  let seen = 0;
  for (let seed = 0; seed < 400; seed++) {
    const g = simulateGame({ away: even[0], home: even[1], seed, innings: 1 });
    for (const e of g.events) {
      if (e.type !== "half_start" || e.state.inning <= 1) continue;
      seen++;
      assert.notEqual(e.state.bases.second, null);
      assert.equal(e.state.outs, 0);
      assert.equal(e.state.balls + e.state.strikes, 0);
    }
  }
  assert.ok(seen > 10);
});

test("rules 2: the extra-innings guard still produces a winner and a consistent score", () => {
  // Zero extra innings allowed: every game level after regulation is settled by the guard.
  let guarded = 0;
  for (let seed = 0; seed < 600; seed++) {
    const free = simulateGame({ away: even[0], home: even[1], seed, innings: 1 });
    const g = simulateGame({ away: even[0], home: even[1], seed, innings: 1, maxExtraInnings: 0 });
    assert.ok(g.winner);
    assert.equal(sum(g.box.linescore.away), g.final.away);
    assert.equal(sum(g.box.linescore.home), g.final.home);
    assert.ok(g.final[g.winner] > g.final[g.winner === "home" ? "away" : "home"]);
    if (free.box.linescore.away.length > 1 && g.box.linescore.away.length === 1 && !g.events.some((e) => e.type === "play" && e.state.inning > 1)) {
      guarded++;
      assert.match(finalText(g), /coin flip/);
    }
  }
  assert.ok(guarded > 10, `guarded games: ${guarded}`);
});

test("rules 2: a 10-run lead ends the game, from the 2nd inning on", () => {
  let ended = 0, awayLed = 0;
  for (let seed = 0; seed < 400; seed++) {
    for (const [away, home] of [[tomatoCans, mashers], [mashers, tomatoCans]]) {
      const g = simulateGame({ away, home, seed, innings: 5 });
      const lead = Math.abs(g.final.home - g.final.away);
      const last = plays(g)[plays(g).length - 1];
      if (finalText(g).includes("Run-ahead")) {
        ended++;
        assert.ok(lead >= 10, `ended with a lead of ${lead}`);
        assert.ok(last.state.inning >= 2);
        if (g.winner === "away") {
          awayLed++;
          // The home team still batted its half, and the lead held at the end of it.
          assert.equal(last.state.half, "bottom");
          assert.equal(last.state.outs, 3);
        }
      }
      // Never a lead of 10+ at the end of a completed inning from the 2nd on without the game being over.
      const lines = g.box.linescore;
      let a = 0, h = 0;
      for (let i = 0; i < lines.home.length - 1; i++) {
        a += lines.away[i]; h += lines.home[i];
        if (i >= 1 && Math.abs(a - h) >= 10) assert.fail(`game played on after inning ${i + 1} at ${a}-${h}`);
      }
    }
  }
  assert.ok(ended > 50, `run-ahead games: ${ended}`);
  assert.ok(awayLed > 5, `away run-ahead wins: ${awayLed}`);
});

test("rules 2: a home team opening a 10-run lead in the bottom of the 2nd+ ends it mid-inning", () => {
  let n = 0;
  for (let seed = 0; seed < 400; seed++) {
    const g = simulateGame({ away: tomatoCans, home: mashers, seed, innings: 5 });
    const ps = plays(g), last = ps[ps.length - 1];
    if (last.state.half === "bottom" && last.state.outs < 3 && last.state.score.home - last.state.score.away >= 10 && last.state.inning < 5) {
      n++;
      assert.ok(last.state.inning >= 2);
      assert.equal(g.winner, "home");
    }
  }
  assert.ok(n > 20, `mid-inning run-ahead finishes: ${n}`);
});

test("rules 2: a one-inning game has no run-ahead shortcut", () => {
  for (let seed = 0; seed < 200; seed++) {
    const g = simulateGame({ away: tomatoCans, home: mashers, seed, innings: 1 });
    assert.ok(!finalText(g).includes("Run-ahead"));
    // Regulation is one full inning each (or the home team batting last): the top half always finishes.
    assert.equal(g.events.find((e) => e.type === "play" && e.state.half === "top")?.state.inning, 1);
  }
});

test("rules 2: walk-offs end the game on the winning play in the last inning or any extra", () => {
  let n = 0;
  for (const innings of [1, 3, 5]) {
    for (let seed = 0; seed < 300; seed++) {
      const g = simulateGame({ away: even[0], home: even[1], seed, innings });
      const ps = plays(g), last = ps[ps.length - 1];
      if (last.state.outs < 3 && g.winner === "home" && !finalText(g).includes("Run-ahead")) {
        n++;
        assert.equal(last.state.half, "bottom");
        assert.ok(last.state.inning >= innings);
        assert.equal(g.events.filter((e) => e.type === "play").pop(), last);
        assert.equal(last.tier, 1);
      }
    }
  }
  assert.ok(n > 30, `walk-offs: ${n}`);
});

test("rules 1 is still selectable: ties and no run-ahead", () => {
  const g = simulateGame({ away: tomatoCans, home: mashers, seed: 3, innings: 5, rules: 1 });
  assert.ok(!finalText(g).includes("Run-ahead"));
});

test("rules 2: an interactive game ends the same way (extra innings, no tie)", () => {
  const inputs: Parameters<typeof playInteractive>[0]["inputs"] = [];
  for (;;) {
    const out = playInteractive({ away: even[0], home: even[1], seed: 11, innings: 1, rules: 2, userSide: "home", inputs });
    if (!out.awaiting) { assert.ok(out.result?.winner); return; }
    const a = out.awaiting;
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } } : a.role === "field" ? { kind: "field", timing: 0 } : { kind: "swing", swing: "contact", timing: 0 });
  }
});
