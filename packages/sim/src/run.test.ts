import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CURRENT_RULES, playInteractive } from "./game.ts";
import { BOUNDS, ABILITIES } from "./ability.ts";
import type { Awaiting, GameEvent, SimPlayer, SimTeam, UserInput } from "./types.ts";

let nextId = 5000;
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

const pitchIn: UserInput = { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } };
const swing: UserInput = { kind: "swing", swing: "contact", timing: 0 };
const take: UserInput = { kind: "swing", swing: "take", timing: 0 };
const AB = { id: "RUN_AFTERBURNER" } as const;
const steal = (from: "first" | "second" | "third", ability?: typeof AB): UserInput => ({ kind: "run", action: "steal", from: from as "first" | "second", ...(ability ? { ability } : {}) });
const advance = (send: ("first" | "second" | "third")[], ability?: typeof AB): UserInput => ({ kind: "run", action: "advance", send, ...(ability ? { ability } : {}) });

const play = (seed: number, inputs: UserInput[], userSide: "home" | "away" = "away", extra: { autoField?: boolean; rules?: 5 | 6; startHeat?: number } = {}) =>
  playInteractive({ away, home, seed, innings: 5, rules: 6, userSide, inputs, startHeat: 100, ...extra });
const runEvents = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { type: "run" }> => e.type === "run");

/** Answer the plain questions (contact swings, fastballs, glove taps, hold everyone) until `stop` likes the awaiting. */
function until(seed: number, userSide: "home" | "away", stop: (a: Awaiting) => boolean, inputs: UserInput[] = []): UserInput[] | null {
  for (let guard = 0; guard < 600; guard++) {
    const g = play(seed, inputs, userSide);
    if (!g.awaiting) return null;
    if (stop(g.awaiting)) return inputs;
    const r = g.awaiting.role;
    inputs.push(r === "pitch" ? pitchIn : r === "field" ? { kind: "field", timing: 0 } : r === "run" ? advance([]) : swing);
  }
  return null;
}

const SEEDS = Array.from({ length: 120 }, (_, i) => i);
const stealSpots = () => SEEDS.flatMap((seed) => {
  const prefix = until(seed, "away", (a) => a.role === "swing" && !!a.run?.steal.length && a.state.outs < 2);
  return prefix ? [{ seed, prefix }] : [];
});

test("rules 6 is current and a v6 game with no run inputs plays exactly like v5", () => {
  assert.equal(CURRENT_RULES, 6);
  for (const side of ["home", "away"] as const) {
    const log: UserInput[] = [];
    const drive = (rules: 5 | 6) => {
      for (;;) {
        const g = play(3, log, side, { rules, autoField: true });
        if (g.result) return g.result;
        const r = g.awaiting!.role;
        log.push(r === "pitch" ? pitchIn : r === "field" ? { kind: "field", timing: 0 } : swing);
      }
    };
    const v6 = drive(6);
    const v5 = drive(5);
    assert.equal(hash(v6), hash(v5));
  }
});

test("steal: offered only with a runner and an open base, resolved by the log, ignored when invalid", () => {
  const spots = stealSpots();
  assert.ok(spots.length > 20, `found ${spots.length} spots`);
  for (const { seed, prefix } of spots.slice(0, 20)) {
    const a = play(seed, prefix).awaiting!;
    for (const o of a.run!.steal) {
      assert.equal(a.state.bases[o.base], o.runnerId);
      const to = o.base === "first" ? "second" : "third";
      assert.equal(a.state.bases[to], null);
      assert.ok(o.chance >= 0.3 && o.chance <= 0.9);
    }
    const o = a.run!.steal[0];
    const g = play(seed, [...prefix, steal(o.base), take]);
    const ev = runEvents(g.events);
    assert.equal(ev.length, 1);
    assert.ok(ev[0].action === "steal" || ev[0].action === "caught");
    assert.equal(ev[0].runnerId, o.runnerId);
    const to = o.base === "first" ? "second" : "third";
    if (ev[0].action === "steal") assert.equal(ev[0].state.bases[to], o.runnerId);
    else { assert.equal(ev[0].state.outs, a.state.outs + 1); assert.equal(ev[0].state.bases[o.base], null); }
  }
  // A steal from a base with no runner on it is skipped without a trace.
  const { seed, prefix } = spots[0];
  const a = play(seed, prefix).awaiting!;
  const empty = a.state.bases.first === null ? "first" : a.state.bases.second === null ? "second" : null;
  assert.ok(empty);
  const noop = play(seed, [...prefix, { kind: "run", action: "steal", from: empty }, take]);
  assert.equal(runEvents(noop.events).length, 0);
  assert.equal(hash(noop.events), hash(play(seed, [...prefix, take]).events));
});

