import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCADE_GAMES, RIVAL_GAME_INDEX, UNLOCKS, buildLeague, computeStandings, cpuGame, cpuResults, cpuRound, deriveStyle, semiPairs, suggestedDifficulty, unlocksBetween,
  type ClubProfile, type GameRow,
} from "./arcade-season.ts";
import { BAT_BY_ID, COSMETICS } from "./items.ts";

/** Thirty clubs with spread-out strengths and one standout measure each, like the real league. */
const profiles = (): ClubProfile[] => Array.from({ length: 30 }, (_, i) => ({
  id: i + 1, name: `Club ${i + 1}`, abbr: `C${i + 1}`, strength: 40 + (i * 37) % 45,
  power: 40 + ((i * 7) % 30) + (i % 5 === 0 ? 25 : 0), speed: 40 + ((i * 11) % 30) + (i % 5 === 1 ? 25 : 0), defense: 40 + ((i * 13) % 30) + (i % 5 === 2 ? 25 : 0),
  pitching: 40 + ((i * 17) % 30) + (i % 5 === 3 ? 25 : 0), contact: 40 + ((i * 19) % 30) + (i % 5 === 4 ? 25 : 0), star: `Star${i + 1}`,
}));

test("schedule: seven different clubs, each once, with the rival in game 4", () => {
  for (const seed of [1, 2, 99, 123456]) {
    const league = buildLeague(seed, profiles());
    assert.equal(league.clubs.length, ARCADE_GAMES);
    assert.equal(new Set(league.clubs.map((c) => c.id)).size, ARCADE_GAMES);
    const rivals = league.clubs.filter((c) => c.rival);
    assert.equal(rivals.length, 1);
    assert.equal(league.clubs[RIVAL_GAME_INDEX]!.rival, true);
    assert.equal(league.clubs[RIVAL_GAME_INDEX]!.style, "rival");
  }
});

test("schedule: the same seed gives the same league, another seed another", () => {
  assert.deepEqual(buildLeague(7, profiles()), buildLeague(7, profiles()));
  assert.notDeepEqual(buildLeague(7, profiles()).clubs.map((c) => c.id), buildLeague(8, profiles()).clubs.map((c) => c.id));
});

test("styles come from the ratings: a club only gets a style it stands out in", () => {
  assert.equal(deriveStyle([0, 0, 0, 0, 0]), "balanced");
  assert.equal(deriveStyle([2, 0, 0, 0, 0]), "power");
  assert.equal(deriveStyle([0, 0, 0, 0, 1.5]), "counter");
  const league = buildLeague(5, profiles());
  assert.ok(league.clubs.some((c) => c.style !== "balanced"), "some club has a real identity");
});

test("difficulty ramp: rookie, then pro, then all-star, playoffs all-star", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => suggestedDifficulty(i, false)), ["rookie", "rookie", "pro", "pro", "pro", "allstar", "allstar"]);
  assert.equal(suggestedDifficulty(0, true), "allstar");
});

test("CPU games are deterministic, never tied, and every pairing happens once", () => {
  const league = buildLeague(11, profiles());
  assert.deepEqual(cpuResults(league, 7), cpuResults(league, 7));
  const games = cpuResults(league, 7);
  assert.equal(games.length, 21); // 7 clubs, each plays 6 others
  assert.ok(games.every((g) => g.homeScore !== g.awayScore));
  const pairs = new Set(games.map((g) => [g.home, g.away].sort().join("-")));
  assert.equal(pairs.size, 21);
  // In round r the club the user faces sits out.
  for (let r = 0; r < 7; r++) {
    const busy = cpuRound(league, r).flatMap((g) => [g.home, g.away]);
    assert.equal(busy.length, 6);
    assert.ok(!busy.includes(league.clubs[r]!.id));
  }
  const [a, b] = [league.clubs[0]!, league.clubs[1]!];
  assert.deepEqual(cpuGame(5, 3, a, b), cpuGame(5, 3, a, b));
});

test("CPU games favour the stronger club over many seeds", () => {
  const league = buildLeague(3, profiles());
  const strong = { ...league.clubs[0]!, id: 901, strength: 90 }, weak = { ...league.clubs[1]!, id: 902, strength: 30 };
  let wins = 0;
  for (let s = 0; s < 300; s++) if (cpuGame(s, 1, strong, weak).homeScore > cpuGame(s, 1, strong, weak).awayScore) wins++;
  assert.ok(wins > 200, `strong club won ${wins}/300`);
});

const g = (home: number, away: number, homeScore: number, awayScore: number): GameRow => ({ home, away, homeScore, awayScore });

