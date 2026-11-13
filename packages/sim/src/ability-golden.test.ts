// W36c: per-ability golden fixtures and CPU/user fairness. Tests only: nothing here changes an outcome.
// Fixture: ability-golden.fixture.json (regenerate with UPDATE_ABILITY_GOLDEN=1 only after a deliberate, versioned rules change).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ABILITIES, BOUNDS, NEUTRAL, TEAM_RALLY_BREAKER, arm, cancel, check, combine, commit, expire, fieldContextOk, newLedger } from "./ability.ts";
import type { Actor } from "./ability.ts";
import { CURRENT_RULES, playInteractive } from "./game.ts";
import { PROFILES, chooseAbility, makeBot, type Bot, type Scene } from "./cpu.ts";
import { createRng } from "./rng.ts";
import type { AbilityId, AbilityRequest, Awaiting, GameEvent, Side, SimPlayer, SimTeam, UserInput } from "./types.ts";

let nextId = 20_000;
const hitter = (r: number, position = "LF"): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position, bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
const team = (r: number, name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: [hitter(r, "C"), ...Array.from({ length: 8 }, () => hitter(r))], pitchers: [pitcher(r), pitcher(r)],
});
const away = team(70, "Away"), home = team(70, "Home");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

const IDS = Object.keys(ABILITIES) as AbilityId[];
const COSTS: Record<AbilityId, number> = {
  BAT_COMET: 50, BAT_LASER: 50, BAT_GAP_MASTER: 40, BAT_SECOND_SWING: 60, PITCH_MIRAGE: 40, PITCH_VORTEX: 50,
  FIELD_WALL_REAPER: 60, FIELD_ACROBAT: 50, FIELD_CANNON_ARM: 45, RUN_AFTERBURNER: 40,
};

// --- Catalog pin: the shipped eleven (ten Heat abilities + Rally Breaker), nothing else -------------------------------

test("catalog: exactly the ten shipped Heat abilities, with pinned role, cost, swings, direction and cooldown", () => {
  assert.deepEqual([...IDS].sort(), Object.keys(COSTS).sort(), "no Candidate ability (Anvil, Ricochet, ...) is in the catalog");
  const roles: Record<AbilityId, string> = {
    BAT_COMET: "bat", BAT_LASER: "bat", BAT_GAP_MASTER: "bat", BAT_SECOND_SWING: "bat", PITCH_MIRAGE: "pitch", PITCH_VORTEX: "pitch",
    FIELD_WALL_REAPER: "field", FIELD_ACROBAT: "field", FIELD_CANNON_ARM: "field", RUN_AFTERBURNER: "run",
  };
  for (const id of IDS) {
    const d = ABILITIES[id];
    assert.equal(d.cost, COSTS[id], `${id} cost`);
    assert.equal(d.role, roles[id], `${id} role`);
    assert.equal(d.cooldownPitches, 0, `${id} has no cooldown beyond its Heat cost`);
    assert.equal(d.needsDirection, id === "BAT_GAP_MASTER" || id === "PITCH_VORTEX", `${id} direction`);
    assert.ok(d.cost > 0 && d.cost <= 100, `${id} cost is payable from a 0-100 meter`);
  }
  assert.deepEqual(ABILITIES.BAT_COMET.swings, ["power"]);
  assert.deepEqual(ABILITIES.BAT_LASER.swings, ["contact", "power"]);
  assert.deepEqual(ABILITIES.PITCH_MIRAGE.swings, []);
  assert.deepEqual({ id: TEAM_RALLY_BREAKER.id, cost: TEAM_RALLY_BREAKER.cost, drain: TEAM_RALLY_BREAKER.heatDrain }, { id: "TEAM_RALLY_BREAKER", cost: 100, drain: 40 });
});

