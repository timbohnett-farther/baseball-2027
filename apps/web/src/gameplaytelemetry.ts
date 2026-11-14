// W36b: local-only gameplay telemetry. Observes the intents the UI submits and the events the sim emits; it never
// writes into the replay input log or sim state, and nothing here is sent anywhere or persisted. Pure bookkeeping
// (no React, no DOM) so the same collector runs in unit tests and in the node report script.
import { ABILITIES } from "@bb/sim";
import type { AbilityId, Awaiting, DisabledReason, GameEvent, Side, UserInput } from "@bb/sim";

export const TELEMETRY_SCHEMA = 1;

export type Actor = "user" | "cpu";
export type Control = "pitch" | "swing" | "take" | "field" | "steal" | "pickoff" | "advance" | "rally_breaker" | "ability_chip";
/** Typed rejection reasons. The first eight are the spec's; the rest map the sim's remaining DisabledReason codes. */
export type Reason =
  | "stale_phase" | "repeated_tap" | "wrong_ownership" | "invalid_possession" | "insufficient_heat" | "wrong_window" | "unavailable_target" | "windup_tap"
  | "insufficient_rally" | "cooldown" | "already_used" | "needs_direction";
export const REASONS: Reason[] = ["stale_phase", "repeated_tap", "wrong_ownership", "invalid_possession", "insufficient_heat", "wrong_window", "unavailable_target", "windup_tap", "insufficient_rally", "cooldown", "already_used", "needs_direction"];

const DISABLED: Record<DisabledReason, Reason> = {
  WRONG_CONTEXT: "wrong_window", WRONG_SWING: "wrong_window", INSUFFICIENT_HEAT: "insufficient_heat", INSUFFICIENT_RALLY: "insufficient_rally",
  COOLDOWN: "cooldown", ALREADY_USED: "already_used", SELECT_DIRECTION: "needs_direction", INELIGIBLE_ACTOR: "wrong_ownership",
};
/** The typed adapter for the sim's DisabledReason codes. Never reads UI text. */
export const reasonOf = (r: DisabledReason): Reason => DISABLED[r];

export const controlOf = (i: UserInput): Control =>
  i.kind === "swing" ? (i.swing === "take" ? "take" : "swing")
    : i.kind === "run" ? i.action
      : i.kind === "team" ? i.action : i.kind;

export type Outcome = "accepted" | Reason;

/** Phase-token check: `lastAccepted` is the token of the previous accepted intent (same commit frame when equal). */
export function classifyAppend(logLength: number, token: number, lastAccepted: number | null): Outcome {
  if (lastAccepted !== null && token === lastAccepted) return "repeated_tap";
  return token === logLength ? "accepted" : "stale_phase";
}

const ROLE: Record<string, Awaiting["role"]> = { pitch: "pitch", swing: "swing", field: "field" };

/** Would the sim accept this input right now? Mirrors the checks the UI already makes; observational only. */
export function classifyIntent(input: UserInput, a: Awaiting | null): Outcome {
  if (!a) return "wrong_window";
  const c = controlOf(input);
  if (c === "advance") return a.role === "run" ? "accepted" : "invalid_possession";
  if (c === "steal") return a.role === "swing" && a.run?.steal.some((r) => r.base === (input as { from: string }).from) ? "accepted" : a.role === "swing" ? "unavailable_target" : "invalid_possession";
  if (c === "pickoff") return a.role === "pitch" && a.run?.pickoff.some((r) => r.base === (input as { at: string }).at) ? "accepted" : a.role === "pitch" ? "unavailable_target" : "invalid_possession";
  if (c === "rally_breaker") {
    if (a.role !== "pitch" && a.role !== "swing") return "wrong_window";
    return !a.team ? "wrong_window" : a.team.available ? "accepted" : a.team.reason ? reasonOf(a.team.reason) : "unavailable_target";
  }
  if (a.role !== ROLE[input.kind]) return "invalid_possession";
  const req = "ability" in input ? input.ability : undefined;
  if (req) {
    const s = a.abilities.find((x) => x.id === req.id);
    if (!s) return "unavailable_target";
    if (!s.available) return s.reason ? reasonOf(s.reason) : "unavailable_target";
  }
  return "accepted";
}

