// Pitch-by-pitch arcade game. Pure: same teams + same seed = the same game, every time.
//
// Each pitch: the pitcher hits the zone (Control), the batter decides to swing (Eye),
// makes contact or whiffs (Contact vs. Stuff), fouls it off or puts it in play.
// Balls in play become hits or outs (Power and Contact vs. Movement and team defense),
// and runners advance by their Speed. Ratings are on the 40-99 scale, 70 = average regular.

import { createRng, type Rng } from "./rng.ts";
import { call, describe } from "./text.ts";
import { ABILITIES, BOUNDS, TEAM_RALLY_BREAKER, arm as armAbility, cancel, combine, commit, expire, fieldContextOk, newLedger, statuses, type AbilityDef, type Effects, type FieldContext, type Ledger } from "./ability.ts";
import { PROFILES, chooseAbility, pitchTypeFor, profileOf, sceneOf, swingFor, zoneAim, type Bot, type CpuProfile } from "./cpu.ts";
import type {
  AbilityRequest, Aim, Awaiting, Base, Bases, BattingLine, BoxScore, DisabledReason, Difficulty, GameEvent, GameResult, GameState, InteractiveGame, Outcome,
  PitchingLine, PitchResult, PitchShot, PitchType, PlayShot, RulesVersion, RunnerOption, RunOptions, Side, SimPlayer, SimTeam, TeamStatus, Tier, UserInput,
} from "./types.ts";

export const DEFAULT_INNINGS = 3;
/** Rules v1 stops here and calls it a tie. Only used when `rules` is 1: saved games depend on it. */
const MAX_INNINGS = 9;

/**
 * The ruleset a game is played under. Saved games are re-simulated from seed + inputs, so a rules
 * change must never alter a game recorded under an older version: gate it on `c.rules`.
 *  1 = original: ties after 9 innings, no run-ahead rule.
 *  2 = ARC 3: no ties (extra innings until a winner), 10-run run-ahead rule from inning 2.
 *  3 = PUP: Heat (0-100) and Rally are visible resources only. They never touch hit odds, and Super Bats do nothing.
 *  4 = PUP abilities: the user can spend Heat on a bat or pitch ability (see ability.ts). A game that never uses one plays exactly as v3.
 *  5 = ARC 7 fielding: a force-play throw choice on close grounders, and the fielding abilities (Wall Reaper, Acrobat, Cannon Arm).
 *      A v5 game whose fielding inputs carry neither a throw nor an ability plays exactly as v4.
 *  6 = ARC 8 baserunning: the user's runners can steal (batting) and the user's pitcher can throw over (pitching), and the user
 *      chooses who to send on a hit or tag up on a fly out. Afterburner rides on a steal or a send. Every extra choice is optional in
 *      a replay (autoField), so a v6 log with no run inputs plays exactly as v5. The computer never steals.
 *  7 = ARC 11 / PUP 11+14: three CPU difficulties (cpu.ts), the computer spends Heat on abilities and steals and throws over in
 *      interactive games (its own seeded stream, so replays match), and Rally Breaker. A v7 log that never uses a team input at the
 *      "pro" difficulty with the computer's extras out of reach plays as v6 would; auto-sims (no user seat) are identical to v6.
 *  8 = W29: the throw-over limit (two) resets for every batter instead of lasting the whole match, for both sides.
 *  9 = W29b: balance pass (TUNE9: shorter at-bats, more balls in play and hits, slower Rally fill) and, for new seasons, home/away alternation.
 */
export const CURRENT_RULES: RulesVersion = 9;

/**
 * Every outcome knob rules 9 retunes, in one place (ARC 11.5-11.6 pace levers: at-bat length, contact/outcome mix, Rally fill).
 * TUNE8 is the behaviour of rules 1-8 and must never change; TUNE9 is the W29b balance pass (docs/ACCEPTANCE.md, Soak).
 */
interface Tune {
  /** Share of swung-at pitches that fouled off, in the zone and out of it (the user's own timing scales its foul chance by foulScale). */
  foulZone: number; foulOff: number; foulScale: number;
  /** Added to the contact chance on a swing. */
  contactAdd: number;
  /** Base chance a ball in play is a hit, and base home-run chance. */
  hit: number; hr: number;
  /** Added to the chance the pitcher throws a strike, and to the chance a batter swings at a strike (fewer walks and takes). */
  zoneAdd: number; swingAdd: number;
  /** Rally earned per positive Heat point (PUP 3.6 says 0.5). */
  rallyGain: number;
}
const TUNE8: Tune = { foulZone: 0.42, foulOff: 0.5, foulScale: 1, contactAdd: 0, zoneAdd: 0, swingAdd: 0, hit: 0.29, hr: 0.05, rallyGain: 0.5 };
const TUNE9: Tune = { foulZone: 0.25, foulOff: 0.32, foulScale: 0.65, contactAdd: 0.04, zoneAdd: 0.10, swingAdd: 0.08, hit: 0.35, hr: 0.06, rallyGain: 0.34 };
const tuneOf = (c: Ctx): Tune => (c.rules >= 9 ? TUNE9 : TUNE8);
/** Quick Match lengths; season and playoff games are always DEFAULT_INNINGS. */
export const INNINGS_OPTIONS = [1, 3, 5] as const;
const RUN_AHEAD = 10;
/**
 * Rules v2 safety net: extra innings past this many (regulation + 20) are decided by a seeded coin
 * flip that adds one run, so a game always ends. Two level 70-rated teams reach it about never.
 */
export const MAX_EXTRA_INNINGS = 20;

// How much a rating gap matters. Below 1 keeps upsets alive: an 80 team beats a 70 team
// about 2 games in 3 instead of 4 in 5 (arcade games should never feel decided at the draft).
const TALENT = 0.55;
const z = (rating: number | undefined) => (((rating ?? 70) - 70) / 10) * TALENT;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const other = (s: Side): Side => (s === "away" ? "home" : "away");

interface Ctx {
  rng: Rng;
  teams: Record<Side, SimTeam>;
  innings: number;
  rules: RulesVersion;
  /** Rules v2: set when the 10-run rule ended the game mid-inning. */
  runAhead: boolean;
  state: GameState;
  events: GameEvent[];
  lineupIdx: Record<Side, number>;
  pitcherIdx: Record<Side, number>;
  pitchCount: Map<number, number>;
  line: Record<Side, number[]>;
  hits: Record<Side, number>;
  batting: Record<Side, Map<number, BattingLine>>;
  pitching: Record<Side, Map<number, PitchingLine>>;
  over: boolean;
  /** Interactive mode: the user's side and their input log. `autoField` replays logs recorded before fielding existed. */
  user?: { side: Side; inputs: UserInput[]; cursor: number; autoField?: boolean; auto?: Bot };
  /** Interactive mode: how the user's last swing was timed, for the ball in play. */
  lastSwing?: { power: boolean; q: number; boost?: { contact: number; power: number }; fx?: Effects; /** Rules v7: a computer batter's ability: its effects apply but its swing never moved the hit odds. */ fxOnly?: boolean };
  /** Interactive mode: Super Power Bat charges left, and whether this at-bat spent one. */
  superLeft: number;
  superUsed: boolean;
  /** Interactive mode: how the user's last fielding tap changed the play. */
  lastField?: { fielderId: number; robbed: boolean; booted: boolean; out: boolean };
  /** Rules v3: the side getting Rally Assist, read at the start of the current pitch. */
  assist: Side | null;
  /** Rules v4: the user's Heat reservation and cooldowns, and the ability committed on the pitch in progress. */
  ledger: Ledger;
  /** Rules v6: pickoff throws made to the current batter. */
  pickoffs: number;
  active?: Active;
  /** Rules v7: the same, for the computer's own ability on this pitch. */
  cpuActive?: Active;
  /** Rules v7: the computer's difficulty profile (always "pro" below v7), its own decision stream, and its throw-overs so far. */
  difficulty: Difficulty;
  profile: CpuProfile;
  cpuRng: Rng;
  cpuPickoffs: number;
  /** Rules v7: Rally Breaker is once per side per match. */
  breaker: Record<Side, boolean>;
  /** Opt-in presentation facts (`shot` on events). Descriptive only: never read by the sim, never drawn from an RNG. */
  facts: boolean;
  pitchFacts?: PitchShot;
  ballFacts?: { kind: "grounder" | "fly" | "liner"; spray: number };
}

interface Active { def: AbilityDef; request: AbilityRequest; playerId: number; side: Side; fx: Effects; triggered: boolean }

/** Thrown in interactive mode when the log runs out; the caller turns it into "waiting for input". */
class NeedInput extends Error {
  awaiting: Awaiting;
  constructor(awaiting: Awaiting) { super("need input"); this.awaiting = awaiting; }
}

const snapshot = (s: GameState): GameState => ({ ...s, bases: { ...s.bases }, score: { ...s.score }, heat: { ...s.heat }, rally: { ...s.rally } });

// --- Heat and Rally: visible momentum, earned on the field and capped ---------------------------

const MAX_HEAT = 3;
const START_HEAT = 25, HEAT_CAP = 100, RALLY_CAP = 100;
const ASSIST_RUNS = 3, ASSIST_MULT = 1.25;
const heatOf = (c: Ctx, id: number) => c.state.heat[id] ?? 0;
function warm(c: Ctx, id: number, delta: number) {
  const h = clamp(heatOf(c, id) + delta, 0, MAX_HEAT);
  if (h > 0) c.state.heat[id] = h; else delete c.state.heat[id];
}
/** Rules v3 Rally Assist: the side trailing by 3+ runs, whose positive Heat awards pay x1.25. */
export const rallyAssist = (s: GameState): Side | null =>
  s.score.home - s.score.away >= ASSIST_RUNS ? "away" : s.score.away - s.score.home >= ASSIST_RUNS ? "home" : null;