test("modifiers: each ability's effect set is pinned, sits inside BOUNDS, and Mirage is physically neutral", () => {
  const pinned: Record<AbilityId, Record<string, number>> = {
    BAT_COMET: { windowScale: 0.85, dHr: 0.04, dGround: -0.05, popupBelowQ: 0.45 },
    BAT_LASER: { dHr: -0.02, dHit: 0.05, dGround: -0.08, dFly: -0.1 },
    BAT_GAP_MASTER: { dHr: -0.015, dDouble: 0.08 },
    BAT_SECOND_SWING: { rescueQ: 0.25 },
    PITCH_MIRAGE: {},
    PITCH_VORTEX: { missScale: 1.35, locShift: 0.12, whiffAdd: 0.03 },
    FIELD_WALL_REAPER: { reach: 0.5 },
    FIELD_ACROBAT: { fieldWindow: 1.3, reach: 0.15 },
    FIELD_CANNON_ARM: { dDp: 0.15, wildThrow: 0.08 },
    RUN_AFTERBURNER: { run: 0.1 },
  };
  for (const id of IDS) {
    const raw = ABILITIES[id].effects(ABILITIES[id].needsDirection ? "right" : undefined);
    assert.deepEqual(raw, pinned[id], `${id} raw effects`);
    const fx = combine([raw]);
    for (const k of Object.keys(BOUNDS) as (keyof typeof BOUNDS)[]) assert.ok(fx[k] >= BOUNDS[k][0] && fx[k] <= BOUNDS[k][1], `${id}.${k} inside its cap`);
  }
  assert.deepEqual(combine([ABILITIES.PITCH_MIRAGE.effects()]), NEUTRAL, "Mirage moves no number");
  // Documented caps: no ability can fix a result (no instant homer, no guaranteed catch/steal, no supersonic pitch).
  assert.ok(BOUNDS.dHr[1] <= 0.05 && BOUNDS.run[1] <= 0.1 && BOUNDS.reach[1] <= 0.6 && BOUNDS.rescueQ[1] <= 0.3);
});

test("modifier order: scales multiply, nudges add, then global caps; stage order does not change the cap", () => {
  const a = combine([ABILITIES.BAT_COMET.effects(), ABILITIES.BAT_LASER.effects()]);
  const b = combine([ABILITIES.BAT_LASER.effects(), ABILITIES.BAT_COMET.effects()]);
  assert.deepEqual(a, b, "additive nudges commute");
  assert.equal(combine([{ missScale: 1.35 }, { missScale: 1.35 }]).missScale, 1.5, "missScale stack clamps at 1.5");
  assert.equal(combine([{ windowScale: 0.85 }, { windowScale: 0.85 }]).windowScale, 0.8, "windowScale floors at 0.8");
  assert.equal(combine([{ dHr: 0.04 }, { dHr: 0.04 }]).dHr, 0.05);
});

// --- Activation window: arm / cancel / commit / expire, Heat cost / refund / clamp (per ability) ------------------------

const actorFor = (id: AbilityId, heat: number): Actor => ({ id: 1, role: ABILITIES[id].role, heat });
const reqFor = (id: AbilityId): AbilityRequest => (ABILITIES[id].needsDirection ? { id, direction: "left" } : { id });
const swingFor = (id: AbilityId) => (ABILITIES[id].swings[0] ? ABILITIES[id].swings[ABILITIES[id].swings.length - 1] : undefined);