/** Local, in-memory flow markers. "result_*" are the result screen's own steps; none leave the device. */
export type FlowName = "start" | "resume" | "tutorial" | "half_start" | "final" | "saved" | "result_shown" | "result_reward_shown" | "result_repeat_no_reward" | "result_continue";
type Counts = Record<string, number>;
const bump = (o: Counts, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

export interface HeatLedger {
  reserved: number; released: number; refunded: number; spent: number; outstanding: number;
  /** A commit with no matching reservation (should stay 0), and a submitted ability with no reservation. */
  commitWithoutReservation: number; unreservedSubmits: number;
  /** event.heat after a commit vs. the previous snapshot's heat minus the ability cost. */
  heatChecks: number; heatMismatches: number;
}

export interface Snapshot {
  schema: number;
  matches: number;
  /** Per control: accepted/rejected per actor, rejections by reason. User counts come from submitted intents, CPU from events. */
  commands: Record<Actor, Counts>;
  rejected: Record<string, Counts>; // control -> reason -> n (user intents only)
  abilities: Record<Actor, Record<string, { arm: number; cancel: number; commit: number; triggered: number; expired: number; rejected: number }>>;
  heat: { user: HeatLedger; cpu: { spent: number } };
  conservation: { ok: boolean; detail: string };
  rallyBreaker: Record<Actor, number>;
  hints: Counts;
  flow: Counts;
  innings: number;
  durationEstimateMs: { wall: number; basis: "wall_clock_first_to_last_event" };
}

const ledger = (): HeatLedger => ({ reserved: 0, released: 0, refunded: 0, spent: 0, outstanding: 0, commitWithoutReservation: 0, unreservedSubmits: 0, heatChecks: 0, heatMismatches: 0 });
const abil = () => ({ arm: 0, cancel: 0, commit: 0, triggered: 0, expired: 0, rejected: 0 });

export class GameplayTelemetry {
  private s: Snapshot;
  private armed: { id: AbilityId; cost: number } | null = null;
  private submitted: { id: AbilityId; cost: number } | null = null;
  private lastAccepted: number | null = null;
  private cursor = 0;
  private skipExisting = false;
  private prevHeat: Record<number, number> | null = null;
  private t0: number | null = null;
  private t1: number | null = null;
  private userSide: Side = "away";
  private now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; this.s = this.blank(); }

  private blank(): Snapshot {
    return {
      schema: TELEMETRY_SCHEMA, matches: 0, commands: { user: {}, cpu: {} }, rejected: {}, abilities: { user: {}, cpu: {} },
      heat: { user: ledger(), cpu: { spent: 0 } }, conservation: { ok: true, detail: "" }, rallyBreaker: { user: 0, cpu: 0 },
      hints: {}, flow: {}, innings: 0, durationEstimateMs: { wall: 0, basis: "wall_clock_first_to_last_event" },
    };
  }

  /** Begin observing a match. `resumed` = the saved inputs were replayed, so events already in the log are not this session's. */
  startMatch(userSide: Side, resumed = false) {
    this.s = this.blank(); this.s.matches = 1;
    this.armed = this.submitted = null; this.lastAccepted = null; this.cursor = 0; this.prevHeat = null;
    this.skipExisting = resumed; this.userSide = userSide; this.t0 = this.t1 = this.now();
    bump(this.s.flow, resumed ? "resume" : "start");
  }

  flow(name: FlowName) { bump(this.s.flow, name); }
  hint(id: string) { bump(this.s.hints, id); }

  /** The user submitted an input. `token` is the phase token the tap carried, `logLength` the log length at commit time. */
  submit(input: UserInput, awaiting: Awaiting | null, token: number, logLength: number): Outcome {
    let out = classifyAppend(logLength, token, this.lastAccepted);
    if (out === "accepted") out = classifyIntent(input, awaiting);
    const c = controlOf(input);
    if (out !== "accepted") { this.reject(c, out); return out; }
    this.lastAccepted = token;
    this.accepted(input);
    return out;
  }

  /** An input the sim already accepted (the replay/report path, where no live Awaiting is at hand). */
  accepted(input: UserInput) {
    const c = controlOf(input);
    bump(this.s.commands.user, c);
    const req = "ability" in input ? input.ability : undefined;
    if (req) {
      const cost = ABILITIES[req.id].cost;
      if (this.armed?.id === req.id) { this.submitted = this.armed; this.armed = null; }
      else { this.s.heat.user.unreservedSubmits++; this.s.heat.user.reserved += cost; this.submitted = { id: req.id, cost }; }
    } else this.releaseArmed();
    if (c === "rally_breaker") this.s.rallyBreaker.user++;
  }

  /** Chip tapped while disabled: the typed reason from the chip's own status. */
  chipRejected(r: DisabledReason) { this.reject("ability_chip", reasonOf(r)); }
  /** A swing tap during the windup, which the UI ignores. */
  windupTap() { this.reject("swing", "windup_tap"); }

  /** Client-side arm. Re-arming another ability releases the first. */
  arm(id: AbilityId) {
    if (this.armed) this.releaseArmed();
    const cost = ABILITIES[id].cost;
    this.armed = { id, cost }; this.s.heat.user.reserved += cost; (this.s.abilities.user[id] ??= abil()).arm++;
  }
  /** Any client-side release of an armed ability: cancel, switch, take, approach change, unmount. */
  cancel() { if (this.armed) { const id = this.armed.id; this.releaseArmed(); this.s.abilities.user[id].cancel++; } }
  private releaseArmed() { if (this.armed) { this.s.heat.user.released += this.armed.cost; this.armed = null; } }

  private reject(c: Control, r: Reason) { bump((this.s.rejected[c] ??= {}), r); }

  /** Observe the full event list of the match so far (a growing, deterministic prefix); only new events are counted. */
  observeEvents(events: readonly GameEvent[]) {
    if (this.skipExisting) { this.cursor = events.length; this.skipExisting = false; this.prevHeat = events.at(-1)?.state.heat ?? null; return; }
    for (; this.cursor < events.length; this.cursor++) this.event(events[this.cursor]);
    this.t1 = this.now();
  }

  private event(e: GameEvent) {
    const st = e.state, mine = (side: Side) => (side === this.userSide ? "user" : "cpu") as Actor;
    this.s.innings = Math.max(this.s.innings, st.inning);
    if (e.type === "half_start") bump(this.s.flow, "half_start");
    else if (e.type === "final") bump(this.s.flow, "final");
    else if (e.type === "pitch") {
      const pitching: Side = st.half === "top" ? "home" : "away", batting: Side = st.half === "top" ? "away" : "home";
      if (mine(pitching) === "cpu") bump(this.s.commands.cpu, "pitch");
      if (mine(batting) === "cpu") bump(this.s.commands.cpu, e.result === "swinging_strike" || e.result === "foul" || e.result === "in_play" ? "swing" : "take");
    } else if (e.type === "run") { if (mine(e.side) === "cpu" && (e.action === "steal" || e.action === "pickoff" || e.action === "advance")) bump(this.s.commands.cpu, e.action); }
    else if (e.type === "team") { if (mine(e.side) === "cpu") { bump(this.s.commands.cpu, "rally_breaker"); this.s.rallyBreaker.cpu++; } }
    else if (e.type === "ability") this.ability(e, mine(e.side));
    this.prevHeat = st.heat;
  }

  private ability(e: Extract<GameEvent, { type: "ability" }>, who: Actor) {
    const a = (this.s.abilities[who][e.ability] ??= abil());
    const cost = ABILITIES[e.ability].cost, L = this.s.heat.user;
    if (e.phase === "committed") {
      a.commit++;
      if (who === "cpu") this.s.heat.cpu.spent += cost;
      else if (this.submitted?.id === e.ability) { L.spent += cost; this.submitted = null; }
      else { L.commitWithoutReservation++; L.reserved += cost; L.spent += cost; }
      if (this.prevHeat && this.prevHeat[e.playerId] !== undefined) { L.heatChecks++; if (e.heat !== this.prevHeat[e.playerId] - cost && who === "user") L.heatMismatches++; }
    } else if (e.phase === "rejected") {
      a.rejected++;
      if (who === "user") { if (e.reason) bump((this.s.rejected.ability_chip ??= {}), reasonOf(e.reason)); if (this.submitted?.id === e.ability) { L.refunded += cost; this.submitted = null; } }
    } else if (e.phase === "triggered") a.triggered++;
    else {
      a.expired++;
      if (who === "user" && this.submitted?.id === e.ability) { L.refunded += cost; this.submitted = null; }
    }
  }

  snapshot(): Snapshot {
    const L = this.s.heat.user;
    L.outstanding = (this.armed?.cost ?? 0) + (this.submitted?.cost ?? 0);
    const lhs = L.reserved, rhs = L.released + L.refunded + L.spent + L.outstanding;
    this.s.conservation = { ok: lhs === rhs && L.outstanding >= 0, detail: `reserved ${lhs} = released ${L.released} + refunded ${L.refunded} + spent ${L.spent} + outstanding ${L.outstanding}` };
    if (this.t0 !== null && this.t1 !== null) this.s.durationEstimateMs.wall = this.t1 - this.t0;
    return JSON.parse(JSON.stringify(this.s));
  }
}

