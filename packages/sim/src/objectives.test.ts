import assert from "node:assert/strict";
import { test } from "node:test";
import { CURRENT_RULES, evaluateObjectives, objectiveDef, pickObjectives, simulateGame, type GameResult, type SimPlayer, type SimTeam } from "./index.ts";

let nextId = 1;
const hitter = (r: number): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position: "LF", bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 80 },
});
const team = (r: number, name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: Array.from({ length: 9 }, () => hitter(r)), pitchers: [pitcher(r), pitcher(r), pitcher(r)],
});

const STYLES = ["power", "speed", "defense", "pitch", "counter", "balanced", "rival"];
const game = (seed: number): GameResult => simulateGame({ away: team(60, "Away"), home: team(80, "Home"), seed, innings: 3, rules: CURRENT_RULES });

test("pickObjectives: always the win first, three distinct ids that all exist", () => {
  for (const style of STYLES) for (let g = 1; g <= 7; g++) {
    const ids = pickObjectives(1234, g, style, []);
    assert.equal(ids.length, 3);
    assert.equal(ids[0], "win");
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) assert.ok(objectiveDef(id), id);
  }
});

test("pickObjectives: deterministic, and nothing repeats from the previous fixture", () => {
  assert.deepEqual(pickObjectives(9, 3, "power", []), pickObjectives(9, 3, "power", []));
  for (let seed = 1; seed <= 40; seed++) {
    let prev: string[] = [];
    for (let g = 1; g <= 7; g++) {
      const ids = pickObjectives(seed, g, STYLES[g - 1]!, prev);
      for (const id of ids.slice(1)) assert.ok(!prev.includes(id), `seed ${seed} game ${g} repeated ${id}`);
      prev = ids;
    }
  }
});

test("evaluateObjectives: the win star follows the winner and only known ids can be earned", () => {
  let won = 0, lost = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = game(seed);
    const earned = evaluateObjectives(["win", "nonsense"], r);
    assert.equal(earned.includes("win"), r.winner === "home");
    assert.ok(!earned.includes("nonsense"));
    if (r.winner === "home") won++; else lost++;
  }
  assert.ok(won > 0 && lost > 0, "need both outcomes to exercise the check");
});

test("evaluateObjectives: result-based stars agree with the box score", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = game(seed);
    const e = (id: string) => evaluateObjectives([id], r).length === 1;
    assert.equal(e("arc-clean"), r.final.away <= 1);
    assert.equal(e("arc-hits"), r.box.hits.home >= 5);
    assert.equal(e("scout-rival-1"), r.final.home - r.final.away >= 3);
    assert.equal(e("scout-balanced-2"), r.final.away <= 3);
  }
});
