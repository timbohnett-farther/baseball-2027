import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { defaultRatings, slotsFor, type CustomPlayerInput, type CustomPlayerState, type MyTeam, type Player } from "@bb/shared";
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

async function user(name: string, ip: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { username: name, password: "secret123", displayName: "Kid" }, remoteAddress: ip });
  const c = res.cookies.find((x) => x.name === "bb_session")!;
  const headers = { cookie: `bb_session=${c.value}` };
  await app.inject({ method: "POST", url: "/api/my-team", headers, payload: { name: "Customs", color: "#3a6fd8" } });
  return headers;
}

function legalTeam(): Player[] {
  const chosen: Player[] = [];
  const need: [string, number][] = [["C", 1], ["1B", 1], ["2B", 1], ["3B", 1], ["SS", 1], ["OF", 3], ["DH", 1], ["SP", 1], ["RP", 2]];
  for (const [slot, n] of need) {
    const m = pool().players.filter((p) => p.ratings.role !== "TWP" && !chosen.includes(p) &&
      (slot === "DH" ? p.ratings.role === "H" : slotsFor({ position: p.position, role: p.ratings.role }).includes(slot as never)));
    chosen.push(...m.slice(0, n));
  }
  return chosen;
}

const mine = (over: Partial<CustomPlayerInput> = {}): CustomPlayerInput => ({
  name: "Sky Blue", number: 7, position: "DH", bats: "S", look: { skin: 2, build: "sturdy", accent: 1 }, ratings: defaultRatings("DH"), ...over,
});
const draft = async (h: { cookie: string }, ps: Player[]) => { for (const p of ps) await app.inject({ method: "POST", url: `/api/my-team/players/${p.id}`, headers: h }); };
const call = (h: { cookie: string }, method: "GET" | "POST" | "PATCH" | "DELETE", payload?: object) =>
  app.inject({ method, url: "/api/my-team/custom-player", headers: h, payload });

test("custom player: needs sign-in, shows the budget, saves one per team, listed first", async () => {
  assert.equal((await app.inject("/api/my-team/custom-player")).statusCode, 401);
  const h = await user("kid1", "10.9.0.1");
  const state: CustomPlayerState = (await call(h, "GET")).json();
  assert.equal(state.player, null);
  assert.deepEqual({ bonus: state.points.bonus, cap: state.points.cap, floor: state.points.floor }, { bonus: 0, cap: 80, floor: 40 });

  const made = await call(h, "POST", mine());
  assert.equal(made.statusCode, 201, made.body);
  const team: MyTeam = made.json();
  assert.equal(team.players[0].custom?.number, 7);
  assert.ok(team.players[0].id < 0);
  assert.equal(team.players[0].name, "Sky Blue");
  assert.equal(team.chemistry.players.some((p) => p.playerId === team.players[0].id), false, "chemistry ignores custom players");
  assert.equal((await call(h, "POST", mine())).statusCode, 409, "one custom player per team");
  const back: CustomPlayerState = (await call(h, "GET")).json();
  assert.equal(back.player?.name, "Sky Blue");
  assert.ok(back.overall && back.overall >= 66 && back.overall <= 72);
});

test("custom player: bad name, number, budget and caps are refused by the server", async () => {
  const h = await user("kid2", "10.9.0.2");
  const bad = async (over: Partial<CustomPlayerInput>, re: RegExp) => {
    const r = await call(h, "POST", mine(over));
    assert.equal(r.statusCode, 400, r.body);
    assert.match(r.json().error, re);
  };
  await bad({ name: "x" }, /2 to 16/);
  await bad({ name: "Big Ass" }, /different name/);
  await bad({ number: 100 }, /0 to 99/);
  await bad({ ratings: { contact: 80, power: 80, eye: 80, speed: 80, fielding: 80 } }, /spent 200/);
  await bad({ ratings: { ...defaultRatings("DH"), power: 81 } }, /above 80/);
  await bad({ position: "SP" }, /./);
  assert.equal(((await call(h, "GET")).json() as CustomPlayerState).player, null, "nothing was saved");
});