/** One Heat award. Positive ones get the assist bonus and fill the team's Rally by half the base. */
function award(c: Ctx, side: Side, id: number, base: number) {
  if (base === 0) return;
  const n = base > 0 && c.assist === side ? Math.round(base * ASSIST_MULT) : base;
  c.state.heat[id] = clamp((c.state.heat[id] ?? START_HEAT) + n, 0, HEAT_CAP);
  if (base > 0) c.state.rally[side] = clamp(c.state.rally[side] + Math.floor(base * tuneOf(c).rallyGain), 0, RALLY_CAP);
}

/** Heat for what one pitch did on its own. Strikeouts and walks also get their final award in playHeat. */
function pitchHeat(c: Ctx, bSide: Side, fSide: Side, batter: SimPlayer, pitcher: SimPlayer, result: PitchResult, q: number | undefined) {
  const { balls, strikes } = c.state;
  const k = strikes === 3;
  if (result === "ball") { if (balls < 4) award(c, bSide, batter.id, 3); }
  else if (result === "called_strike") award(c, fSide, pitcher.id, 5);
  else if (result === "swinging_strike") { award(c, fSide, pitcher.id, 7); if (!k) award(c, bSide, batter.id, -5); }
  else if (result === "foul") { award(c, fSide, pitcher.id, 2); if ((q ?? 0) >= 0.45) award(c, bSide, batter.id, 4); }
}

const IN_PLAY_OUT: Outcome[] = ["groundout", "flyout", "lineout", "sac_fly", "double_play"];
/** Heat for how the plate appearance ended: the result, hard contact, fielders and runs scored. */
function playHeat(c: Ctx, bSide: Side, fSide: Side, batter: SimPlayer, pitcher: SimPlayer, outcome: Outcome, q: number | undefined, scored: number[]) {
  const hit = ["single", "double", "triple", "home_run"].includes(outcome);
  const inPlay = outcome !== "walk" && outcome !== "strikeout";
  if (outcome === "home_run") { award(c, bSide, batter.id, 25); award(c, fSide, pitcher.id, -20); }
  else if (hit) { award(c, bSide, batter.id, 15); award(c, fSide, pitcher.id, -8); }
  else if (outcome === "walk") { award(c, bSide, batter.id, 8); award(c, fSide, pitcher.id, -12); }
  else if (outcome === "strikeout") { award(c, bSide, batter.id, -20); award(c, fSide, pitcher.id, 10); }
  else if (IN_PLAY_OUT.includes(outcome)) { award(c, bSide, batter.id, 6); award(c, fSide, pitcher.id, 8); }
  if (inPlay && (q ?? 0) >= 0.78) award(c, bSide, batter.id, 5);
  const f = c.lastField;
  if (f && (f.robbed || f.out)) award(c, fSide, f.fielderId, f.robbed ? 12 : 6);
  for (const id of scored) award(c, bSide, id, 8);
}

/** Extra chance (+/-) on the batter's side of a matchup: his heat, less the pitcher's, plus being On Fire. Rules v3: none. */
const momentum = (c: Ctx, batter: SimPlayer, pitcher: SimPlayer) =>
  c.rules >= 3 ? 0 : 0.025 * (heatOf(c, batter.id) - heatOf(c, pitcher.id)) + (c.state.fire === battingSide(c) ? 0.05 : 0);
const battingSide = (c: Ctx): Side => (c.state.half === "top" ? "away" : "home");
const fieldingSide = (c: Ctx): Side => other(battingSide(c));
const pitcherOf = (c: Ctx, side: Side) => c.teams[side].pitchers[c.pitcherIdx[side]];
const findPlayer = (c: Ctx, id: number) =>
  [...c.teams.away.lineup, ...c.teams.home.lineup, ...c.teams.away.pitchers, ...c.teams.home.pitchers].find((p) => p.id === id)!;

function teamDefense(team: SimTeam): number {
  const f = team.lineup.map((p) => p.batting?.fielding ?? 60);
  return f.reduce((s, x) => s + x, 0) / Math.max(f.length, 1);
}

/** Pitches before a pitcher tires: about 46 for a 90-stamina starter, 36 for a 60-stamina reliever. */
const pitchLimit = (p: SimPlayer) => 15 + 0.35 * (p.pitching?.stamina ?? 60);

function bat(c: Ctx, side: Side, p: SimPlayer): BattingLine {
  const m = c.batting[side];
  if (!m.has(p.id)) m.set(p.id, { playerId: p.id, name: p.name, pos: p.position, ab: 0, r: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0 });
  return m.get(p.id)!;
}
function arm(c: Ctx, side: Side, p: SimPlayer): PitchingLine {
  const m = c.pitching[side];
  if (!m.has(p.id)) m.set(p.id, { playerId: p.id, name: p.name, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, pitches: 0 });
  return m.get(p.id)!;
}

// --- One pitch -----------------------------------------------------------------------

function throwPitch(c: Ctx, batter: SimPlayer, pitcher: SimPlayer): { result: PitchResult; zone: boolean; mph: number; q?: number } {
  const { rng } = c;
  const b = batter.batting, p = pitcher.pitching;
  const used = c.pitchCount.get(pitcher.id) ?? 0;
  const tired = clamp((used - pitchLimit(pitcher)) / 15, 0, 1); // fades over ~15 pitches past the limit
  const stuff = z(p?.stuff) - tired, control = z(p?.control) - tired;

  const t0 = tuneOf(c);
  const zone = rng.next() < clamp(0.5 + 0.05 * control, 0.35, 0.65) + t0.zoneAdd;
  const swing = zone
    ? rng.next() < clamp(0.68 + 0.03 * z(b?.eye), 0.5, 0.85) + t0.swingAdd
    : rng.next() < clamp(0.3 - 0.05 * z(b?.eye) + 0.03 * stuff, 0.1, 0.5);
  const fastball = rng.next() < 0.6;
  const mph = Math.round((fastball ? 93 + 0.3 * 10 * stuff : 85 + 0.2 * 10 * stuff) + (rng.next() - 0.5) * 4);

  if (!swing) return { result: zone ? "called_strike" : "ball", zone, mph };
  const mo = momentum(c, batter, pitcher), t = tuneOf(c);
  const contact = zone
    ? clamp(0.85 + 0.04 * z(b?.contact) - 0.05 * stuff + mo + t.contactAdd, 0.6, 0.97)
    : clamp(0.6 + 0.05 * z(b?.contact) - 0.06 * stuff + mo + t.contactAdd, 0.3, 0.85);
  if (rng.next() >= contact) return { result: "swinging_strike", zone, mph };
  const result = rng.next() < (zone ? t.foulZone : t.foulOff) ? "foul" : "in_play";
  return c.rules >= 3 ? { result, zone, mph, q: cpuContactQ(c, b?.contact, stuff) } : { result, zone, mph };
}

/** Rules v3 contact quality for swings nobody timed: only Heat reads it. */
const cpuContactQ = (c: Ctx, contact: number | undefined, stuff: number) =>
  clamp(0.55 + 0.1 * z(contact) - 0.1 * stuff + (c.rng.next() - 0.5) * 0.5, 0, 1);

// --- One pitch, with the user in the loop ----------------------------------------------------

const TYPE_MPH: Record<PitchType, number> = { fastball: 93, slider: 86, change: 82, curve: 79 };
/** Off-speed pitches fool hitters a bit more; fastballs are the safe pitch. */
const TYPE_WHIFF: Record<PitchType, number> = { fastball: 0, slider: 0.04, change: 0.03, curve: 0.05 };

/** A Super Swing is only allowed in a clutch spot: runners in scoring position, two strikes, or late in the game. */
export function isClutch(state: GameState, innings: number): boolean {
  return state.bases.second !== null || state.bases.third !== null || state.strikes === 2 || state.inning >= Math.min(7, innings);
}

function superInfo(c: Ctx, role: Awaiting["role"]): Awaiting["super"] {
  if (c.rules >= 3) return null;
  const bat = c.user && c.teams[c.user.side].gear?.superBat;
  if (!bat || role !== "swing") return null;
  return { bat: bat.name, charges: c.superLeft, clutch: isClutch(c.state, c.innings) };
}

/** Rules v7: Rally Breaker as the user sees it. The targets are the opposing pitcher and the opposing batter now up (or next). */
function breakerTargets(c: Ctx, opp: Side): SimPlayer[] {
  const t = c.teams[opp], idx = c.lineupIdx[opp] - (battingSide(c) === opp ? 1 : 0);
  return [pitcherOf(c, opp), t.lineup[idx % t.lineup.length]];
}

function teamStatus(c: Ctx): TeamStatus {
  const side = c.user!.side, rally = c.state.rally[side], T = TEAM_RALLY_BREAKER;
  const targets = breakerTargets(c, other(side)).map((p) => ({ id: p.id, heat: heatOf(c, p.id), loses: Math.min(T.heatDrain, heatOf(c, p.id)) }));
  const [reason, message] = c.breaker[side] ? ["ALREADY_USED" as const, "Rally Breaker is once per match."] : rally < T.cost ? ["INSUFFICIENT_RALLY" as const, `Needs ${T.cost} Rally, you have ${rally}.`] : [undefined, undefined];
  return { id: T.id, name: T.name, cost: T.cost, summary: T.summary, rally, available: !reason, ...(reason ? { reason, message } : {}), targets, needsConfirm: targets.every((t) => t.heat === 0) };
}

