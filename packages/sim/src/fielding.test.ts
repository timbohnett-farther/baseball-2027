import { test } from "node:test";
import assert from "node:assert/strict";
import { playInteractive } from "./game.ts";
import { ABILITIES, BOUNDS, combine } from "./ability.ts";
import type { AbilityId, Awaiting, Base, GameEvent, SimPlayer, SimTeam, UserInput } from "./types.ts";

// Rules v5 fielding (ARC 7, PUP 8-10): the throw choice on a force-play grounder and the three fielding abilities.

let nextId = 5000;
const POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
const hitter = (r: number, position: string): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position, bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
const team = (name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: POSITIONS.map((p) => hitter(70, p)), pitchers: [pitcher(70), pitcher(70)],
});
const away = team("Away"), home = team("Home");
const SEEDS = 250;

const play = (seed: number, inputs: UserInput[], rules: 4 | 5 = 5) =>
  playInteractive({ away, home, seed, innings: 5, rules, userSide: "home", inputs, startHeat: 100 });
const TAP = 0.5;
const basic = (aw: Awaiting): UserInput =>
  aw.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } }
    : aw.role === "swing" ? { kind: "swing", swing: "contact", timing: 0.2 } : { kind: "field", timing: TAP };

interface Ask { inputs: UserInput[]; aw: Awaiting; seen: number }
/** Every glove tap on this seed that `want` accepts (up to `max`), each with the log that leads to it. */
function findAsks(seed: number, want: (aw: Awaiting) => boolean, max = 3): Ask[] {
  const inputs: UserInput[] = [], out: Ask[] = [];
  for (let n = 0; n < 400 && out.length < max; n++) {
    const g = play(seed, inputs);
    if (!g.awaiting) break;
    if (g.awaiting.role === "field" && want(g.awaiting)) out.push({ inputs: [...inputs], aw: g.awaiting, seen: g.events.length });
    inputs.push(basic(g.awaiting));
  }
  return out;
}
const findAsk = (seed: number, want: (aw: Awaiting) => boolean): Ask | null => findAsks(seed, want, 1)[0] ?? null;
const resolve = (seed: number, ask: Ask, field: Extract<UserInput, { kind: "field" }>) => {
  const g = play(seed, [...ask.inputs, field]);
  const fresh = g.events.slice(ask.seen);
  const p = fresh.find((e) => e.type === "play") as Extract<GameEvent, { type: "play" }>;
  return { outcome: p.outcome, fresh, state: p.state };
};
const BASES: Record<string, number> = { strikeout: 0, groundout: 0, flyout: 0, lineout: 0, double_play: 0, sac_fly: 0, single: 1, double: 2, triple: 3, home_run: 4 };
const isOut = (o: string) => BASES[o] === 0;
const withAbility = (id: AbilityId): Extract<UserInput, { kind: "field" }> => ({ kind: "field", timing: TAP, ability: { id } });
const plain: Extract<UserInput, { kind: "field" }> = { kind: "field", timing: TAP };

/** Same ball, with and without the ability: how many plays it helped, hurt, and left alone. */
function effect(id: AbilityId, want: (aw: Awaiting) => boolean) {
  let asks = 0, better = 0, worse = 0, same = 0, triggered = 0, hrs = 0;
  const converted: string[] = [];
  for (let seed = 0; seed < SEEDS; seed++) {
    for (const ask of findAsks(seed, want)) {
    asks++;
    const a = resolve(seed, ask, plain), b = resolve(seed, ask, withAbility(id));
    if (b.outcome === "home_run") hrs++;
    if (b.fresh.some((e) => e.type === "ability" && e.phase === "triggered")) triggered++;
    if (BASES[b.outcome] < BASES[a.outcome]) { better++; converted.push(a.outcome); } else if (BASES[b.outcome] > BASES[a.outcome]) worse++; else same++;
    }
  }
  return { asks, better, worse, same, triggered, hrs, converted };
}
const flies = (aw: Awaiting) => aw.ball?.kind === "fly" && aw.abilities.find((a) => a.id === "FIELD_WALL_REAPER")?.available === true;
const dives = (aw: Awaiting) => aw.ball?.kind !== "grounder" && aw.abilities.find((a) => a.id === "FIELD_ACROBAT")?.available === true;
const doublePlays = (aw: Awaiting) => aw.ball?.throws !== undefined && aw.abilities.find((a) => a.id === "FIELD_CANNON_ARM")?.available === true;

