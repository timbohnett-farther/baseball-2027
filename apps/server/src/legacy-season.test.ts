import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { slotsFor, SEASON_LENGTH, SEASON_REWARDS, TEAM_COLORS, type Player, type SeasonState } from "@bb/shared";
import { playInteractive, type SimTeam } from "@bb/sim";
import { buildApp } from "./app.ts";
import { closeDb, getDb, initDb } from "./db/index.ts";
import { coinLedger, games, seasonGames, seasons, users, userTeams } from "./db/schema.ts";
import { settleSeason } from "./season.ts";
import { pool, startStore } from "./store.ts";

// W39 (ACCEPTANCE R30): seasons begun before the arcade format are format 1: 20 games, then a best-of-3 bracket.
// Nothing creates them any more, so these tests insert the rows the way the old POST /api/season did and drive them
// through the same settle path the finish route uses.

let app: FastifyInstance;
before(async () => {
  await initDb({ localDir: "memory://" });
  await startStore(() => {}, { autoRefresh: false });
  app = await buildApp();
});
after(async () => { await app.close(); await closeDb(); });

function legalTeam(): Player[] {
  const chosen: Player[] = [];
  const need: [string, number][] = [["C", 1], ["1B", 1], ["2B", 1], ["3B", 1], ["SS", 1], ["OF", 3], ["DH", 1], ["SP", 1], ["RP", 2]];
  for (const [slot, n] of need) {
    const matches = pool().players.filter((p) => p.ratings.role !== "TWP" && !chosen.includes(p) &&
      (slot === "DH" ? p.ratings.role === "H" : slotsFor({ position: p.position, role: p.ratings.role }).includes(slot as never)));
    chosen.push(...matches.slice(0, n));
  }
  return chosen;
}

async function manager(username: string, ip: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { username, password: "secret123" }, remoteAddress: ip });
  assert.equal(res.statusCode, 201, res.body);
  const headers = { cookie: `bb_session=${res.cookies.find((x) => x.name === "bb_session")!.value}` };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: `${username} club`, color: TEAM_COLORS[0] } });
  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  await app.inject({ method: "POST", url: "/api/my-team/finish", headers });
  const [u] = await getDb().select().from(users).where(eq(users.username, username));
  const [t] = await getDb().select().from(userTeams).where(eq(userTeams.userId, u!.id));
  return { headers, userId: u!.id, teamId: t!.id };
}

type Mgr = Awaited<ReturnType<typeof manager>>;
const opponents = () => pool().teams.map((t) => t.id);

/** A format-1 season as the old POST /api/season left it: regular status, 20 unplayed games, no arcade league or star objectives. */
async function legacySeason(m: Mgr) {
  const db = getDb();
  const [s] = await db.insert(seasons).values({ userId: m.userId, teamId: m.teamId, number: 1, seed: 4242, format: 1 }).returning();
  const opp = opponents();
  await db.insert(seasonGames).values(Array.from({ length: SEASON_LENGTH }, (_, i) => ({ seasonId: s!.id, gameNo: i + 1, round: 0, opponentTeamId: opp[i % opp.length]! })));
  return s!.id;
}

/** Record one result the way the finish route does: a games row, then settleSeason on the freshly read season. Returns the bonus paid. */
async function settle(m: Mgr, seasonId: number, outcome: "W" | "L" | "T") {
  const db = getDb();
  const [g] = await db.insert(games).values({
    userId: m.userId, teamId: m.teamId, opponentTeamId: opponents()[0]!, seed: 1, innings: 3, userSide: "home", teams: {} as never,
    userScore: outcome === "W" ? 2 : 1, opponentScore: outcome === "L" ? 2 : 1, result: outcome,
  }).returning();
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  return settleSeason(db, season!, g!.id, outcome);
}
const seasonOf = async (m: Mgr) => (await app.inject({ url: "/api/season", headers: m.headers })).json() as SeasonState;
const coinsOf = async (m: Mgr) => (await app.inject({ url: "/api/me", headers: m.headers })).json().coins as number;