function buildAwaiting(c: Ctx, role: Awaiting["role"], batter: SimPlayer, pitcher: SimPlayer, incoming: Awaiting["incoming"], ball: Awaiting["ball"], choice: AdvanceChoice | null): Awaiting {
  const actor = role === "swing" ? { id: batter.id, role: "bat" as const } : role === "pitch" ? { id: pitcher.id, role: "pitch" as const }
    : ball && c.rules >= 5 ? { id: ball.fielderId, role: "field" as const } : null;
  let abilities = c.rules >= 4 && actor ? statuses(ABILITIES, c.ledger, { ...actor, heat: heatOf(c, actor.id) }) : [];
  if (actor?.role === "field" && ball) {
    const ctx: FieldContext = { kind: ball.kind, doublePlay: !!ball.throws };
    abilities = abilities.map((a) => fieldContextOk(a.id, ctx) ? a : { ...a, available: false, reason: "WRONG_CONTEXT", message: "Not on this play." });
  }
  return { role, batterId: batter.id, pitcherId: pitcher.id, state: snapshot(c.state), incoming, ball, super: superInfo(c, role), abilities, ...(c.rules >= 6 ? { run: runOptions(c, role, pitcher, choice) } : {}), ...(c.rules >= 7 && (role === "pitch" || role === "swing") ? { team: teamStatus(c) } : {}) };
}

function takeInput(c: Ctx, role: Awaiting["role"], batter: SimPlayer, pitcher: SimPlayer, incoming: Awaiting["incoming"], ball: Awaiting["ball"] = null, choice: AdvanceChoice | null = null): UserInput {
  const u = c.user!;
  if (!u.inputs[u.cursor]) {
    const aw = buildAwaiting(c, role, batter, pitcher, incoming, ball, choice);
    if (!u.auto) throw new NeedInput(aw);
    u.inputs.push(u.auto.pick(aw)); // a bot seat answers and logs, so the game is a plain input log afterwards
  }
  const next = u.inputs[u.cursor];
  if (next.kind !== role) throw new Error(`input ${u.cursor}: expected ${role}, got ${next.kind}`);
  u.cursor++;
  return next;
}

/**
 * Rules v4: commit the ability that rode along with a pitch or swing. A request that can't be honoured
 * (wrong swing, not enough Heat, ...) costs nothing and just logs why; the pitch carries on without it.
 * Returns the bounded effects to apply, or null.
 */
function useAbility(c: Ctx, role: "bat" | "pitch" | "field" | "run", who: SimPlayer, side: Side, req: AbilityRequest | undefined, swing?: "contact" | "power" | "take", field?: FieldContext, cpu = false): Effects | null {
  if (c.rules < 4 || !req) return null;
  const actor = { id: who.id, role, heat: heatOf(c, who.id) };
  const name = ABILITIES[req.id]?.name ?? "Ability";
  const note = (phase: "committed" | "triggered" | "expired" | "rejected", text: string, reason?: DisabledReason) =>
    c.events.push({ type: "ability", state: snapshot(c.state), phase, side, playerId: who.id, ability: req.id, heat: heatOf(c, who.id), ...(reason ? { reason } : {}), text });
  if (swing === "take") { note("expired", `${who.name} lets it go. ${name} is released and costs no Heat.`); return null; }
  const v = field && !fieldContextOk(req.id, field) ? { ok: false as const, reason: "WRONG_CONTEXT" as const, message: "Not on this play." } : armAbility(ABILITIES, c.ledger, actor, req);
  const done = v.ok ? commit(ABILITIES, c.ledger, actor, swing) : v;
  if (!done.ok || done.heat === undefined || !done.def) {
    cancel(c.ledger);
    const r = done.ok ? { reason: "WRONG_CONTEXT" as const, message: "Nothing happened." } : done;
    note("rejected", `${name} can't be used: ${r.message} No Heat spent.`, r.reason);
    return null;
  }
  const dir = req.direction ? ` ${req.direction}` : "";
  c.state.heat[who.id] = done.heat;
  const fx = combine([done.def.effects(req.direction)]);
  const slot = { def: done.def, request: req, playerId: who.id, side, fx, triggered: role === "pitch" || role === "run" };
  if (cpu) c.cpuActive = slot; else c.active = slot;
  note("committed", `${who.name} uses ${name}${dir}! ${done.def.cost} Heat spent.`);
  return fx;
}

/** Rules v4: close out the pitch's ability. It either took effect or fizzled, and the cost is spent either way (PUP 4.6). */
function settleAbility(c: Ctx, inPlay: boolean, cpu = false) {
  const a = cpu ? c.cpuActive : c.active;
  if (cpu) c.cpuActive = undefined; else c.active = undefined;
  if (cpu || a?.def.role === "field" || a?.def.role === "run") cancel(c.ledger); else expire(c.ledger); // a fielding or running play isn't a pitch: cooldowns don't tick (and the computer's use rides on the user's pitch tick)
  if (!a) return;
  const hit = a.triggered || (inPlay && a.def.role === "bat" && a.def.id !== "BAT_SECOND_SWING");
  const name = a.def.name;
  c.events.push({ type: "ability", state: snapshot(c.state), phase: hit ? "triggered" : "expired", side: a.side, playerId: a.playerId, ability: a.def.id, heat: heatOf(c, a.playerId),
    text: hit ? `${name} takes effect.` : `${name} found nothing to work with. The Heat is spent.` });
}

const inZone = (a: Aim) => Math.abs(a.x) <= 1 && Math.abs(a.y) <= 1;

/** Rules v7: the computer decides on an ability for this pitch (own stream) and, if it takes one, pays for it like a person would. */
function cpuUse(c: Ctx, role: "bat" | "pitch", who: SimPlayer, side: Side, batter: SimPlayer, pitcher: SimPlayer | null): Effects | null {
  const scene = sceneOf(c.state, c.innings, role, side, heatOf(c, who.id), batter.batting, (pitcher ?? who).pitching, c.profile);
  const req = chooseAbility(c.profile, c.cpuRng, scene);
  return req ? useAbility(c, role, who, side, req, role === "bat" ? swingFor(req.id) : undefined, undefined, true) : null;
}

function throwUserPitch(c: Ctx, batter: SimPlayer, pitcher: SimPlayer): { result: PitchResult; zone: boolean; mph: number; q?: number } {
  const { rng, state } = c;
  const b = batter.batting, p = pitcher.pitching;
  const used = c.pitchCount.get(pitcher.id) ?? 0;
  const tired = clamp((used - pitchLimit(pitcher)) / 15, 0, 1);
  const stuff = z(p?.stuff) - tired, control = z(p?.control) - tired;
  const userPitching = fieldingSide(c) === c.user!.side;

  let type: PitchType, loc: Aim, mph: number;
  let swingKind: "contact" | "power" | "take" | null = null, q = 0;
  let boost: { contact: number; power: number } | undefined;
  let pfx: Effects | null = null, bfx: Effects | null = null;
  if (userPitching) {
    const inp = takeInput(c, "pitch", batter, pitcher, null) as Extract<UserInput, { kind: "pitch" }>;
    type = inp.type;
    pfx = useAbility(c, "pitch", pitcher, fieldingSide(c), inp.ability);
    // Where it actually lands: the aim plus a miss that shrinks with Control.
    const miss = clamp(0.5 - 0.15 * control, 0.2, 0.8) * (pfx?.missScale ?? 1);
    loc = { x: clamp(inp.aim.x, -1.6, 1.6) + (rng.next() + rng.next() - 1) * miss + (pfx?.locShift ?? 0), y: clamp(inp.aim.y, -1.6, 1.6) + (rng.next() + rng.next() - 1) * miss };
    mph = Math.round(TYPE_MPH[type] + 3 * stuff + (rng.next() - 0.5) * 4);
  } else {
    // The computer pitches. Roll the pitch first so the user can see it coming.
    const cpuFx = c.rules >= 7 ? cpuUse(c, "pitch", pitcher, fieldingSide(c), batter, null) : null;
    const prof = c.profile;
    const r = rng.next();
    type = pitchTypeFor(prof, r);
    const zone = rng.next() < clamp((0.5 + 0.05 * control + prof.zone) / (cpuFx?.missScale ?? 1), 0.35, 0.65) + tuneOf(c).zoneAdd;
    const edge = () => (rng.next() < 0.5 ? -1 : 1) * (1.05 + rng.next() * 0.5);
    loc = zone ? zoneAim(prof, rng.next() * 2 - 1, rng.next() * 2 - 1)
      : rng.next() < 0.5 ? { x: edge(), y: (rng.next() * 2 - 1) * 1.4 } : { x: (rng.next() * 2 - 1) * 1.4, y: edge() };
    if (cpuFx) loc = { x: loc.x + cpuFx.locShift, y: loc.y };
    mph = Math.round(TYPE_MPH[type] + 3 * stuff + (rng.next() - 0.5) * 4);
    pfx = cpuFx;
    // Mirage: the label is hidden from the user's batter until the ball is nearly on them.
    const inp = takeInput(c, "swing", batter, pitcher, { type: c.cpuActive?.def.id === "PITCH_MIRAGE" ? null : type, mph, aim: loc }) as Extract<UserInput, { kind: "swing" }>;
    swingKind = inp.swing;
    q = 1 - Math.min(1, Math.abs(inp.timing));
    bfx = useAbility(c, "bat", batter, battingSide(c), inp.ability, swingKind);
    if (bfx && bfx.windowScale < 1) q = 1 - Math.min(1, (1 - q) / bfx.windowScale); // a wider window forgives the same timing
    // A Super Swing spends a charge (clutch spots only; an illegal request is just a normal swing).
    const sb = c.teams[c.user!.side].gear?.superBat;
    if (inp.super && sb && swingKind !== "take" && c.superLeft > 0 && isClutch(c.state, c.innings)) {
      c.superLeft--; c.superUsed = true;
      boost = { contact: sb.contact, power: sb.power };
      q = 0.5 + 0.5 * q; // the bat forgives timing
    }
  }

  const zone = inZone(loc);
  c.pitchFacts = { type, x: Math.round(loc.x * 100) / 100, y: Math.round(loc.y * 100) / 100 };
  const edge = zone ? clamp((Math.max(Math.abs(loc.x), Math.abs(loc.y)) - 0.6) / 0.4, 0, 1) : 0;
  const swing = swingKind
    ? swingKind !== "take"
    : zone ? rng.next() < clamp(0.68 + 0.03 * z(b?.eye) + c.profile.zoneSwing + (state.strikes === 2 ? c.profile.protect : 0), 0.5, 0.85) + tuneOf(c).swingAdd
      : rng.next() < clamp((Math.max(Math.abs(loc.x), Math.abs(loc.y)) < 1.3 ? 0.4 : 0.22) - 0.05 * z(b?.eye) + 0.03 * stuff + c.profile.chase, 0.08, 0.55);
  if (!swing) return { result: zone ? "called_strike" : "ball", zone, mph };
  // Rules v7: a computer batter may spend Heat on a bat ability once it has decided to swing (Comet needs a power swing, the rest a contact one).
  let cpuFx: Effects | null = null, cpuPower = false;
  if (!swingKind && c.rules >= 7) {
    cpuFx = cpuUse(c, "bat", batter, battingSide(c), batter, pitcher);
    cpuPower = c.cpuActive?.def.id === "BAT_COMET";
  }

  const t = tuneOf(c), mo = momentum(c, batter, pitcher);
  const zc = z((b?.contact ?? 70) + (boost?.contact ?? 0));
  let contact = zone
    ? clamp(0.85 + 0.04 * zc - 0.05 * stuff - 0.08 * edge - TYPE_WHIFF[type] + mo + t.contactAdd, 0.5, 0.97)
    : clamp(0.55 + 0.05 * zc - 0.06 * stuff - TYPE_WHIFF[type] + mo + t.contactAdd, 0.2, 0.8);
  if (pfx) contact = Math.max(0.05, contact - pfx.whiffAdd);
  let foul = zone ? t.foulZone : t.foulOff;
  if (swingKind) {
    // The user's timing decides most of it: a perfect swing is a very good one.
    contact = clamp(contact * (0.3 + 0.7 * q) + (swingKind === "contact" ? 0.06 : -0.04), 0.05, 0.97);
    foul = clamp(0.55 - 0.35 * q, 0.15, 0.5) * t.foulScale;
  }
  let cpuQ: number | undefined;
  const hitQ = () => (swingKind ? q : c.rules >= 3 ? (cpuQ ??= cpuContactQ(c, b?.contact, stuff)) : undefined);
  if (rng.next() >= contact) {
    // Second Swing turns a badly mistimed miss into a foul. It never makes contact that was not there.
    if (bfx && q < bfx.rescueQ && c.active) { c.active.triggered = true; return { result: "foul", zone, mph, q: hitQ() }; }
    // The computer's own Second Swing reads a drawn timing (drawn only when it paid for the ability).
    if (cpuFx && cpuFx.rescueQ > 0 && (hitQ() ?? 1) < cpuFx.rescueQ && c.cpuActive) { c.cpuActive.triggered = true; return { result: "foul", zone, mph, q: hitQ() }; }
    return { result: "swinging_strike", zone, mph };
  }
  if (rng.next() < foul) return { result: "foul", zone, mph, q: hitQ() };
  if (swingKind) c.lastSwing = { power: swingKind === "power", q, boost, fx: bfx ?? undefined };
  else if (cpuFx) c.lastSwing = { power: cpuPower, q: hitQ() ?? 0.5, fx: cpuFx, fxOnly: true };
  return { result: "in_play", zone, mph, q: hitQ() };
}