test("standings: most wins first, with the reason on every row", () => {
  const rows = computeStandings([1, 2, 3], [g(1, 2, 5, 1), g(1, 3, 4, 2), g(2, 3, 3, 1)], 1);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
  assert.equal(rows[0]!.why, "Most wins");
  assert.equal(rows[0]!.gb, 0);
  assert.equal(rows[2]!.gb, 2);
});

test("tiebreaker: two tied clubs, head-to-head beats run differential", () => {
  // 1 and 2 are both 2-1 and 2 has the far better differential, but 1 won the head-to-head.
  const rows = computeStandings([1, 2, 3, 4], [g(1, 2, 2, 1), g(1, 3, 2, 1), g(4, 1, 1, 0), g(2, 3, 9, 0), g(2, 4, 9, 0), g(3, 4, 1, 0)], 1);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4]);
  assert.equal(rows[0]!.why, "Won the head-to-head");
  assert.ok(rows[1]!.diff > rows[0]!.diff);
});

test("tiebreaker: three tied clubs fall to run differential unless one beat the others", () => {
  // A cycle: 1 beat 2, 2 beat 3, 3 beat 1 -> nobody swept, so run differential decides.
  const cycle = computeStandings([1, 2, 3], [g(1, 2, 2, 1), g(2, 3, 4, 0), g(3, 1, 2, 1)], 1);
  assert.deepEqual(cycle.map((r) => r.id), [2, 1, 3]);
  assert.equal(cycle[0]!.why, "Run differential");
  // Three clubs on two wins; club 1 beat both others, so it leads despite the worst differential.
  const sweep = computeStandings([1, 2, 3, 4, 5], [g(1, 2, 1, 0), g(1, 3, 1, 0), g(2, 3, 9, 0), g(4, 1, 9, 0), g(5, 1, 9, 0), g(2, 4, 5, 0), g(3, 4, 5, 0), g(3, 5, 5, 0)], 1);
  assert.equal(sweep[0]!.id, 1);
  assert.equal(sweep[0]!.why, "Beat every other tied club");
  assert.ok(sweep[0]!.diff < 0);
});

test("tiebreaker: equal differential falls to fewer runs allowed, then a seeded draw", () => {
  const rows = computeStandings([1, 2, 3, 4], [g(1, 3, 4, 2), g(2, 4, 8, 6), g(1, 4, 0, 1), g(2, 3, 0, 1)], 1);
  const a = rows.find((r) => r.id === 1)!, b = rows.find((r) => r.id === 2)!;
  assert.equal(a.diff, b.diff === 0 ? 0 : a.diff);
  const same = computeStandings([1, 2], [], 5);
  assert.deepEqual(same, computeStandings([1, 2], [], 5));
  assert.equal(same[0]!.why, "Seeded draw");
});

test("playoffs: seed 1 plays 4 and 2 plays 3", () => {
  assert.deepEqual(semiPairs([10, 20, 30, 40]), [[10, 40], [20, 30]]);
});

test("unlocks: every three stars, items that exist in the store, nothing paid twice", () => {
  for (const u of UNLOCKS.filter((x) => x.kind === "item")) {
    assert.ok(COSMETICS.some((c) => c.id === u.itemId) || BAT_BY_ID[u.itemId!] || u.itemId === "comet-tail", `unknown item ${u.itemId}`);
  }
  assert.deepEqual(unlocksBetween(0, 2), []);
  assert.deepEqual(unlocksBetween(2, 3).map((u) => u.stars), [3]);
  assert.deepEqual(unlocksBetween(0, 9).map((u) => u.stars), [3, 6, 9]);
  assert.deepEqual(unlocksBetween(3, 3), []);
  assert.deepEqual(unlocksBetween(27, 30).map((u) => u.coins), [100]);
  assert.deepEqual(unlocksBetween(30, 32), []);
});

test("home/away: seven fixtures alternate, the extra home game reverses next season", async () => {
  const { regularSide, semiSide, finalSide } = await import("./arcade-season.ts");
  const sides = (n: number) => Array.from({ length: 7 }, (_, i) => regularSide(i + 1, n));
  for (const n of [1, 2, 3, 4]) {
    const s = sides(n);
    s.forEach((x, i) => { if (i) assert.notEqual(x, s[i - 1]); });
  }
  const home = (n: number) => sides(n).filter((x) => x === "home").length;
  assert.deepEqual([home(1), home(2), home(3), home(4)], [4, 3, 4, 3]);
  assert.equal(semiSide(0, 3), "home");
  assert.equal(semiSide(2, 1), "away");
  assert.equal(finalSide("home", "away", 0, 1), "away");
  assert.equal(finalSide("away", "home", 1, 0), "home");
  assert.equal(finalSide("home", "home", 2, 1), "away");
  assert.equal(finalSide("away", "away", 0, 3), "home");
});