test("custom player: obeys the roster rules, full roster tells you to drop someone", async () => {
  const h = await user("kid3", "10.9.0.3");
  await draft(h, legalTeam());
  const full = await call(h, "POST", mine());
  assert.equal(full.statusCode, 400);
  assert.match(full.json().error, /full \(12\).*Drop a player first/);

  const h2 = await user("kid4", "10.9.0.4");
  const team = legalTeam();
  await draft(h2, team.filter((p) => p !== team[8])); // everyone except the DH
  assert.equal((await call(h2, "POST", mine({ position: "SP", ratings: defaultRatings("SP") }))).statusCode, 400, "staff already has 3 pitchers");
  const ok = await call(h2, "POST", mine());
  assert.equal(ok.statusCode, 201, ok.body);
  const t: MyTeam = ok.json();
  assert.equal(t.players.length, 12);
  assert.equal(t.draft.ready, true);
  assert.equal((await app.inject({ method: "POST", url: "/api/my-team/finish", headers: h2 })).statusCode, 200);
});

test("custom player: edit name, number, look and ratings; position change must still fit; delete frees the slot", async () => {
  const h = await user("kid5", "10.9.0.5");
  await call(h, "POST", mine());
  const r = { ...defaultRatings("DH"), contact: 60, power: 60 };
  const edit = await call(h, "PATCH", { name: "Skye", number: 0, look: { skin: 4, build: "slim", accent: 5 }, ratings: r });
  assert.equal(edit.statusCode, 200, edit.body);
  const p = (edit.json() as MyTeam).players[0];
  assert.equal(p.name, "Skye");
  assert.equal(p.custom?.number, 0);
  assert.deepEqual(p.custom?.look, { skin: 4, build: "slim", accent: 5 });
  assert.equal((await call(h, "PATCH", { ratings: { ...r, contact: 80, power: 80 } })).statusCode, 400, "re-spend stays inside the budget");
  const pitcher = await call(h, "PATCH", { position: "SP", ratings: defaultRatings("SP") });
  assert.equal(pitcher.statusCode, 200, pitcher.body);
  assert.equal((pitcher.json() as MyTeam).players[0].ratings.role, "SP");
  assert.equal((await call(h, "PATCH", { position: "SP" })).statusCode, 200, "no change is fine");
  const gone = await call(h, "DELETE");
  assert.equal(gone.statusCode, 200);
  assert.equal((gone.json() as MyTeam).players.length, 0);
  assert.equal((await call(h, "PATCH", { name: "Nope" })).statusCode, 404);
});

test("custom player: a full game with a custom player on the roster finishes and replays exactly", async () => {
  for (const [who, over] of [["kid6", mine()], ["kid7", mine({ position: "RP", ratings: defaultRatings("RP") })]] as const) {
    const h = await user(who, who === "kid6" ? "10.9.0.6" : "10.9.0.7");
    const team = legalTeam();
    const drop = over.position === "RP" ? team[team.length - 1] : team[8];
    await draft(h, team.filter((p) => p !== drop));
    assert.equal((await call(h, "POST", over)).statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: "/api/my-team/finish", headers: h })).statusCode, 200);
    const opp = pool().teams.find((t) => !team.some((p) => p.teamId === t.id)) ?? pool().teams[0];
    const res = await app.inject({ method: "POST", url: "/api/games", headers: h, payload: { opponentTeamId: opp.id } });
    assert.equal(res.statusCode, 201, res.body);
    const game = res.json();
    const ids = [...game.teams.home.lineup, ...game.teams.home.pitchers].map((p: { id: number }) => p.id);
    assert.ok(ids.some((id: number) => id < 0), "the custom player is in the sim roster");
    assert.ok(game.result.events.length > 50);
    // Later edits don't change a saved game, and reloading replays the same events from the stored teams.
    await call(h, "PATCH", { name: "Changed", number: 55 });
    const again = (await app.inject({ url: `/api/games/${game.id}`, headers: h })).json();
    assert.deepEqual(again.result, game.result);
  }
});
