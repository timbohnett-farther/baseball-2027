import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_RATING_CAP, HITTER_BASE_POINTS, PITCHER_BASE_POINTS, STAR_BONUS_MAX, STAR_BONUS_TABLE, customOverall, defaultRatings,
  pointsSpent, starBonus, totalPoints, validateCustomPlayer, validateDisplayName, type CustomPlayerInput,
} from "./index.ts";

const base = (over: Partial<CustomPlayerInput> = {}): CustomPlayerInput => ({
  name: "Ace", number: 7, position: "SS", bats: "R", look: { skin: 1, build: "regular", accent: 2 }, ratings: defaultRatings("SS"), ...over,
});

test("base budgets land on the pool medians (sum of skills 345 hitter, 276 pitcher)", () => {
  assert.equal(5 * 40 + HITTER_BASE_POINTS, 345);
  assert.equal(4 * 40 + PITCHER_BASE_POINTS, 276);
  assert.equal(pointsSpent(defaultRatings("SS"), "SS"), HITTER_BASE_POINTS);
  assert.equal(pointsSpent(defaultRatings("SP"), "SP"), PITCHER_BASE_POINTS);
});

test("default overall is near the pool median (about 69)", () => {
  assert.equal(customOverall(defaultRatings("SS"), "SS"), 69);
  assert.equal(customOverall(defaultRatings("RP"), "RP"), 69);
});

test("star bonus is a capped step table", () => {
  assert.equal(starBonus(0), 0);
  assert.equal(starBonus(9), 0);
  assert.equal(starBonus(10), 2);
  assert.equal(starBonus(99), 6);
  assert.equal(starBonus(400), STAR_BONUS_MAX);
  assert.equal(starBonus(1_000_000), STAR_BONUS_MAX);
  assert.ok(Math.max(...STAR_BONUS_TABLE.map((t) => t.bonus)) <= STAR_BONUS_MAX);
  assert.equal(totalPoints("SS", 400), HITTER_BASE_POINTS + 12);
});

test("a fully boosted custom player is still under the pool p90 and top pick", () => {
  assert.ok(5 * 40 + totalPoints("SS", 1e6) < 374);
  assert.ok(4 * 40 + totalPoints("SP", 1e6) < 304);
  assert.ok(CUSTOM_RATING_CAP < 99);
});

test("valid player passes", () => {
  const r = validateCustomPlayer(base(), 0);
  assert.deepEqual(r.problems, []);
  assert.equal(r.value?.name, "Ace");
});

test("over budget, over cap and under floor are rejected", () => {
  const rat = { contact: 80, power: 80, eye: 80, speed: 80, fielding: 80 };
  assert.match(validateCustomPlayer(base({ ratings: rat }), 0).problems.join(), /spent 200/);
  assert.match(validateCustomPlayer(base({ ratings: { ...defaultRatings("SS"), power: 81 } }), 400).problems.join(), /above 80/);
  assert.match(validateCustomPlayer(base({ ratings: { ...defaultRatings("SS"), power: 39 } }), 0).problems.join(), /below 40/);
});

test("star bonus unlocks extra points; without stars they are rejected", () => {
  const r = { ...defaultRatings("SS") };
  r.contact += 2;
  assert.ok(validateCustomPlayer(base({ ratings: r }), 0).problems.length > 0);
  assert.deepEqual(validateCustomPlayer(base({ ratings: r }), 10).problems, []);
});

test("rating keys must match the position", () => {
  assert.ok(validateCustomPlayer(base({ position: "SP" }), 0).problems.length > 0);
  assert.deepEqual(validateCustomPlayer(base({ position: "SP", ratings: defaultRatings("SP") }), 0).problems, []);
});

test("number, position, bats and look are checked", () => {
  assert.ok(validateCustomPlayer(base({ number: 100 }), 0).problems.length);
  assert.ok(validateCustomPlayer(base({ number: -1 }), 0).problems.length);
  assert.deepEqual(validateCustomPlayer(base({ number: 0 }), 0).problems, []);
  assert.ok(validateCustomPlayer(base({ position: "XX" as never }), 0).problems.length);
  assert.ok(validateCustomPlayer(base({ bats: "Q" as never }), 0).problems.length);
  assert.ok(validateCustomPlayer(base({ look: { skin: 9, build: "regular", accent: 0 } }), 0).problems.length);
  assert.deepEqual(validateCustomPlayer(base({ bats: "S" }), 0).problems, []);
});

test("display name rules", () => {
  assert.deepEqual(validateDisplayName("  Sky   Blue "), { ok: true, name: "Sky Blue" });
  assert.equal(validateDisplayName("A").ok, false);
  assert.equal(validateDisplayName("x".repeat(17)).ok, false);
  assert.equal(validateDisplayName("<b>hi</b>").ok, false);
  assert.equal(validateDisplayName("Big Ass").ok, false);
  assert.equal(validateDisplayName("f u c k").ok, false);
  assert.equal(validateDisplayName("Sassy").ok, true);
  assert.equal(validateDisplayName("Mr. O'Neil-2").ok, true);
  assert.equal(validateDisplayName(42).ok, false);
  assert.equal(validateDisplayName("12").ok, false);
});