// --- Ball in play ----------------------------------------------------------------------

function ballInPlay(c: Ctx, batter: SimPlayer, pitcher: SimPlayer, swing?: Ctx["lastSwing"]): Outcome {
  const { rng } = c;
  const p = pitcher.pitching;
  // A Super Swing adds the bat's boost to the hitter's ratings for this ball only.
  const b = batter.batting && swing?.boost
    ? { ...batter.batting, contact: batter.batting.contact + swing.boost.contact, power: batter.batting.power + swing.boost.power }
    : batter.batting;
  const defense = (teamDefense(c.teams[fieldingSide(c)]) - 70) / 10;
  // A swing the user timed well helps; Power trades hits for homers, Contact the other way.
  const dHr = swing && !swing.fxOnly ? (swing.power ? 0.06 * swing.q : -0.015) : 0;
  const dHit = swing && !swing.fxOnly ? (swing.power ? -0.02 : 0.05 * swing.q) - 0.08 * (1 - swing.q) : 0;
  const mo = momentum(c, batter, pitcher);
  const fx = swing?.fx;
  const popup = fx && swing!.q < fx.popupBelowQ ? 0.06 : 0; // Comet on a mistimed swing climbs too high
  const t = tuneOf(c);
  const hr = clamp(t.hr + dHr + 0.5 * mo + 0.03 * z(b?.power) - 0.012 * z(p?.movement) + (fx?.dHr ?? 0), 0.005, 0.28);
  const hit = clamp(t.hit + dHit + mo + 0.03 * z(b?.contact) - 0.015 * z(p?.movement) - 0.015 * defense + (fx?.dHit ?? 0) - popup, 0.12, 0.45);
  let r = rng.next();
  if (r < hr) return "home_run";
  // One draw decides what kind of hit or out it is (drawn here so the fielding step below
  // can read it without changing the auto-sim's RNG sequence).
  const x = rng.next();
  const ground = clamp(0.45 - 0.04 * z(b?.power) + 0.03 * z(p?.movement) + (fx?.dGround ?? 0), 0.3, 0.6);
  const flyEnd = ground + 0.35 + (fx?.dFly ?? 0);
  c.ballFacts = { kind: x < ground ? "grounder" : x < flyEnd ? "fly" : "liner", spray: (x * 1000) % 1 };

  const triple = clamp(0.03 + 0.015 * z(b?.speed), 0.005, 0.08);
  const double = clamp(0.22 + 0.03 * z(b?.power) + (fx?.dDouble ?? 0), 0.1, 0.35);
  // Rules v5: the throw the user picked on a close force-play grounder, and the fielding ability that rode along.
  let thrown: { to: Base; rec: Base } | undefined, fieldFx: Effects | null = null;

  // A close one on the user's defense: their glove tap settles it (contextual takeover).
  if (c.user && fieldingSide(c) === c.user.side && Math.abs(r - (hr + hit)) < CONTEST_BAND) {
    const kind = x < ground ? "grounder" : x < flyEnd ? "fly" : "liner";
    const fielder = pickFielder(c.teams[fieldingSide(c)], kind, (x * 1000) % 1);
    const play = c.rules >= 5 && kind === "grounder" ? throwPlay(c.state) : undefined;
    const f = takeFieldInput(c, batter, pitcher, { kind, fielderId: fielder.id, ...(play ? { throws: play } : {}) }, { kind, doublePlay: !!play });
    const wasHit = r < hr + hit;
    // Wall Reaper only ever takes a hit away; it cannot turn a ball that was an out into anything. (Extra-base hits are drawn from the grounder range, so a fly cannot be gated on them.)
    const reach = f.fx && (c.active?.def.id !== "FIELD_WALL_REAPER" || wasHit) ? f.fx.reach : 0;
    const r0 = r + (f.q0 - 0.5) * 2 * CONTEST_BAND;
    r += (f.q - 0.5) * 2 * CONTEST_BAND + reach * CONTEST_BAND; // a perfect tap makes the out, a whiff gives up the hit
    const isHit = r < hr + hit;
    if (c.active?.def.role === "field" && r0 < hr + hit && !isHit) c.active.triggered = true;
    c.lastField = { fielderId: fielder.id, robbed: wasHit && !isHit, booted: !wasHit && isHit, out: !isHit };
    if (play) thrown = { to: f.throwTo && play.options.includes(f.throwTo) ? f.throwTo : play.recommended, rec: play.recommended };
    fieldFx = f.fx;
  }

  if (r < hr + hit) return x < triple ? "triple" : x < triple + double ? "double" : "single";
  if (x < ground) {
    const { outs, bases } = c.state;
    if (bases.first !== null && outs < 2) {
      let p = clamp(0.4 - 0.06 * z(b?.speed), 0.15, 0.6);
      const base = p;
      let turn = true;
      if (thrown) {
        if (thrown.to === "first") turn = false; // the sure out at first: no double play
        else if (thrown.to !== thrown.rec) p *= 0.5; // the wrong force base
        p += fieldFx?.dDp ?? 0;
      }
      const u = rng.next();
      const wild = turn && fieldFx && fieldFx.wildThrow > 0 ? rng.next() < fieldFx.wildThrow : false;
      if (turn && !wild && u < p) {
        if (fieldFx && fieldFx.dDp > 0 && u >= base && c.active) c.active.triggered = true;
        return "double_play";
      }
    }
    return "groundout";
  }
  return x < flyEnd ? "flyout" : "lineout";
}

/** The force-play throws on a grounder with the lead runner on first and fewer than two out (rules v5). The best throw is the one that can turn two. */
function throwPlay(state: GameState): { recommended: Base; options: Base[] } | undefined {
  const { first, second, third } = state.bases;
  if (first === null || state.outs >= 2) return undefined;
  const loaded = second !== null && third !== null;
  return { recommended: loaded ? "home" : "second", options: ["first", "second", ...(second !== null ? ["third" as const] : []), ...(loaded ? ["home" as const] : [])] };
}

/** How close to the hit/out line a ball must land to be worth a glove tap (about 1 in 5 balls in play). */
const CONTEST_BAND = 0.06;

