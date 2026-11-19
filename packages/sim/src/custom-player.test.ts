import { test } from "node:test";
import assert from "node:assert/strict";
import { playInteractive, simulateGame } from "./game.ts";
import type { SimPlayer, SimTeam } from "./types.ts";

// W42: a created player is an ordinary roster player. Negative synthetic id, no special rules: a full game with him
// completes, plays his turns, and replays byte-identically on every ruleset.

const hitter = (id: number, r: number): SimPlayer => ({ id, name: `H${id}`, lastName: `H${id}`, position: "LF", bats: "R", batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null });
const pitcher = (id: number, r: number, stamina: number): SimPlayer => ({ id, name: `P${id}`, lastName: `P${id}`, position: "P", bats: "R", batting: null, pitching: { stuff: r, control: r, movement: r, stamina } });
const team = (name: string, r: number, custom?: SimPlayer): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#c8322f",
  lineup: [...(custom ? [custom] : [hitter(1, r)]), ...Array.from({ length: 8 }, (_, i) => hitter(i + 2, r))],
  pitchers: [pitcher(20, r, 90), pitcher(21, r, 60), pitcher(22, r, 60)],
});
const mine: SimPlayer = { id: -7, name: "Sparky", lastName: "Sparky", position: "SS", bats: "S", batting: { contact: 70, power: 60, eye: 62, speed: 66, fielding: 67 }, pitching: null };
const myPitcher: SimPlayer = { id: -7, name: "Sparky", lastName: "Sparky", position: "P", bats: "R", batting: null, pitching: { stuff: 72, control: 66, movement: 60, stamina: 62 } };

test("a full game with a custom hitter completes, he bats, and it replays identically on rules 1-9", () => {
  for (const rules of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
    for (const seed of [3, 11]) {
      const input = { away: team("Away", 68, mine), home: team("Home", 68), seed, innings: 9, rules };
      const one = simulateGame(input), two = simulateGame(input);
      assert.equal(JSON.stringify(one), JSON.stringify(two), `rules ${rules} seed ${seed}`);
      assert.ok(one.events.length > 0 && one.events.at(-1)!.type === "final", `finished (rules ${rules})`);
      assert.ok(one.events.some((e) => e.type === "play" && e.batterId === -7), `custom player batted (rules ${rules})`);
    }
  }
});

test("a custom pitcher takes the mound and an interactive replay matches", () => {
  const input = { away: { ...team("Away", 68), pitchers: [myPitcher, pitcher(21, 68, 60), pitcher(22, 68, 60)] }, home: team("Home", 68), seed: 5, innings: 9, rules: 9 as const };
  const r = simulateGame(input);
  assert.ok(r.events.some((e) => e.type === "play" && e.pitcherId === -7));
  const a = playInteractive({ ...input, userSide: "home", inputs: [], autoField: true });
  const b = playInteractive({ ...input, userSide: "home", inputs: [], autoField: true });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
