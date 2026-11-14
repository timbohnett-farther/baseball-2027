import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArcadeFixture, ArcadeSeasonState } from "@bb/shared";
import { afterGameLine, fixtureLine, hubNow, isRematch, progressLine, sideWord, starsNote, SAVED_ON_DEVICE } from "./seasonhub.ts";

const fx = (gameNo: number, o: Partial<ArcadeFixture> = {}): ArcadeFixture => ({
  gameNo, round: 0, label: `Game ${gameNo}`, opponent: { id: `t${gameNo}`, name: `Club ${gameNo}`, abbr: `C${gameNo}`, rival: false } as ArcadeFixture["opponent"],
  userSide: gameNo % 2 ? "home" : "away", gameId: null, result: null, userScore: null, opponentScore: null, objectives: [], stars: 0,
  difficulty: null, suggested: "rookie" as ArcadeFixture["suggested"], ...o,
});
const row = (i: number, w: number, you = false, inPlayoffs = false) => ({ name: `T${i}`, abbr: `T${i}`, you, rival: false, seed: null, inPlayoffs, w, l: 0, t: 0 }) as unknown as ArcadeSeasonState["standings"][number];
const season = (o: Partial<ArcadeSeasonState> = {}): ArcadeSeasonState => ({
  format: 2, id: 1, number: 1, status: "regular", record: { w: 0, l: 0, t: 0 }, played: 0,
  schedule: [fx(1)], next: fx(1), standings: [row(0, 0, true), ...[1, 2, 3, 4, 5, 6, 7].map((i) => row(i, 0))], bracket: null,
  champion: false, placement: null, rewardCoins: 0, stars: { season: 0, max: 27 }, highestDifficulty: null,
  lifetime: { stars: 5, next: { stars: 9, label: "Gold Glove" } } as unknown as ArcadeSeasonState["lifetime"], ...o,
});

test("new season: game 1 of 7, in the race, home or away is stated", () => {
  const n = hubNow(season());
  assert.match(n.stage, /game 1 of 7/);
  assert.equal(n.standing.label, "Still in the race");
  assert.match(n.next!, /Home vs Club 1/);
  assert.equal(n.rematch, false);
});

test("midseason: standing and sides come from the server state", () => {
  const next = fx(4);
  const n = hubNow(season({ played: 3, next, schedule: [next] }));
  assert.match(n.stage, /game 4 of 7/);
  assert.match(n.next!, /Away vs Club 4/);
  assert.match(n.standing.detail, /4 games left/);
});

test("clinched and eliminated are only claimed when the table proves it", () => {
  const clinched = season({ played: 6, standings: [row(0, 6, true), ...[1, 2, 3, 4, 5, 6, 7].map((i) => row(i, 0))] });
  assert.equal(hubNow(clinched).standing.label, "Playoff spot clinched");
  const out = season({ played: 6, standings: [row(0, 0, true), row(1, 6), row(2, 6), row(3, 6), row(4, 6), ...[5, 6, 7].map((i) => row(i, 0))] });
  assert.equal(hubNow(out).standing.label, "Eliminated from the playoffs");
  assert.equal(hubNow(out).standing.tone, "bad");
  assert.equal(hubNow(season({ played: 2 })).standing.tone, "warn");
});

test("semifinal and final: one game decides it, final names the title", () => {
  const semi = season({ status: "playoffs", next: fx(8, { round: 1, label: "Semifinal" }) });
  assert.equal(hubNow(semi).stage, "Semifinal");
  assert.match(hubNow(semi).next!, /One game decides it/);
  const fin = season({ status: "playoffs", next: fx(9, { round: 2, label: "Final" }) });
  assert.match(hubNow(fin).standing.detail, /title/);
});

test("a tied playoff game makes the next fixture a labelled rematch", () => {
  const tied = fx(8, { round: 1, label: "Semifinal", result: "T", gameId: 1 });
  const re = fx(9, { round: 1, label: "Semifinal" });
  const s = season({ status: "playoffs", schedule: [tied, re], next: re });
  assert.equal(isRematch(s, re), true);
  assert.equal(isRematch(s, tied), false);
  assert.match(fixtureLine(s, re), /^Rematch: Semifinal/);
  assert.equal(hubNow(s).rematch, true);
  assert.equal(isRematch(season(), fx(1)), false);
  assert.equal(isRematch(season(), null), false);
});

test("season complete: placement shown, Next Season named, no next fixture", () => {
  const s = season({ status: "done", next: null, champion: true, placement: { place: 1, label: "Champions" } });
  const n = hubNow(s);
  assert.equal(n.stage, "Season complete");
  assert.equal(n.next, null);
  assert.equal(n.standing.label, "Champions");
  assert.match(afterGameLine(s), /start Season 2/);
});

test("legacy rows: a null side arrives as home and is shown as Home", () => {
  assert.equal(sideWord({ userSide: "home" }), "Home");
  assert.equal(sideWord({ userSide: "away" }), "Away");
});

test("progress line: real star counts and the gap to the next unlock", () => {
  assert.match(progressLine(season({ stars: { season: 4, max: 27 } })), /4 of 27 season stars. 4 more lifetime stars to Gold Glove/);
  const none = season({ lifetime: { stars: 40, next: null } as unknown as ArcadeSeasonState["lifetime"] });
  assert.match(progressLine(none), /Every unlock is earned/);
});

test("after-game line says what Continue leads to", () => {
  assert.match(afterGameLine(season()), /^Next: Game 1 of 7, Home vs Club 1/);
  assert.equal(afterGameLine(season({ next: null })), "Continue to the season hub.");
});

test("stars note: pending, duplicate, rejected, and silent when the server already paid", () => {
  const reward = undefined as never;
  const paid = { arcade: {} } as never;
  assert.equal(starsNote({ seasonGame: false, saved: null, reward, repeat: false }), null);
  assert.equal(starsNote({ seasonGame: true, saved: "saved", reward: paid, repeat: false }), null);
  assert.match(starsNote({ seasonGame: true, saved: "saving", reward, repeat: false })!.text, /pending/);
  assert.match(starsNote({ seasonGame: true, saved: SAVED_ON_DEVICE, reward, repeat: false })!.text, /saved on your device/);
  assert.match(starsNote({ seasonGame: true, saved: "saved", reward, repeat: true })!.text, /already counted/);
  const bad = starsNote({ seasonGame: true, saved: "Could not save", reward, repeat: false })!;
  assert.equal(bad.tone, "bad");
  assert.match(bad.text, /not counted/);
});
