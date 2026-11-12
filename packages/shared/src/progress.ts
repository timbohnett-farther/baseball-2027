// Player development: drafted players earn XP for the games they appear in, and each level
// nudges every skill up a point. Only the server awards XP; the browser just shows it.

import type { PlayerRatings } from "./ratings.ts";

/** XP a player earns from one game he appeared in. */
export const XP_RULES = { appearance: 10, win: 5, hit: 1, homer: 3, strikeout: 1 } as const;
export const LEVEL_XP = 60;
export const MAX_LEVEL = 8;

export interface PlayerProgress {
  xp: number;
  level: number;
  /** XP needed for the next level, or null at the cap. */
  nextLevelXp: number | null;
}

export const levelFor = (xp: number): number => Math.min(MAX_LEVEL, Math.floor(Math.max(0, xp) / LEVEL_XP));

export function progressFor(xp: number): PlayerProgress {
  const level = levelFor(xp);
  return { xp, level, nextLevelXp: level >= MAX_LEVEL ? null : (level + 1) * LEVEL_XP };
}

/** Ratings with the level applied: +1 per level to every skill and to overall, never past 99. */
export function developRatings<R extends Omit<PlayerRatings, "id">>(r: R, level: number): R {
  if (level <= 0) return r;
  const up = (n: number) => Math.min(99, n + level);
  const lift = <T extends object | null>(o: T): T =>
    o ? (Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? up(v) : v])) as T) : o;
  return { ...r, overall: up(r.overall), hitting: lift(r.hitting), pitching: lift(r.pitching) };
}
