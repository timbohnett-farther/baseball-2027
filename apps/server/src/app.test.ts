import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DEFAULT_WOOD, slotsFor, woodDeltas, type MyTeam, type Player } from "@bb/shared";
import { buildApp } from "./app.ts";
import { closeDb, initDb } from "./db/index.ts";
import { pool, startStore } from "./store.ts";

let app: FastifyInstance;

before(async () => {
  await initDb({ localDir: "memory://" });
  await startStore(() => {}, { autoRefresh: false }); // seeds from data/players.json
  app = await buildApp();
});
after(async () => { await app.close(); await closeDb(); });

const cookieOf = (res: LightMyRequestResponse) => {
  const c = res.cookies.find((x) => x.name === "bb_session");
  return c ? `bb_session=${c.value}` : "";
};

async function signup(username: string, password = "secret123", ip?: string) {
  // `ip` sidesteps the per-IP attempt limit once a file's worth of signups has used it up.
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { username, password, displayName: "Micah" }, remoteAddress: ip });
  return { res, cookie: cookieOf(res) };
}

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

test("health reports the local database and a loaded pool", async () => {
  const res = await app.inject("/health");
  assert.equal(res.json().database, "local");
  assert.equal(res.json().migrations, 9, "every migration in drizzle/ should be applied at boot");
  assert.ok(pool().players.length > 1000);
});

test("sign up, see yourself, log out, log back in", async () => {
  const { res, cookie } = await signup("micah");
  assert.equal(res.statusCode, 201);
  assert.ok(cookie);
  assert.equal((await app.inject({ url: "/api/me", headers: { cookie } })).json().username, "micah");

  assert.equal((await signup("MICAH")).res.statusCode, 409, "usernames are case-insensitive");
  assert.equal((await signup("x")).res.statusCode, 400);
  assert.equal((await signup("shortpw", "123")).res.statusCode, 400);

  await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
  assert.equal((await app.inject({ url: "/api/me", headers: { cookie } })).statusCode, 401, "old session is gone");

  const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "micah", password: "nope-nope" } });
  assert.equal(bad.statusCode, 401);
  const good = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Micah", password: "secret123" } });
  assert.equal(good.statusCode, 200);
  assert.ok(cookieOf(good));
});