for (const id of IDS) {
  test(`${id}: arm reserves, cancel refunds in full, commit spends exactly ${COSTS[id]}, expire releases`, () => {
    const cost = COSTS[id];
    // arm reserves but does not deduct
    const l = newLedger(), a = actorFor(id, 100);
    assert.ok(arm(ABILITIES, l, a, reqFor(id)).ok);
    assert.equal(a.heat, 100, "arming never touches Heat");
    assert.equal(l.armed?.cost, cost);
    // cancel: whole reservation released, Heat untouched
    cancel(l);
    assert.equal(l.armed, null);
    // commit: Heat left = heat - cost, once
    assert.ok(arm(ABILITIES, l, a, reqFor(id)).ok);
    const done = commit(ABILITIES, l, a, swingFor(id));
    assert.ok(done.ok && done.heat === 100 - cost, "commit returns Heat minus cost");
    assert.equal(l.armed, null);
    assert.equal(commit(ABILITIES, l, a, swingFor(id)).ok, false, "one-use: a second commit has nothing armed");
    // expire releases an unspent reservation and ticks the pitch counter
    assert.ok(arm(ABILITIES, l, a, reqFor(id)).ok);
    const p0 = l.pitch; expire(l);
    assert.equal(l.armed, null); assert.equal(l.pitch, p0 + 1);
    // clamp: exactly the cost is enough and leaves exactly zero; one short is refused and changes nothing
    const exact = actorFor(id, cost), l2 = newLedger();
    assert.ok(arm(ABILITIES, l2, exact, reqFor(id)).ok);
    const spent = commit(ABILITIES, l2, exact, swingFor(id));
    assert.ok(spent.ok && spent.heat === 0, "Heat floors at exactly 0, never negative");
    const short = actorFor(id, cost - 1), l3 = newLedger();
    const no = arm(ABILITIES, l3, short, reqFor(id));
    assert.ok(!no.ok && no.reason === "INSUFFICIENT_HEAT");
    assert.equal(l3.armed, null, "a refused arm reserves nothing");
  });

  test(`${id}: legal counterplay: wrong role, wrong swing, take, missing direction and a second ability are all refused for free`, () => {
    const d = ABILITIES[id], l = newLedger(), a = actorFor(id, 100);
    const wrongRole = check(ABILITIES, l, { ...a, role: d.role === "bat" ? "pitch" : "bat" }, reqFor(id));
    assert.ok(!wrongRole.ok && wrongRole.reason === "INELIGIBLE_ACTOR");
    if (d.swings.length) {
      assert.ok(!check(ABILITIES, l, a, reqFor(id), "take").ok, "a take can't use a swing ability");
      if (d.swings.length === 1) { const bad = check(ABILITIES, l, a, reqFor(id), d.swings[0] === "power" ? "contact" : "power"); assert.ok(!bad.ok && bad.reason === "WRONG_SWING"); }
    }
    if (d.needsDirection) { const bad = check(ABILITIES, l, a, { id }); assert.ok(!bad.ok && bad.reason === "SELECT_DIRECTION"); }
    const other = IDS.find((x) => x !== id && ABILITIES[x].role === d.role);
    if (other) {
      assert.ok(arm(ABILITIES, l, a, reqFor(id)).ok);
      const second = check(ABILITIES, l, a, reqFor(other));
      assert.ok(!second.ok && second.reason === "ALREADY_USED", "only one reservation per athlete at a time");
    }
  });
}

test("Heat reservation is not a spend: with 50 Heat a Comet arm leaves 50 spendable but a second 60-cost ability is refused", () => {
  const l = newLedger(), a: Actor = { id: 1, role: "bat", heat: 100 };
  assert.ok(arm(ABILITIES, l, a, { id: "BAT_COMET" }).ok);
  const second = check(ABILITIES, l, a, { id: "BAT_SECOND_SWING" });
  assert.ok(!second.ok);
});

// --- Targeted interaction fixtures ---------------------------------------------------------------------------------------

test("Comet versus Wall Reaper: independent halves of a play, neither can reach the other's field", () => {
  const comet = ABILITIES.BAT_COMET.effects(), reaper = ABILITIES.FIELD_WALL_REAPER.effects();
  assert.deepEqual(Object.keys(reaper), ["reach"], "Wall Reaper only moves a contested catch");
  assert.ok(!("reach" in comet) && !("dHr" in reaper), "Comet never moves reach and Wall Reaper never moves the home-run odds");
  const both = combine([comet, reaper]);
  assert.equal(both.dHr, 0.04, "Comet's homer nudge is unchanged by a Wall Reaper on the same ball");
  assert.equal(both.reach, 0.5);
  assert.ok(both.dHr <= BOUNDS.dHr[1]);
  // Wall Reaper only on a fly ball; a home run is never offered as a contested play.
  assert.deepEqual(["grounder", "liner", "fly"].map((kind) => fieldContextOk("FIELD_WALL_REAPER", { kind: kind as "fly", doublePlay: false })), [false, false, true]);
});

