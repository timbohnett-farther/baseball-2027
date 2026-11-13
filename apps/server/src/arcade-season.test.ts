import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { slotsFor, TEAM_COLORS, UNLOCKS, type ArcadeSeasonState, type Player } from "@bb/shared";
import { buildApp } from "./app.ts";
import { closeDb, initDb } from "./db/index.ts";
import { pool, startStore } from "./store.ts";

let app: FastifyInstance;
before(async () => {
  await initDb({ localDir: "memory://" });
  await startStore(() => {}, { autoRefresh: false });
  app = await buildApp();
});
after(async () => { await app.close(); await closeDb(); });

const cookieOf = (res: LightMyRequestResponse) => `bb_session=${res.cookies.find((x) => x.name === "bb_session")!.value}`;

/** A legal team from the real pool (best available at each spot): one per position, three OF, a DH, an SP and two RPs. */
function legalTeam(): Player[] {
  const byCost = pool().players; // sorted best-first
  const chosen: Player[] = [];
  const need: [string, number][] = [["C", 1], ["1B", 1], ["2B", 1], ["3B", 1], ["SS", 1], ["OF", 3], ["DH", 1], ["SP", 1], ["RP", 2]];
  for (const [slot, n] of need) {
    const matches = byCost.filter((p) => p.ratings.role !== "TWP" && !chosen.includes(p) &&
      (slot === "DH" ? p.ratings.role === "H" : slotsFor({ position: p.position, role: p.ratings.role }).includes(slot as never)));
    chosen.push(...matches.slice(0, n));
  }
  return chosen;
}

async function newManager(username: string, ip: string, color: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { username, password: "secret123" }, remoteAddress: ip });
  assert.equal(res.statusCode, 201, res.body);
  const headers = { cookie: cookieOf(res) };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: `${username} club`, color } });
  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  await app.inject({ method: "POST", url: "/api/my-team/finish", headers });
  return headers;
}

const season = async (headers: { cookie: string }) => (await app.inject({ url: "/api/season", headers })).json() as ArcadeSeasonState;

test("arcade season: seven fixtures, one per club, the rival in round 4, three starred objectives each", async () => {
  const headers = await newManager("arc1", "10.0.2.1", TEAM_COLORS[0]);
  const created = await app.inject({ method: "POST", url: "/api/season", headers });
  assert.equal(created.statusCode, 201, created.body);
  const s = created.json() as ArcadeSeasonState;
  assert.equal(s.format, 2);
  assert.equal(s.status, "regular");
  assert.equal(s.schedule.length, 7);
  assert.equal(new Set(s.schedule.map((f) => f.opponent.id)).size, 7);
  assert.equal(s.standings.length, 8);
  assert.equal(s.standings.filter((r) => r.you).length, 1);
  assert.equal(s.schedule.filter((f) => f.opponent.rival).length, 1);
  assert.equal(s.schedule[3]!.opponent.rival, true);
  assert.equal(s.next!.gameNo, 1);
  assert.equal(s.stars.max, 27); // 7 regular games + semifinal + final
  let prev: string[] = [];
  for (const f of s.schedule) {
    assert.equal(f.objectives.length, 3);
    assert.equal(f.objectives[0]!.id, "win");
    const ids = f.objectives.map((o) => o.id).slice(1);
    assert.equal(ids.filter((id) => prev.includes(id)).length, 0, `game ${f.gameNo} repeats an objective`);
    prev = ids;
  }
  // The same season on a re-read; one at a time; only the next opponent counts; seasons are 3 innings.
  assert.deepEqual(await season(headers), s);
  assert.equal((await app.inject({ method: "POST", url: "/api/season", headers })).statusCode, 400);
  const wrong = s.schedule[1]!.opponent.id;
  assert.equal((await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: wrong, seasonId: s.id } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: s.next!.opponent.id, seasonId: s.id, innings: 5 } })).statusCode, 400);
});

test("arcade season: a full season pays what it reports, unlocks match the store, and the career adds up", async () => {
  const headers = await newManager("arc2", "10.0.2.2", TEAM_COLORS[1]);
  let s = (await app.inject({ method: "POST", url: "/api/season", headers })).json() as ArcadeSeasonState;
  let coins = 0, stars = 0;
  const unlocked: string[] = [];
  for (let n = 0; n < 40 && s.status !== "done"; n++) {
    const res = await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: s.next!.opponent.id, seasonId: s.id } });
    assert.equal(res.statusCode, 201, res.body);
    const g = res.json();
    coins += g.reward.total;
    assert.ok(g.reward.arcade, "arcade games report their stars");
    assert.equal(g.reward.arcade.objectives.length, 3);
    assert.equal(g.reward.arcade.stars, g.reward.arcade.objectives.filter((o: { earned: boolean }) => o.earned).length);
    stars += g.reward.arcade.stars;
    for (const u of g.reward.arcade.unlocks) { const def = UNLOCKS.find((x) => x.stars === u.stars); if (def?.itemId) unlocked.push(def.itemId); }
    s = await season(headers);
  }
  assert.equal(s.status, "done");
  assert.equal(s.next, null);
  assert.ok(s.placement);
  assert.equal(s.schedule.filter((f) => f.round === 0).length, 7);
  assert.equal(s.record.w + s.record.l + s.record.t, 7);
  assert.equal(s.stars.season, stars);
  assert.equal(s.lifetime.stars, stars);
  assert.equal(s.standings.filter((r) => r.inPlayoffs).length, 4);
  if (s.champion) assert.equal(s.placement!.place, 1);

  const me = (await app.inject({ url: "/api/me", headers })).json();
  assert.equal(me.coins, coins, "the coins the games reported are the coins in the wallet");
  const store = (await app.inject({ url: "/api/store", headers })).json();
  for (const id of unlocked) assert.ok(store.owned.includes(id), `${id} should be owned`);

  const career = (await app.inject({ url: "/api/season/career", headers })).json();
  assert.equal(career.lifetime.stars, stars);
  assert.equal(career.seasons.length, 1);
  assert.equal(career.seasons[0].format, 2);
  assert.equal(career.seasons[0].stars, stars);
  assert.equal((await app.inject({ url: "/api/season/career" })).statusCode, 401);
});