test("Wall Reaper: takes hits away from close flies, never a home run", () => {
  const r = effect("FIELD_WALL_REAPER", flies);
  assert.ok(r.asks > 100, `${r.asks} asks`);
  assert.ok(r.better > 0, "it robs some");
  assert.equal(r.worse, 0);
  assert.equal(r.hrs, 0);
  assert.ok(r.converted.every((o) => o === "single" || o === "double" || o === "triple"), "it only ever converts hits");
  assert.ok(r.better < r.asks * 0.5, "a nudge, not a guarantee");
});

test("Acrobat: more catches on dives and liners, never fewer", () => {
  const r = effect("FIELD_ACROBAT", dives);
  assert.ok(r.asks > 100);
  assert.ok(r.better > 0);
  assert.equal(r.worse, 0);
  assert.equal(r.hrs, 0);
  assert.ok(r.better < r.asks * 0.6);
});

test("Cannon Arm: more double plays, and a throw that sails now and then", () => {
  let asks = 0, dpBase = 0, dpArm = 0, lost = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    for (const ask of findAsks(seed, doublePlays)) {
      asks++;
      const a = resolve(seed, ask, plain), b = resolve(seed, ask, withAbility("FIELD_CANNON_ARM"));
      if (a.outcome === "double_play") dpBase++;
      if (b.outcome === "double_play") dpArm++;
      if (a.outcome === "double_play" && b.outcome !== "double_play") lost++;
    }
  }
  assert.ok(asks > 20, `${asks} double-play spots`);
  assert.ok(dpArm > dpBase, `double plays ${dpBase} -> ${dpArm}`);
  assert.ok(dpArm < asks, "never guaranteed");
});

test("the wrong base has a price: the sure out at first gives up the double play", () => {
  let asks = 0, rec = 0, first = 0, wrongForce = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    for (const ask of findAsks(seed, (aw) => aw.ball?.throws !== undefined)) {
    asks++;
    const t = ask.aw.ball!.throws!;
    assert.ok(t.options.includes(t.recommended) && t.options.includes("first"));
    const go = (throwTo?: Base) => resolve(seed, ask, { kind: "field", timing: TAP, ...(throwTo ? { throwTo } : {}) }).outcome;
    const def = go(), viaRec = go(t.recommended);
    assert.equal(def, viaRec, "no throw recorded means the recommended throw");
    if (viaRec === "double_play") rec++;
    if (go("first") === "double_play") first++;
    const other = t.options.find((o) => o !== "first" && o !== t.recommended);
    if (other && go(other) === "double_play") wrongForce++;
    }
  }
  assert.ok(asks > 20);
  assert.ok(rec > 0);
  assert.equal(first, 0);
  assert.ok(wrongForce <= rec);
});