test("a format-1 season still loads with the old hub: record, next game, schedule, standings, no arcade fields", async () => {
  const m = await manager("leg1", "10.8.0.1");
  const id = await legacySeason(m);
  const res = await app.inject({ url: "/api/season", headers: m.headers });
  assert.equal(res.statusCode, 200, res.body);
  const s = res.json() as SeasonState & Record<string, unknown>;
  assert.equal(s.format, 1);
  assert.equal(s.id, id);
  assert.equal(s.status, "regular");
  assert.deepEqual(s.record, { w: 0, l: 0, t: 0 });
  assert.equal(s.schedule.length, SEASON_LENGTH);
  assert.equal(s.next!.gameNo, 1);
  assert.ok(s.standings.some((r) => r.you), "standings include the user's club");
  assert.equal(s.league, undefined);
  assert.equal(s.schedule.every((g) => (g as unknown as Record<string, unknown>).stars === undefined), true);
});

test("a real match played in a format-1 season advances it by one game and pays no stars", async () => {
  const ip = "10.8.0.2";
  const m = await manager("leg2", ip);
  const id = await legacySeason(m);
  const before = await seasonOf(m);
  const setup = (await app.inject({ method: "POST", url: "/api/games/interactive", headers: m.headers, remoteAddress: ip, payload: { opponentTeamId: before.next!.opponent.id, seasonId: id } })).json() as { userSide: "home" | "away"; seed: number; innings: number; rules: number; difficulty: string; teams: { home: SimTeam; away: SimTeam } };
  const inputs: unknown[] = [];
  const play = () => playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules as never, difficulty: setup.difficulty as never, userSide: setup.userSide, inputs: inputs as never });
  let out = play();
  while (out.awaiting) {
    inputs.push(out.awaiting.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.2, y: -0.3 } }
      : out.awaiting.role === "run" ? { kind: "run", action: "advance", send: [] }
      : out.awaiting.role === "field" ? { kind: "field", timing: 0 } : { kind: "swing", swing: "contact", timing: 0.1 });
    out = play();
  }
  const fin = await app.inject({ method: "POST", url: "/api/games/interactive/finish", headers: m.headers, remoteAddress: ip, payload: { opponentTeamId: before.next!.opponent.id, seasonId: id, seed: setup.seed, inputs, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, final: out.result!.final, clientGameId: "legacy-game-0001" } });
  assert.equal(fin.statusCode, 201, fin.body);
  assert.equal(fin.json().reward.arcade, undefined, "format 1 has no star objectives");
  const after = await seasonOf(m);
  assert.equal(after.format, 1);
  assert.equal(after.record.w + after.record.l + after.record.t, 1);
  assert.equal(after.next!.gameNo, 2);
  assert.equal(after.schedule.filter((g) => g.gameId !== null).length, 1);
});

test("format 1 runs the whole way: 20 games, berth, three bracket rounds (a playoff tie adds a game), title and bonuses", async () => {
  const m = await manager("leg3", "10.8.0.3");
  const id = await legacySeason(m);
  const coins0 = await coinsOf(m);
  let bonus = 0;
  for (let i = 0; i < SEASON_LENGTH; i++) {
    assert.equal((await seasonOf(m)).status, "regular");
    bonus += await settle(m, id, i < 11 ? "W" : "L"); // 11-9: a winning record
  }
  assert.equal(bonus, SEASON_REWARDS.regular + SEASON_REWARDS.berth);
  let s = await seasonOf(m);
  assert.equal(s.status, "playoffs");
  assert.equal(s.playoffRound, 1);
  assert.deepEqual(s.record, { w: 11, l: 9, t: 0 });
  assert.equal(s.schedule.filter((g) => g.round === 1).length, 3, "best of three scheduled after game 20");
  assert.equal(s.next!.round, 1);

  bonus += await settle(m, id, "T"); // a tie does not count in a series
  s = await seasonOf(m);
  assert.equal(s.schedule.filter((g) => g.round === 1).length, 4, "the tie added a game to the series");
  assert.equal(s.playoffWins + s.playoffLosses, 0);

  for (const round of [1, 2, 3]) {
    assert.equal((await seasonOf(m)).playoffRound, round);
    bonus += await settle(m, id, "W");
    bonus += await settle(m, id, "W");
  }
  s = await seasonOf(m);
  assert.equal(s.status, "done");
  assert.equal(s.champion, true);
  assert.equal(s.eliminated, false);
  assert.equal(s.next, null);
  const expected = SEASON_REWARDS.regular + SEASON_REWARDS.berth + SEASON_REWARDS.round[0] + SEASON_REWARDS.round[1] + SEASON_REWARDS.round[2] + SEASON_REWARDS.champion;
  assert.equal(s.rewardCoins, expected);
  assert.equal(bonus, expected);
  assert.equal((await coinsOf(m)) - coins0, expected, "season bonuses reached the wallet");
});

