import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { abilityChipLabel, baseTargetLabel, gloveLabel, speedLabel, swingLabel } from "./a11y.ts";

test("control labels read as plain sentences", () => {
  assert.equal(baseTargetLabel("second", true), "Throw to second base, recommended");
  assert.equal(baseTargetLabel("home", false), "Throw to home plate");
  assert.equal(speedLabel(2), "Game speed 2x");
  assert.equal(abilityChipLabel("Mirage", 40, "READY", false), "Mirage, costs 40 Heat, ready");
  assert.equal(abilityChipLabel("Mirage", 40, "ARMED", true), "Mirage, costs 40 Heat, armed, tap to cancel");
  assert.equal(swingLabel("power"), "Power swing");
  assert.equal(gloveLabel("DIVE"), "Dive the ball");
});

test("every gameplay button in duel.tsx that has no plain-text name carries an aria-label", () => {
  const src = readFileSync(new URL("./duel.tsx", import.meta.url), "utf8");
  for (const needle of ["speedLabel(x)", "baseTargetLabel(b", "abilityChipLabel(", "swingLabel(", "gloveLabel(", 'aria-label="Resume game"']) assert.ok(src.includes(needle), needle);
});