/** Who's got it: grounders and liners to the infield, flies to the outfield, by where it's hit (0 = left line, 1 = right line). */
function pickFielder(team: SimTeam, kind: "grounder" | "liner" | "fly", dir: number): SimPlayer {
  const want = kind === "fly" ? (dir < 0.33 ? ["LF", "OF"] : dir < 0.67 ? ["CF", "OF"] : ["RF", "OF"])
    : dir < 0.25 ? ["3B"] : dir < 0.5 ? ["SS"] : dir < 0.75 ? ["2B"] : ["1B"];
  const byPos = want.map((pos) => team.lineup.find((p) => p.position === pos)).find(Boolean);
  return byPos ?? [...team.lineup].sort((a, b) => (b.batting?.fielding ?? 0) - (a.batting?.fielding ?? 0))[0];
}

/** Quality of the user's glove tap, 0-1. Better fielders get a wider window to hit. */
function takeFieldInput(c: Ctx, batter: SimPlayer, pitcher: SimPlayer, ball: NonNullable<Awaiting["ball"]>, ctx: FieldContext): { q: number; q0: number; throwTo?: Base; fx: Effects | null } {
  const u = c.user!;
  if (u.autoField && u.inputs[u.cursor]?.kind !== "field") return { q: 0.5, q0: 0.5, fx: null }; // no tap recorded: the play stands as rolled
  const inp = takeInput(c, "field", batter, pitcher, null, ball) as Extract<UserInput, { kind: "field" }>;
  const fielder = findPlayer(c, ball.fielderId);
  const fx = c.rules >= 5 ? useAbility(c, "field", fielder, fieldingSide(c), inp.ability, undefined, ctx) : null;
  const window = clamp(1 + 0.15 * z(fielder.batting?.fielding), 0.6, 1.4);
  const quality = (w: number) => 1 - Math.min(1, Math.abs(inp.timing) / w);
  return { q: quality(window * (fx?.fieldWindow ?? 1)), q0: quality(window), ...(c.rules >= 5 && inp.throwTo ? { throwTo: inp.throwTo } : {}), fx };
}

// --- Baserunning (rules v6) ------------------------------------------------------------

/** However the odds stack, a throw can always win: no baserunning chance goes above this. */
const RUN_CAP = 0.92;
const BOUND_RUN = BOUNDS.run[1];
const PICKOFF_LIMIT = 2;
type RunBase = "first" | "second" | "third";
type AdvanceChoice = { kind: "hit" | "fly"; outcome: Outcome; bases: RunBase[] };

const speedOf = (c: Ctx, id: number) => z(findPlayer(c, id).batting?.speed);

/** A steal of second or third: the runner's legs against the catcher's arm and the pitcher's delivery. */
function stealChance(c: Ctx, id: number, from: "first" | "second", pitcher: SimPlayer, fSide: Side): number {
  const catcher = c.teams[fSide].lineup.find((p) => p.position === "C");
  return clamp(0.7 + 0.12 * speedOf(c, id) - 0.1 * z(catcher?.batting?.fielding) - 0.03 * z(pitcher.pitching?.control) - (from === "second" ? 0.06 : 0), 0.3, 0.9);
}

const pickoffChance = (c: Ctx, id: number, pitcher: SimPlayer) => clamp(0.06 - 0.03 * speedOf(c, id) + 0.02 * z(pitcher.pitching?.control), 0.01, 0.15);

/** Chance a sent runner beats the throw. Fixed per situation so the UI can show it; sending is a gamble a hold never takes. */
function sendChance(c: Ctx, id: number, kind: "hit" | "fly", outcome: Outcome, from: RunBase): number {
  const s = speedOf(c, id);
  if (kind === "fly") return from === "third" ? clamp(0.78 + 0.1 * s, 0.5, 0.9) : clamp(0.72 + 0.1 * s, 0.45, 0.9);
  if (outcome === "double") return clamp(0.5 + 0.1 * s, 0.25, 0.85);
  return from === "second" ? clamp(0.6 + 0.1 * s, 0.35, 0.9) : clamp(0.4 + 0.08 * s, 0.2, 0.8);
}

/** Which runners the user has a say over on this play, or null. Runners not listed move as the engine rolls them. */
function advanceChoice(s: GameState, outcome: Outcome): AdvanceChoice | null {
  const b = s.bases;
  const bases = ((): RunBase[] => {
    if (outcome === "single") return (["second", "first"] as const).filter((k) => b[k] !== null);
    if (outcome === "double") return b.first !== null ? ["first"] : [];
    if (outcome === "flyout" && s.outs < 3) return (["third", "second"] as const).filter((k) => b[k] !== null);
    return [];
  })();
  return bases.length ? { kind: outcome === "flyout" ? "fly" : "hit", outcome, bases } : null;
}

const afterburnerFor = (c: Ctx, id: number) =>
  statuses(ABILITIES, c.ledger, { id, role: "run", heat: heatOf(c, id) })[0] ?? null;

/** What the user can do right now, for the awaiting. Pure: no rng, no events. */
function runOptions(c: Ctx, role: Awaiting["role"], pitcher: SimPlayer, choice: AdvanceChoice | null): RunOptions {
  const b = c.state.bases, bSide = battingSide(c), fSide = fieldingSide(c);
  const opt = (base: RunBase, chance: number, boosted = true): RunnerOption => {
    const id = b[base]!;
    return { base, runnerId: id, chance, boost: boosted ? Math.min(RUN_CAP, chance + BOUND_RUN) : chance, afterburner: boosted ? afterburnerFor(c, id) : null };
  };
  const batting = c.user!.side === bSide;
  const steal: RunnerOption[] = [];
  if (role !== "run" && batting) {
    if (b.first !== null && b.second === null) steal.push(opt("first", stealChance(c, b.first, "first", pitcher, fSide)));
    if (b.second !== null && b.third === null) steal.push(opt("second", stealChance(c, b.second, "second", pitcher, fSide)));
  }
  const left = Math.max(0, PICKOFF_LIMIT - c.pickoffs);
  const pickoff: RunnerOption[] = [];
  if (role !== "run" && !batting && left > 0) for (const k of ["first", "second", "third"] as const) if (b[k] !== null) pickoff.push(opt(k, pickoffChance(c, b[k]!, pitcher), false));
  const advance = choice ? { kind: choice.kind, outcome: choice.outcome, runners: choice.bases.map((k) => opt(k, sendChance(c, b[k]!, choice.kind, choice.outcome, k))) } : null;
  return { steal, pickoff, pickoffsLeft: batting ? 0 : left, advance };
}

/** A steal attempt by the batting side's runner on `from`. The user's and the computer's share the roll; the computer draws nothing extra. */
function stealAttempt(c: Ctx, bSide: Side, fSide: Side, pitcher: SimPlayer, pLine: PitchingLine, from: "first" | "second", ability: AbilityRequest | undefined, cpu: boolean) {
  const b = c.state.bases, to = from === "first" ? "second" : "third", id = b[from];
  if (id === null || b[to] !== null) return;
  const runner = findPlayer(c, id);
  const fx = useAbility(c, "run", runner, bSide, ability, undefined, undefined, cpu);
  const roll = c.rng.next(), odds = Math.min(RUN_CAP, stealChance(c, id, from, pitcher, fSide) + (fx?.run ?? 0));
  const safe = roll < odds;
  if (cpu ? c.cpuActive : c.active) settleAbility(c, false, cpu);
  b[from] = null;
  if (safe) b[to] = id; else { c.state.outs++; pLine.outs++; }
  award(c, bSide, id, safe ? 15 : -12);
  c.events.push({ type: "run", state: snapshot(c.state), action: safe ? "steal" : "caught", side: bSide, runnerId: id,
    ...(c.facts ? { shot: { play: "steal", base: to, safe, close: closeness(roll, odds) } } : {}),
    text: safe ? `${runner.name} steals ${to}!` : `${runner.name} is caught stealing ${to}.` });
}

/** How near the roll was to the odds, 0-1 (1 = a coin-flip play). Descriptive only. */
const closeness = (roll: number, odds: number) => Math.round(Math.max(0, 1 - Math.abs(roll - odds) / 0.25) * 100) / 100;

function pickoffThrow(c: Ctx, bSide: Side, pitcher: SimPlayer, pLine: PitchingLine, at: RunBase) {
  const b = c.state.bases, id = b[at];
  if (id === null) return;
  const runner = findPlayer(c, id);
  const roll = c.rng.next(), odds = pickoffChance(c, id, pitcher);
  const out = roll < odds;
  if (out) { b[at] = null; c.state.outs++; pLine.outs++; award(c, bSide, id, -12); }
  c.events.push({ type: "run", state: snapshot(c.state), action: out ? "pickoff" : "hold", side: bSide, runnerId: id,
    ...(c.facts ? { shot: { play: "pickoff", base: at, safe: !out, close: closeness(roll, odds) } } : {}),
    text: out ? `${pitcher.name} picks ${runner.name} off ${at}!` : `${pitcher.name} throws over to ${at}. ${runner.name} is back in time.` });
}

/**
 * Rules v7, Rally Breaker (PUP 4.5): spend all 100 Rally, once per side per match, only between pitches. Any armed ability is released
 * first, then the opposing pitcher and the opposing batter now up each lose 40 Heat (not below zero). Nothing else on the field changes.
 * A request that can't happen is dropped, like a late steal.
 */
function useBreaker(c: Ctx, side: Side) {
  const T = TEAM_RALLY_BREAKER;
  if (c.rules < 7 || c.breaker[side] || c.state.rally[side] < T.cost || c.state.outs >= 3) return;
  cancel(c.ledger);
  c.breaker[side] = true;
  c.state.rally[side] -= T.cost;
  const names = breakerTargets(c, other(side)).map((p) => {
    c.state.heat[p.id] = Math.max(0, heatOf(c, p.id) - T.heatDrain);
    return p.name;
  });
  c.events.push({ type: "team", state: snapshot(c.state), side, action: "rally_breaker",
    text: `${c.teams[side].name} use Rally Breaker! ${names.join(" and ")} lose up to ${T.heatDrain} Heat.` });
}

