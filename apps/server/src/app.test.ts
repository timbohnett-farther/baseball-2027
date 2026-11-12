import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { slotsFor, type MyTeam, type Player } from "@bb/shared";
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

async function signup(username: string, password = "secret123") {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { username, password, displayName: "Micah" } });
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
  let out = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, userSide: "home", inputs: [] });
  while (out.awaiting) {
    inputs.push(out.awaiting.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.2, y: -0.3 } } : { kind: "swing", swing: "contact", timing: 0.1 });
    out = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, userSide: "home", inputs: inputs as never });
  }
  const finish = (body: object) => app.inject({ method: "POST", url: "/api/games/interactive/finish", headers, payload: body }).then((r) => r);
  const bad = { opponentTeamId: yankees.id, seed: setup.seed, inputs, final: { away: 99, home: 0 } };
  assert.equal((await finish(bad)).statusCode, 409); // the score you claim must match the replay
  assert.equal((await finish({ ...bad, inputs: [{ kind: "swing", swing: "bunt", timing: 0 }] })).statusCode, 400);
  const saved = await finish({ ...bad, final: out.result!.final });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.deepEqual(saved.json().result.final, out.result!.final);
  const reloaded = (await app.inject({ url: `/api/games/${saved.json().id}`, headers })).json();
  assert.deepEqual(reloaded.result.events, out.result!.events);
  assert.equal((await app.inject({ url: "/api/games", headers })).json().games.length, 2);
});