test("team routes need a signed-in user", async () => {
  assert.equal((await app.inject("/api/my-team")).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/players/592450" })).statusCode, 401);
});

test("create a team, draft a legal roster, finish", async () => {
  const { res: s, cookie } = await signup("drafter");
  assert.equal(s.statusCode, 201, s.body);
  const headers = { cookie };
  assert.equal((await app.inject({ url: "/api/my-team", headers })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Sluggers", color: "#bad" } })).statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Sluggers", color: "#c8322f" } });
  assert.equal(created.statusCode, 201);

  const team = legalTeam();
  assert.equal(team.length, 12);
  let last: MyTeam | null = null;
  for (const p of team) {
    const res = await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
    assert.equal(res.statusCode, 200, `${p.name}: ${res.body}`);
    last = res.json();
  }
  assert.equal(last!.players.length, 12);
  assert.ok(last!.draft.ready, last!.draft.problems.join(" "));

  // Full roster: a 13th player is refused.
  const extra = pool().players.find((p) => !team.includes(p))!;
  assert.equal((await app.inject({ method: "POST", url: `/api/my-team/players/${extra.id}`, headers })).statusCode, 400);

  const done = await app.inject({ method: "POST", url: "/api/my-team/finish", headers });
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().status, "ready");

  // Dropping a player puts the team back into drafting and finishing fails until it's fixed.
  const dropped = await app.inject({ method: "DELETE", url: `/api/my-team/players/${team[0].id}`, headers });
  assert.equal(dropped.json().status, "drafting");
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/finish", headers })).statusCode, 400);
});

test("your team comes back with chemistry: rivals feud", async () => {
  const { cookie } = await signup("rivals");
  const headers = { cookie };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Frenemies", color: "#3a6fd8" } });
  const yankee = pool().players.find((p) => p.teamAbbr === "NYY" && p.ratings.role === "H")!;
  const redSox = pool().players.find((p) => p.teamAbbr === "BOS" && p.ratings.role === "H")!;
  await app.inject({ method: "POST", url: `/api/my-team/players/${yankee.id}`, headers });
  const res = await app.inject({ method: "POST", url: `/api/my-team/players/${redSox.id}`, headers });
  const team = res.json() as MyTeam;
  const feud = team.chemistry.effects.find((e) => e.name.startsWith("Bad Blood"));
  assert.ok(feud, JSON.stringify(team.chemistry.effects.map((e) => e.name)));
  assert.ok(team.chemistry.players.find((p) => p.playerId === yankee.id)!.delta < 0);
});

test("every MLB team can field a full lineup and staff", async () => {
  const { mlbSimTeam } = await import("./games.ts");
  for (const t of pool().teams) {
    const team = mlbSimTeam(t.id)!;
    assert.equal(team.lineup.length, 9, `${t.abbreviation} lineup`);
    assert.equal(team.pitchers.length, 3, `${t.abbreviation} staff`);
  }
});

test("play a game against an MLB team, then see it in your history", async () => {
  const { cookie } = await signup("gamer");
  const headers = { cookie };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Gamers", color: "#2e9e5b" } });
  // Play the team whose players you drafted the most of, so the exclusion is actually exercised.
  const counts = new Map<number, number>();
  for (const p of legalTeam()) if (p.teamId) counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const yankees = pool().teams.find((t) => t.id === busiest)!;

  // Not ready yet: no games.
  assert.equal((await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: yankees.id } })).statusCode, 400);

  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/finish", headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: 999999 } })).statusCode, 400);

  const res = await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: yankees.id } });
  assert.equal(res.statusCode, 201, res.body);
  const game = res.json();
  assert.equal(game.userSide, "home");
  assert.equal(game.opponent.abbr, yankees.abbreviation);
  assert.ok(game.result.events.length > 50);
  assert.equal(game.teams.home.lineup.length, 9);
  // Nobody plays for both teams: your drafted players are off the opponent's roster.
  const mine = new Set([...game.teams.home.lineup, ...game.teams.home.pitchers].map((p: { id: number }) => p.id));
  for (const p of [...game.teams.away.lineup, ...game.teams.away.pitchers]) assert.ok(!mine.has(p.id), `${p.name} is on both teams`);

  const history = (await app.inject({ url: "/api/games", headers })).json();
  assert.equal(history.games.length, 1);
  assert.equal(history.record.w + history.record.l + history.record.t, 1);

  // Reloading the game re-creates exactly the same play-by-play from its seed.
  const again = (await app.inject({ url: `/api/games/${game.id}`, headers })).json();
  assert.deepEqual(again.result, game.result);

  // Other people can't see your games.
  const { cookie: other } = await signup("snooper");
  assert.equal((await app.inject({ url: `/api/games/${game.id}`, headers: { cookie: other } })).statusCode, 404);

  // Play it yourself: the browser drives the pure engine with the setup we hand it, then sends
  // its choices back. We replay them to verify and record the game.
  const { playInteractive } = await import("@bb/sim");
  const setup = (await app.inject({ method: "POST", url: "/api/games/interactive", headers, payload: { opponentTeamId: yankees.id } })).json();
  assert.equal(setup.userSide, "home");
  const inputs: unknown[] = [];
  let out = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, userSide: "home", inputs: [] });
  while (out.awaiting) {
    inputs.push(out.awaiting.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.2, y: -0.3 } }
      : out.awaiting.role === "field" ? { kind: "field", timing: 0 } : { kind: "swing", swing: "contact", timing: 0.1 });
    out = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, userSide: "home", inputs: inputs as never });
  }
  const finish = (body: object) => app.inject({ method: "POST", url: "/api/games/interactive/finish", headers, payload: body }).then((r) => r);
  const bad = { opponentTeamId: yankees.id, seed: setup.seed, inputs, innings: setup.innings, rules: setup.rules, final: { away: 99, home: 0 } };
  assert.equal((await finish(bad)).statusCode, 409); // the score you claim must match the replay
  assert.equal((await finish({ ...bad, inputs: [{ kind: "swing", swing: "bunt", timing: 0 }] })).statusCode, 400);
  const saved = await finish({ ...bad, final: out.result!.final });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.deepEqual(saved.json().result.final, out.result!.final);
  const reloaded = (await app.inject({ url: `/api/games/${saved.json().id}`, headers })).json();
  assert.deepEqual(reloaded.result.events, out.result!.events);
  assert.equal((await app.inject({ url: "/api/games", headers })).json().games.length, 2);
});