test("steal: success rate sits near the stated odds, and Heat moves +15 / -12", () => {
  let tries = 0, wins = 0, expected = 0;
  for (const { seed, prefix } of stealSpots()) {
    const a = play(seed, prefix).awaiting!;
    const o = a.run!.steal[0];
    const g = play(seed, [...prefix, steal(o.base), take]);
    const ev = runEvents(g.events)[0];
    tries++; expected += o.chance; if (ev.action === "steal") wins++;
    assert.equal(ev.state.heat[o.runnerId], Math.max(0, Math.min(100, (a.state.heat[o.runnerId] ?? 0) + (ev.action === "steal" ? 15 : -12))) );
  }
  assert.ok(tries >= 60);
  assert.ok(Math.abs(wins / tries - expected / tries) < 0.12, `${wins}/${tries} vs ${(expected / tries).toFixed(2)}`);
});

test("afterburner: never worse on the same roll, about +10 points on average, capped, costs 40 Heat", () => {
  assert.equal(BOUNDS.run[1], 0.1);
  assert.equal(ABILITIES.RUN_AFTERBURNER.cost, 40);
  let tries = 0, plain = 0, boosted = 0, expectedGain = 0;
  for (const { seed, prefix } of stealSpots()) {
    const a = play(seed, prefix).awaiting!;
    const o = a.run!.steal[0];
    assert.ok(o.boost <= 0.92 && o.boost >= o.chance && o.boost - o.chance <= 0.1 + 1e-9);
    assert.ok(o.afterburner?.available);
    const base = runEvents(play(seed, [...prefix, steal(o.base), take]).events)[0];
    const g = play(seed, [...prefix, steal(o.base, AB), take]);
    const withAb = runEvents(g.events)[0];
    tries++; expectedGain += o.boost - o.chance;
    if (base.action === "steal") plain++;
    if (withAb.action === "steal") boosted++;
    assert.ok(!(base.action === "steal" && withAb.action === "caught"), "the same roll can only get better");
    const spent = (a.state.heat[o.runnerId] ?? 0) - 40 + (withAb.action === "steal" ? 15 : -12);
    assert.equal(withAb.state.heat[o.runnerId], Math.max(0, Math.min(100, spent)));
    assert.ok(g.events.some((e) => e.type === "ability" && e.phase === "committed" && e.ability === "RUN_AFTERBURNER"));
  }
  const gain = (boosted - plain) / tries;
  assert.ok(gain > 0 && gain < 0.2, `measured gain ${gain.toFixed(3)} over ${tries}`);
  assert.ok(Math.abs(gain - expectedGain / tries) < 0.06, `measured ${gain.toFixed(3)} vs stated ${(expectedGain / tries).toFixed(3)}`);
});

