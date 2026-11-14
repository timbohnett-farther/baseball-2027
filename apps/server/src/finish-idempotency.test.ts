import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { slotsFor, TEAM_COLORS, type ArcadeSeasonState, type Player } from "@bb/shared";
import { playInteractive, type SimTeam } from "@bb/sim";
import { buildApp } from "./app.ts";
import { closeDb, getDb, initDb } from "./db/index.ts";
import { games, seasonGames, seasons, userItems } from "./db/schema.ts";
import { pool, startStore } from "./store.ts";

// W36d: the offline queue and the finishing screen can both upload one finished match, sometimes at the same moment.
// Whatever order they land in, the match counts once: one game row, one payout, one season step, one set of stars/unlocks.

let app: FastifyInstance;
before(async () => {
  await initDb({ localDir: "memory://" }); // in-process Postgres (PGlite): no external database needed
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
  return headers;
}

type Setup = { userSide: "home" | "away"; seed: number; innings: number; rules: number; difficulty: string; teams: { home: SimTeam; away: SimTeam } };
async function playOut(headers: { cookie: string }, ip: string, opponentTeamId: number, seasonId?: number) {
  const setup = (await app.inject({ method: "POST", url: "/api/games/interactive", headers, remoteAddress: ip, payload: { opponentTeamId, seasonId } })).json() as Setup;
  const inputs: unknown[] = [];
  const play = () => playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules as never, difficulty: setup.difficulty as never, userSide: setup.userSide, inputs: inputs as never });
  let out = play();
  while (out.awaiting) {
    inputs.push(out.awaiting.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.2, y: -0.3 } }
      : out.awaiting.role === "run" ? { kind: "run", action: "advance", send: [] }
      : out.awaiting.role === "field" ? { kind: "field", timing: 0 } : { kind: "swing", swing: "contact", timing: 0.1 });
    out = play();
  }
  return { opponentTeamId, seasonId, seed: setup.seed, inputs, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, final: out.result!.final };
}

const post = (headers: { cookie: string }, ip: string, payload: object) => app.inject({ method: "POST", url: "/api/games/interactive/finish", headers, remoteAddress: ip, payload });
const coinsOf = async (headers: { cookie: string }) => (await app.inject({ url: "/api/me", headers })).json().coins as number;

test("a season match uploaded twice in a row pays once, advances the season once, grants stars and unlocks once", async () => {
  const ip = "10.7.0.1";
  const headers = await manager("idem1", ip);
  const s = (await app.inject({ method: "POST", url: "/api/season", headers })).json() as ArcadeSeasonState;
  const body = { ...(await playOut(headers, ip, s.next!.opponent.id, s.id)), clientGameId: "match-idem-0001" };
  const coins0 = await coinsOf(headers);
  const first = await post(headers, ip, body);
  assert.equal(first.statusCode, 201, first.body);
  const afterFirst = { coins: await coinsOf(headers), season: await app.inject({ url: "/api/season", headers }).then((r) => r.json() as ArcadeSeasonState) };
  assert.equal(afterFirst.coins - coins0, first.json().reward.total, "the wallet moved by exactly the reported reward");

  for (let i = 0; i < 3; i++) {
    const again = await post(headers, ip, body);
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().id, first.json().id);
    assert.equal(again.json().reward, undefined, "a retry hands back the saved game with no reward block: nothing is recomputed or paid");
  }
  assert.equal(await coinsOf(headers), afterFirst.coins, "no coins from the retries");
  const season = (await app.inject({ url: "/api/season", headers })).json() as ArcadeSeasonState;
  assert.deepEqual(season, afterFirst.season, "season record, stars and next fixture unchanged by retries");
  assert.equal(season.next!.gameNo, 2, "exactly one fixture was settled");
  const rows = await getDb().select().from(seasonGames).where(eq(seasonGames.seasonId, s.id));
  assert.equal(rows.filter((r) => r.gameId !== null).length, 1);
  const [sr] = await getDb().select().from(seasons).where(eq(seasons.id, s.id));
  assert.equal(sr!.wins + sr!.losses + sr!.ties, 1);
  assert.equal((await app.inject({ url: "/api/games", headers })).json().games.length, 1);
  // Unlocked items are one row per item.
  const owned = await getDb().select().from(userItems);
  assert.equal(new Set(owned.map((o) => `${o.userId}:${o.itemId}`)).size, owned.length);
});

// Note: under in-process PGlite these requests still serialize, so this passes with or without the per-game lock in games.ts (checked by disabling it). It guards the outcome; the lock is a defensive fix for real Postgres.
test("the same match uploaded at the same moment (finish screen + offline queue) still counts once", async () => {
  const ip = "10.7.0.2";
  const headers = await manager("idem2", ip);
  const s = (await app.inject({ method: "POST", url: "/api/season", headers })).json() as ArcadeSeasonState;
  const body = { ...(await playOut(headers, ip, s.next!.opponent.id, s.id)), clientGameId: "match-idem-0002" };
  const coins0 = await coinsOf(headers);
  const results = await Promise.all([post(headers, ip, body), post(headers, ip, body), post(headers, ip, body), post(headers, ip, body)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 200, 200, 201], results.map((r) => r.body).join("\n"));
  const ids = new Set(results.map((r) => r.json().id));
  assert.equal(ids.size, 1, "every response names the same game");
  const paid = results.find((r) => r.statusCode === 201)!.json().reward.total;
  assert.equal((await coinsOf(headers)) - coins0, paid, "coins paid once");
  assert.equal((await app.inject({ url: "/api/games", headers })).json().games.length, 1);
  const season = (await app.inject({ url: "/api/season", headers })).json() as ArcadeSeasonState;
  assert.equal(season.next!.gameNo, 2);
  assert.equal(season.record.w + season.record.l + season.record.t, 1);
});

test("a finish for a different user's game id is its own game; a refused or unfit retry never pays", async () => {
  const ip = "10.7.0.3";
  const a = await manager("idem3a", ip), b = await manager("idem3b", ip);
  const opp = pool().teams[0]!.id;
  const body = { ...(await playOut(a, ip, opp)), clientGameId: "match-shared-id" };
  assert.equal((await post(a, ip, body)).statusCode, 201);
  const bCoins = await coinsOf(b);
  // The id is scoped to the user: another account sending it is not "a retry".
  const bBody = { ...(await playOut(b, ip, opp)), clientGameId: "match-shared-id" };
  assert.equal((await post(b, ip, bBody)).statusCode, 201);
  assert.ok((await coinsOf(b)) > bCoins);
  // A tampered score on a fresh id is refused and pays nothing.
  const aCoins = await coinsOf(a);
  const tampered = await post(a, ip, { ...body, clientGameId: "match-tamper-01", final: { away: 99, home: 0 } });
  assert.equal(tampered.statusCode, 409);
  assert.equal(await coinsOf(a), aCoins);
  assert.equal((await app.inject({ url: "/api/games", headers: a })).json().games.length, 1);
  assert.equal((await getDb().select().from(games).where(eq(games.clientGameId, "match-tamper-01"))).length, 0);
});
