// Client-measured match pace (ARC 1.4), sent with /finish so W29 can compare it to the targets.
// Optional and advisory: the server logs a cleaned copy and never trusts it for anything.

export interface PaceReport {
  /** Pitch-to-pitch gaps (ms). Gaps over the idle cap are dropped as backgrounding, not pace. */
  pitches: number; gapMedianMs: number; gapP90Ms: number;
  /** Wall-clock length of each half-inning, in play order. */
  halfInningMs: number[];
  /** Whole match, and the share of it spent in non-interactive playback (ARC target: below 20%). */
  totalMs: number; presentationMs: number;
}

const finite = (n: unknown, max: number): number | null => typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : null;

/** Drop anything that isn't a plausible PaceReport; the server logs only what survives. */
export function cleanPace(x: unknown): PaceReport | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const pitches = finite(o.pitches, 2000), gapMedianMs = finite(o.gapMedianMs, 3.6e6), gapP90Ms = finite(o.gapP90Ms, 3.6e6);
  const totalMs = finite(o.totalMs, 3.6e7), presentationMs = finite(o.presentationMs, 3.6e7);
  if (pitches === null || gapMedianMs === null || gapP90Ms === null || totalMs === null || presentationMs === null) return null;
  if (!Array.isArray(o.halfInningMs) || o.halfInningMs.length > 60) return null;
  const halfInningMs = o.halfInningMs.map((v) => finite(v, 3.6e6));
  if (halfInningMs.some((v) => v === null)) return null;
  return { pitches, gapMedianMs, gapP90Ms, halfInningMs: halfInningMs as number[], totalMs, presentationMs };
}
