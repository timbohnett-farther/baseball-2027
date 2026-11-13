import type { PaceReport } from "@bb/shared";

/** A gap longer than this means the tab was backgrounded or the player walked away, not pace. */
export const IDLE_CAP_MS = 120_000;

const pct = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;

/** Pure timing aggregator: the caller supplies timestamps, so tests need no clock. */
export class PaceTracker {
  private start = 0; private lastPitch = -1; private gaps: number[] = []; private pitches = 0;
  private halves: number[] = []; private halfStart = -1; private presentation = 0; private busyAt = -1;

  begin(t: number) { this.start = t; }
  onPitch(t: number) {
    this.pitches++;
    if (this.lastPitch >= 0 && t - this.lastPitch <= IDLE_CAP_MS) this.gaps.push(t - this.lastPitch);
    this.lastPitch = t;
  }
  onHalfStart(t: number) { this.closeHalf(t); this.halfStart = t; }
  /** Non-interactive playback (animations the player only watches) is timed between these two calls. */
  setBusy(busy: boolean, t: number) {
    if (busy && this.busyAt < 0) this.busyAt = t;
    else if (!busy && this.busyAt >= 0) { this.presentation += Math.min(t - this.busyAt, IDLE_CAP_MS); this.busyAt = -1; }
  }
  private closeHalf(t: number) { if (this.halfStart >= 0 && t - this.halfStart <= 3_600_000) this.halves.push(t - this.halfStart); this.halfStart = -1; }
  report(t: number): PaceReport {
    this.closeHalf(t); this.setBusy(false, t);
    const s = [...this.gaps].sort((a, b) => a - b);
    return {
      pitches: this.pitches, gapMedianMs: Math.round(pct(s, 0.5)), gapP90Ms: Math.round(pct(s, 0.9)),
      halfInningMs: this.halves.map(Math.round), totalMs: Math.round(Math.max(0, t - this.start)), presentationMs: Math.round(this.presentation),
    };
  }
}
