import { test } from "node:test";
import assert from "node:assert/strict";
import { playInteractive, simulateGame } from "./game.ts";
import { tutorialSetup } from "./tutorial.ts";
import type { GameEvent, UserInput } from "./types.ts";

// W32: `facts` attaches descriptive `shot` data to events. It is opt-in, draws nothing, and changes no outcome,
// so the same game with it on is the same game with it off once the `shot` keys are taken away.
const strip = (events: GameEvent[]) => JSON.stringify(events, (k, v) => (k === "shot" ? undefined : v));

function bot(setup: ReturnType<typeof tutorialSetup>, facts: boolean, userSide: "away" | "home") {
  const inputs: UserInput[] = [];
  for (;;) {
    const out = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, userSide, inputs, facts });
    if (!out.awaiting) return { inputs, result: out.result! };
    const a = out.awaiting, n = inputs.length;
    const steal = a.run?.steal[0];
    inputs.push(a.role === "pitch" ? (n % 6 === 5 && a.run?.pickoff.length ? { kind: "run", action: "pickoff", at: a.run.pickoff[0].base } : { kind: "pitch", type: (["fastball", "slider", "change", "curve"] as const)[n % 4], aim: { x: ((n * 7) % 11) / 5 - 1, y: ((n * 3) % 9) / 4 - 1 } })
      : a.role === "field" ? { kind: "field", timing: ((n % 5) - 2) / 2 }
        : a.role === "run" ? { kind: "run", action: "advance", send: a.run!.advance!.runners.map((r) => r.base) }
          : steal && n % 4 === 0 ? { kind: "run", action: "steal", from: steal.base === "third" ? "second" : steal.base }
            : { kind: "swing", swing: n % 7 === 0 ? "take" : n % 3 === 0 ? "power" : "contact", timing: ((n % 9) - 4) / 4 });
  }
}

test("facts on: same events once `shot` is stripped, and none appear when off", () => {
  const setup = tutorialSetup();
  for (const side of ["away", "home"] as const) {
    const off = bot(setup, false, side), on = bot(setup, true, side);
    assert.deepEqual(on.inputs, off.inputs);
    assert.equal(strip(on.result.events), JSON.stringify(off.result.events));
    assert.ok(!JSON.stringify(off.result.events).includes('"shot"'));
    assert.equal(JSON.stringify({ ...on.result, events: 0 }, (k, v) => (k === "shot" ? undefined : v)), JSON.stringify({ ...off.result, events: 0 }));
  }
});

test("facts on leaves auto-sim games for every ruleset unchanged", () => {
  const { teams } = tutorialSetup();
  for (const rules of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) for (let seed = 0; seed < 6; seed++) {
    const a = simulateGame({ ...teams, seed, innings: 3, rules }), b = simulateGame({ ...teams, seed, innings: 3, rules, facts: true });
    assert.equal(strip(b.events), JSON.stringify(a.events), `rules ${rules} seed ${seed}`);
    assert.deepEqual(b.box, a.box);
  }
});

test("shot facts are well formed and describe what the log already says", () => {
  const { result } = bot(tutorialSetup(), true, "home");
  let pitches = 0, balls = 0;
  for (const e of result.events) {
    if (e.type === "pitch" && e.shot) { pitches++; assert.ok(["fastball", "slider", "change", "curve"].includes(e.shot.type)); assert.ok(Math.abs(e.shot.x) <= 3 && Math.abs(e.shot.y) <= 3); }
    if (e.type === "play" && e.shot) {
      balls++;
      assert.ok(e.shot.spray >= 0 && e.shot.spray < 1);
      if (e.outcome === "home_run") assert.deepEqual([e.shot.kind, e.shot.strength], ["fly", 2]);
    }
    if (e.type === "play" && (e.outcome === "strikeout" || e.outcome === "walk")) assert.equal(e.shot, null);
  }
  assert.ok(pitches > 10 && balls > 2, `pitches ${pitches} balls ${balls}`);
});

test("steal and pickoff events carry a run shot with a closeness in [0,1]", () => {
  let runs = 0;
  for (let seed = 1; seed <= 12; seed++) for (const side of ["away", "home"] as const) {
    const setup = { ...tutorialSetup(), seed };
    for (const e of bot(setup, true, side).result.events)
      if (e.type === "run" && e.shot) { runs++; assert.ok(e.shot.close >= 0 && e.shot.close <= 1); assert.ok(["steal", "pickoff"].includes(e.shot.play)); assert.equal(e.shot.safe, e.action === "steal" || e.action === "hold"); }
  }
  assert.ok(runs > 0, "no steal or pickoff shots");
});