test("format 1: a losing record ends the season after game 20, and a lost series ends it in the playoffs", async () => {
  const m = await manager("leg4", "10.8.0.4");
  const a = await legacySeason(m);
  for (let i = 0; i < SEASON_LENGTH; i++) await settle(m, a, i < 8 ? "W" : "L");
  let s = await seasonOf(m);
  assert.equal(s.status, "done");
  assert.equal(s.champion, false);
  assert.equal(s.eliminated, true);
  assert.equal(s.rewardCoins, SEASON_REWARDS.regular, "finishing the 20 games pays, a berth does not");
  assert.equal(s.schedule.length, SEASON_LENGTH);

  // The next season for this user is an arcade one; the finished legacy season stays in the career list as format 1.
  const started = await app.inject({ method: "POST", url: "/api/season", headers: m.headers });
  assert.equal(started.statusCode, 201, started.body);
  assert.equal(started.json().format, 2);
  const career = (await app.inject({ url: "/api/season/career", headers: m.headers })).json() as { seasons?: Array<{ number: number; format: number; stars: number }> } | Array<{ number: number; format: number }>;
  const list = Array.isArray(career) ? career : career.seasons ?? [];
  const old = list.find((x) => x.format === 1);
  assert.ok(old, "the format-1 season is still listed");

  const m2 = await manager("leg4b", "10.8.0.5");
  const b = await legacySeason(m2);
  for (let i = 0; i < SEASON_LENGTH; i++) await settle(m2, b, i < 12 ? "W" : "L");
  assert.equal((await seasonOf(m2)).status, "playoffs");
  await settle(m2, b, "L");
  await settle(m2, b, "L");
  s = await seasonOf(m2);
  assert.equal(s.status, "done");
  assert.equal(s.eliminated, true);
  assert.equal(s.rewardCoins, SEASON_REWARDS.regular + SEASON_REWARDS.berth);
  assert.equal(s.next, null);
  assert.equal(s.schedule.filter((g) => g.gameId === null).length, 0, "unplayed bracket games are dropped");
});

test("a user with an unfinished format-1 season cannot start another", async () => {
  const m = await manager("leg5", "10.8.0.6");
  await legacySeason(m);
  const res = await app.inject({ method: "POST", url: "/api/season", headers: m.headers });
  assert.equal(res.statusCode, 400);
});

test("W41 ledger: a legacy season's bonus writes a 'season' ledger row and the ledger sums to the wallet", async () => {
  const m = await manager("leg_ledger", "10.8.0.9");
  const id = await legacySeason(m);
  let bonus = 0;
  for (let i = 0; i < SEASON_LENGTH; i++) bonus += await settle(m, id, i < 11 ? "W" : "L");
  assert.equal(bonus, SEASON_REWARDS.regular + SEASON_REWARDS.berth);
  const rows = await getDb().select().from(coinLedger).where(eq(coinLedger.userId, m.userId)).orderBy(coinLedger.id);
  assert.ok(rows.length >= 1 && rows.every((r) => r.kind === "season" && r.delta > 0), JSON.stringify(rows));
  assert.equal(rows.reduce((n, r) => n + r.delta, 0), bonus);
  assert.equal(rows.at(-1)!.balanceAfter, await coinsOf(m), "the last row's balance is the wallet");
  assert.ok(rows.every((r, i) => i === 0 || r.balanceAfter === rows[i - 1]!.balanceAfter + r.delta), "balances chain");
});