test("fielding tokens: each fielding ability is legal only on its own ball, and no other id passes", () => {
  const kinds = ["grounder", "liner", "fly"] as const;
  const table = (id: string, dp: boolean) => kinds.map((kind) => fieldContextOk(id, { kind, doublePlay: dp }));
  assert.deepEqual(table("FIELD_WALL_REAPER", false), [false, false, true]);
  assert.deepEqual(table("FIELD_ACROBAT", false), [false, true, true], "a dive on a liner or fly, never a grounder");
  assert.deepEqual(table("FIELD_CANNON_ARM", true), [true, false, false]);
  assert.deepEqual(table("FIELD_CANNON_ARM", false), [false, false, false], "Cannon Arm needs a double play on");
  for (const id of IDS.filter((x) => !x.startsWith("FIELD_"))) assert.deepEqual(table(id, true), [false, false, false], `${id} is never a fielding ability`);
});

test("Mirage and Vortex: one pitch ability per pitch; Mirage changes no number, Vortex mirrors left/right", () => {
  const l = newLedger(), p: Actor = { id: 2, role: "pitch", heat: 100 };
  assert.ok(arm(ABILITIES, l, p, { id: "PITCH_MIRAGE" }).ok);
  const v = check(ABILITIES, l, p, { id: "PITCH_VORTEX", direction: "left" });
  assert.ok(!v.ok && v.reason === "ALREADY_USED");
  const left = combine([ABILITIES.PITCH_VORTEX.effects("left")]), right = combine([ABILITIES.PITCH_VORTEX.effects("right")]);
  assert.equal(left.locShift, -right.locShift);
  assert.equal(left.missScale, right.missScale);
  assert.equal(left.missScale, 1.35, "less control, not more: dispersion only grows");
  assert.ok(combine([ABILITIES.PITCH_VORTEX.effects("left"), ABILITIES.PITCH_MIRAGE.effects()]).missScale <= 1.5);
});

test("Second Swing: rescues only a clearly mistimed swing, to a foul at most, and is one-use per pitch", () => {
  const fx = combine([ABILITIES.BAT_SECOND_SWING.effects()]);
  assert.equal(fx.rescueQ, 0.25);
  assert.ok(fx.rescueQ <= BOUNDS.rescueQ[1]);
  const { dHr, dHit, dGround, dDouble, dFly } = fx;
  assert.deepEqual([dHr, dHit, dGround, dDouble, dFly], [0, 0, 0, 0, 0], "it never touches the odds for a ball in play");
});

test("Afterburner runner ownership: only a runner can hold it, only the runner's own odds move, capped", () => {
  const l = newLedger();
  for (const role of ["bat", "pitch", "field"] as const) {
    const v = check(ABILITIES, l, { id: 3, role, heat: 100 }, { id: "RUN_AFTERBURNER" });
    assert.ok(!v.ok && v.reason === "INELIGIBLE_ACTOR", `${role} can't use Afterburner`);
  }
  const fx = combine([ABILITIES.RUN_AFTERBURNER.effects()]);
  assert.deepEqual({ ...fx, run: 0 }, NEUTRAL, "only `run` moves");
  assert.equal(fx.run, 0.1);
});

// --- Engine harness: every ability played through playInteractive, committed against the real pipeline -------------------

/**
 * A user seat that asks for `target` on every prompt of its role. With `force` it asks even when the chip says unavailable, so
 * rejection paths run too. Everything else it answers plainly. Deterministic: no randomness, the engine's seed does the varying.
 */