/**
 * Steals, throw-overs and Rally Breaker the user logged just before a pitch. They are optional: with none in the log
 * nothing is drawn, so the pitch plays exactly as it did without them. A request that can't happen is skipped.
 */
function runExtras(c: Ctx, bSide: Side, fSide: Side, pitcher: SimPlayer, pLine: PitchingLine) {
  const u = c.user!;
  for (;;) {
    const inp = u.inputs[u.cursor];
    if (!inp || (inp.kind !== "run" && inp.kind !== "team") || (inp.kind === "run" && inp.action === "advance")) return;
    u.cursor++;
    if (c.state.outs >= 3) continue; // the half is over: late requests are dropped
    if (inp.kind === "team") { useBreaker(c, u.side); continue; }
    if (inp.action === "steal") {
      if (u.side !== bSide) continue;
      stealAttempt(c, bSide, fSide, pitcher, pLine, inp.from, inp.ability, false);
    } else {
      if (u.side !== fSide || c.state.bases[inp.at] === null || c.pickoffs >= PICKOFF_LIMIT) continue;
      c.pickoffs++;
      pickoffThrow(c, bSide, pitcher, pLine, inp.at);
    }
  }
}

/**
 * Rules v7: the computer's own pre-pitch choices, all from its own stream. Batting, it sends the best-odds runner (with Afterburner when
 * the policy wants it); pitching, it throws over at the most dangerous runner, at most twice a match. Rally Breaker fires when the
 * meter is full and the two targets still hold enough Heat to be worth it.
 */
function cpuPrePitch(c: Ctx, bSide: Side, fSide: Side, pitcher: SimPlayer, pLine: PitchingLine) {
  const u = c.user!, p = c.profile, cpuSide = other(u.side), r = c.cpuRng;
  const T = TEAM_RALLY_BREAKER;
  if (!c.breaker[cpuSide] && c.state.rally[cpuSide] >= T.cost) {
    const heat = breakerTargets(c, u.side).reduce((n, t) => n + heatOf(c, t.id), 0);
    if (heat >= p.breakerHeat && r.next() < p.breakerRate) useBreaker(c, cpuSide);
  }
  const b = c.state.bases;
  if (cpuSide === bSide) {
    const cands = (["first", "second"] as const).filter((k) => b[k] !== null && b[k === "first" ? "second" : "third"] === null);
    const best = cands.map((k) => ({ k, chance: stealChance(c, b[k]!, k, pitcher, fSide) })).sort((x, y) => y.chance - x.chance)[0];
    if (best && best.chance >= p.stealMin && r.next() < p.stealRate) {
      const id = b[best.k]!, fx = chooseAbility(p, r, sceneOf(c.state, c.innings, "run", cpuSide, heatOf(c, id), findPlayer(c, id).batting, pitcher.pitching, p));
      stealAttempt(c, bSide, fSide, pitcher, pLine, best.k, fx, true);
    }
  } else if (c.cpuPickoffs < PICKOFF_LIMIT && r.next() < p.pickoffRate) {
    const at = (["third", "second", "first"] as const).find((k) => b[k] !== null);
    if (at) { c.cpuPickoffs++; pickoffThrow(c, bSide, pitcher, pLine, at); }
  }
}

/** The user's send/hold answer for this play, and the Afterburner that rode on it. */
interface RunPlan { send: Set<RunBase>; lead: RunBase | null; fx: Effects | null; out: number; notes: string[] }

/** Ask for the send/hold choice. Null when the user has no say, or a replay carries no answer (the play is rolled as before). */
function takeRunPlan(c: Ctx, bSide: Side, batter: SimPlayer, pitcher: SimPlayer, outcome: Outcome): RunPlan | null {
  const choice = c.rules >= 6 && c.user!.side === bSide ? advanceChoice(c.state, outcome) : null;
  if (!choice) return null;
  const u = c.user!;
  if (u.autoField && u.inputs[u.cursor]?.kind !== "run") return null;
  const inp = takeInput(c, "run", batter, pitcher, null, null, choice) as Extract<UserInput, { kind: "run" }>;
  if (inp.action !== "advance") throw new Error(`input ${u.cursor - 1}: expected advance, got ${inp.action}`);
  const send = new Set(inp.send.filter((k) => choice.bases.includes(k)));
  // The most advanced runner sent carries the Afterburner; a request with nobody sent costs nothing.
  const lead = (["third", "second", "first"] as const).find((k) => send.has(k));
  const fx = lead ? useAbility(c, "run", findPlayer(c, c.state.bases[lead]!), bSide, inp.ability) : null;
  return { send, lead: lead ?? null, fx, out: 0, notes: [] };
}

/** One sent runner against the throw. */
function sendRoll(c: Ctx, plan: RunPlan, kind: "hit" | "fly", outcome: Outcome, from: RunBase): boolean {
  const id = c.state.bases[from]!;
  const safe = c.rng.next() < Math.min(RUN_CAP, sendChance(c, id, kind, outcome, from) + (from === plan.lead ? plan.fx?.run ?? 0 : 0));
  if (!safe) { plan.out++; plan.notes.push(`${findPlayer(c, id).name} is thrown out.`); }
  return safe;
}

/** A single or double with the user's send/hold calls. The runner on third and the batter move as they always do. */
function advanceSent(c: Ctx, plan: RunPlan, outcome: Outcome, batterId: number): number[] {
  const b = c.state.bases, scored: number[] = [];
  const next: Bases = { first: null, second: null, third: null };
  if (outcome === "single") {
    if (b.third !== null) scored.push(b.third);
    if (b.second !== null) {
      if (!plan.send.has("second")) next.third = b.second;
      else if (sendRoll(c, plan, "hit", outcome, "second")) scored.push(b.second);
    }
    if (b.first !== null) {
      if (plan.send.has("first") && next.third === null) { if (sendRoll(c, plan, "hit", outcome, "first")) next.third = b.first; }
      else next.second = b.first;
    }
    next.first = batterId;
  } else {
    if (b.third !== null) scored.push(b.third);
    if (b.second !== null) scored.push(b.second);
    if (b.first !== null) {
      if (!plan.send.has("first")) next.third = b.first;
      else if (sendRoll(c, plan, "hit", outcome, "first")) scored.push(b.first);
    }
    next.second = batterId;
  }
  c.state.bases = next;
  return scored;
}

/** A fly out with the user's tag-up call: runners sent go on the catch, the rest hold. Returns who scored. */
function tagUp(c: Ctx, plan: RunPlan): number[] {
  const b = c.state.bases, scored: number[] = [];
  const next: Bases = { ...b };
  if (b.third !== null && plan.send.has("third")) { next.third = null; if (sendRoll(c, plan, "fly", "flyout", "third")) scored.push(b.third); }
  if (b.second !== null && plan.send.has("second") && next.third === null) { next.second = null; if (sendRoll(c, plan, "fly", "flyout", "second")) next.third = b.second; }
  c.state.bases = next;
  return scored;
}

// --- Running the bases -----------------------------------------------------------------

/** Move runners for an outcome. Returns the ids of players who scored. */
function advance(c: Ctx, outcome: Outcome, batterId: number): number[] {
  const { rng, state } = c;
  const b = state.bases;
  const scored: number[] = [];
  const speed = (id: number | null) => (id === null ? 0 : z(findPlayer(c, id).batting?.speed));
  const next: Bases = { first: null, second: null, third: null };

  switch (outcome) {
    case "walk":
      if (b.first !== null) {
        if (b.second !== null) {
          if (b.third !== null) scored.push(b.third);
          next.third = b.second;
        } else next.third = b.third;
        next.second = b.first;
      } else { next.second = b.second; next.third = b.third; }
      next.first = batterId;
      break;
    case "single":
      if (b.third !== null) scored.push(b.third);
      if (b.second !== null) { if (rng.next() < clamp(0.55 + 0.1 * speed(b.second), 0.3, 0.85)) scored.push(b.second); else next.third = b.second; }
      if (b.first !== null) { if (next.third === null && rng.next() < clamp(0.25 + 0.08 * speed(b.first), 0.05, 0.5)) next.third = b.first; else next.second = b.first; }
      next.first = batterId;
      break;
    case "double":
      if (b.third !== null) scored.push(b.third);
      if (b.second !== null) scored.push(b.second);
      if (b.first !== null) { if (rng.next() < clamp(0.4 + 0.1 * speed(b.first), 0.15, 0.75)) scored.push(b.first); else next.third = b.first; }
      next.second = batterId;
      break;
    case "triple":
      for (const r of [b.third, b.second, b.first]) if (r !== null) scored.push(r);
      next.third = batterId;
      break;
    case "home_run":
      for (const r of [b.third, b.second, b.first]) if (r !== null) scored.push(r);
      scored.push(batterId);
      break;
    case "groundout":
      // With fewer than two outs (already counted), runners move up; a runner on third scores half the time.
      if (state.outs < 3) {
        if (b.third !== null && rng.next() < 0.5) scored.push(b.third); else next.third = b.third;
        if (b.second !== null) { if (next.third === null) next.third = b.second; else next.second = b.second; }
        if (b.first !== null) next.second = next.second ?? b.first;
      }
      break;
    case "double_play":
      if (state.outs < 3) {
        if (b.third !== null) scored.push(b.third);
        next.third = b.second;
      }
      break;
    case "sac_fly":
      if (b.third !== null) scored.push(b.third);
      next.second = b.second; next.first = b.first;
      break;
    default: // strikeout, flyout, lineout: nobody moves
      next.first = b.first; next.second = b.second; next.third = b.third;
  }
  state.bases = next;
  return scored;
}

// --- Plate appearance --------------------------------------------------------------------

