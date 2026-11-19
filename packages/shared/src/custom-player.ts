// Create-a-player: one custom player per team, built from a fixed point budget.
// Pure rules shared by the server (which enforces them) and the web flow (which shows them).
//
// Balance, measured on the real draft pool (1,384 players, ratings 40-99, floor 40):
//   hitters  : median skill sum 346 over 5 skills (p90 374, best 428)
//   pitchers : median skill sum 276 over 4 skills (p90 304, best 356)
// Points are spent above the 40 floor, so the base budget lands the player ON the pool median:
//   hitter 145 points (sum 345), pitcher 116 points (sum 276).
// No rating may pass CUSTOM_RATING_CAP (80, about the pool's p90 per skill; the best draft pick has 99).
// Lifetime stars add a few bonus points, capped at STAR_BONUS_MAX, never bought with coins.
// Fully maxed (base + 12 bonus) a hitter sums 357 and a pitcher 288: still under the pool's p90, far under the best.

export const RATING_FLOOR = 40;
export const CUSTOM_RATING_CAP = 80;
export const HITTER_BASE_POINTS = 145;
export const PITCHER_BASE_POINTS = 116;

/** Lifetime stars -> bonus points. Highest threshold reached wins. Stars come from played games only. */
export const STAR_BONUS_TABLE: { stars: number; bonus: number }[] = [
  { stars: 10, bonus: 2 },
  { stars: 25, bonus: 4 },
  { stars: 50, bonus: 6 },
  { stars: 100, bonus: 8 },
  { stars: 200, bonus: 10 },
  { stars: 400, bonus: 12 },
];
export const STAR_BONUS_MAX = 12;

export const HITTER_SKILLS = ["contact", "power", "eye", "speed", "fielding"] as const;
export const PITCHER_SKILLS = ["stuff", "control", "movement", "stamina"] as const;

/** Position choices, using the draft's vocabulary. SP and RP are the two pitcher roles (position "P"). */
export const CUSTOM_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "SP", "RP"] as const;
export type CustomPosition = (typeof CUSTOM_POSITIONS)[number];

export const BUILDS = ["slim", "regular", "sturdy"] as const;
export type Build = (typeof BUILDS)[number];
export const SKIN_TONES = 5;
/** Uniform accent colours (cap brim and sleeves); an index into this list. */
export const ACCENT_COLORS = ["#c8322f", "#3a6fd8", "#2e9e5b", "#fd5a1e", "#8a5cd6", "#d4af37", "#00a3e0", "#f4f1ea"] as const;

export type Bats = "L" | "R" | "S";

export interface CustomLook { skin: number; build: Build; accent: number }
export type CustomRatings = Record<string, number>;

export interface CustomPlayerInput {
  name: string;
  number: number;
  position: CustomPosition;
  bats: Bats;
  look: CustomLook;
  ratings: CustomRatings;
}

export const isPitcherPosition = (p: string) => p === "SP" || p === "RP";
export const skillsFor = (p: string): readonly string[] => (isPitcherPosition(p) ? PITCHER_SKILLS : HITTER_SKILLS);
export const basePoints = (p: string) => (isPitcherPosition(p) ? PITCHER_BASE_POINTS : HITTER_BASE_POINTS);

export function starBonus(lifetimeStars: number): number {
  let b = 0;
  for (const t of STAR_BONUS_TABLE) if (lifetimeStars >= t.stars) b = t.bonus;
  return Math.min(b, STAR_BONUS_MAX);
}

export const totalPoints = (position: string, lifetimeStars: number) => basePoints(position) + starBonus(lifetimeStars);

/** Points spent above the floor. */
export const pointsSpent = (ratings: CustomRatings, position: string) =>
  skillsFor(position).reduce((n, k) => n + ((ratings[k] ?? RATING_FLOOR) - RATING_FLOOR), 0);

/** An even starting spread that uses the whole base budget (never above the cap). */
export function defaultRatings(position: string): CustomRatings {
  const skills = skillsFor(position);
  const each = Math.floor(basePoints(position) / skills.length);
  let extra = basePoints(position) - each * skills.length;
  return Object.fromEntries(skills.map((k) => [k, RATING_FLOOR + each + (extra-- > 0 ? 1 : 0)]));
}

const HITTER_WEIGHTS: Record<string, number> = { contact: 0.28, power: 0.24, eye: 0.2, speed: 0.1, fielding: 0.18 };
const PITCHER_WEIGHTS: Record<string, number> = { stuff: 0.35, control: 0.3, movement: 0.2, stamina: 0.15 };

export function customOverall(ratings: CustomRatings, position: string): number {
  const w = isPitcherPosition(position) ? PITCHER_WEIGHTS : HITTER_WEIGHTS;
  return Math.round(Object.entries(w).reduce((n, [k, x]) => n + (ratings[k] ?? RATING_FLOOR) * x, 0));
}

/** Everything wrong with a custom player, in plain words. Empty = valid. `name` is checked by validateDisplayName. */
export function validateCustomPlayer(input: unknown, lifetimeStars: number): { problems: string[]; value: CustomPlayerInput | null } {
  const problems: string[] = [];
  const i = (input ?? {}) as Partial<CustomPlayerInput>;
  const name = validateDisplayName(i.name);
  if (!name.ok) problems.push(name.reason);
  const n = i.number;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 99) problems.push("Jersey number must be 0 to 99.");
  if (!CUSTOM_POSITIONS.includes(i.position as CustomPosition)) problems.push("Pick a position.");
  if (i.bats !== "L" && i.bats !== "R" && i.bats !== "S") problems.push("Pick how you bat: left, right or switch.");
  const lk = i.look;
  if (!lk || !Number.isInteger(lk.skin) || lk.skin < 0 || lk.skin >= SKIN_TONES || !BUILDS.includes(lk.build) || !Number.isInteger(lk.accent) || lk.accent < 0 || lk.accent >= ACCENT_COLORS.length) problems.push("Pick a look.");
  if (CUSTOM_POSITIONS.includes(i.position as CustomPosition) && i.ratings && typeof i.ratings === "object") {
    const skills = skillsFor(i.position as string);
    const r = i.ratings as CustomRatings;
    const extra = Object.keys(r).filter((k) => !skills.includes(k));
    if (extra.length) problems.push("Unknown rating.");
    for (const k of skills) {
      const v = r[k];
      if (!Number.isInteger(v) || v < RATING_FLOOR) problems.push(`${k} can't go below ${RATING_FLOOR}.`);
      else if (v > CUSTOM_RATING_CAP) problems.push(`${k} can't go above ${CUSTOM_RATING_CAP}.`);
    }
    if (!problems.length) {
      const budget = totalPoints(i.position as string, lifetimeStars);
      const spent = pointsSpent(r, i.position as string);
      if (spent > budget) problems.push(`You spent ${spent} points but only have ${budget}.`);
    }
  } else if (i.position !== undefined) problems.push("Set your ratings.");
  if (problems.length || !name.ok) return { problems, value: null };
  return {
    problems,
    value: { name: name.name, number: n as number, position: i.position as CustomPosition, bats: i.bats as Bats, look: i.look as CustomLook, ratings: i.ratings as CustomRatings },
  };
}

import { validateDisplayName } from "./names.ts";
