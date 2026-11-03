import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRatings, seasonWeight, type HittingLine, type PitchingLine, type RatingInput } from "./ratings.ts";

const Y = 2026;

function hitLine(pa: number, r: { avg: number; iso: number; hrPct: number; bbPct: number; soPct: number; sb?: number }): HittingLine {
  const bb = Math.round(pa * r.bbPct);
  const ab = pa - bb;
  const h = Math.round(ab * r.avg);
  const hr = Math.round(pa * r.hrPct);
  const doubles = Math.max(0, Math.round((r.iso * ab - 3 * hr) / 1));
  return { pa, ab, h, doubles, triples: 0, hr, bb, ibb: 0, hbp: 0, so: Math.round(pa * r.soPct), sb: r.sb ?? 0, cs: 0 };
}

function pitLine(bf: number, r: { soPct: number; bbPct: number; hrPct: number; starter: boolean }): PitchingLine {
  const g = r.starter ? Math.round(bf / 24) : Math.round(bf / 4.3);
  return {
    bf, outs: Math.round(bf * 0.7), g, gs: r.starter ? g : 0,
    so: Math.round(bf * r.soPct), bb: Math.round(bf * r.bbPct), hbp: 0, hr: Math.round(bf * r.hrPct),
    groundOuts: Math.round(bf * 0.3), airOuts: Math.round(bf * 0.3),
  };
}

const hitter = (id: number, position: string, line: HittingLine): RatingInput =>
  ({ id, position, hitting: [{ year: Y, level: "MLB", line }], pitching: [], sprint: [], fielding: [], velo: [] });
const pitcher = (id: number, line: PitchingLine): RatingInput =>
  ({ id, position: "P", hitting: [], pitching: [{ year: Y, level: "MLB", line }], sprint: [], fielding: [], velo: [] });

// A small league: a spread of regulars plus fringe players that set the baseline.
function league(): RatingInput[] {
  const players: RatingInput[] = [];
  for (let i = 0; i < 40; i++) {
    const t = i / 39; // 0 = weak, 1 = strong
    players.push(hitter(100 + i, ["SS", "CF", "1B", "LF"][i % 4], hitLine(550, {
      avg: 0.22 + 0.07 * t, iso: 0.1 + 0.15 * t, hrPct: 0.015 + 0.04 * t, bbPct: 0.06 + 0.06 * t, soPct: 0.28 - 0.1 * t,
    })));
    players.push(pitcher(300 + i, pitLine(600, { soPct: 0.18 + 0.14 * t, bbPct: 0.11 - 0.05 * t, hrPct: 0.04 - 0.02 * t, starter: i % 2 === 0 })));
  }
  for (let i = 0; i < 20; i++) {
    players.push(hitter(500 + i, "2B", hitLine(80, { avg: 0.21, iso: 0.1, hrPct: 0.015, bbPct: 0.06, soPct: 0.29 })));
    players.push(pitcher(600 + i, pitLine(90, { soPct: 0.18, bbPct: 0.11, hrPct: 0.04, starter: false })));
  }
  return players;
}

test("season weights favour recent MLB seasons", () => {
  assert.equal(seasonWeight(2026, "MLB", 2026), 1);
  assert.ok(seasonWeight(2025, "MLB", 2026) < 1);
  assert.equal(seasonWeight(2026, "AAA", 2026), 0.5);
  assert.equal(seasonWeight(2022, "MLB", 2026), 0);
});

test("better hitters rate higher, and every rating stays in 40-99", () => {
  const ratings = new Map(computeRatings(league(), Y).map((r) => [r.id, r]));
  const weak = ratings.get(100)!, strong = ratings.get(139)!;
  assert.ok(strong.overall > weak.overall + 20, `${strong.overall} vs ${weak.overall}`);
  assert.ok(strong.hitting!.power > weak.hitting!.power);
  assert.ok(strong.hitting!.contact > weak.hitting!.contact);
  assert.ok(strong.hitting!.eye > weak.hitting!.eye);
  for (const r of ratings.values()) {
    assert.ok(r.overall >= 40 && r.overall <= 99, `overall ${r.overall}`);
    for (const v of Object.values(r.hitting ?? r.pitching ?? {})) assert.ok(v >= 40 && v <= 99);
  }
});

test("better pitchers rate higher; starters get more stamina", () => {
  const ratings = new Map(computeRatings(league(), Y).map((r) => [r.id, r]));
  // Compare two starters (even ids start), so durability doesn't muddy the comparison.
  const weak = ratings.get(300)!, strong = ratings.get(338)!;
  assert.ok(strong.overall > weak.overall + 20, `${strong.overall} vs ${weak.overall}`);
  assert.ok(strong.pitching!.stuff > weak.pitching!.stuff);
  assert.ok(strong.pitching!.control > weak.pitching!.control);
  assert.equal(ratings.get(300)!.role, "SP");
  assert.equal(ratings.get(301)!.role, "RP");
  assert.ok(ratings.get(300)!.pitching!.stamina > ratings.get(301)!.pitching!.stamina);
});

test("a tiny hot streak can't make a star", () => {
  const players = league();
  // 20 PA of video-game numbers.
  players.push(hitter(900, "LF", hitLine(20, { avg: 0.5, iso: 0.5, hrPct: 0.2, bbPct: 0.2, soPct: 0.05 })));
  const r = computeRatings(players, Y).find((x) => x.id === 900)!;
  assert.ok(r.overall < 80, `got ${r.overall}`);
});

test("a prospect with no stats lands below average, not at the extremes", () => {
  const players = league();
  players.push(hitter(901, "SS", { pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, sb: 0, cs: 0 }));
  players.push({ ...pitcher(902, pitLine(0, { soPct: 0, bbPct: 0, hrPct: 0, starter: false })), pitching: [] });
  const ratings = computeRatings(players, Y);
  for (const id of [901, 902]) {
    const r = ratings.find((x) => x.id === id)!;
    assert.ok(r.overall >= 45 && r.overall < 70, `${id}: ${r.overall}`);
  }
});

test("same input gives the same ratings", () => {
  assert.deepEqual(computeRatings(league(), Y), computeRatings(league(), Y));
});