function plateAppearance(c: Ctx) {
  const { rng, state } = c;
  const bSide = battingSide(c), fSide = fieldingSide(c);
  const team = c.teams[bSide];
  const batter = team.lineup[c.lineupIdx[bSide] % team.lineup.length];
  c.lineupIdx[bSide]++;

  // Tired pitcher? Go to the bullpen before the next batter.
  const current = pitcherOf(c, fSide);
  if ((c.pitchCount.get(current.id) ?? 0) >= pitchLimit(current) && c.pitcherIdx[fSide] < c.teams[fSide].pitchers.length - 1) {
    c.pitcherIdx[fSide]++;
    const fresh = pitcherOf(c, fSide);
    c.events.push({ type: "pitching_change", state: snapshot(state), side: fSide, pitcherId: fresh.id,
      text: `Pitching change: ${fresh.name} comes in to pitch for ${c.teams[fSide].name}.` });
  }
  const pitcher = pitcherOf(c, fSide);
  const pLine = arm(c, fSide, pitcher), bLine = bat(c, bSide, batter);

  state.balls = 0; state.strikes = 0;
  // Rules v8: the throw-over limit is per batter, as the field's own doc says. Before v8 it never reset, so it ran out after two a match.
  if (c.rules >= 8) { c.pickoffs = 0; c.cpuPickoffs = 0; }
  let outcome: Outcome | null = null;
  let lastMph = 0, contactQ: number | undefined;
  while (!outcome) {
    if (c.user && c.rules >= 6) {
      const u = c.user;
      if (u.auto && u.cursor >= u.inputs.length && c.rules >= 7) u.inputs.push(...u.auto.pre(buildAwaiting(c, u.side === bSide ? "swing" : "pitch", batter, pitcher, null, null, null)));
      runExtras(c, bSide, fSide, pitcher, pLine);
      if (c.rules >= 7 && state.outs < 3) cpuPrePitch(c, bSide, fSide, pitcher, pLine);
      if (state.outs >= 3) { c.lineupIdx[bSide]--; return; } // caught stealing for the last out: the batter leads off next time
    }
    c.assist = c.rules >= 3 ? rallyAssist(state) : null;
    c.pitchFacts = undefined;
    const pitch = c.user ? throwUserPitch(c, batter, pitcher) : throwPitch(c, batter, pitcher);
    c.pitchCount.set(pitcher.id, (c.pitchCount.get(pitcher.id) ?? 0) + 1);
    pLine.pitches++;
    lastMph = pitch.mph;
    if (pitch.result === "ball") state.balls++;
    else if (pitch.result === "called_strike" || pitch.result === "swinging_strike") state.strikes++;
    else if (pitch.result === "foul" && state.strikes < 2) state.strikes++;
    if (c.rules >= 3) { contactQ = pitch.q; pitchHeat(c, bSide, fSide, batter, pitcher, pitch.result, pitch.q); }
    c.events.push({ type: "pitch", state: snapshot(state), batterId: batter.id, pitcherId: pitcher.id, result: pitch.result, mph: pitch.mph, zone: pitch.zone, ...(c.facts && c.pitchFacts ? { shot: c.pitchFacts } : {}) });
    if (c.user && c.rules >= 4) { settleAbility(c, pitch.result === "in_play"); if (c.cpuActive) settleAbility(c, pitch.result === "in_play", true); }
    if (state.balls === 4) outcome = "walk";
    else if (state.strikes === 3) outcome = "strikeout";
    else if (pitch.result === "in_play") {
      c.ballFacts = undefined;
      outcome = ballInPlay(c, batter, pitcher, c.lastSwing); c.lastSwing = undefined;
      if (c.active) settleAbility(c, true);
      if (c.cpuActive) settleAbility(c, true, true);
    }
  }

  const count = `${state.balls}-${state.strikes}`;
  const runnersOn = state.bases.first !== null || state.bases.second !== null || state.bases.third !== null;
  const scoreBefore = { ...state.score };

  // Outs first (so runner logic knows how many are left), then sac-fly check, then runners.
  if (["strikeout", "groundout", "flyout", "lineout"].includes(outcome)) state.outs++;
  if (outcome === "double_play") state.outs = Math.min(3, state.outs + 2);
  const plan = c.user && c.rules >= 6 ? takeRunPlan(c, bSide, batter, pitcher, outcome) : null;
  let scored: number[];
  if (plan && outcome === "flyout") {
    scored = tagUp(c, plan);
    if (scored.length) outcome = "sac_fly";
  } else if (plan) scored = advanceSent(c, plan, outcome, batter.id);
  else {
    if (outcome === "flyout" && state.outs < 3 && state.bases.third !== null && rng.next() < clamp(0.7 + 0.1 * z(findPlayer(c, state.bases.third).batting?.speed), 0.4, 0.9)) {
      outcome = "sac_fly";
    }
    scored = advance(c, outcome, batter.id);
  }
  if (plan) {
    if (c.active) settleAbility(c, true);
    state.outs = Math.min(3, state.outs + plan.out);
  }
  const runs = scored.length;
  state.score[bSide] += runs;

  // Box score
  const isHit = ["single", "double", "triple", "home_run"].includes(outcome);
  if (outcome !== "walk" && outcome !== "sac_fly") bLine.ab++;
  if (isHit) { bLine.h++; pLine.h++; c.hits[bSide]++; }
  if (outcome === "home_run") { bLine.hr++; pLine.hr++; }
  if (outcome === "walk") { bLine.bb++; pLine.bb++; }
  if (outcome === "strikeout") { bLine.k++; pLine.k++; }
  const rbi = outcome === "double_play" ? 0 : runs;
  bLine.rbi += rbi;
  for (const id of scored) bat(c, bSide, findPlayer(c, id)).r++;
  pLine.r += runs;
  const outsMade = ["strikeout", "groundout", "flyout", "lineout", "sac_fly"].includes(outcome) ? 1 : outcome === "double_play" ? 2 : 0;
  pLine.outs += outsMade + (plan?.out ?? 0);

  // Heat and Rally. Rules v3 is resources only; before that, once a team is On Fire its meter stops draining until the half ends.
  let caughtFire = false;
  if (c.rules >= 3) playHeat(c, bSide, fSide, batter, pitcher, outcome, contactQ, scored);
  else warm(c, batter.id, isHit ? 1 : outsMade ? -1 : 0);
  if (c.rules < 3) warm(c, pitcher.id, outcome === "strikeout" ? 1 : isHit ? -1 : 0);
  if (c.rules < 3 && state.fire !== bSide) {
    state.rally[bSide] = clamp(state.rally[bSide] + (isHit ? 25 : outcome === "walk" ? 10 : 0) + 15 * runs - 12 * outsMade, 0, 100);
    if (state.rally[bSide] >= 100) { state.fire = bSide; caughtFire = true; }
  }

  // Is the game over on this play?
  const lastInning = state.inning >= c.innings;
  const walkOff = state.half === "bottom" && lastInning && state.score.home > state.score.away;
  const gameEndingOut = state.outs >= 3 && lastInning &&
    ((state.half === "bottom" && state.score.home !== state.score.away) || (state.half === "top" && state.score.home > state.score.away));

  // Presentation tier (docs/VISUAL_DESIGN.md 3.1), escalated by context.
  const lateAndClose = lastInning && Math.abs(scoreBefore.home - scoreBefore.away) <= 1;
  let tier: Tier = 0, card: string | null = null, stat: string | null = null, line: string | null = null;
  if (outcome === "home_run") {
    const feet = Math.round(370 + 25 * z(batter.batting?.power) + rng.next() * 60);
    stat = `${feet} ft`;
    tier = 2; card = runs === 4 ? "GRAND SLAM" : "HOME RUN"; line = feet > 440 ? call(rng, "longHomer") : call(rng, "homer");
    if (runs === 4) { tier = 1; line = call(rng, "grandSlam"); }
    if (walkOff) { tier = 1; card = "WALK-OFF HOMER"; line = call(rng, "walkOff"); }
    else if (state.inning > c.innings || lateAndClose) tier = 1;
  } else if (walkOff) {
    tier = 1; card = "WALK-OFF"; line = call(rng, "walkOff");
  } else if (outcome === "triple") {
    tier = 2; card = "TRIPLE"; line = call(rng, "triple");
  } else if (outcome === "double_play") {
    tier = 2; card = "DOUBLE PLAY"; line = call(rng, "doublePlay");
  } else if (outcome === "strikeout") {
    stat = `${lastMph} mph`;
    if (gameEndingOut) { tier = 1; card = "GAME OVER"; line = call(rng, "gameOverK"); }
    else if (state.outs >= 3 && runnersOn) { tier = 2; card = "STRIKEOUT"; line = call(rng, "bigK"); }
    else tier = 3;
  } else if (outcome === "double") tier = 3;
  if (!line && isHit && (bLine.h === 3 || (outcome === "home_run" && bLine.hr === 2))) line = call(rng, "heatedUp");
  if (caughtFire && (tier === 0 || tier === 3)) { tier = 2; card = "ON FIRE"; line = call(rng, "onFire"); }

  // The user's glove decided it: a stolen hit is a highlight, a booted one gets a note.
  let text = describe(rng, outcome, batter.name, count, runs);
  if (plan?.notes.length) text += ` ${plan.notes.join(" ")}`;
  const fielded = c.lastField; c.lastField = undefined;
  if (fielded?.robbed && tier !== 1) { tier = 2; card = "ROBBED"; stat = findPlayer(c, fielded.fielderId).name; line = call(rng, "webGem"); }
  else if (fielded?.booted) text += ` ${call(rng, "booted")}`;

  // A Super Swing that connects is a highlight in its own right.
  const superSwing = c.superUsed; c.superUsed = false;
  if (superSwing && isHit && tier !== 1) { tier = 2; card = outcome === "home_run" ? "SUPER HOMER" : "SUPER SWING"; stat = stat ?? c.teams[bSide].gear?.superBat?.name ?? null; }

  c.events.push({
    type: "play", state: snapshot(state), batterId: batter.id, pitcherId: pitcher.id, outcome, runs, rbi,
    text, tier, call: line, card, stat, ...(superSwing ? { superSwing } : {}),
    ...(c.facts ? { shot: contactFacts(c, outcome, batter, contactQ) } : {}),
  });
  if (walkOff) c.over = true;
  // Rules v2: the home team opening a 10-run lead in the bottom of the 2nd or later ends it on the spot.
  if (c.rules >= 2 && !c.over && state.half === "bottom" && state.inning >= 2 && state.score.home - state.score.away >= RUN_AHEAD) {
    c.over = true; c.runAhead = true;
  }
}

