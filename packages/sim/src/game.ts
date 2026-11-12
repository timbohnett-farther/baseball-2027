// Pitch-by-pitch arcade game. Pure: same teams + same seed = the same game, every time.
//
// Each pitch: the pitcher hits the zone (Control), the batter decides to swing (Eye),
// makes contact or whiffs (Contact vs. Stuff), fouls it off or puts it in play.
// Balls in play become hits or outs (Power and Contact vs. Movement and team defense),
// and runners advance by their Speed. Ratings are on the 40-99 scale, 70 = average regular.

import { createRng, type Rng } from "./rng.ts";
import { call, describe } from "./text.ts";
import type {
  Aim, Awaiting, Bases, BattingLine, BoxScore, GameEvent, GameResult, GameState, InteractiveGame, Outcome,
  PitchingLine, PitchResult, PitchType, Side, SimPlayer, SimTeam, Tier, UserInput,
} from "./types.ts";

export const DEFAULT_INNINGS = 3;
const MAX_INNINGS = 9; // a game still tied after this many ends in a tie

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
  /** Interactive mode: the user's side and their input log. */
  user?: { side: Side; inputs: UserInput[]; cursor: number };
  /** Interactive mode: how the user's last swing was timed, for the ball in play. */
  lastSwing?: { power: boolean; q: number };
}

/** Thrown in interactive mode when the log runs out; the caller turns it into "waiting for input". */
class NeedInput extends Error {
  awaiting: Awaiting;
  constructor(awaiting: Awaiting) { super("need input"); this.awaiting = awaiting; }
}

const snapshot = (s: GameState): GameState => ({ ...s, bases: { ...s.bases }, score: { ...s.score } });
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

function throwPitch(c: Ctx, batter: SimPlayer, pitcher: SimPlayer): { result: PitchResult; zone: boolean; mph: number } {
  const { rng } = c;
  const b = batter.batting, p = pitcher.pitching;
  const used = c.pitchCount.get(pitcher.id) ?? 0;
  const tired = clamp((used - pitchLimit(pitcher)) / 15, 0, 1); // fades over ~15 pitches past the limit
  const stuff = z(p?.stuff) - tired, control = z(p?.control) - tired;

  const zone = rng.next() < clamp(0.5 + 0.05 * control, 0.35, 0.65);
  const swing = zone
    ? rng.next() < clamp(0.68 + 0.03 * z(b?.eye), 0.5, 0.85)
    : rng.next() < clamp(0.3 - 0.05 * z(b?.eye) + 0.03 * stuff, 0.1, 0.5);
  const fastball = rng.next() < 0.6;
  const mph = Math.round((fastball ? 93 + 0.3 * 10 * stuff : 85 + 0.2 * 10 * stuff) + (rng.next() - 0.5) * 4);

  if (!swing) return { result: zone ? "called_strike" : "ball", zone, mph };
  const contact = zone
    ? clamp(0.85 + 0.04 * z(b?.contact) - 0.05 * stuff, 0.6, 0.97)
    : clamp(0.6 + 0.05 * z(b?.contact) - 0.06 * stuff, 0.3, 0.85);
  if (rng.next() >= contact) return { result: "swinging_strike", zone, mph };
  return { result: rng.next() < (zone ? 0.42 : 0.5) ? "foul" : "in_play", zone, mph };
}

// --- One pitch, with the user in the loop ----------------------------------------------------

const TYPE_MPH: Record<PitchType, number> = { fastball: 93, slider: 86, change: 82, curve: 79 };
/** Off-speed pitches fool hitters a bit more; fastballs are the safe pitch. */
const TYPE_WHIFF: Record<PitchType, number> = { fastball: 0, slider: 0.04, change: 0.03, curve: 0.05 };

function takeInput(c: Ctx, role: "pitch" | "swing", batter: SimPlayer, pitcher: SimPlayer, incoming: Awaiting["incoming"]): UserInput {
  const u = c.user!;
  const next = u.inputs[u.cursor];
  if (!next) throw new NeedInput({ role, batterId: batter.id, pitcherId: pitcher.id, state: snapshot(c.state), incoming });
  if (next.kind !== (role === "pitch" ? "pitch" : "swing")) throw new Error(`input ${u.cursor}: expected ${role}, got ${next.kind}`);
  u.cursor++;
  return next;
}

const inZone = (a: Aim) => Math.abs(a.x) <= 1 && Math.abs(a.y) <= 1;