test("afterburner: a runner without the Heat is refused and nothing is spent", () => {
  let checked = 0;
  for (const seed of SEEDS) {
    const inputs: UserInput[] = [];
    const base = { away, home, seed, innings: 5, rules: 6 as const, userSide: "away" as const };
    let a: Awaiting | undefined;
    for (let guard = 0; guard < 600 && !a; guard++) {
      const g = playInteractive({ ...base, inputs, startHeat: 30 });
      if (!g.awaiting) break;
      if (g.awaiting.role === "swing" && g.awaiting.run?.steal.length && (g.awaiting.state.heat[g.awaiting.run.steal[0].runnerId] ?? 0) < 40) a = g.awaiting;
      else inputs.push(g.awaiting.role === "pitch" ? pitchIn : g.awaiting.role === "field" ? { kind: "field", timing: 0 } : g.awaiting.role === "run" ? advance([]) : swing);
    }
    if (!a) continue;
    const o = a.run!.steal[0];
    assert.equal(o.afterburner?.available, false);
    assert.equal(o.afterburner?.reason, "INSUFFICIENT_HEAT");
    const g = playInteractive({ ...base, inputs: [...inputs, steal(o.base, AB)], startHeat: 30 });
    const rej = g.events.find((e) => e.type === "ability" && e.phase === "rejected");
    assert.ok(rej);
    const ev = runEvents(g.events)[0];
    assert.equal(ev.state.heat[o.runnerId], Math.max(0, (a.state.heat[o.runnerId] ?? 0) + (ev.action === "steal" ? 15 : -12)));
    if (++checked >= 8) break;
  }
  assert.ok(checked >= 3);
});

test("pickoff: user pitching can throw over, at most twice a batter; a throw rarely gets anyone", () => {
  let throws = 0, outs = 0, spots = 0;
  for (const seed of SEEDS) {
    const prefix = until(seed, "home", (a) => a.role === "pitch" && !!a.run?.pickoff.length);
    if (!prefix) continue;
    const a = play(seed, prefix, "home").awaiting!;
    assert.equal(a.run!.pickoffsLeft, 2);
    assert.deepEqual(a.run!.steal, []);
    const at = a.run!.pickoff[0].base;
    const g = play(seed, [...prefix, ...Array(3).fill({ kind: "run", action: "pickoff", at })], "home");
    const ev = runEvents(g.events);
    assert.ok(ev.length >= 1 && ev.length <= 2, "the third throw is refused");
    spots++;
    for (const e of ev) { throws++; if (e.action === "pickoff") { outs++; assert.equal(e.state.bases[at], null); assert.equal(e.state.outs, a.state.outs + 1); } else assert.equal(e.action, "hold"); if (e.action === "pickoff") break; }
  }
  assert.ok(spots >= 30);
  assert.ok(outs / throws < 0.2, `${outs}/${throws}`);
});

test("tag-up and send: holding keeps runners put, sending is a real gamble", () => {
  let sent = 0, scored = 0, thrownOut = 0, spots = 0;
  for (const seed of SEEDS) {
    const prefix = until(seed, "away", (a) => a.role === "run" && a.run?.advance?.kind === "fly" && a.run.advance.runners.some((r) => r.base === "third"));
    if (!prefix) continue;
    const a = play(seed, prefix).awaiting!;
    spots++;
    const hold = play(seed, [...prefix, advance([])]);
    const holdPlay = hold.events.filter((e) => e.type === "play").at(-1)!;
    assert.ok(holdPlay.type === "play" && holdPlay.outcome === "flyout" && holdPlay.runs === 0);
    assert.equal(holdPlay.state.bases.third, a.state.bases.third);
    const go = play(seed, [...prefix, advance(["third"])]);
    const p = go.events.filter((e) => e.type === "play").at(-1)!;
    assert.ok(p.type === "play");
    sent++;
    if (p.runs === 1) { scored++; assert.equal(p.outcome, "sac_fly"); }
    else { thrownOut++; assert.equal(p.state.outs, a.state.outs + 1); assert.match(p.text, /thrown out/); }
  }
  assert.ok(spots >= 10, `${spots}`);
  assert.ok(scored > 0 && thrownOut >= 0 && scored / sent > 0.5 && scored / sent < 1 || thrownOut === 0, `${scored}/${sent}`);
});

