import assert from "node:assert/strict";
import { test } from "node:test";
import { playInteractive, tutorialSetup, type UserInput } from "./index.ts";

test("the tutorial game is fixed: same setup every time, Rookie, one inning", () => {
  const a = tutorialSetup(), b = tutorialSetup();
  assert.deepEqual(a, b);
  assert.equal(a.difficulty, "rookie");
  assert.equal(a.innings, 1);
});

test("the tutorial game plays to a final score and asks for a pitch and a swing", () => {
  const s = tutorialSetup();
  const roles = new Set<string>();
  const inputs: UserInput[] = [];
  for (let i = 0; i < 400; i++) {
    const g = playInteractive({ away: s.teams.away, home: s.teams.home, seed: s.seed, innings: s.innings, rules: s.rules, difficulty: s.difficulty, userSide: s.userSide, inputs });
    if (!g.awaiting) { assert.ok(g.result); assert.ok(roles.has("pitch") && roles.has("swing")); return; }
    const a = g.awaiting;
    roles.add(a.role);
    inputs.push(a.role === "swing" ? { kind: "swing", swing: "contact", timing: 0 }
      : a.role === "run" ? { kind: "run", action: "advance", send: [] }
      : a.role === "field" ? { kind: "field", timing: 0 }
      : { kind: "pitch", type: "fastball", aim: { x: 0.5, y: 0.5 } });
  }
  assert.fail("did not finish");
});
