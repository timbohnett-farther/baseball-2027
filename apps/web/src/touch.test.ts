import { test } from "node:test";
import assert from "node:assert/strict";
import type { AbilityStatus } from "@bb/sim";
import { appendInput, cellAim, cellTag, chipState, chipTap, keyCell, reasonText, survivesApproach, type ChipCtx } from "./touch.ts";

const st = (o: Partial<AbilityStatus>): AbilityStatus => ({ id: "BAT_COMET", name: "Comet", cost: 50, summary: "", needsDirection: false, swings: ["power"], available: true, ...o });
const ctx = (o: Partial<ChipCtx> = {}): ChipCtx => ({ armed: null, heat: 80, approach: "power", choosing: null, ...o });

test("grid cells map to aims: top row is high, middle cell is dead centre", () => {
  assert.deepEqual(cellAim(4), { x: 0, y: 0 });
  assert.deepEqual(cellAim(0), { x: -0.85, y: 0.85 });
  assert.deepEqual(cellAim(8), { x: 0.85, y: -0.85 });
  assert.equal(cellAim(0).x === 0, false);
  assert.deepEqual(cellAim(2, true), { x: 1.4, y: 1.4 });
  assert.deepEqual(cellAim(4, true), { x: 0, y: 0 });
  assert.equal(cellTag(4), "MIDDLE"); assert.equal(cellTag(1), "EDGE"); assert.equal(cellTag(1, true), "CHASE");
});

test("numpad keys land on the matching cell", () => {
  assert.equal(keyCell("7"), 0); assert.equal(keyCell("5"), 4); assert.equal(keyCell("3"), 8); assert.equal(keyCell("x"), -1);
});

test("disabled reasons are plain language with real numbers", () => {
  assert.equal(reasonText(st({ available: false, reason: "INSUFFICIENT_HEAT" }), 32.9), "NEED 18 MORE HEAT");
  assert.equal(reasonText(st({ available: false, reason: "COOLDOWN", message: "Recharging for 2 more pitches." }), 80), "READY IN 2 PITCHES");
  assert.equal(reasonText(st({ available: false, reason: "WRONG_SWING" }), 80), "POWER SWING REQUIRED");
  assert.equal(reasonText(st({ available: false, reason: "WRONG_CONTEXT" }), 80), "NOT AVAILABLE NOW");
});

test("tapping a chip: arm, cancel, note, choose a side, or switch to the right swing", () => {
  assert.deepEqual(chipTap(st({}), ctx()), { do: "arm", req: { id: "BAT_COMET" } });
  assert.deepEqual(chipTap(st({}), ctx({ armed: { id: "BAT_COMET" } })), { do: "cancel" });
  assert.deepEqual(chipTap(st({ available: false, reason: "INSUFFICIENT_HEAT" }), ctx({ heat: 20 })), { do: "note", text: "NEED 30 MORE HEAT" });
  assert.deepEqual(chipTap(st({ id: "BAT_GAP_MASTER", swings: ["contact", "power"], needsDirection: true }), ctx()), { do: "choose", id: "BAT_GAP_MASTER" });
  assert.deepEqual(chipTap(st({}), ctx({ approach: "contact" })), { do: "switch", to: "power", text: "POWER SWING REQUIRED" });
  // pitchers have no approach
  assert.deepEqual(chipTap(st({ id: "PITCH_MIRAGE", swings: [] }), ctx({ approach: null })), { do: "arm", req: { id: "PITCH_MIRAGE" } });
});

test("chip state text", () => {
  assert.deepEqual(chipState(st({}), ctx()), { state: "ready", label: "ARM" });
  assert.deepEqual(chipState(st({}), ctx({ armed: { id: "BAT_COMET" } })), { state: "armed", label: "ARMED" });
  assert.deepEqual(chipState(st({ id: "BAT_GAP_MASTER" }), ctx({ armed: { id: "BAT_GAP_MASTER", direction: "left" } })), { state: "armed", label: "ARMED LEFT" });
  assert.equal(chipState(st({ id: "BAT_GAP_MASTER" }), ctx({ choosing: "BAT_GAP_MASTER" })).state, "choosing");
  assert.equal(chipState(st({ available: false, reason: "COOLDOWN", message: "1 more" }), ctx()).state, "disabled");
});

test("an armed power-only ability does not survive a switch to contact", () => {
  assert.equal(survivesApproach(st({}), "contact"), false);
  assert.equal(survivesApproach(st({}), "power"), true);
  assert.equal(survivesApproach(undefined, "contact"), true);
});

test("tap contract: a stale or repeated tap adds no input, so no Heat is spent and nothing acts twice", () => {
  const a = { kind: "swing", swing: "power", timing: 0, ability: { id: "BAT_COMET" } } as never;
  const b = { kind: "swing", swing: "contact", timing: 0.1 } as never;
  const log: unknown[] = [];
  const once = appendInput(log, a, 0);
  assert.equal(once.length, 1);
  // Two taps in one commit frame: both carry token 0, the second finds the log already longer.
  assert.equal(appendInput(once, b, 0), once);
  // A tap from an earlier phase (token 0) arriving after the log moved on to 3.
  const later = appendInput(appendInput(once, b, 1), b, 2);
  assert.equal(later.length, 3);
  assert.equal(appendInput(later, a, 0), later);
  // A tap from a phase that hasn't happened yet is refused too.
  assert.equal(appendInput(later, a, 5), later);
});