test("coins: games pay out, the store sells bats, gear equips", async () => {
  const { res: su, cookie } = await signup("shopper", undefined, "10.0.0.9");
  assert.equal(su.statusCode, 201, su.body);
  const headers = { cookie };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Shoppers", color: "#2e9e5b" } });
  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  await app.inject({ method: "POST", url: "/api/my-team/finish", headers });
  const opp = pool().teams[0];

  const first = await app.inject({ url: "/api/store", headers });
  let store = first.json();
  assert.equal(store.coins, 0, first.body);
  assert.deepEqual(store.owned, []);
  assert.deepEqual(store.gear, { wood: { wood: "ash", length: 33, weight: 31 }, superBat: null });
  assert.ok(store.bats.length >= 10);

  const game = (await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: opp.id } })).json();
  assert.ok(game.reward.total >= 20, JSON.stringify(game.reward));
  assert.ok(game.reward.coins.result > 0);
  const me = (await app.inject({ url: "/api/me", headers })).json();
  assert.equal(me.coins, game.reward.total);

  // Too poor for a Rare bat; Legendary never for sale.
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { batId: "hornet" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { batId: "ninth-wave" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { batId: "nope" } })).statusCode, 400);
  // Can't equip what you don't own.
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/gear", headers, payload: { superBat: "hornet" } })).statusCode, 400);

  // Give the user an allowance (only the server can touch coins), then buy.
  const { getDb } = await import("./db/index.ts");
  const { users } = await import("./db/schema.ts");
  const { eq } = await import("drizzle-orm");
  await getDb().update(users).set({ coins: 1000 }).where(eq(users.username, "shopper"));
  const bought = await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { batId: "hornet" } });
  assert.equal(bought.statusCode, 200, bought.body);
  assert.equal(bought.json().coins, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { batId: "hornet" } })).statusCode, 400); // already owned

  const gear = await app.inject({ method: "POST", url: "/api/my-team/gear", headers, payload: { superBat: "hornet", wood: { wood: "maple", length: 34, weight: 32 } } });
  assert.equal(gear.statusCode, 200, gear.body);
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/gear", headers, payload: { wood: { wood: "oak", length: 33, weight: 31 } } })).statusCode, 400);
  store = (await app.inject({ url: "/api/store", headers })).json();
  assert.deepEqual(store.owned, ["hornet"]);
  assert.deepEqual(store.gear, { wood: { wood: "maple", length: 34, weight: 32 }, superBat: "hornet" });

  // The equipped bat rides along in the interactive setup, so the browser can offer Super Swings.
  const setup = (await app.inject({ method: "POST", url: "/api/games/interactive", headers, payload: { opponentTeamId: opp.id } })).json();
  assert.equal(setup.teams.home.gear.superBat.id, "hornet");
  assert.equal(setup.teams.home.gear.superBat.charges, 3);
});

