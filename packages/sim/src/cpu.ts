import { ABILITIES } from "./ability.ts";
import { createRng, type Rng } from "./rng.ts";
import type { AbilityRequest, Awaiting, Batting, Difficulty, GameState, PitchType, Pitching, Side, SimTeam, UserInput } from "./types.ts";

/**
 * Rules v7 CPU difficulty (ARC 11). A profile is a handful of constants chosen once per game; none of them
 * reads the score, the inning or the Rally meter, so there is no comeback physics (the ability policy below reads the
 * situation like a person would, the same way at every difficulty). Nothing here touches pitch
 * speed, the human's timing windows, any rating, or a ball after contact: difficulty only changes which pitch
 * the computer throws and where, when its batter swings, and how often it steals, picks off and spends abilities.
 */
export interface CpuProfile {
  /** Cumulative fastball / slider / change-up cut points; the rest is curveballs. */
  mix: [number, number, number];
  /** Added to the computer pitcher's chance of throwing a strike. */
  zone: number;
  /** In-zone aim: scale toward the middle (<1 = easier to square up) and the share pulled out to the edge. */
  centre: number; edge: number;
  /** Added to the computer batter's swing odds in the zone, out of it, and in the zone with two strikes. */
  zoneSwing: number; chase: number; protect: number;
  /** A steal is tried when its odds are at least stealMin, then `stealRate` of the time; throws over cost nothing. */
  stealMin: number; stealRate: number; pickoffRate: number;
  /** An ability is used when its utility reaches abilityMin, then abilityRate of the time (a consistency roll). */
  abilityMin: number; abilityRate: number;
  /** Rally Breaker: the chance it fires once the meter is full and the targets have at least breakerHeat between them. */
  breakerRate: number; breakerHeat: number;
  /** Soak bot only: how far its timing wanders (0 = perfect). */
  sloppy: number;
}

export const PROFILES: Record<Difficulty, CpuProfile> = {
  rookie: { mix: [0.7, 0.85, 0.95], zone: 0.05, centre: 0.6, edge: 0, zoneSwing: -0.06, chase: 0.06, protect: 0, stealMin: 1, stealRate: 0, pickoffRate: 0, abilityMin: 0.65, abilityRate: 0.4, breakerRate: 0.3, breakerHeat: 70, sloppy: 0.7 },
  pro: { mix: [0.55, 0.75, 0.9], zone: 0, centre: 1, edge: 0, zoneSwing: 0, chase: 0, protect: 0, stealMin: 0.8, stealRate: 0.2, pickoffRate: 0.1, abilityMin: 0.5, abilityRate: 0.7, breakerRate: 0.6, breakerHeat: 60, sloppy: 0.5 },
  allstar: { mix: [0.45, 0.68, 0.86], zone: -0.02, centre: 1, edge: 0.35, zoneSwing: 0.05, chase: -0.08, protect: 0.07, stealMin: 0.7, stealRate: 0.4, pickoffRate: 0.22, abilityMin: 0.4, abilityRate: 0.9, breakerRate: 0.9, breakerHeat: 50, sloppy: 0.35 },
};

/** The hard limits every profile sits inside; a test pins them, so a new tuning can't quietly become a handicap. */
export const PROFILE_BOUNDS: Record<keyof CpuProfile, [number, number]> = {
  mix: [0.4, 0.8], zone: [-0.05, 0.05], centre: [0.5, 1], edge: [0, 0.5],
  zoneSwing: [-0.08, 0.08], chase: [-0.1, 0.1], protect: [0, 0.1],
  stealMin: [0.7, 1], stealRate: [0, 0.5], pickoffRate: [0, 0.3],
  abilityMin: [0.3, 0.7], abilityRate: [0, 1], breakerRate: [0, 1], breakerHeat: [40, 80], sloppy: [0.3, 0.8],
};

export const DIFFICULTIES: readonly Difficulty[] = ["rookie", "pro", "allstar"];
export const isDifficulty = (v: unknown): v is Difficulty => v === "rookie" || v === "pro" || v === "allstar";
export const profileOf = (d: Difficulty | undefined): CpuProfile => PROFILES[d ?? "pro"];