/** Sum snapshots (counters add; flags and detail are recomputed). For the node report. */
export function mergeSnapshots(list: Snapshot[]): Snapshot {
  const sum = (a: unknown, b: unknown): unknown => {
    if (typeof a === "number" && typeof b === "number") return a + b;
    if (a && b && typeof a === "object" && typeof b === "object") {
      const o: Record<string, unknown> = { ...(a as object) };
      for (const k of Object.keys(b)) o[k] = k in o ? sum(o[k], (b as Record<string, unknown>)[k]) : (b as Record<string, unknown>)[k];
      return o;
    }
    return typeof b === "string" || typeof b === "boolean" ? b : a;
  };
  const m = list.reduce((acc, s) => sum(acc, s) as Snapshot);
  const L = m.heat.user;
  m.conservation = { ok: list.every((s) => s.conservation.ok) && L.reserved === L.released + L.refunded + L.spent + L.outstanding, detail: `reserved ${L.reserved} = released ${L.released} + refunded ${L.refunded} + spent ${L.spent} + outstanding ${L.outstanding}` };
  return m;
}

export const gameplayTelemetry = new GameplayTelemetry();

/** Dev only: expose `window.__gameplayTelemetry()`. */
export function installGameplayTelemetry() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __gameplayTelemetry?: () => Snapshot };
  if (!w.__gameplayTelemetry) w.__gameplayTelemetry = () => gameplayTelemetry.snapshot();
}