function throwUserPitch(c: Ctx, batter: SimPlayer, pitcher: SimPlayer): { result: PitchResult; zone: boolean; mph: number } {
  const { rng } = c;
  const b = batter.batting, p = pitcher.pitching;
  const used = c.pitchCount.get(pitcher.id) ?? 0;
  const tired = clamp((used - pitchLimit(pitcher)) / 15, 0, 1);
  const stuff = z(p?.stuff) - tired, control = z(p?.control) - tired;
  const userPitching = fieldingSide(c) === c.user!.side;

  let type: PitchType, loc: Aim, mph: number;
  let swingKind: "contact" | "power" | "take" | null = null, q = 0;
  if (userPitching) {
    const inp = takeInput(c, "pitch", batter, pitcher, null) as Extract<UserInput, { kind: "pitch" }>;
    type = inp.type;
    // Where it actually lands: the aim plus a miss that shrinks with Control.
    const miss = clamp(0.5 - 0.15 * control, 0.2, 0.8);
    loc = { x: clamp(inp.aim.x, -1.6, 1.6) + (rng.next() + rng.next() - 1) * miss, y: clamp(inp.aim.y, -1.6, 1.6) + (rng.next() + rng.next() - 1) * miss };
    mph = Math.round(TYPE_MPH[type] + 3 * stuff + (rng.next() - 0.5) * 4);
  } else {
    // The computer pitches. Roll the pitch first so the user can see it coming.
    const r = rng.next();
    type = r < 0.55 ? "fastball" : r < 0.75 ? "slider" : r < 0.9 ? "change" : "curve";
    const zone = rng.next() < clamp(0.5 + 0.05 * control, 0.35, 0.65);
    const edge = () => (rng.next() < 0.5 ? -1 : 1) * (1.05 + rng.next() * 0.5);
    loc = zone ? { x: (rng.next() * 2 - 1) * 0.95, y: (rng.next() * 2 - 1) * 0.95 }
      : rng.next() < 0.5 ? { x: edge(), y: (rng.next() * 2 - 1) * 1.4 } : { x: (rng.next() * 2 - 1) * 1.4, y: edge() };
    mph = Math.round(TYPE_MPH[type] + 3 * stuff + (rng.next() - 0.5) * 4);
    const inp = takeInput(c, "swing", batter, pitcher, { type, mph, aim: loc }) as Extract<UserInput, { kind: "swing" }>;
    swingKind = inp.swing;
    q = 1 - Math.min(1, Math.abs(inp.timing));
  }

  const zone = inZone(loc);
  const edge = zone ? clamp((Math.max(Math.abs(loc.x), Math.abs(loc.y)) - 0.6) / 0.4, 0, 1) : 0;
  const swing = swingKind
    ? swingKind !== "take"
    : zone ? rng.next() < clamp(0.68 + 0.03 * z(b?.eye), 0.5, 0.85)
      : rng.next() < clamp((Math.max(Math.abs(loc.x), Math.abs(loc.y)) < 1.3 ? 0.4 : 0.22) - 0.05 * z(b?.eye) + 0.03 * stuff, 0.08, 0.55);
  if (!swing) return { result: zone ? "called_strike" : "ball", zone, mph };

  let contact = zone
    ? clamp(0.85 + 0.04 * z(b?.contact) - 0.05 * stuff - 0.08 * edge - TYPE_WHIFF[type], 0.5, 0.97)
    : clamp(0.55 + 0.05 * z(b?.contact) - 0.06 * stuff - TYPE_WHIFF[type], 0.2, 0.8);
  let foul = zone ? 0.42 : 0.5;
  if (swingKind) {
    // The user's timing decides most of it: a perfect swing is a very good one.
    contact = clamp(contact * (0.3 + 0.7 * q) + (swingKind === "contact" ? 0.06 : -0.04), 0.05, 0.97);
    foul = clamp(0.55 - 0.35 * q, 0.15, 0.5);
  }
  if (rng.next() >= contact) return { result: "swinging_strike", zone, mph };
  if (rng.next() < foul) return { result: "foul", zone, mph };
  if (swingKind) c.lastSwing = { power: swingKind === "power", q };
  return { result: "in_play", zone, mph };
}

// --- Ball in play ----------------------------------------------------------------------

