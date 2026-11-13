import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameEvent } from "@bb/sim";
import { blockingBudgetMs, skipAfterMs, cardWindowMs, fitShots, cameraViewFor, blendRate, CAMERA_BLEND_MS } from "./presentation.ts";

const state = {} as never;
const play = (o: Partial<Extract<GameEvent, { type: "play" }>>) => ({ type: "play", state, batterId: 1, pitcherId: 2, outcome: "single", runs: 0, rbi: 0, text: "", tier: 0, call: null, card: null, stat: null, ...o }) as GameEvent;

test("blocking budgets follow ARC 10.3", () => {
  assert.equal(blockingBudgetMs(play({ outcome: "groundout" })), 500);
  assert.equal(blockingBudgetMs(play({ outcome: "strikeout" })), 1000);
  assert.equal(blockingBudgetMs(play({ outcome: "home_run", tier: 1 })), 1200);
  assert.equal(blockingBudgetMs(play({ outcome: "flyout", tier: 2 })), 1200);
  assert.equal(blockingBudgetMs({ type: "half_start", state, text: "" }), 1300);
  assert.ok(blockingBudgetMs({ type: "team" } as GameEvent) <= 750);
});

test("no event blocks past its cap, whatever the tier", () => {
  for (const tier of [0, 1, 2, 3] as const) for (const outcome of ["single", "home_run", "strikeout", "groundout"] as const)
    assert.ok(blockingBudgetMs(play({ tier, outcome })) <= 1200);
});

test("routine plays are not skippable, big ones skip after 250 ms", () => {
  assert.equal(skipAfterMs(play({ outcome: "groundout" })), null);
  assert.equal(skipAfterMs(play({ outcome: "strikeout" })), 250);
  assert.equal(skipAfterMs(play({ outcome: "home_run", tier: 1 })), 250);
  assert.equal(skipAfterMs({ type: "team" } as GameEvent), 200);
});

test("the card is gone by the end of the budget", () => {
  const e = play({ outcome: "home_run", tier: 1, card: "GRAND SLAM" }) as Extract<GameEvent, { type: "play" }>;
  const [delay, dur] = cardWindowMs(e);
  assert.ok(delay + dur <= blockingBudgetMs(e));
});

test("fitShots trims to the budget and never stretches", () => {
  const shots = [{ dur: 1 }, { dur: 2 }, { dur: 1 }];
  const fit = fitShots(shots, 2);
  assert.ok(Math.abs(fit.reduce((n, s) => n + s.dur, 0) - 2) < 1e-9);
  assert.equal(fitShots(shots, 10), shots);
});

test("camera: plate for pitches, field once in play, stadium between innings", () => {
  assert.equal(cameraViewFor({ type: "pitch" } as GameEvent), "plate");
  assert.equal(cameraViewFor(play({})), "field");
  assert.equal(cameraViewFor({ type: "run" } as GameEvent), "runners");
  assert.equal(cameraViewFor({ type: "half_start" } as GameEvent), "stadium");
});

test("camera blend settles within the cap; reduced motion cuts", () => {
  const rate = blendRate(false);
  assert.ok(Math.exp(-rate * CAMERA_BLEND_MS / 1000) < 0.06);
  assert.equal(blendRate(true), Infinity);
});
