import type { Quality } from "./quality.ts";
import type { Vec3 } from "./actionshot.ts";
import { CONTACT_Q } from "./shotscene.ts";

// W33b: the cinematic treatment of the three action shots (contact, mound release, slide/tag). Pure data and maths (no three,
// no DOM, no sim): the tier -> treatment mapping, the VFX schedule and the light placement are unit-tested under node.
// field.tsx applies it only while a shot is staged and puts everything back when the shot ends. Presentation only: nothing here
// reads or writes game state, and nothing moves the ball, the figures or the camera.

export type ShotFamily = "contact" | "release" | "slide";

/** One pooled-particle emission at shot progress `q` (0..1). */
export interface FxEvent { q: number; kind: ShotFamily; n: number }

export interface ShotTreatment {
  /** Multiplier on the stadium key, fill and hemisphere lights: darker surround, subject lit by the shot rig. */
  dim: number;
  /** Warm key from the camera side and cool rim from behind the subject (directional intensities). */
  key: number;
  rim: number;
  /** Scene fog density (depth cue: the stands recede). */
  fog: number;
  /** Vignette overlay opacity, 0 = no overlay element at all. */
  vignette: number;
  /** Mild contrast/saturation grade on the canvas (CSS filter), High tier only. */
  grade: boolean;
  /** Contact light pulse intensity; 0 whenever the shot is calm (reduced motion or the still variant) or the tier is Battery. */
  pulse: number;
  /** Particle emissions over the shot and the pool they come from; empty on Battery. */
  fx: FxEvent[];
}

/** Base fog density of the live stadium (field.tsx); a shot returns to it. */
export const BASE_FOG = 0.0028;

interface TierLook { dim: number; key: number; rim: number; fog: number; vignette: number; grade: boolean; pulse: number; fx: number }
const TIER: Record<Quality, TierLook> = {
  high: { dim: 0.45, key: 2.6, rim: 7, fog: 0.0095, vignette: 0.85, grade: true, pulse: 5, fx: 1 },
  standard: { dim: 0.58, key: 2.2, rim: 5.5, fog: 0.007, vignette: 0.6, grade: false, pulse: 3, fx: 0.5 },
  battery: { dim: 0.75, key: 1.7, rim: 4, fog: 0.005, vignette: 0, grade: false, pulse: 0, fx: 0 },
};
/** Per-family rim strength (the slide is the lowest-lit scene, the release the tightest framing). */
const FAMILY_RIM: Record<ShotFamily, number> = { contact: 1, release: 0.9, slide: 1.1 };
/** Calm variant (reduced motion, or the still action-shot mode): no pulse, a third of the particles. */
const CALM_FX = 0.35;

/** Particle schedule for one family at a particle scale (1 = full). Positions come from the pose at the event's own q. */
export function fxSchedule(family: ShotFamily, scale: number): FxEvent[] {
  const n = (full: number) => Math.round(full * scale);
  const out: FxEvent[] = [];
  if (scale <= 0) return out;
  if (family === "contact") out.push({ q: CONTACT_Q, kind: family, n: n(36) });
  else if (family === "release") out.push({ q: 0.33, kind: family, n: n(26) });
  else for (let q = 0.34; q < 0.95; q += 0.06) out.push({ q: Math.round(q * 100) / 100, kind: family, n: n(20) });
  return out.filter((e) => e.n > 0);
}

/** The whole treatment for a shot family at a quality tier. `calm` = reduced motion or a still shot. */
export function shotTreatment(family: ShotFamily, tier: Quality, calm: boolean): ShotTreatment {
  const t = TIER[tier];
  return {
    dim: t.dim, key: t.key, rim: t.rim * FAMILY_RIM[family], fog: t.fog, vignette: t.vignette, grade: t.grade,
    pulse: calm ? 0 : t.pulse,
    fx: fxSchedule(family, t.fx * (calm ? CALM_FX : 1)),
  };
}

/** Events that fire when the shot clock moves from `from` (exclusive) to `to` (inclusive), in order. */
export const dueEvents = (fx: FxEvent[], from: number, to: number): FxEvent[] => fx.filter((e) => e.q > from && e.q <= to);

/** Largest particle pool a tier needs (any family), so the pools are allocated once with the renderer. */
export const poolSize = (tier: Quality): number => Math.max(0, ...(["contact", "release", "slide"] as const).map((f) => fxSchedule(f, TIER[tier].fx).reduce((s, e) => s + e.n, 0)));

/**
 * Where the shot lights stand: the rim sits behind the subject (opposite the camera, a little to one side so it skims the
 * edges and stays above the horizon), the key on the camera side and higher. `look` is the subject, `cam` the camera.
 */
export function rigPositions(cam: Vec3, look: Vec3): { rim: Vec3; key: Vec3 } {
  let dx = look[0] - cam[0], dz = look[2] - cam[2];
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  const px = -dz, pz = dx; // perpendicular on the ground
  return {
    rim: [look[0] + dx * 18 + px * 7, look[1] + 9, look[2] + dz * 18 + pz * 7],
    key: [look[0] - dx * 12 - px * 5, look[1] + 11, look[2] - dz * 12 - pz * 5],
  };
}
