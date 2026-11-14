// W35b: render-cadence model. Pure (no three, no DOM, no sim): the frame gate field.tsx runs every requestAnimationFrame, and
// the frame-time schedules the invariance test and `scripts/cadence.mjs` drive it with. Nothing here is read by the sim.

/** The per-frame step the ballpark takes: skip frames under the tier's cap, and never advance animation by more than 50 ms of a long frame. */
export class FrameClock {
  private last: number;
  private minFrameMs: number;
  constructor(minFrameMs: number, start: number) { this.minFrameMs = minFrameMs; this.last = start; }
  /** null = skip this display frame (battery cap); otherwise the interval since the last rendered frame and the animation step in seconds. */
  tick(now: number): { intervalMs: number; real: number } | null {
    if (now - this.last < this.minFrameMs) return null;
    const intervalMs = now - this.last;
    this.last = now;
    return { intervalMs, real: Math.min(0.05, intervalMs / 1000) };
  }
}

export type Cadence = "hz30" | "hz60" | "hz144" | "uneven" | "stall";
export const CADENCES: Cadence[] = ["hz30", "hz60", "hz144", "uneven", "stall"];

/** mulberry32 over a fixed seed: the jitter in a schedule is itself repeatable. */
function jitter(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Successive frame intervals in ms for a cadence. hz30/60/144 are fixed periods. `uneven` is a 60 Hz display with a
 * repeatable 4-60 ms spread (including dropped-frame doubles). `stall` is 60 Hz with a 500 ms stall every 120 frames and a
 * 120 ms hitch every 37. Index `i` is the i-th frame.
 */
export function frameInterval(kind: Cadence, i: number, rnd: () => number = () => 0.5): number {
  switch (kind) {
    case "hz30": return 1000 / 30;
    case "hz60": return 1000 / 60;
    case "hz144": return 1000 / 144;
    case "uneven": { const r = rnd(); return r < 0.1 ? 33.3 + rnd() * 27 : 4 + r * 16; }
    case "stall": return i > 0 && i % 120 === 0 ? 500 : i > 0 && i % 37 === 0 ? 120 : 1000 / 60;
  }
}

/** Frame timestamps (ms, from t = 0) covering `durationMs`. */
export function schedule(kind: Cadence, durationMs: number, seed = 1): number[] {
  const rnd = jitter(seed), out: number[] = [];
  let t = 0;
  for (let i = 0; t <= durationMs; i++) { t += frameInterval(kind, i, rnd); out.push(t); }
  return out;
}
