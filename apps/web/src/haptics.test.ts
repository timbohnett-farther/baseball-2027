import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameEvent } from "@bb/sim";
import { HAPTIC_PATTERNS, hapticFor, patternFor } from "./haptics.ts";

const play = (outcome: string) => ({ type: "play", outcome }) as unknown as GameEvent;

test("every pattern is short and non-empty", () => {
  for (const p of Object.values(HAPTIC_PATTERNS)) {
    assert.ok(p.length > 0);
    assert.ok(p.reduce((a, b) => a + b, 0) < 300);
  }
});

test("events map to cues for the user's side only", () => {
  assert.equal(hapticFor(play("home_run"), true), "homer");
  assert.equal(hapticFor(play("home_run"), false), null);
  assert.equal(hapticFor(play("double"), true), "hit");
  assert.equal(hapticFor(play("strikeout"), true), "strikeout");
  assert.equal(hapticFor(play("groundout"), true), null);
  assert.equal(hapticFor({ type: "team" } as GameEvent, false), "breaker");
});

test("pattern respects the setting and reduced motion", () => {
  assert.equal(patternFor("homer", false), null);
  assert.equal(patternFor(null, true), null);
  assert.deepEqual(patternFor("hit", true), HAPTIC_PATTERNS.hit);
  assert.deepEqual(patternFor("hit", true, true), [20]);
});
