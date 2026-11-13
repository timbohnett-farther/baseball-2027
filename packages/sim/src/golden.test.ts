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

function scriptedLog(innings: number, rules: 1 | 2): { inputs: UserInput[]; result: ReturnType<typeof playInteractive>["result"] } {
  const inputs: UserInput[] = [];
  for (;;) {
    const out = playInteractive({ away, home, seed: 7, innings, rules, userSide: "home", inputs });
    if (!out.awaiting) return { inputs, result: out.result };
    const n = inputs.length, a = out.awaiting;
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: (["fastball", "slider", "change", "curve"] as const)[n % 4], aim: { x: ((n * 7) % 11) / 5 - 1, y: ((n * 3) % 9) / 4 - 1 } }
      : a.role === "field" ? { kind: "field", timing: ((n % 5) - 2) / 2 }
        : { kind: "swing", swing: n % 7 === 0 ? "take" : n % 3 === 0 ? "power" : "contact", timing: ((n % 9) - 4) / 4, super: n % 5 === 0 });
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
