import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { TUTORIAL_REWARD } from "@bb/shared";
import { playInteractive, tutorialSetup, type UserInput } from "@bb/sim";
import { buildApp } from "./app.ts";
import { closeDb, initDb } from "./db/index.ts";
import { startStore } from "./store.ts";

let app: FastifyInstance;
before(async () => {
  await initDb({ localDir: "memory://" });
  await startStore(() => {}, { autoRefresh: false });
  app = await buildApp();
});
after(async () => { await app.close(); await closeDb(); });

const cookieOf = (res: LightMyRequestResponse) => `bb_session=${res.cookies.find((x) => x.name === "bb_session")!.value}`;
async function signup(username: string, ip: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { username, password: "secret123" }, remoteAddress: ip });
  assert.equal(res.statusCode, 201, res.body);
  return { cookie: cookieOf(res), me: res.json() };
}

/** A full scripted run of the fixed tutorial game. */
function tutorialLog(): UserInput[] {
  const s = tutorialSetup();
  const inputs: UserInput[] = [];
  for (let i = 0; i < 400; i++) {
    const g = playInteractive({ away: s.teams.away, home: s.teams.home, seed: s.seed, innings: s.innings, rules: s.rules, difficulty: s.difficulty, userSide: s.userSide, inputs });
    if (!g.awaiting) return inputs;
    const a = g.awaiting;
    inputs.push(a.role === "swing" ? { kind: "swing", swing: "contact", timing: 0 }
      : a.role === "run" ? { kind: "run", action: "advance", send: [] }
      : a.role === "field" ? { kind: "field", timing: 0 }
      : { kind: "pitch", type: "fastball", aim: { x: 0.5, y: 0.5 } });
  }
  throw new Error("tutorial game did not finish");
}

test("tutorial: a new user has not played it; finishing records it and pays the badge coins once", async () => {
  const { cookie, me } = await signup("rookie", "10.0.1.1");
  const headers = { cookie };
  assert.equal(me.tutorial, null);
  const inputs = tutorialLog();
  const done = await app.inject({ method: "POST", url: "/api/tutorial/complete", headers, payload: { inputs } });
  assert.equal(done.statusCode, 200, done.body);
  assert.deepEqual(done.json(), { tutorial: "done", coins: me.coins + TUTORIAL_REWARD, reward: TUTORIAL_REWARD });
  const after1 = (await app.inject({ url: "/api/me", headers })).json();
  assert.equal(after1.tutorial, "done");
  assert.equal(after1.coins, me.coins + TUTORIAL_REWARD);
  const again = await app.inject({ method: "POST", url: "/api/tutorial/complete", headers, payload: { inputs } });
  assert.equal(again.json().reward, 0, "replaying the tutorial pays nothing");
  assert.equal((await app.inject({ url: "/api/me", headers })).json().coins, after1.coins);
});

test("tutorial: an unfinished or malformed log is refused and pays nothing; it needs a session", async () => {
  const { cookie, me } = await signup("rookie2", "10.0.1.2");
  const headers = { cookie };
  const half = tutorialLog().slice(0, 3);
  assert.equal((await app.inject({ method: "POST", url: "/api/tutorial/complete", headers, payload: { inputs: half } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/tutorial/complete", headers, payload: { inputs: [{ kind: "nope" }] } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/tutorial/complete", headers, payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/tutorial/complete", payload: { inputs: [] } })).statusCode, 401);
  const now = (await app.inject({ url: "/api/me", headers })).json();
  assert.equal(now.tutorial, null);
  assert.equal(now.coins, me.coins);
});

test("tutorial: skipping is remembered, pays nothing, and never undoes a finished tutorial", async () => {
  const { cookie, me } = await signup("rookie3", "10.0.1.3");
  const headers = { cookie };
  assert.equal((await app.inject({ method: "POST", url: "/api/tutorial/skip", headers })).json().tutorial, "skipped");
  const skipped = (await app.inject({ url: "/api/me", headers })).json();
  assert.equal(skipped.tutorial, "skipped");
  assert.equal(skipped.coins, me.coins);
  const done = await app.inject({ method: "POST", url: "/api/tutorial/complete", headers, payload: { inputs: tutorialLog() } });
  assert.equal(done.json().reward, TUTORIAL_REWARD, "a skipper who later plays it still earns the badge");
  assert.equal((await app.inject({ method: "POST", url: "/api/tutorial/skip", headers })).json().tutorial, "done");
});