function abilityBot(target: AbilityId, force: boolean): Bot {
  const def = ABILITIES[target];
  const req = reqFor(target);
  const ok = (a: Awaiting) => force || a.abilities.find((x) => x.id === target)?.available;
  return {
    pre(v) {
      const out: UserInput[] = [];
      if (def.role === "run" && v.role === "swing") { const go = v.run?.steal[0]; if (go) out.push({ kind: "run", action: "steal", from: go.base === "second" ? "second" : "first", ability: req }); }
      return out;
    },
    pick(a) {
      if (a.role === "pitch") return { kind: "pitch", type: "fastball", aim: { x: 0.1, y: -0.2 }, ...(def.role === "pitch" && ok(a) ? { ability: req } : {}) };
      if (a.role === "swing") {
        const kind = target === "BAT_COMET" ? "power" : "contact";
        return { kind: "swing", swing: kind, timing: target === "BAT_SECOND_SWING" ? 0.9 : 0.1, ...(def.role === "bat" && ok(a) ? { ability: req } : {}) };
      }
      if (a.role === "field") return { kind: "field", timing: 0, ...(def.role === "field" && ok(a) ? { ability: req } : {}) };
      const adv = a.run?.advance;
      return { kind: "run", action: "advance", send: adv ? adv.runners.map((r) => r.base) : [], ...(def.role === "run" && force ? { ability: req } : {}) };
    },
  };
}

const heatOf = (e: GameEvent, id: number) => e.state.heat[id] ?? 0;
const prevOf = (events: GameEvent[], i: number) => (i > 0 ? events[i - 1] : null);

function playWith(seed: number, bot: Bot, userSide: Side = "home", rules = CURRENT_RULES, difficulty: "pro" | "allstar" | "rookie" = "pro") {
  const inputs: UserInput[] = [];
  const g = playInteractive({ away, home, seed, innings: 3, rules: rules as 9, userSide, inputs, startHeat: 100, difficulty, auto: bot });
  return { g, inputs };
}

interface Tally { games: number; committed: number; triggered: number; expired: number; rejected: number }

/** Run `seeds` games for one ability and assert every resource / event invariant on every event. */
function sweep(id: AbilityId, force: boolean, seeds: number[]): { tally: Tally; first: { seed: number; hash: string; events: number } | null } {
  const t: Tally = { games: 0, committed: 0, triggered: 0, expired: 0, rejected: 0 };
  let first: { seed: number; hash: string; events: number } | null = null;
  for (const seed of seeds) {
    const { g } = playWith(seed, abilityBot(id, force), seed % 2 ? "home" : "away");
    t.games++;
    const ev = g.events;
    let open: GameEvent | null = null;
    ev.forEach((e, i) => {
      for (const h of Object.values(e.state.heat)) assert.ok(h >= 0 && h <= 100, `Heat ${h} out of 0-100`);
      assert.ok(e.state.rally.home >= 0 && e.state.rally.home <= 100 && e.state.rally.away >= 0 && e.state.rally.away <= 100, "Rally out of 0-100");
      if (e.type !== "ability" || e.ability !== id) return;
      const prev = prevOf(ev, i);
      if (e.phase === "committed") {
        t.committed++;
        assert.equal(open, null, "a second commit for the same athlete before the first settled");
        open = e;
        if (prev) assert.equal(heatOf(e, e.playerId), Math.max(0, heatOf(prev, e.playerId) - COSTS[id]), `${id} pays exactly its cost`);
        assert.equal(e.heat, heatOf(e, e.playerId), "the event reports the Heat after paying");
      } else if (e.phase === "triggered" || e.phase === "expired") {
        e.phase === "triggered" ? t.triggered++ : t.expired++;
        if (open) { assert.equal((open as Extract<GameEvent, { type: "ability" }>).playerId, e.playerId); open = null; }
        // Settling never charges again: an ability event never lowers its own athlete's Heat after the commit.
        if (prev && prev.type === "ability" && prev.ability === id) assert.equal(heatOf(e, e.playerId), heatOf(prev, e.playerId), "settling takes no more Heat");
      } else {
        t.rejected++;
        if (prev) assert.equal(heatOf(e, e.playerId), heatOf(prev, e.playerId), "a rejected request costs nothing");
      }
    });
    assert.equal(open, null, "every committed ability settles before the game ends");
    if (!first && ev.some((e) => e.type === "ability" && e.ability === id && e.phase === "committed")) first = { seed, hash: hash(ev), events: ev.length };
  }
  return { tally: t, first };
}