test("season: 20 games, playoffs if over .500, bonuses paid by the server", async () => {
  const { res: su, cookie } = await signup("skipper", undefined, "10.0.0.11");
  assert.equal(su.statusCode, 201, su.body);
  const headers = { cookie };
  assert.equal((await app.inject({ method: "POST", url: "/api/season", headers })).statusCode, 400); // no team yet
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Skippers", color: "#2e9e5b" } });
  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  await app.inject({ method: "POST", url: "/api/my-team/finish", headers });
  assert.equal((await app.inject({ url: "/api/season", headers })).statusCode, 404);

  const started = await app.inject({ method: "POST", url: "/api/season", headers });
  assert.equal(started.statusCode, 201, started.body);
  let s = started.json();
  assert.equal(s.number, 1);
  assert.equal(s.status, "regular");
  assert.equal(s.schedule.length, 20);
  assert.equal(new Set(s.schedule.map((g: { opponent: { id: number } }) => g.opponent.id)).size, 20);
  assert.equal(s.next.gameNo, 1);
  assert.equal(s.standings.length, 31);
  assert.equal((await app.inject({ method: "POST", url: "/api/season", headers })).statusCode, 400); // one at a time

  // Only the next scheduled opponent counts for the season.
  const wrong = s.schedule[1].opponent.id;
  assert.equal((await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: wrong, seasonId: s.id } })).statusCode, 400);

  let coins = 0, bonuses = 0;
  for (let n = 0; n < 60 && s.status !== "done"; n++) {
    const res = await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: s.next.opponent.id, seasonId: s.id } });
    assert.equal(res.statusCode, 201, res.body);
    const g = res.json();
    coins += g.reward.total;
    bonuses += g.reward.coins.season ?? 0;
    s = (await app.inject({ url: "/api/season", headers })).json();
    const played = s.schedule.filter((x: { gameId: number | null }) => x.gameId !== null).length;
    assert.equal(played, n + 1);
  }
  assert.equal(s.status, "done");
  assert.equal(s.next, null);
  const reg = s.schedule.filter((g: { round: number }) => g.round === 0);
  assert.equal(reg.length, 20);
  assert.equal(s.record.w + s.record.l + s.record.t, 20);
  const madePlayoffs = s.record.w > s.record.l;
  assert.equal(s.schedule.some((g: { round: number }) => g.round > 0), madePlayoffs);
  assert.ok(bonuses >= 100 + (madePlayoffs ? 100 : 0), `bonuses ${bonuses}`);
  assert.equal(s.rewardCoins, bonuses);
  assert.equal(s.eliminated, !s.champion);
  const me = (await app.inject({ url: "/api/me", headers })).json();
  assert.equal(me.coins, coins);
  // Season over: a new one can start, numbered 2.
  const again = await app.inject({ method: "POST", url: "/api/season", headers });
  assert.equal(again.statusCode, 201, again.body);
  assert.equal(again.json().number, 2);
});

