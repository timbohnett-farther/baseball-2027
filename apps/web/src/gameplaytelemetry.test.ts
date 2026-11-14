import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ABILITIES, CURRENT_RULES, makeBot, playInteractive, autoLineup } from "@bb/sim";
import type { AbilityStatus, Awaiting, GameEvent, SimPlayer, SimTeam, UserInput } from "@bb/sim";
import { GameplayTelemetry, classifyAppend, classifyIntent, mergeSnapshots, reasonOf, REASONS, type Reason } from "./gameplaytelemetry.ts";

const chip = (id: string, over: Partial<AbilityStatus> = {}): AbilityStatus => ({ id, name: id, cost: ABILITIES[id as "AFTERBURNER"]?.cost ?? 30, summary: "", needsDirection: false, swings: [], available: true, ...over }) as AbilityStatus;
const aw = (role: Awaiting["role"], over: Partial<Awaiting> = {}): Awaiting => ({ role, batterId: 1, pitcherId: 2, state: {} as never, incoming: null, ball: null, super: null, abilities: [], ...over });
const pitch: UserInput = { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } as never };
const swing: UserInput = { kind: "swing", swing: "contact", timing: 0 };
const ids = Object.keys(ABILITIES);

test("classifyAppend: stale phase, repeated tap in one commit frame, accepted", () => {
  assert.equal(classifyAppend(3, 3, null), "accepted");
  assert.equal(classifyAppend(4, 3, null), "stale_phase");
  assert.equal(classifyAppend(3, 3, 3), "repeated_tap");
});

test("every typed reason is produced", () => {
  const seen = new Set<Reason>();
  const t = new GameplayTelemetry(() => 0); t.startMatch("away");
  const note = (o: string) => { if (o !== "accepted") seen.add(o as Reason); return o; };
  note(t.submit(pitch, aw("pitch"), 0, 0)); // accepted; token 0 now used
  note(t.submit(pitch, aw("pitch"), 0, 1)); // repeated_tap
  note(t.submit(pitch, aw("pitch"), 0, 2)); // stale (token 0 vs len 2) -> repeated first, so use a fresh token
  note(t.submit(pitch, aw("pitch"), 1, 5)); // stale_phase
  note(t.submit(swing, aw("pitch"), 5, 5)); // invalid_possession
  note(t.submit({ kind: "run", action: "steal", from: "first" }, aw("swing", { run: { steal: [], pickoff: [], pickoffsLeft: 0, advance: null } }), 5, 5)); // unavailable_target
  note(t.submit({ kind: "team", action: "rally_breaker" }, aw("pitch", { team: { available: false, reason: "INSUFFICIENT_RALLY" } as never }), 5, 5)); // insufficient_rally
  note(t.submit(swing, null, 5, 5)); // wrong_window
  const reason = (r: Parameters<typeof reasonOf>[0], role: Awaiting["role"] = "swing") => note(classifyIntent({ ...swing, ability: { id: ids[0] as never } }, aw(role, { abilities: [chip(ids[0], { available: false, reason: r })] })));
  reason("INSUFFICIENT_HEAT"); reason("WRONG_CONTEXT"); reason("COOLDOWN"); reason("ALREADY_USED"); reason("SELECT_DIRECTION"); reason("INELIGIBLE_ACTOR");
  t.windupTap();
  const snap = t.snapshot();
  for (const m of Object.values(snap.rejected)) for (const k of Object.keys(m)) seen.add(k as Reason);
  assert.deepEqual([...REASONS].filter((r) => !seen.has(r)), []);
  assert.equal(snap.rejected.swing.windup_tap, 1);
});

test("reasonOf maps each sim DisabledReason to a typed reason", () => {
  assert.equal(reasonOf("INSUFFICIENT_HEAT"), "insufficient_heat");
  assert.equal(reasonOf("WRONG_SWING"), "wrong_window");
  assert.equal(reasonOf("INELIGIBLE_ACTOR"), "wrong_ownership");
  assert.equal(reasonOf("SELECT_DIRECTION"), "needs_direction");
});

test("repeated tap in one commit frame is counted once", () => {
  const t = new GameplayTelemetry(() => 0); t.startMatch("away");
  for (let i = 0; i < 4; i++) t.submit(pitch, aw("pitch"), 7, 7);
  const s = t.snapshot();
  assert.equal(s.commands.user.pitch, 1);
  assert.equal(s.rejected.pitch.repeated_tap, 3);
});

const ev = (type: string, state: object, extra: object = {}) => ({ type, state: { inning: 1, half: "top", heat: { 9: 50 }, rally: { away: 0, home: 0 }, ...state }, ...extra }) as unknown as GameEvent;

