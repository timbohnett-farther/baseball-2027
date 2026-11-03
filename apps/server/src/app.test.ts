import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { salaryFor, slotsFor, type MyTeam, type Player } from "@bb/shared";
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

/** Cheapest legal team from the real pool: one per position, three OF, a DH, an SP and two RPs. */
function cheapTeam(): Player[] {
  const byCost = [...pool().players].sort((a, b) => salaryFor(a.ratings.overall) - salaryFor(b.ratings.overall));
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
  const created = await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Sluggers", color: "#c8102e" } });
  assert.equal(created.statusCode, 201);

  const team = cheapTeam();
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

test("the salary cap is enforced on the server", async () => {
  const { cookie } = await signup("bigspender");
  const headers = { cookie };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Stars", color: "#0c2340" } });
  // The top hitters cost far more than $60M together; adding stops before the cap.
  const stars = pool().players.filter((p) => p.ratings.role === "H").slice(0, 6);
  const results = [];
  for (const p of stars) results.push((await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers })).statusCode);
  assert.ok(results.includes(400), `expected a budget refusal, got ${results}`);
  const team = (await app.inject({ url: "/api/my-team", headers })).json() as MyTeam;
  assert.ok(team.draft.payroll <= 600);
});