test("fielding abilities: costs are spent on commit, refused on the wrong ball and refunded as nothing", () => {
  const heatOf = (aw: Awaiting) => aw.state.heat[aw.ball!.fielderId];
  let checked = 0;
  for (let seed = 0; seed < SEEDS && checked < 40; seed++) {
    const ask = findAsk(seed, (aw) => aw.ball?.kind === "grounder" && aw.ball.throws === undefined);
    if (!ask) continue;
    checked++;
    const before = heatOf(ask.aw);
    // Chips: nothing fielding-specific fits a grounder with no double play on.
    for (const id of ["FIELD_WALL_REAPER", "FIELD_ACROBAT", "FIELD_CANNON_ARM"]) {
      const chip: Awaiting["abilities"][number] = ask.aw.abilities.find((a) => a.id === id)!;
      assert.equal(chip.available, false);
      assert.equal(chip.reason, "WRONG_CONTEXT");
    }
    const r = resolve(seed, ask, withAbility("FIELD_WALL_REAPER"));
    const rej = r.fresh.find((e) => e.type === "ability");
    assert.ok(rej && rej.type === "ability" && rej.phase === "rejected" && rej.reason === "WRONG_CONTEXT");
    assert.equal(rej.heat, before, "a refused request costs nothing");
    assert.equal(resolve(seed, ask, plain).outcome, r.outcome, "and changes nothing");
  }
  assert.ok(checked > 10);
  // A committed one is charged its PUP price.
  const cost = { FIELD_WALL_REAPER: 60, FIELD_ACROBAT: 50, FIELD_CANNON_ARM: 45 } as const;
  for (const [id, want] of [["FIELD_WALL_REAPER", flies], ["FIELD_ACROBAT", dives], ["FIELD_CANNON_ARM", doublePlays]] as const) {
    assert.equal(ABILITIES[id].cost, cost[id]);
    let seen = 0;
    for (let seed = 0; seed < SEEDS && seen < 5; seed++) {
      const ask = findAsk(seed, want);
      if (!ask) continue;
      const c = resolve(seed, ask, withAbility(id)).fresh.find((e) => e.type === "ability" && e.phase === "committed");
      assert.ok(c && c.type === "ability");
      assert.equal(c.heat, ask.aw.state.heat[ask.aw.ball!.fielderId] - cost[id]);
      seen++;
    }
    assert.ok(seen > 0, id);
  }
});

test("fielding abilities: every effect stays inside its cap, however they stack", () => {
  const all = combine(["FIELD_WALL_REAPER", "FIELD_ACROBAT", "FIELD_CANNON_ARM"].flatMap((id) => [ABILITIES[id as AbilityId].effects(), ABILITIES[id as AbilityId].effects()]));
  for (const k of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) assert.ok(all[k] >= BOUNDS[k][0] && all[k] <= BOUNDS[k][1], k);
  assert.ok(all.wildThrow <= 0.1 && all.reach <= 0.6 && all.fieldWindow <= 1.4 && all.dDp <= 0.2);
  // A reach of 0.6 of the contest band can only move a ball that was already close: a ball away from the line stays a hit.
  for (const id of ["FIELD_WALL_REAPER", "FIELD_ACROBAT", "FIELD_CANNON_ARM"] as const) assert.equal(ABILITIES[id].role, "field");
});

test("a v5 log with field inputs replays byte for byte, and with none it plays as v4", () => {
  const log = (rules: 4 | 5, mk: (aw: Awaiting) => UserInput) => {
    const inputs: UserInput[] = [];
    for (let n = 0; n < 400; n++) {
      const g = play(11, inputs, rules);
      if (g.result) return { g, inputs };
      inputs.push(mk(g.awaiting!));
    }
    throw new Error("never finished");
  };
  const rich = (aw: Awaiting): UserInput => {
    if (aw.role !== "field") return basic(aw);
    const t = aw.ball!.throws;
    const chip = aw.abilities.find((a) => a.available);
    return { kind: "field", timing: 0.3, ...(t ? { throwTo: t.options[0] } : {}), ...(chip ? { ability: { id: chip.id } } : {}) };
  };
  const one = log(5, rich), two = log(5, rich);
  assert.ok(one.inputs.some((i) => i.kind === "field" && (i.throwTo || i.ability)), "the log really used the new inputs");
  assert.deepEqual(one.g.result, two.g.result);
  assert.deepEqual(playInteractive({ away, home, seed: 11, innings: 5, rules: 5, userSide: "home", inputs: one.inputs, startHeat: 100 }).result, one.g.result);
  const v4 = log(4, basic), v5 = log(5, basic);
  assert.deepEqual(v5.g.result!.events.map((e) => e.type === "ability" ? e : { ...e }), v4.g.result!.events);
  assert.deepEqual(v5.g.result!.box, v4.g.result!.box);
});