test("ability transitions and Heat conservation: arm, cancel, commit, reject, expire", () => {
  const id = ids[0] as never, cost = ABILITIES[id as "AFTERBURNER"].cost;
  const t = new GameplayTelemetry(() => 0); t.startMatch("away");
  t.arm(id); t.cancel();                                            // released
  t.arm(id); t.submit({ ...swing, ability: { id } }, aw("swing", { abilities: [chip(id)] }), 0, 0); // submitted
  const committed = ev("ability", {}, { phase: "committed", side: "away", playerId: 9, ability: id, heat: 50 - cost });
  t.observeEvents([committed]); // spent
  t.arm(id); t.submit({ ...swing, ability: { id } }, aw("swing", { abilities: [chip(id)] }), 1, 1);
  t.observeEvents([committed, ev("ability", {}, { phase: "rejected", side: "away", playerId: 9, ability: id, heat: 20, reason: "INSUFFICIENT_HEAT" })]);
  const s = t.snapshot();
  assert.equal(s.abilities.user[id].arm, 3); assert.equal(s.abilities.user[id].cancel, 1); assert.equal(s.abilities.user[id].commit, 1);
  assert.equal(s.heat.user.released, cost); assert.equal(s.heat.user.spent, cost); assert.equal(s.heat.user.refunded, cost);
  assert.equal(s.heat.user.heatMismatches, 0);
  assert.ok(s.conservation.ok, s.conservation.detail);
  assert.equal(s.heat.user.outstanding, 0);
  assert.equal(s.rejected.ability_chip.insufficient_heat, 1);
  // an armed-but-unsent ability is outstanding, still conserved
  t.arm(id);
  assert.equal(t.snapshot().heat.user.outstanding, cost); assert.ok(t.snapshot().conservation.ok);
});

test("a take releases an armed ability and expired refunds a submitted one", () => {
  const id = ids[0] as never, t = new GameplayTelemetry(() => 0); t.startMatch("away");
  t.arm(id); t.submit({ kind: "swing", swing: "take", timing: 0 }, aw("swing"), 0, 0);
  assert.equal(t.snapshot().heat.user.released, ABILITIES[id as "AFTERBURNER"].cost);
  t.arm(id); t.submit({ ...swing, ability: { id } }, aw("swing", { abilities: [chip(id)] }), 1, 1);
  t.observeEvents([ev("ability", {}, { phase: "expired", side: "away", playerId: 9, ability: id, heat: 50 })]);
  const s = t.snapshot();
  assert.equal(s.heat.user.refunded, ABILITIES[id as "AFTERBURNER"].cost); assert.ok(s.conservation.ok);
});

test("CPU and user actions are attributed separately; resumed matches skip replayed events", () => {
  const p = (half: string, result: string) => ev("pitch", { half }, { result });
  const events = [ev("half_start", {}), p("top", "called_strike"), p("top", "foul"), p("bottom", "ball"), ev("team", {}, { side: "home", action: "rally_breaker" }), ev("ability", {}, { phase: "committed", side: "home", playerId: 9, ability: ids[0], heat: 5 })];
  const t = new GameplayTelemetry(() => 0); t.startMatch("away");
  t.observeEvents(events); t.observeEvents(events); // deduped
  const s = t.snapshot();
  assert.equal(s.commands.cpu.pitch, 2); // top: home (cpu) pitches twice
  assert.equal(s.commands.cpu.take, 1); assert.equal(s.commands.cpu.swing, undefined);
  assert.equal(s.commands.user.pitch, undefined); // user counts only from submitted intents
  assert.equal(s.rallyBreaker.cpu, 1); assert.equal(s.rallyBreaker.user, 0);
  assert.equal(s.abilities.cpu[ids[0]].commit, 1); assert.equal(s.abilities.user[ids[0]], undefined);
  const r = new GameplayTelemetry(() => 0); r.startMatch("away", true);
  r.observeEvents(events); r.observeEvents([...events, p("top", "ball")]);
  assert.equal(r.snapshot().commands.cpu.pitch, 1);
});

test("mergeSnapshots sums counters and rechecks conservation", () => {
  const mk = () => { const t = new GameplayTelemetry(() => 0); t.startMatch("away"); t.submit(pitch, aw("pitch"), 0, 0); return t.snapshot(); };
  const m = mergeSnapshots([mk(), mk(), mk()]);
  assert.equal(m.matches, 3); assert.equal(m.commands.user.pitch, 3); assert.ok(m.conservation.ok);
});

// Replay-hash invariance: the collector observes a match and never feeds back into it.
const hitter = (id: number, r: number): SimPlayer => ({ id, name: `H${id}`, lastName: `H${id}`, position: "LF", bats: "R", batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null });
const arm = (id: number, r: number): SimPlayer => ({ id, name: `P${id}`, lastName: `P${id}`, position: "P", bats: "R", batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 } });
const side = (base: number, r: number): SimTeam => ({ name: "T", abbr: "TTT", color: "#fff", lineup: autoLineup(Array.from({ length: 9 }, (_, i) => hitter(base + i, r))), pitchers: [arm(base + 20, r), arm(base + 21, r)] });

test("telemetry attached vs. not attached: identical replay hashes over several seeds", () => {
  const h = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  for (const seed of [1, 2, 3, 17, 4242, 90210]) for (const userSide of ["away", "home"] as const) {
    const away = side(100, 70), home = side(200, 70);
    const run = (attach: boolean) => {
      const inputs: UserInput[] = [];
      const g = playInteractive({ away, home, seed, innings: 3, rules: CURRENT_RULES, difficulty: "pro", userSide, inputs, auto: makeBot("pro", seed, userSide, { away, home }, 3) });
      if (attach) { const t = new GameplayTelemetry(() => 0); t.startMatch(userSide); t.observeEvents(g.events); for (const i of inputs) t.submit(i, null, 0, 1); t.snapshot(); }
      return h({ events: g.events, inputs, result: g.result });
    };
    assert.equal(run(true), run(false), `seed ${seed} ${userSide}`);
  }
});