test("player development: games earn XP, levels lift ratings, only the server writes XP", async () => {
  const { res: su, cookie } = await signup("coach", undefined, "10.0.0.12");
  assert.equal(su.statusCode, 201, su.body);
  const headers = { cookie };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Coaches", color: "#2e9e5b" } });
  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  await app.inject({ method: "POST", url: "/api/my-team/finish", headers });
  const before = (await app.inject({ url: "/api/my-team", headers })).json();
  for (const p of before.players) assert.deepEqual(p.progress, { xp: 0, level: 0, nextLevelXp: 60 });

  const opp = pool().teams[0].id;
  const g = (await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: opp } })).json();
  const appeared = new Set<number>([...g.result.box.batting.home, ...g.result.box.pitching.home].map((l: { playerId: number }) => l.playerId));
  const after = (await app.inject({ url: "/api/my-team", headers })).json();
  for (const p of after.players) {
    if (appeared.has(p.id)) assert.ok(p.progress.xp >= 10, `${p.name} xp ${p.progress.xp}`);
    else assert.equal(p.progress.xp, 0);
  }
  assert.ok(g.reward.levelUps.every((l: { level: number }) => l.level === 1)); // 60 xp is a lot for one game, but allowed

  // Level 3: +3 to every rating, capped at 99, and the sim sees the developed player.
  const { getDb } = await import("./db/index.ts");
  const { userTeamPlayers } = await import("./db/schema.ts");
  const { eq } = await import("drizzle-orm");
  const star = before.players.find((p: { ratings: { role: string } }) => p.ratings.role === "H");
  await getDb().update(userTeamPlayers).set({ xp: 180 }).where(eq(userTeamPlayers.playerId, star.id));
  const team = (await app.inject({ url: "/api/my-team", headers })).json();
  const grown = team.players.find((p: { id: number }) => p.id === star.id);
  assert.equal(grown.progress.level, 3);
  assert.equal(grown.ratings.overall, Math.min(99, star.ratings.overall + 3));
  assert.equal(grown.ratings.hitting.contact, Math.min(99, star.ratings.hitting.contact + 3));
  // The sim gets the developed rating, then chemistry (which can shift with the new overall) and the wood bat on top.
  const setup = (await app.inject({ method: "POST", url: "/api/games/interactive", headers, payload: { opponentTeamId: opp } })).json();
  const inSim = setup.teams.home.lineup.find((p: { id: number }) => p.id === star.id);
  assert.ok(inSim, "developed player is in the lineup");
  const chem = team.chemistry.players.find((b: { playerId: number }) => b.playerId === star.id);
  assert.equal(inSim.batting.contact, (chem.skills.contact ?? grown.ratings.hitting.contact) + woodDeltas(DEFAULT_WOOD).contact);
});

test("cosmetics: colourways buy with coins, equip per slot, ride into the sim team as looks only", async () => {
  const { res: su, cookie } = await signup("stylist", undefined, "10.0.0.13");
  assert.equal(su.statusCode, 201, su.body);
  const headers = { cookie };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Stylists", color: "#2e9e5b" } });
  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  await app.inject({ method: "POST", url: "/api/my-team/finish", headers });

  const store = (await app.inject({ url: "/api/store", headers })).json();
  assert.ok(store.cosmetics.length >= 12);
  const helmet = store.cosmetics.find((c: { slot: string }) => c.slot === "helmet");
  const cleats = store.cosmetics.find((c: { slot: string; tier: string }) => c.slot === "cleats" && c.tier === "rare");

  // Broke, unknown, and not-owned are all refused.
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { cosmeticId: helmet.id } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { cosmeticId: "helmet-nope" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/gear", headers, payload: { cosmetics: { helmet: helmet.id } } })).statusCode, 400);

  const { getDb } = await import("./db/index.ts");
  const { users } = await import("./db/schema.ts");
  const { eq } = await import("drizzle-orm");
  await getDb().update(users).set({ coins: 400 }).where(eq(users.username, "stylist"));
  const bought = await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { cosmeticId: helmet.id } });
  assert.equal(bought.statusCode, 200, bought.body);
  assert.equal(bought.json().coins, 400 - helmet.price);
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { cosmeticId: helmet.id } })).statusCode, 400); // owned
  assert.equal((await app.inject({ method: "POST", url: "/api/store/buy", headers, payload: { cosmeticId: cleats.id } })).statusCode, 400); // rare, too poor now

  // Wrong slot is refused; the right slot equips; null clears.
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/gear", headers, payload: { cosmetics: { cleats: helmet.id } } })).statusCode, 400);
  const on = await app.inject({ method: "POST", url: "/api/my-team/gear", headers, payload: { cosmetics: { helmet: helmet.id } } });
  assert.equal(on.statusCode, 200, on.body);
  assert.equal(on.json().cosmetics.helmet, helmet.id);
  assert.equal(on.json().superBat, null); // untouched

  const setup = (await app.inject({ method: "POST", url: "/api/games/interactive", headers, payload: { opponentTeamId: pool().teams[1].id } })).json();
  assert.equal(setup.teams.home.gear.cosmetics.helmet, helmet.id);
  assert.equal(setup.teams.away.gear, undefined); // MLB clubs wear stock

  const off = await app.inject({ method: "POST", url: "/api/my-team/gear", headers, payload: { cosmetics: { helmet: null } } });
  assert.equal(off.json().cosmetics.helmet, null);
});

