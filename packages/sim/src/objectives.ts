// Three-star objectives (ARC 13): the result, a scouting star set by the opponent's style, and an arcade star.
// They only read a finished game, so they never touch the match rules.

import type { GameEvent, GameResult } from "./types.ts";

export interface ObjectiveDef {
  id: string;
  kind: "result" | "scout" | "arcade";
  /** Opponent style a scouting objective belongs to. */
  style?: string;
  label: string;
  check: (r: GameResult) => boolean;
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
/** The user is always the home side. */
const homePlays = (r: GameResult) => r.events.filter((e): e is Extract<GameEvent, { type: "play" }> => e.type === "play" && e.state.half === "bottom");
const homeRuns = (r: GameResult) => sum(r.box.batting.home, (b) => b.hr);
const margin = (r: GameResult) => r.final.home - r.final.away;

const DEFS: ObjectiveDef[] = [
  { id: "win", kind: "result", label: "Win the game", check: (r) => r.winner === "home" },

  { id: "scout-power-1", kind: "scout", style: "power", label: "Allow 1 home run or fewer", check: (r) => sum(r.box.pitching.home, (p) => p.hr) <= 1 },
  { id: "scout-power-2", kind: "scout", style: "power", label: "Keep them to 2 runs or fewer", check: (r) => r.final.away <= 2 },
  { id: "scout-speed-1", kind: "scout", style: "speed", label: "Hold them to 3 hits or fewer", check: (r) => r.box.hits.away <= 3 },
  { id: "scout-speed-2", kind: "scout", style: "speed", label: "Walk nobody", check: (r) => sum(r.box.pitching.home, (p) => p.bb) === 0 },
  { id: "scout-defense-1", kind: "scout", style: "defense", label: "Hit into no double plays", check: (r) => homePlays(r).every((p) => p.outcome !== "double_play") },
  { id: "scout-defense-2", kind: "scout", style: "defense", label: "Get 4 hits", check: (r) => r.box.hits.home >= 4 },
  { id: "scout-pitch-1", kind: "scout", style: "pitch", label: "Draw 2 walks", check: (r) => sum(r.box.batting.home, (b) => b.bb) >= 2 },
  { id: "scout-pitch-2", kind: "scout", style: "pitch", label: "Score in 2 different innings", check: (r) => r.box.linescore.home.filter((n) => n > 0).length >= 2 },
  { id: "scout-counter-1", kind: "scout", style: "counter", label: "Score first", check: (r) => { const p = r.events.find((e) => e.type === "play" && e.runs > 0); return !!p && p.state.half === "bottom"; } },
  { id: "scout-counter-2", kind: "scout", style: "counter", label: "Strike out 3 batters", check: (r) => sum(r.box.pitching.home, (p) => p.k) >= 3 },
  { id: "scout-balanced-1", kind: "scout", style: "balanced", label: "Score in 2 different innings", check: (r) => r.box.linescore.home.filter((n) => n > 0).length >= 2 },
  { id: "scout-balanced-2", kind: "scout", style: "balanced", label: "Hold them to 3 runs or fewer", check: (r) => r.final.away <= 3 },
  { id: "scout-rival-1", kind: "scout", style: "rival", label: "Win by 3 or more runs", check: (r) => margin(r) >= 3 },
  { id: "scout-rival-2", kind: "scout", style: "rival", label: "Hit a home run", check: (r) => homeRuns(r) >= 1 },

  { id: "arc-homer", kind: "arcade", label: "Hit a home run", check: (r) => homeRuns(r) >= 1 },
  { id: "arc-big-inning", kind: "arcade", label: "Score 3 runs in one inning", check: (r) => Math.max(0, ...r.box.linescore.home) >= 3 },
  { id: "arc-hits", kind: "arcade", label: "Collect 5 hits", check: (r) => r.box.hits.home >= 5 },
  { id: "arc-strikeouts", kind: "arcade", label: "Strike out 4 batters", check: (r) => sum(r.box.pitching.home, (p) => p.k) >= 4 },
  { id: "arc-abilities", kind: "arcade", label: "Use 2 different abilities", check: (r) => new Set(r.events.filter((e) => e.type === "ability" && e.phase === "committed" && e.side === "home").map((e) => (e as Extract<GameEvent, { type: "ability" }>).ability)).size >= 2 },
  { id: "arc-extra-bases", kind: "arcade", label: "Hit 2 extra-base hits", check: (r) => homePlays(r).filter((p) => p.outcome === "double" || p.outcome === "triple" || p.outcome === "home_run").length >= 2 },
  { id: "arc-first-inning", kind: "arcade", label: "Score in the 1st inning", check: (r) => (r.box.linescore.home[0] ?? 0) > 0 },
  { id: "arc-clean", kind: "arcade", label: "Keep them to 1 run or fewer", check: (r) => r.final.away <= 1 },
];

const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

export function objectiveDef(id: string): ObjectiveDef | undefined { return BY_ID.get(id); }

function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) { h ^= v >>> 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); }
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * The three objective ids for one fixture: always the win, then a scouting star for the opponent's style
 * and an arcade star. Nothing from `previous` (the last fixture's ids) repeats.
 */
export function pickObjectives(seed: number, gameNo: number, style: string, previous: string[]): string[] {
  const choose = (pool: ObjectiveDef[], salt: number) => {
    const fresh = pool.filter((d) => !previous.includes(d.id));
    const from = fresh.length ? fresh : pool;
    return from[hash(seed, gameNo, salt) % from.length]!.id;
  };
  const scout = DEFS.filter((d) => d.kind === "scout" && d.style === style);
  const arcade = DEFS.filter((d) => d.kind === "arcade");
  const scoutId = choose(scout.length ? scout : DEFS.filter((d) => d.kind === "scout" && d.style === "balanced"), 1);
  // The scouting star and the arcade star never ask for the same thing in one game.
  const arcadeId = choose(arcade.filter((d) => d.label !== objectiveDef(scoutId)!.label), 2);
  return ["win", scoutId, arcadeId];
}

/** Which of these objectives a finished game earned. */
export function evaluateObjectives(ids: string[], result: GameResult): string[] {
  return ids.filter((id) => BY_ID.get(id)?.check(result));
}
