import { test } from "node:test";
import assert from "node:assert/strict";
import { shotModeActive } from "./shotmode.ts";

test("?shot= is honoured only in dev", () => {
  assert.equal(shotModeActive(true, "?shot=duel-pitch"), true);
  assert.equal(shotModeActive(true, "?shot=hr&hold=0.5"), true);
  assert.equal(shotModeActive(false, "?shot=duel-pitch"), false);
  assert.equal(shotModeActive(false, "?shot=hr&hold=0.5"), false);
});

test("no shot parameter means no shot mode, dev or not", () => {
  assert.equal(shotModeActive(true, ""), false);
  assert.equal(shotModeActive(true, "?seed=3"), false);
  assert.equal(shotModeActive(false, ""), false);
});
