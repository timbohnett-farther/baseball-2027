import type { GameEvent } from "@bb/sim";

// ARC 10.3: how long an event may block play, and when a tap may skip it. Cinematics are trimmed to fit.
// ARC 10 gives no 2x rule, so callers divide these by playback speed.

type Play = Extract<GameEvent, { type: "play" }>;

/** Result actions must be usable by this point on the match result (ARC 10.3). */
export const RESULT_ACTIONS_MS = 2000;
/** Camera blends between views never exceed this (ARC 10.1). */
export const CAMERA_BLEND_MS = 250;

const isStrikeout = (p: Play) => p.outcome === "strikeout";
const isHomer = (p: Play) => p.outcome === "home_run";
/** A signature or highlight play (spectacular catch, big hit): the 1.2 s class. */
const isBig = (p: Play) => p.tier === 1 || p.tier === 2;

export function blockingBudgetMs(e: GameEvent): number {
  switch (e.type) {
    case "pitch": return 450;
    case "half_start": return 1300; // inning end shot, under the 1.5 s cap
    case "pitching_change": return 1400;
    case "ability": return 500;
    case "team": return 750; // Rally Breaker
    case "run": return 700;
    case "final": return 0;
    case "play":
      if (isHomer(e) || isBig(e)) return 1200;
      if (isStrikeout(e)) return 1000;
      return 500;
  }
}

/** Earliest a tap may skip the event, or null when it is too short to need skipping. */
export function skipAfterMs(e: GameEvent): number | null {
  if (e.type === "team") return 200;
  if (e.type === "half_start") return 250;
  if (e.type !== "play") return null;
  return isHomer(e) || isBig(e) || isStrikeout(e) ? 250 : null;
}

/** Overlay card: lands early, and is gone by the time the budget ends. */
export function cardWindowMs(e: Play): [delay: number, dur: number] {
  const budget = blockingBudgetMs(e);
  const delay = 250;
  return [delay, Math.max(0, budget - delay)];
}

export interface Shot { dur: number }

/** Scale a shot list down so it fits the blocking budget (in seconds); never stretches it. */
export function fitShots<T extends Shot>(shots: T[], budgetSec: number): T[] {
  const total = shots.reduce((n, s) => n + s.dur, 0);
  if (total <= budgetSec || total === 0) return shots;
  const k = budgetSec / total;
  return shots.map((s) => ({ ...s, dur: s.dur * k }));
}

export type CameraView = "plate" | "field" | "runners" | "stadium";

/** Gameplay camera per ARC 10.1: behind the catcher until the ball is in play, then the broadcast field. */
export function cameraViewFor(e: GameEvent): CameraView {
  switch (e.type) {
    case "pitch": return "plate";
    case "play": return "field";
    case "run": return "runners";
    case "half_start": case "pitching_change": case "final": return "stadium";
    default: return "plate";
  }
}

/** Blend rate (1/s) so a view change settles in about CAMERA_BLEND_MS; reduced motion cuts. */
export function blendRate(reduced: boolean): number {
  return reduced ? Infinity : 3 / (CAMERA_BLEND_MS / 1000);
}
