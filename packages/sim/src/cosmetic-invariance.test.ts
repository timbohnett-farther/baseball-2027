import { test } from "node:test";
import assert from "node:assert/strict";
import { playInteractive, simulateGame } from "./game.ts";
import type { SimPlayer, SimTeam, UserInput } from "./types.ts";

// W41: looks never touch the game. Every cosmetic slot set (helmet, cleats, gloves, jersey, bat skin, celebration)
// must give a byte-identical result to the same seed with none, on every ruleset, and for an interactive game.

let nextId = 1;
const hitter = (r: number): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position: "LF", bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number, stamina: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina },
});
const superBat = { id: "b", name: "Test Bat", charges: 2, contact: 6, power: 6 };
const base = (r: number, name: string) => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: Array.from({ length: 9 }, () => hitter(r)),
  pitchers: [pitcher(r, 90), pitcher(r, 60), pitcher(r, 60)],
});
const plain = (t: ReturnType<typeof base>): SimTeam => ({ ...t, gear: { superBat } });
const dressed = (t: ReturnType<typeof base>): SimTeam => ({
  ...t,
  gear: { superBat, cosmetics: { helmet: "helmet-royal", cleats: "cleats-volt", gloves: "gloves-teal", jersey: "jersey-pinstripe", batskin: "batskin-ember", celebration: "celebration-fireworks" } },
});
const a = base(72, "Away"), h = base(68, "Home");

test("every new cosmetic slot set: simulateGame is identical on rules 1-9", () => {
  for (const rules of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
    for (const seed of [1, 7, 23]) {
      const p = simulateGame({ away: plain(a), home: plain(h), seed, innings: 5, rules });
      const d = simulateGame({ away: dressed(a), home: dressed(h), seed, innings: 5, rules });
      assert.equal(JSON.stringify(d), JSON.stringify(p), `rules ${rules} seed ${seed}`);
    }
  }
});

test("every new cosmetic slot set: an interactive game logs identically", () => {
  const run = (away: SimTeam, home: SimTeam) => {
    const inputs: UserInput[] = [];
    for (;;) {
      const out = playInteractive({ away, home, seed: 11, innings: 3, rules: 9, userSide: "home", inputs });
      if (!out.awaiting) return JSON.stringify(out.result);
      const n = inputs.length, w = out.awaiting;
      if (w.role === "run") { inputs.push({ kind: "run", action: "advance", send: w.run!.advance!.runners.map((r) => r.base) }); continue; }
      inputs.push(w.role === "pitch" ? { kind: "pitch", type: (["fastball", "slider", "change", "curve"] as const)[n % 4], aim: { x: 0, y: 0 } }
        : w.role === "field" ? { kind: "field", timing: 0 }
          : { kind: "swing", swing: n % 3 === 0 ? "power" : "contact", timing: ((n % 9) - 4) / 4, super: n % 5 === 0 });
    }
  };
  assert.equal(run(dressed(a), dressed(h)), run(plain(a), plain(h)));
});