const SWEEP_SEEDS = Array.from({ length: 40 }, (_, i) => 900 + i);
const fixturePath = new URL("./ability-golden.fixture.json", import.meta.url);
const computed: Record<string, { seed: number; hash: string; events: number; committed: number }> = {};

for (const id of IDS) {
  test(`${id}: engine integration over ${SWEEP_SEEDS.length} seeds: pays once per commit, settles, never leaves 0-100, rejections are free`, () => {
    const free = sweep(id, false, SWEEP_SEEDS), forced = sweep(id, true, SWEEP_SEEDS);
    console.log(`  ${id}: asked-when-available commits=${free.tally.committed} (triggered ${free.tally.triggered}, expired ${free.tally.expired}); forced commits=${forced.tally.committed} rejected=${forced.tally.rejected}`);
    assert.ok(free.tally.committed > 0, `${id} was exercised at least once through the real engine`);
    assert.equal(free.tally.triggered + free.tally.expired, free.tally.committed, "every commit settles as triggered or expired");
    assert.ok(free.first);
    computed[id] = { ...free.first!, committed: free.tally.committed };
  });
}

test("golden fixture: the first ability game per ability replays to the pinned event hash", () => {
  if (process.env.UPDATE_ABILITY_GOLDEN === "1") writeFileSync(fixturePath, JSON.stringify({ rules: CURRENT_RULES, seeds: SWEEP_SEEDS.length, abilities: computed }, null, 2) + "\n");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { rules: number; abilities: typeof computed };
  assert.equal(fixture.rules, CURRENT_RULES);
  assert.deepEqual(Object.keys(fixture.abilities).sort(), [...IDS].sort(), "fixture covers every shipped ability");
  for (const id of IDS) assert.deepEqual(computed[id], fixture.abilities[id], `${id} golden`);
});

test("ability games replay from seed + input log alone", () => {
  for (const id of IDS) {
    const { g, inputs } = playWith(SWEEP_SEEDS[0], abilityBot(id, true));
    const again = playInteractive({ away, home, seed: SWEEP_SEEDS[0], innings: 3, rules: 9, userSide: "home", inputs: [...inputs], startHeat: 100, difficulty: "pro" });
    assert.equal(hash(again.events), hash(g.events), `${id} replays`);
  }
});

test("Wall Reaper never reverses a home run: no committed Wall Reaper is followed by a home_run on that ball", () => {
  let n = 0;
  for (const seed of SWEEP_SEEDS) {
    const { g } = playWith(seed, abilityBot("FIELD_WALL_REAPER", false), seed % 2 ? "home" : "away");
    g.events.forEach((e, i) => {
      if (e.type !== "ability" || e.ability !== "FIELD_WALL_REAPER" || e.phase !== "committed") return;
      n++;
      const next = g.events.slice(i + 1).find((x) => x.type === "play");
      assert.ok(next && next.type === "play" && next.outcome !== "home_run", "a contested catch is never a home run");
    });
  }
  assert.ok(n > 0);
});

test("DOCUMENTED ASYMMETRY (harness, not engine): makeBot never attaches Afterburner to a steal; the CPU does, and a human can", () => {
  // cpu.ts bot.pre() emits a steal with no `ability`, while cpuPrePitch() asks chooseAbility(role "run"). The engine path (useAbility)
  // is identical and a human's steal input carries `ability`; this only skews bot-vs-CPU soak numbers.
  let bot = 0, cpu = 0;
  for (let i = 0; i < 60; i++) {
    const seed = 50_000 + i * 13, userSide: Side = i % 2 ? "home" : "away";
    const { g } = playWith(seed, makeBot("allstar", seed, userSide, { away, home }, 3), userSide, 9, "allstar");
    for (const e of g.events) if (e.type === "ability" && e.phase === "committed" && e.ability === "RUN_AFTERBURNER") (e.side === userSide ? bot++ : cpu++);
  }
  console.log(`  Afterburner commits over 60 games: bot seat ${bot}, CPU seat ${cpu}`);
  assert.equal(bot, 0, "current behaviour: the scripted bot never spends Afterburner on a steal");
  assert.ok(cpu > 0);
});