/** Presentation facts for a play: the batted ball, from values the at-bat already produced. No draws. */
function contactFacts(c: Ctx, outcome: Outcome, batter: SimPlayer, q: number | undefined): PlayShot {
  const b = c.ballFacts;
  const inPlay = outcome !== "strikeout" && outcome !== "walk";
  // A home run skips the batted-ball draw, so its direction comes from who hit it and when.
  const spray = b?.spray ?? ((batter.id * 37 + c.state.inning * 7 + c.state.outs * 11) % 100) / 100;
  const kind = outcome === "home_run" ? "fly" : b?.kind ?? "grounder";
  const strength = outcome === "home_run" || outcome === "triple" ? 2 : q !== undefined ? (q >= 0.8 ? 2 : q >= 0.5 ? 1 : 0) : outcome === "double" ? 2 : outcome === "single" || outcome === "lineout" ? 1 : 0;
  return inPlay ? { kind, spray: Math.round(spray * 100) / 100, strength } : null;
}

// --- Whole game ----------------------------------------------------------------------------

type GameInput = {
  away: SimTeam; home: SimTeam; seed: number; innings?: number;
  /** Ruleset version; see CURRENT_RULES. Saved games pass the one they were recorded under. */
  rules?: RulesVersion;
  /** Test hook: override MAX_EXTRA_INNINGS (rules v2). */
  maxExtraInnings?: number;
  /** Test hook: override the starting Heat (rules v3). */
  startHeat?: number;
  /** Rules v7: the computer's difficulty (default "pro"). */
  difficulty?: Difficulty;
  /** Attach presentation facts (`shot`) to events. Off by default so existing event payloads stay byte-identical. */
  facts?: boolean;
};

export function simulateGame(input: GameInput): GameResult {
  return run(input).result!;
}

/**
 * Play a game where `userSide` makes the pitching and batting choices. Pass the inputs made so
 * far; the game replays from the seed and stops at the first moment it needs another one.
 */
/** `auto` seats a bot in the user chair (the soak test): it answers every prompt and its answers are appended to `inputs`, so the log replays on its own. */
export function playInteractive(input: GameInput & { userSide: Side; inputs: UserInput[]; autoField?: boolean; auto?: Bot }): InteractiveGame {
  const { events, awaiting, result } = run(input, { side: input.userSide, inputs: input.inputs, cursor: 0, autoField: input.autoField, auto: input.auto });
  return { events, awaiting, result };
}

/** Rules v3: every rostered athlete, substitutes included, starts the match at 25 Heat. */
function startHeat(rules: RulesVersion, start: number, ...teams: SimTeam[]): Record<number, number> {
  const heat: Record<number, number> = {};
  if (rules >= 3) for (const t of teams) for (const p of [...t.lineup, ...t.pitchers]) heat[p.id] = start;
  return heat;
}

function run(input: GameInput, user?: Ctx["user"]): { events: GameEvent[]; awaiting: Awaiting | null; result: GameResult | null } {
  const innings = input.innings ?? DEFAULT_INNINGS;
  const rules = input.rules ?? CURRENT_RULES;
  const lastInning = rules >= 2 ? innings + (input.maxExtraInnings ?? MAX_EXTRA_INNINGS) : MAX_INNINGS;
  const c: Ctx = {
    rng: createRng(input.seed),
    teams: { away: input.away, home: input.home },
    innings,
    rules,
    runAhead: false,
    state: { inning: 1, half: "top", outs: 0, balls: 0, strikes: 0, bases: { first: null, second: null, third: null }, score: { away: 0, home: 0 }, heat: startHeat(rules, input.startHeat ?? START_HEAT, input.away, input.home), rally: { away: 0, home: 0 }, fire: null },
    events: [],
    lineupIdx: { away: 0, home: 0 },
    pitcherIdx: { away: 0, home: 0 },
    pitchCount: new Map(),
    line: { away: [], home: [] },
    hits: { away: 0, home: 0 },
    batting: { away: new Map(), home: new Map() },
    pitching: { away: new Map(), home: new Map() },
    over: false,
    user,
    superLeft: user && rules < 3 ? (input[user.side].gear?.superBat?.charges ?? 0) : 0,
    superUsed: false,
    assist: null,
    ledger: newLedger(),
    pickoffs: 0,
    difficulty: rules >= 7 ? input.difficulty ?? "pro" : "pro",
    profile: profileOf(rules >= 7 ? input.difficulty : undefined),
    cpuRng: createRng((input.seed ^ 0x5bd1e995) >>> 0),
    cpuPickoffs: 0,
    breaker: { away: false, home: false },
    facts: input.facts === true,
  };
  const s = c.state;

  try {

  for (let inning = 1; inning <= lastInning && !c.over; inning++) {
    for (const half of ["top", "bottom"] as const) {
      // Home team doesn't bat in the last inning if it's already ahead.
      if (half === "bottom" && inning >= innings && s.score.home > s.score.away) break;
      // Being On Fire lasts the half; the fire side always just finished batting.
      if (s.fire) { s.rally[s.fire] = 0; s.fire = null; }
      Object.assign(s, { inning, half, outs: 0, balls: 0, strikes: 0, bases: { first: null, second: null, third: null } });
      const side = battingSide(c);
      const before = s.score[side];
      // Extra innings start with a runner on second: the last batter of the previous inning.
      if (inning > innings) {
        const t = c.teams[side];
        s.bases.second = t.lineup[(c.lineupIdx[side] + t.lineup.length - 1) % t.lineup.length].id;
      }
      c.events.push({ type: "half_start", state: snapshot(s),
        text: `${half === "top" ? "Top" : "Bottom"} of the ${ordinal(inning)}${inning > innings ? " (extra innings: runner starts on second)" : ""}. ${c.teams[side].name} batting.` });
      while (s.outs < 3 && !c.over) plateAppearance(c);
      c.line[side].push(s.score[side] - before);
      if (c.over) break;
    }
    if (inning >= innings && s.score.home !== s.score.away) break;
    // Rules v2: after any completed inning from the 2nd on, a 10-run lead wins (an away lead still got its bottom half).
    if (rules >= 2 && inning >= 2 && Math.abs(s.score.home - s.score.away) >= RUN_AHEAD) { c.runAhead = true; break; }
  }

  } catch (e) {
    if (e instanceof NeedInput) return { events: c.events, awaiting: e.awaiting, result: null };
    throw e;
  }

  let winner: Side | null = s.score.home > s.score.away ? "home" : s.score.away > s.score.home ? "away" : null;
  const { away, home } = c.teams;
  s.balls = 0; s.strikes = 0;
  let note = c.runAhead ? " Run-ahead rule." : "";
  if (rules >= 2 && winner === null) {
    // Hit the extra-innings guard still level: a seeded coin flip, worth one run so the score agrees with the winner.
    winner = c.rng.next() < 0.5 ? "away" : "home";
    s.score[winner]++;
    c.line[winner][c.line[winner].length - 1]++;
    note = ` Decided by a coin flip after ${lastInning} innings.`;
  }
  c.events.push({ type: "final", state: snapshot(s),
    text: winner
      ? `Final: ${c.teams[winner].name} win ${Math.max(s.score.home, s.score.away)}-${Math.min(s.score.home, s.score.away)}.${note}`
      : `Final: ${away.name} ${s.score.away}, ${home.name} ${s.score.home}. A tie after ${MAX_INNINGS}.` });

  const box: BoxScore = {
    linescore: c.line,
    hits: c.hits,
    batting: { away: away.lineup.map((p) => bat(c, "away", p)), home: home.lineup.map((p) => bat(c, "home", p)) },
    pitching: { away: [...c.pitching.away.values()], home: [...c.pitching.home.values()] },
  };
  return { events: c.events, awaiting: null, result: { seed: input.seed, innings, final: { ...s.score }, winner, events: c.events, box } };
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

// --- Lineups ---------------------------------------------------------------------------------

/**
 * A sensible batting order: table-setter (contact + speed) leads off, a patient hitter second,
 * the best all-around hitter third, the biggest power cleanup, then the rest best-first.
 */
export function autoLineup(hitters: SimPlayer[]): SimPlayer[] {
  const left = [...hitters];
  const takeBest = (score: (p: SimPlayer) => number) => {
    left.sort((a, b) => score(b) - score(a));
    return left.shift()!;
  };
  const b = (p: SimPlayer) => p.batting ?? { contact: 50, power: 50, eye: 50, speed: 50, fielding: 50 };
  const overall = (p: SimPlayer) => b(p).contact + b(p).power + b(p).eye * 0.6;
  const order: SimPlayer[] = [];
  if (left.length) order[0] = takeBest((p) => b(p).contact + b(p).speed);
  if (left.length) order[1] = takeBest((p) => b(p).eye + b(p).contact);
  const third = left.length ? takeBest(overall) : null;
  const fourth = left.length ? takeBest((p) => b(p).power) : null;
  if (third) order[2] = third;
  if (fourth) order[3] = fourth;
  left.sort((a, c) => overall(c) - overall(a));
  return [...order.filter(Boolean), ...left];
}