test("match length: quick matches are 1, 3 or 5 innings, seasons stay 3, rules ride with the game", async () => {
  const { res: su, cookie } = await signup("lengths", undefined, "10.0.0.21");
  assert.equal(su.statusCode, 201, su.body);
  const headers = { cookie };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Lengths", color: "#2e9e5b" } });
  for (const p of legalTeam()) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers });
  await app.inject({ method: "POST", url: "/api/my-team/finish", headers });
  const opp = pool().teams.find((t) => t.id !== undefined)!;
  const start = (payload: object) => app.inject({ method: "POST", url: "/api/games/interactive", headers, payload: { opponentTeamId: opp.id, ...payload } });

  for (const bad of [0, 2, 4, 9, "3", 1.5]) assert.equal((await start({ innings: bad })).statusCode, 400, `innings ${bad}`);
  assert.equal((await start({})).json().innings, 3);
  for (const n of [1, 3, 5]) {
    const setup = (await start({ innings: n })).json();
    assert.equal(setup.innings, n);
    assert.equal(setup.rules, 2);
  }
  const sim = await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: opp.id, innings: 1 } });
  assert.equal(sim.statusCode, 201, sim.body);
  assert.equal(sim.json().result.box.linescore.away.length >= 1, true);
  assert.notEqual(sim.json().result.winner, null); // rules 2: no ties
  assert.equal((await app.inject({ method: "POST", url: "/api/games", headers, payload: { opponentTeamId: opp.id, innings: 7 } })).statusCode, 400);

  // Season games are always 3 innings.
  const season = (await app.inject({ method: "POST", url: "/api/season", headers })).json();
  const seasonBody = { opponentTeamId: season.next.opponent.id, seasonId: season.id };
  assert.equal((await start({ ...seasonBody, innings: 5 })).statusCode, 400);
  assert.equal((await start({ ...seasonBody })).json().innings, 3);

  // A game finished by a browser that predates rules versioning replays as rules 1.
  const { playInteractive } = await import("@bb/sim");
  const setup = (await start({ innings: 1 })).json();
  const inputs: unknown[] = [];
  const play = (rules: 1 | 2) => playInteractive({ ...setup.teams, seed: setup.seed, innings: 1, rules, userSide: "home", inputs: inputs as never });
  let out = play(1);
  while (out.awaiting) {
    inputs.push(out.awaiting.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.2, y: -0.3 } }
      : out.awaiting.role === "field" ? { kind: "field", timing: 0 } : { kind: "swing", swing: "contact", timing: 0.1 });
    out = play(1);
  }
  const finish = (body: object) => app.inject({ method: "POST", url: "/api/games/interactive/finish", headers, payload: body });
  const base = { opponentTeamId: opp.id, seed: setup.seed, inputs, innings: 1, final: out.result!.final };
  assert.equal((await finish({ ...base, rules: 3 })).statusCode, 400);
  assert.equal((await finish({ ...base, innings: 4 })).statusCode, 400);
  const { innings: _i, ...legacy } = base; // old bundle: no innings, no rules => 3 innings under rules 1
  assert.equal((await finish({ ...legacy, final: { away: 99, home: 0 } })).statusCode, 409);
  const saved = await finish({ ...base, rules: 1 });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.deepEqual((await app.inject({ url: `/api/games/${saved.json().id}`, headers })).json().result.final, out.result!.final);
});