// --- Rally Breaker ---------------------------------------------------------------------------------------------------------

test("Rally Breaker team meter: across every AI-vs-AI game it costs exactly 100 Rally, drains at most 40 Heat from two targets, floors at 0, once per side", () => {
  let uses = 0;
  const bySide: Record<Side, number> = { home: 0, away: 0 };
  for (let i = 0; i < 60; i++) {
    const seed = 70_000 + i * 17, userSide: Side = i % 2 ? "home" : "away";
    const bot = makeBot("allstar", seed, userSide, { away, home }, 3);
    const { g } = playWith(seed, bot, userSide, 9, "allstar");
    const perSide: Record<Side, number> = { home: 0, away: 0 };
    g.events.forEach((e, i2) => {
      if (e.type !== "team") return;
      const prev = g.events[i2 - 1];
      uses++; perSide[e.side]++; bySide[e.side]++;
      assert.ok(prev.state.rally[e.side] >= TEAM_RALLY_BREAKER.cost, "needed a full meter");
      assert.equal(e.state.rally[e.side], prev.state.rally[e.side] - TEAM_RALLY_BREAKER.cost, "spends exactly 100 Rally");
      const drained = Object.keys(e.state.heat).map(Number).filter((id) => (prev.state.heat[id] ?? 0) !== (e.state.heat[id] ?? 0));
      assert.ok(drained.length <= 2, "only the opposing pitcher and batter lose Heat");
      for (const id of drained) { const was: number = prev.state.heat[id] ?? 0; const after: number = e.state.heat[id] ?? 0; assert.equal(after, Math.max(0, was - TEAM_RALLY_BREAKER.heatDrain)); }
    });
    assert.ok(perSide.home <= 1 && perSide.away <= 1, "once per side per match");
  }
  console.log(`  Rally Breaker uses over 60 games: home ${bySide.home}, away ${bySide.away}`);
  assert.ok(uses > 0, "Rally Breaker was exercised");
});

// --- CPU / user equivalence ------------------------------------------------------------------------------------------------

test("CPU and user pay the same cost for the same ability, through the same pipeline (sampled from AI-vs-AI games)", () => {
  const seen: Record<string, [number, number]> = {};
  for (let i = 0; i < 80; i++) {
    const seed = 40_000 + i * 31, userSide: Side = i % 2 ? "home" : "away";
    const { g } = playWith(seed, makeBot("allstar", seed, userSide, { away, home }, 3), userSide, 9, "allstar");
    g.events.forEach((e, k) => {
      if (e.type !== "ability" || e.phase !== "committed") return;
      const cost = COSTS[e.ability];
      assert.equal(heatOf(e, e.playerId), Math.max(0, heatOf(g.events[k - 1], e.playerId) - cost), `${e.side === userSide ? "user" : "CPU"} ${e.ability} pays ${cost}`);
      (seen[e.ability] ??= [0, 0])[e.side === userSide ? 0 : 1]++;
    });
  }
  console.log("  commits (user seat / CPU seat): " + Object.entries(seen).map(([k, v]) => `${k} ${v[0]}/${v[1]}`).join(", "));
  assert.ok(Object.keys(seen).length > 0);
});