function ballInPlay(c: Ctx, batter: SimPlayer, pitcher: SimPlayer, swing?: { power: boolean; q: number }): Outcome {
  const { rng } = c;
  const b = batter.batting, p = pitcher.pitching;
  const defense = (teamDefense(c.teams[fieldingSide(c)]) - 70) / 10;
  // A swing the user timed well helps; Power trades hits for homers, Contact the other way.
  const dHr = swing ? (swing.power ? 0.06 * swing.q : -0.015) : 0;
  const dHit = swing ? (swing.power ? -0.02 : 0.05 * swing.q) - 0.08 * (1 - swing.q) : 0;
  const hr = clamp(0.05 + dHr + 0.03 * z(b?.power) - 0.012 * z(p?.movement), 0.005, 0.28);
  const hit = clamp(0.29 + dHit + 0.03 * z(b?.contact) - 0.015 * z(p?.movement) - 0.015 * defense, 0.12, 0.45);
  const r = rng.next();
  if (r < hr) return "home_run";
  if (r < hr + hit) {
    const x = rng.next();
    const triple = clamp(0.03 + 0.015 * z(b?.speed), 0.005, 0.08);
    const double = clamp(0.22 + 0.03 * z(b?.power), 0.1, 0.35);
    return x < triple ? "triple" : x < triple + double ? "double" : "single";
  }
  const x = rng.next();
  const ground = clamp(0.45 - 0.04 * z(b?.power) + 0.03 * z(p?.movement), 0.3, 0.6);
  if (x < ground) {
    const { outs, bases } = c.state;
    if (bases.first !== null && outs < 2 && rng.next() < clamp(0.4 - 0.06 * z(b?.speed), 0.15, 0.6)) return "double_play";
    return "groundout";
  }
  return x < ground + 0.35 ? "flyout" : "lineout";
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
  let outcome: Outcome | null = null;
  let lastMph = 0;
  while (!outcome) {
    const pitch = c.user ? throwUserPitch(c, batter, pitcher) : throwPitch(c, batter, pitcher);
    c.pitchCount.set(pitcher.id, (c.pitchCount.get(pitcher.id) ?? 0) + 1);
    pLine.pitches++;
    lastMph = pitch.mph;
    if (pitch.result === "ball") state.balls++;
    else if (pitch.result === "called_strike" || pitch.result === "swinging_strike") state.strikes++;
    else if (pitch.result === "foul" && state.strikes < 2) state.strikes++;
    c.events.push({ type: "pitch", state: snapshot(state), batterId: batter.id, pitcherId: pitcher.id, result: pitch.result, mph: pitch.mph, zone: pitch.zone });
    if (state.balls === 4) outcome = "walk";
    else if (state.strikes === 3) outcome = "strikeout";
    else if (pitch.result === "in_play") { outcome = ballInPlay(c, batter, pitcher, c.lastSwing); c.lastSwing = undefined; }
  }

  const count = `${state.balls}-${state.strikes}`;
  const runnersOn = state.bases.first !== null || state.bases.second !== null || state.bases.third !== null;
  const scoreBefore = { ...state.score };

  // Outs first (so runner logic knows how many are left), then sac-fly check, then runners.
  if (["strikeout", "groundout", "flyout", "lineout"].includes(outcome)) state.outs++;
  if (outcome === "double_play") state.outs = Math.min(3, state.outs + 2);
  if (outcome === "flyout" && state.outs < 3 && state.bases.third !== null && rng.next() < clamp(0.7 + 0.1 * z(findPlayer(c, state.bases.third).batting?.speed), 0.4, 0.9)) {
    outcome = "sac_fly";
  }
  const scored = advance(c, outcome, batter.id);
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
  pLine.outs += ["strikeout", "groundout", "flyout", "lineout", "sac_fly"].includes(outcome) ? 1 : outcome === "double_play" ? 2 : 0;

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

  c.events.push({
    type: "play", state: snapshot(state), batterId: batter.id, pitcherId: pitcher.id, outcome, runs, rbi,
    text: describe(rng, outcome, batter.name, count, runs), tier, call: line, card, stat,
  });
  if (walkOff) c.over = true;
}

// --- Whole game ----------------------------------------------------------------------------

type GameInput = { away: SimTeam; home: SimTeam; seed: number; innings?: number };

export function simulateGame(input: GameInput): GameResult {
  return run(input).result!;
}

/**
 * Play a game where `userSide` makes the pitching and batting choices. Pass the inputs made so
 * far; the game replays from the seed and stops at the first moment it needs another one.
 */
export function playInteractive(input: GameInput & { userSide: Side; inputs: UserInput[] }): InteractiveGame {
  const { events, awaiting, result } = run(input, { side: input.userSide, inputs: input.inputs, cursor: 0 });
  return { events, awaiting, result };
}

function run(input: GameInput, user?: Ctx["user"]): { events: GameEvent[]; awaiting: Awaiting | null; result: GameResult | null } {
  const innings = input.innings ?? DEFAULT_INNINGS;
  const c: Ctx = {
    rng: createRng(input.seed),
    teams: { away: input.away, home: input.home },
    innings,
    state: { inning: 1, half: "top", outs: 0, balls: 0, strikes: 0, bases: { first: null, second: null, third: null }, score: { away: 0, home: 0 } },
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
  };
  const s = c.state;

  try {

  for (let inning = 1; inning <= MAX_INNINGS && !c.over; inning++) {
    for (const half of ["top", "bottom"] as const) {
      // Home team doesn't bat in the last inning if it's already ahead.
      if (half === "bottom" && inning >= innings && s.score.home > s.score.away) break;
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
  }

  } catch (e) {
    if (e instanceof NeedInput) return { events: c.events, awaiting: e.awaiting, result: null };
    throw e;
  }

  const winner: Side | null = s.score.home > s.score.away ? "home" : s.score.away > s.score.home ? "away" : null;
  const { away, home } = c.teams;
  s.balls = 0; s.strikes = 0;
  c.events.push({ type: "final", state: snapshot(s),
    text: winner
      ? `Final: ${c.teams[winner].name} win ${Math.max(s.score.home, s.score.away)}-${Math.min(s.score.home, s.score.away)}.`
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