export function pitchTypeFor(p: CpuProfile, r: number): PitchType {
  return r < p.mix[0] ? "fastball" : r < p.mix[1] ? "slider" : r < p.mix[2] ? "change" : "curve";
}

/** A pitch the computer aims inside the zone: x and y are the raw -1..1 draws, scaled and pulled to the edge by the profile. */
export function zoneAim(p: CpuProfile, rx: number, ry: number): { x: number; y: number } {
  const shape = (v: number) => {
    const s = v * 0.95 * p.centre;
    return s + (Math.sign(s) * 0.95 - s) * p.edge;
  };
  return { x: shape(rx), y: shape(ry) };
}

// --- Ability policy (PUP 14) -------------------------------------------------------------------------

/** Everything the policy reads about the moment, from the acting side's point of view. */
export interface Scene {
  role: "bat" | "pitch" | "run";
  heat: number;
  balls: number; strikes: number; outs: number;
  risp: boolean; loaded: boolean; late: boolean;
  /** Runs the acting side leads by (negative = trailing). */
  margin: number;
  batting: Batting | null | undefined; pitching: Pitching | null | undefined;
  /** How predictable the pitcher's mix is: the share of fastballs. */
  fastShare: number;
}

export function sceneOf(state: GameState, innings: number, role: Scene["role"], side: Side, heat: number, batting: Batting | null | undefined, pitching: Pitching | null | undefined, p: CpuProfile): Scene {
  const b = state.bases;
  return {
    role, heat, balls: state.balls, strikes: state.strikes, outs: state.outs,
    risp: b.second !== null || b.third !== null, loaded: b.first !== null && b.second !== null && b.third !== null,
    late: state.inning >= innings - 1,
    margin: side === "home" ? state.score.home - state.score.away : state.score.away - state.score.home,
    batting, pitching, fastShare: p.mix[0],
  };
}

const zr = (v: number | undefined) => ((v ?? 70) - 70) / 10;

/** How much the computer wants this ability right now, 0-1 (negative = never). Pure: the same scene always scores the same. */
export function utility(id: AbilityRequest["id"], s: Scene): number {
  const trailingLate = s.late && s.margin < 0 ? 0.12 : 0;
  switch (id) {
    case "BAT_COMET": return 0.3 + 0.12 * zr(s.batting?.power) + (s.risp ? 0.12 : 0) + trailingLate;
    case "BAT_LASER": return 0.3 + 0.12 * zr(s.batting?.contact) + (s.risp ? 0.15 : 0) + (s.strikes === 2 ? 0.05 : 0);
    case "BAT_GAP_MASTER": return 0.25 + (s.risp ? 0.15 : 0) + 0.08 * zr(s.batting?.contact);
    case "BAT_SECOND_SWING": return s.strikes === 2 && Math.abs(s.margin) <= 2 ? 0.55 : -1;
    case "PITCH_MIRAGE": return 0.3 + 0.8 * (s.fastShare - 0.5) + (s.risp ? 0.12 : 0) + (s.late ? 0.1 : 0);
    case "PITCH_VORTEX":
      if (s.loaded || (s.pitching?.control ?? 70) < 60) return -1;
      return s.strikes === 2 && (s.batting?.eye ?? 70) < 72 ? 0.55 + 0.05 * zr(70 - (s.batting?.eye ?? 70)) : 0.25;
    case "RUN_AFTERBURNER": return 0.5 + (s.late ? 0.1 : 0);
    default: return -1;
  }
}

/**
 * The ability the computer commits on this pitch, if any: the best-scoring one it can afford, used when the score reaches the
 * profile's bar and a consistency roll passes. One draw from `rng` per decision (two when a direction is needed), so it replays.
 */
export function chooseAbility(p: CpuProfile, rng: Rng, s: Scene): AbilityRequest | undefined {
  let best: { id: AbilityRequest["id"]; u: number } | null = null;
  for (const d of Object.values(ABILITIES)) {
    if (d.role !== s.role || d.cost > s.heat) continue;
    const u = utility(d.id, s);
    if (!best || u > best.u) best = { id: d.id, u };
  }
  if (!best) return undefined;
  const roll = rng.next();
  if (best.u < p.abilityMin || roll >= p.abilityRate) return undefined;
  return ABILITIES[best.id].needsDirection ? { id: best.id, direction: rng.next() < 0.5 ? "left" : "right" } : { id: best.id };
}