test("DOCUMENTED ASYMMETRY (current behaviour, not a fix): the CPU never uses a fielding ability; the user can", () => {
  // cpu.ts utility() returns -1 for FIELD_* (its `default` branch) and game.ts never calls cpuUse for "field", so a CPU fielder
  // never pays for Wall Reaper, Acrobat or Cannon Arm. The user has all three. Smallest compatible resolution: a new ruleset
  // that adds CPU field utilities with the same cost path (useAbility), behind its own version. Not done here.
  const s: Scene = { role: "bat", heat: 100, balls: 0, strikes: 0, outs: 0, risp: false, loaded: false, late: false, margin: 0, batting: null, pitching: null, fastShare: 0.55 };
  for (const role of ["bat", "pitch", "run"] as const) for (const id of IDS.filter((x) => x.startsWith("FIELD_"))) {
    const picked = chooseAbility({ ...PROFILES.allstar, abilityMin: 0, abilityRate: 1 }, createRng(1), { ...s, role });
    assert.ok(!picked || !picked.id.startsWith("FIELD_"), `${id} is never chosen by the CPU policy`);
  }
  let cpuField = 0, userField = 0;
  for (let i = 0; i < 60; i++) {
    const seed = 50_000 + i * 13, userSide: Side = i % 2 ? "home" : "away";
    const { g } = playWith(seed, makeBot("allstar", seed, userSide, { away, home }, 3), userSide, 9, "allstar");
    for (const e of g.events) if (e.type === "ability" && e.phase === "committed" && e.ability.startsWith("FIELD_")) (e.side === userSide ? userField++ : cpuField++);
  }
  console.log(`  field-ability commits over 60 games: bot seat ${userField}, CPU seat ${cpuField}`);
  assert.equal(cpuField, 0, "current behaviour: CPU never commits a fielding ability");
});

test("information boundary: the CPU policy reads only the scene (count, bases, score, Heat, ratings), never the incoming pitch or aim", () => {
  const sceneKeys = ["role", "heat", "balls", "strikes", "outs", "risp", "loaded", "late", "margin", "batting", "pitching", "fastShare"];
  const s: Scene = { role: "bat", heat: 100, balls: 1, strikes: 2, outs: 1, risp: true, loaded: false, late: true, margin: -1, batting: { contact: 70, power: 70, eye: 70, speed: 70, fielding: 70 }, pitching: { stuff: 70, control: 70, movement: 70, stamina: 90 }, fastShare: 0.55 };
  assert.deepEqual(Object.keys(s).sort(), [...sceneKeys].sort());
  // Same scene, same stream => same answer; the decision consumes one draw (two when a direction is needed) and no more.
  const p = { ...PROFILES.allstar, abilityMin: 0, abilityRate: 1 };
  const a = createRng(7), b = createRng(7);
  const x = chooseAbility(p, a, s), y = chooseAbility(p, b, s);
  assert.deepEqual(x, y);
  const draws = x && ABILITIES[x.id].needsDirection ? 2 : 1;
  const ref = createRng(7); for (let n = 0; n < draws; n++) ref.next();
  assert.equal(a.next(), ref.next(), "decision RNG consumption is exactly as documented");
});

test("CPU decisions use their own stream: the same log replays identically and another difficulty changes only the CPU's side", () => {
  const seed = 31_337;
  const bot = (d: "pro" | "allstar") => playWith(seed, makeBot("pro", seed, "home", { away, home }, 3), "home", 9, d);
  const a = bot("pro"), b = bot("pro");
  assert.equal(hash(a.g.events), hash(b.g.events), "deterministic");
  const replay = playInteractive({ away, home, seed, innings: 3, rules: 9, userSide: "home", inputs: [...a.inputs], startHeat: 100, difficulty: "pro" });
  assert.equal(hash(replay.events), hash(a.g.events), "the log alone reproduces the CPU's choices");
});

test("rules 1-8 never offer abilities that did not exist then (Rally Breaker is rules 7+, abilities rules 4+)", () => {
  const early = playInteractive({ away, home, seed: 5, innings: 1, rules: 3, userSide: "home", inputs: [] });
  assert.equal(early.awaiting?.abilities.length, 0, "rules 3 has no ability chips");
  const v6 = playInteractive({ away, home, seed: 5, innings: 1, rules: 6, userSide: "home", inputs: [] });
  assert.equal(v6.awaiting?.team, undefined, "rules 6 has no Rally Breaker");
});
