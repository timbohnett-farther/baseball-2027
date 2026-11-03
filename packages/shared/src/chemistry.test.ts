import { test } from "node:test";
import assert from "node:assert/strict";
import { chemistry, SPOTLIGHT_ROOM, starPower } from "./chemistry.ts";
import type { Player } from "./index.ts";

const SEASON = 2026;
let nextId = 1;

function player(o: Partial<Player> & { ovr?: number; role?: Player["ratings"]["role"]; power?: number } = {}): Player {
  const role = o.role ?? (o.position === "P" ? "SP" : "H");
  const ovr = o.ovr ?? 70;
  const pitcher = role === "SP" || role === "RP";
  return {
    id: nextId++, name: o.lastName ?? "Player", firstName: "Test", lastName: o.lastName ?? `P${nextId}`, jersey: null,
    position: o.position ?? (pitcher ? "P" : "2B"), bats: o.bats ?? "R", throws: "R", age: o.age ?? 28,
    birthDate: null, birthCountry: o.birthCountry ?? "USA", height: null, weight: null, mlbDebut: o.mlbDebut ?? "2020-04-01",
    teamId: o.teamAbbr === null ? null : 1, teamAbbr: o.teamAbbr === undefined ? "KC" : o.teamAbbr, status: "Active",
    ratings: {
      overall: ovr, role,
      hitting: pitcher ? null : { contact: 70, power: o.power ?? 70, eye: 70, speed: 70, fielding: 70 },
      pitching: pitcher ? { stuff: 70, control: 70, movement: 70, stamina: 70 } : null,
      sample: { pa: 500, bf: 0 },
    },
  };
}

const boost = (r: ReturnType<typeof chemistry>, p: Player) => r.players.find((x) => x.playerId === p.id)!;
const has = (r: ReturnType<typeof chemistry>, id: string) => r.effects.find((e) => e.id.startsWith(id));

test("Yankees and Red Sox in one dugout: Bad Blood", () => {
  const nyy = player({ teamAbbr: "NYY" }), bos = player({ teamAbbr: "BOS" });
  const r = chemistry([nyy, bos], SEASON);
  assert.ok(has(r, "bad-blood"));
  assert.equal(boost(r, nyy).delta, -3);
  assert.equal(boost(r, bos).delta, -3);
});

test("a veteran outside the feud halves Bad Blood", () => {
  const nyy = player({ teamAbbr: "NYY" }), bos = player({ teamAbbr: "BOS" }), vet = player({ teamAbbr: "KC", age: 36 });
  const r = chemistry([nyy, bos, vet], SEASON);
  assert.ok(has(r, "veteran-presence"));
  assert.equal(boost(r, nyy).delta, -2); // 1.5 rounded
});

test("rival catcher and pitcher: Crossed Signals", () => {
  const c = player({ position: "C", teamAbbr: "LAD" }), p = player({ position: "P", role: "SP", teamAbbr: "SF" });
  const r = chemistry([c, p], SEASON);
  assert.ok(has(r, "crossed"));
  assert.equal(boost(r, p).skills.control, 70 - 3 - 6);
});

test("three real teammates: Clubhouse Chemistry; a pitcher and his catcher: Battery Mates", () => {
  const team = [player({ teamAbbr: "SEA", position: "C" }), player({ teamAbbr: "SEA" }), player({ teamAbbr: "SEA", position: "P", role: "SP" })];
  const r = chemistry(team, SEASON);
  assert.ok(has(r, "clubhouse-SEA"));
  assert.ok(has(r, "battery"));
  assert.ok(boost(r, team[0]).delta >= 2);
});

test("too many stars: Spotlight Overload hits every star", () => {
  const stars = Array.from({ length: 4 }, () => player({ ovr: 99, teamAbbr: "KC" }));
  assert.ok(stars.reduce((s, p) => s + starPower(p.ratings.overall), 0) > SPOTLIGHT_ROOM);
  const r = chemistry(stars, SEASON);
  assert.ok(has(r, "spotlight"));
  for (const s of stars) assert.ok(boost(r, s).effective < 99);
});

test("stacking ace pitchers overshadows your star hitters", () => {
  const slugger = player({ ovr: 92, teamAbbr: "KC" });
  const aces = [player({ position: "P", role: "SP", ovr: 99, teamAbbr: "KC" }), player({ position: "P", role: "RP", ovr: 95, teamAbbr: "KC" })];
  const r = chemistry([slugger, ...aces], SEASON);
  assert.ok(has(r, "overshadowed"));
  assert.ok(boost(r, slugger).skills.power! < 70);
});

test("rookies: jittery alone, mentored with a veteran", () => {
  const rookie = player({ mlbDebut: "2026-06-01", age: 22 });
  assert.equal(boost(chemistry([rookie], SEASON), rookie).delta, -3);
  const vet = player({ age: 35 });
  const r = chemistry([rookie, vet], SEASON);
  assert.ok(has(r, "mentor"));
  assert.equal(boost(r, rookie).delta, 3);
});

test("one big personality is Showtime; two is a Clash", () => {
  const a = player({ power: 97 }), b = player({ power: 96 });
  assert.ok(has(chemistry([a], SEASON), "showtime"));
  const r = chemistry([a, b], SEASON);
  assert.ok(has(r, "clash"));
  assert.ok(boost(r, a).skills.contact! < 70);
});

test("free agents are hungry; four 33+ players have old legs", () => {
  const fa = player({ teamAbbr: null });
  assert.equal(boost(chemistry([fa], SEASON), fa).delta, 2);
  const olds = Array.from({ length: 4 }, () => player({ age: 33 }));
  assert.ok(has(chemistry(olds, SEASON), "old-legs"));
});

test("team power is the average effective rating", () => {
  const team = [player({ ovr: 80 }), player({ ovr: 60 })];
  const r = chemistry(team, SEASON);
  assert.equal(r.basePower, 70);
});
