import assert from "node:assert/strict";
import { test } from "node:test";
import { FRESH_PREFS, HINTS, LESSONS, nextLesson, parsePrefs, pickHint, recordShown, retireHint, setHintsOff, stepOf, withSeen, type Situation } from "./coach.ts";

const sit = (o: Partial<Situation> = {}): Situation => ({ role: "swing", strikes: 0, abilityReady: false, force: false, steal: false, breaker: false, ...o });

test("lessons run in order for the same moment, then move on", () => {
  let seen: string[] = [];
  const s = sit({ role: "pitch" });
  assert.equal(nextLesson(seen, s)?.id, "pitch-pick");
  seen = withSeen(seen, "pitch-pick");
  assert.equal(nextLesson(seen, s)?.id, "pitch-aim");
  seen = withSeen(withSeen(seen, "pitch-aim"), "pitch-aim");
  assert.deepEqual(seen, ["pitch-pick", "pitch-aim"]);
  assert.equal(nextLesson(seen, s), null, "nothing left to teach on a pitch");
  assert.equal(nextLesson(seen, sit())?.id, "swing-timing");
});

test("lessons wait for their situation and never show twice", () => {
  assert.equal(nextLesson([], null), null);
  assert.equal(nextLesson(LESSONS.map((l) => l.id), sit({ role: "field", force: true, abilityReady: true })), null);
  assert.equal(nextLesson(["field-auto"], sit({ role: "field", force: true }))?.id, "field-throw");
  assert.equal(nextLesson(["field-auto", "field-throw"], sit({ role: "field", abilityReady: true }))?.id, "field-special");
  assert.equal(nextLesson(["swing-timing", "swing-kind"], sit({ steal: true }))?.id, "run-steal");
  assert.equal(nextLesson(["swing-timing", "swing-kind"], sit({ breaker: true }))?.id, "rally-breaker");
  assert.equal(nextLesson([], sit({ role: "run" }))?.id, "run-go");
});

test("the course covers batting, pitching, fielding, running, Heat chips and Rally Breaker", () => {
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length);
  for (const id of ["pitch-pick", "pitch-aim", "swing-timing", "swing-kind", "heat-chip", "field-auto", "field-throw", "run-go", "run-steal", "rally-breaker"]) assert.ok(LESSONS.some((l) => l.id === id), id);
  assert.deepEqual(stepOf("pitch-aim"), { n: 2, of: LESSONS.length });
  for (const l of LESSONS) assert.ok(l.text.length <= 100, `${l.id} must fit a phone bubble`);
});

test("hint triggers", () => {
  const id = (s: Situation) => pickHint(s, FRESH_PREFS)?.id ?? null;
  assert.equal(id(sit()), null);
  assert.equal(id(sit({ abilityReady: true })), "ability_ready");
  assert.equal(id(sit({ role: "pitch", abilityReady: true })), "ability_ready");
  assert.equal(id(sit({ role: "field", abilityReady: true })), null, "chips are not the point of a glove tap");
  assert.equal(id(sit({ role: "field", force: true })), "force_play");
  assert.equal(id(sit({ steal: true })), "steal_chance");
  assert.equal(id(sit({ strikes: 2 })), "two_strikes");
  assert.equal(id(sit({ role: "pitch", strikes: 2 })), null, "two strikes advice is for the batter");
  assert.equal(pickHint(null, FRESH_PREFS), null);
});

test("a hint is capped at its max shows, can be retired, and the whole coach can be turned off", () => {
  const max = HINTS.find((h) => h.id === "two_strikes")!.max;
  let p = FRESH_PREFS;
  for (let i = 0; i < max; i++) { assert.equal(pickHint(sit({ strikes: 2 }), p)?.id, "two_strikes"); p = recordShown(p, "two_strikes"); }
  assert.equal(pickHint(sit({ strikes: 2 }), p), null);
  assert.equal(pickHint(sit({ steal: true }), retireHint(FRESH_PREFS, "steal_chance")), null);
  assert.equal(pickHint(sit({ steal: true }), setHintsOff(FRESH_PREFS, true)), null);
  assert.equal(pickHint(sit({ steal: true }), setHintsOff(setHintsOff(FRESH_PREFS, true), false))?.id, "steal_chance");
  assert.deepEqual(retireHint(FRESH_PREFS, "nope"), FRESH_PREFS);
});

test("stored prefs survive garbage", () => {
  assert.deepEqual(parsePrefs(null), FRESH_PREFS);
  assert.deepEqual(parsePrefs("{not json"), FRESH_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ off: true, shown: { two_strikes: 2, bad: "x" } })), { off: true, shown: { two_strikes: 2 } });
});