/** Rules v7: the swing the computer's bat takes when it commits `id`. Comet is a power swing; the rest go for contact. */
export const swingFor = (id: AbilityRequest["id"] | undefined): "power" | "contact" => (id === "BAT_COMET" ? "power" : "contact");

// --- The soak bot: a user seat played by the same policy -----------------------------------------

export interface Bot {
  pre: (v: Awaiting) => UserInput[];
  pick: (a: Awaiting) => UserInput;
}

/**
 * A user seat driven by a CPU profile, for AI-vs-AI soak tests. It answers only what the engine asks, from the same
 * policy functions the computer uses, with its own seeded stream; its choices are logged like a person's, so the game replays.
 */
export function makeBot(difficulty: Difficulty, seed: number, side: Side, teams: Record<Side, SimTeam>, innings: number): Bot {
  const p = PROFILES[difficulty], rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const find = (id: number) => [...teams.away.lineup, ...teams.home.lineup, ...teams.away.pitchers, ...teams.home.pitchers].find((x) => x.id === id);
  const noise = () => Math.max(-1, Math.min(1, (rng.next() + rng.next() - 1) * p.sloppy));
  return {
    pre(v) {
      const out: UserInput[] = [];
      if (v.team?.available && rng.next() < p.breakerRate && v.team.targets.reduce((n, t) => n + t.heat, 0) >= p.breakerHeat) out.push({ kind: "team", action: "rally_breaker" });
      if (v.role === "swing") {
        const go = v.run?.steal.find((r) => r.chance >= p.stealMin);
        if (go && rng.next() < p.stealRate) out.push({ kind: "run", action: "steal", from: go.base === "second" ? "second" : "first" });
      } else if (v.run && v.run.pickoffsLeft > 0 && v.run.pickoff.length && rng.next() < p.pickoffRate) {
        out.push({ kind: "run", action: "pickoff", at: v.run.pickoff[0].base });
      }
      return out;
    },
    pick(a) {
      if (a.role === "pitch") {
        const type = pitchTypeFor(p, rng.next());
        const pitcher = find(a.pitcherId), batter = find(a.batterId);
        const strike = rng.next() < 0.55 + p.zone;
        const aim = strike ? zoneAim(p, rng.next() * 2 - 1, rng.next() * 2 - 1) : { x: (rng.next() < 0.5 ? -1 : 1) * (1.05 + rng.next() * 0.4), y: (rng.next() * 2 - 1) * 0.8 };
        const ask = chooseAbility(p, rng, sceneOf(a.state, innings, "pitch", side, a.state.heat[a.pitcherId] ?? 0, batter?.batting, pitcher?.pitching, p));
        return { kind: "pitch", type, aim, ...(ask && a.abilities.find((x) => x.id === ask.id)?.available ? { ability: ask } : {}) };
      }
      if (a.role === "swing") {
        const batter = find(a.batterId), pitcher = find(a.pitcherId);
        const inc = a.incoming!;
        const zone = Math.abs(inc.aim.x) <= 1 && Math.abs(inc.aim.y) <= 1;
        const swingP = zone ? 0.7 + p.zoneSwing + (a.state.strikes === 2 ? p.protect : 0) : 0.28 + p.chase;
        const ask = chooseAbility(p, rng, sceneOf(a.state, innings, "bat", side, a.state.heat[a.batterId] ?? 0, batter?.batting, pitcher?.pitching, p));
        if (rng.next() >= swingP) return { kind: "swing", swing: "take", timing: 0 };
        const swing = ask ? swingFor(ask.id) : (batter?.batting?.power ?? 70) > 78 ? "power" : "contact";
        return { kind: "swing", swing, timing: noise(), ...(ask && a.abilities.find((x) => x.id === ask.id)?.available ? { ability: ask } : {}) };
      }
      if (a.role === "field") return { kind: "field", timing: noise() };
      const adv = a.run?.advance;
      return { kind: "run", action: "advance", send: adv ? adv.runners.filter((r) => r.chance >= 0.6).map((r) => r.base) : [] };
    },
  };
}