test("send on a single: runner from second is thrown out or scores; held runners move one base", () => {
  let spots = 0, scoredN = 0, outN = 0;
  for (const seed of SEEDS) {
    const prefix = until(seed, "away", (a) => a.role === "run" && a.run?.advance?.outcome === "single" && a.run.advance.runners.some((r) => r.base === "second"));
    if (!prefix) continue;
    const a = play(seed, prefix).awaiting!;
    spots++;
    const hold = play(seed, [...prefix, advance([])]).events.filter((e) => e.type === "play").at(-1)!;
    assert.ok(hold.type === "play");
    assert.equal(hold.state.bases.third, a.state.bases.second);
    const go = play(seed, [...prefix, advance(["second"], AB)]).events.filter((e) => e.type === "play").at(-1)!;
    assert.ok(go.type === "play");
    const sentOpt = a.run!.advance!.runners.find((r) => r.base === "second")!;
    assert.ok(sentOpt.boost - sentOpt.chance <= 0.1 + 1e-9 && sentOpt.boost <= 0.92);
    if (go.runs > 0) scoredN++; else if (go.state.outs > a.state.outs) outN++;
  }
  assert.ok(spots >= 5);
  assert.ok(scoredN + outN === spots, `${scoredN}+${outN} vs ${spots}`);
});

test("afterburner on a send with nobody sent is refused for free", () => {
  for (const seed of SEEDS) {
    const prefix = until(seed, "away", (a) => a.role === "run");
    if (!prefix) continue;
    const a = play(seed, prefix).awaiting!;
    const g = play(seed, [...prefix, advance([], AB)]);
    const p = g.events.filter((e) => e.type === "play").at(-1)!;
    const runner = a.run!.advance!.runners[0].runnerId;
    assert.equal(p.state.heat[runner], a.state.heat[runner] ?? 0);
    assert.ok(!g.events.some((e) => e.type === "ability" && e.ability === "RUN_AFTERBURNER"));
    return;
  }
  assert.fail("no send/hold spot found");
});

/** A whole game with steals, throw-overs, sends and Afterburner, answered by a fixed policy. */
function scripted(seed: number, userSide: "home" | "away") {
  const inputs: UserInput[] = [];
  for (let guard = 0; guard < 3000; guard++) {
    const g = play(seed, inputs, userSide);
    if (g.result) return { inputs, result: g.result };
    const a = g.awaiting!, n = inputs.length, last = inputs[n - 1];
    const fresh = !(last?.kind === "run" && last.action !== "advance");
    if (fresh && a.role === "swing" && a.run?.steal.length) { inputs.push(steal(a.run.steal[0].base, n % 2 === 0 ? AB : undefined)); continue; }
    if (fresh && a.role === "pitch" && a.run?.pickoff.length) { inputs.push({ kind: "run", action: "pickoff", at: a.run.pickoff[0].base }); continue; }
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: ((n * 7) % 11) / 8 - 0.6, y: 0 } }
      : a.role === "field" ? { kind: "field", timing: ((n % 5) - 2) / 2 }
        : a.role === "run" ? advance(a.run!.advance!.runners.filter((_, i) => (n + i) % 2 === 0).map((r) => r.base), n % 3 === 0 ? AB : undefined)
          : { kind: "swing", swing: n % 6 === 0 ? "take" : "contact", timing: ((n % 9) - 4) / 4 });
  }
  throw new Error("never ended");
}

test("rules 6: a log with steals, throw-overs and sends replays to the same game", () => {
  const a = scripted(11, "away"), b = scripted(11, "away");
  assert.deepEqual(a.inputs, b.inputs);
  assert.equal(hash(a.result), hash(b.result));
  assert.ok(a.inputs.some((i) => i.kind === "run" && i.action === "steal"));
  assert.ok(a.inputs.some((i) => i.kind === "run" && i.action === "advance" && i.send.length));
  // Replaying the finished log in one go (what the server does) agrees.
  assert.equal(hash(play(11, a.inputs, "away", { autoField: true }).result), hash(a.result));
  const h = scripted(5, "home");
  assert.ok(h.inputs.some((i) => i.kind === "run" && i.action === "pickoff"));
  assert.equal(hash(play(5, h.inputs, "home", { autoField: true }).result), hash(h.result));
});

test("rules 6: golden pin for a scripted baserunning log", () => {
  const a = scripted(11, "away"), h = scripted(5, "home");
  assert.equal(hash([a.result, h.result]), "9ba01f59d9fd590a");
});
