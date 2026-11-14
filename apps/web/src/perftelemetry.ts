// W35a: dev-only performance telemetry. Pure bookkeeping (no three, no DOM, no sim, no RNG): field.tsx and the soak harness
// feed it timestamps and renderer counts, `window.__perfTelemetry()` reads it back. Nothing in the app reads it, nothing is
// sent anywhere, and it never touches input handling or gameplay timing.

export interface FrameStats { n: number; medianMs: number; p95Ms: number; worstMs: number }

const round = (x: number) => Math.round(x * 100) / 100;

/** Median, p95 (nearest rank) and worst of a set of frame intervals in ms. Empty input gives zeros with n = 0. */
export function frameStats(samples: readonly number[]): FrameStats {
  const n = samples.length;
  if (!n) return { n: 0, medianMs: 0, p95Ms: 0, worstMs: 0 };
  const s = [...samples].sort((a, b) => a - b);
  return { n, medianMs: round(s[n >> 1]), p95Ms: round(s[Math.min(n - 1, Math.ceil(n * 0.95) - 1)]), worstMs: round(s[n - 1]) };
}

export interface ResourceSample { t: number; geometries: number; textures: number; programs: number; heapMB: number | null }
export type ResourceKey = "geometries" | "textures" | "programs";

export interface Growth { first: number; last: number; max: number; /** Change from the first to the last sample after warm-up. */ delta: number }
export interface GrowthReport { verdict: "flat" | "growing" | "insufficient"; samples: number; metrics: Record<ResourceKey, Growth> }

/**
 * Did GPU-side resource counts keep climbing? The first `warmup` samples are ignored (lazy chunks, first shots and pools fill
 * then). After that a count may not end more than `tolerance` above where it started, and the second half of the run may not
 * set a new peak by more than `tolerance` over the first half's peak: a plateau with noise is flat, a ramp is growing.
 */
export function assessGrowth(samples: readonly ResourceSample[], opts: { warmup?: number; tolerance?: number } = {}): GrowthReport {
  const warmup = opts.warmup ?? 2, tol = opts.tolerance ?? 0;
  const body = samples.slice(warmup);
  const keys: ResourceKey[] = ["geometries", "textures", "programs"];
  const metrics = {} as Record<ResourceKey, Growth>;
  for (const k of keys) {
    const v = body.map((s) => s[k]);
    metrics[k] = { first: v[0] ?? 0, last: v[v.length - 1] ?? 0, max: Math.max(0, ...v), delta: (v[v.length - 1] ?? 0) - (v[0] ?? 0) };
  }
  if (body.length < 4) return { verdict: "insufficient", samples: body.length, metrics };
  let growing = false;
  for (const k of keys) {
    const v = body.map((s) => s[k]), half = v.length >> 1;
    if (metrics[k].delta > tol || Math.max(...v.slice(half)) > Math.max(...v.slice(0, half)) + tol) growing = true;
  }
  return { verdict: growing ? "growing" : "flat", samples: body.length, metrics };
}

export interface PhasedSample { phase: string | number; geometries: number; textures: number; programs: number }
export interface SoakGroup { phase: string; samples: number; metrics: Record<ResourceKey, { early: number; late: number; delta: number }> }
export interface SoakReport { verdict: "flat" | "growing" | "insufficient"; groups: SoakGroup[] }

/**
 * W35b: growth judged like for like. A live match holds more objects mid-play than between matches, so comparing the first and
 * last samples of a mixed run (assessGrowth) calls normal churn "growing". Samples here are grouped by `phase` (the point of the
 * play cycle they were taken at), the first `warmup` of each group are dropped, and the mean of the first third is compared with
 * the mean of the last third. A group grows when a count's late mean exceeds its early mean by more than max(absTol, relTol x early).
 * Fewer than `minSamples` after warm-up in every group is "insufficient", not "flat".
 */
export function assessSoak(samples: readonly PhasedSample[], opts: { warmup?: number; minSamples?: number; absTol?: number; relTol?: number } = {}): SoakReport {
  const warmup = opts.warmup ?? 2, minSamples = opts.minSamples ?? 6, absTol = opts.absTol ?? 2, relTol = opts.relTol ?? 0.02;
  const keys: ResourceKey[] = ["geometries", "textures", "programs"];
  const by = new Map<string, PhasedSample[]>();
  for (const x of samples) { const k = String(x.phase); (by.get(k) ?? by.set(k, []).get(k)!).push(x); }
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const groups: SoakGroup[] = [];
  let judged = 0, growing = false;
  for (const [phase, all] of by) {
    const body = all.slice(warmup);
    if (body.length < minSamples) continue;
    judged++;
    const third = Math.max(1, Math.floor(body.length / 3));
    const metrics = {} as SoakGroup["metrics"];
    for (const k of keys) {
      const v = body.map((x) => x[k]), early = mean(v.slice(0, third)), late = mean(v.slice(-third));
      metrics[k] = { early: round(early), late: round(late), delta: round(late - early) };
      if (late - early > Math.max(absTol, relTol * early)) growing = true;
    }
    groups.push({ phase, samples: body.length, metrics });
  }
  return { verdict: judged === 0 ? "insufficient" : growing ? "growing" : "flat", groups };
}

export interface FirstUse { at: number; syncMs: number; frameMs: number | null }
interface Prewarm { ok: boolean; ms: number; programsBefore: number; programsAfter: number; error?: string }

const RING = { frames: 1800, pending: 20000, calls: 200, longTasks: 200 };
const push = <T>(a: T[], v: T, cap: number) => { a.push(v); if (a.length > cap) a.shift(); };

/** The shape `window.__perfTelemetry()` returns. */
export interface PerfSnapshot {
  env: "dev";
  /** ms since navigation start (performance.now()), first occurrence only. */
  marks: Record<string, number>;
  /** First use of each shot family / ability family / pitch: when, how long the synchronous work took, and the interval of the frame that followed it. */
  firsts: Record<string, FirstUse>;
  /** Later uses of the same keys: synchronous cost only. */
  repeats: Record<string, FrameStats>;
  frames: FrameStats;
  renderer: { geometries: number; textures: number; programs: number } | null;
  longTasks: { supported: boolean; count: number; totalMs: number; worstMs: number };
  heap: { supported: boolean; usedMB: number | null; limitMB: number | null };
  prewarm: Prewarm | { skipped: string } | null;
  lifecycle: { directorsCreated: number; directorsDisposed: number; jerseyTextures: number; jerseysDisposed: number };
}

export class PerfLog {
  private marks: Record<string, number> = {};
  private firsts: Record<string, FirstUse> = {};
  private calls: Record<string, number[]> = {};
  private awaiting: { key: string; at: number } | null = null;
  private frames: number[] = [];
  private pending: number[] = [];
  private tasks: { start: number; dur: number }[] = [];
  private taskCount = 0; private taskTotal = 0; private taskWorst = 0; private taskSupported = false;
  private source: (() => { geometries: number; textures: number; programs: number }) | null = null;
  private jerseyCount: () => number = () => 0;
  prewarm: Prewarm | { skipped: string } | null = null;
  created = 0; disposed = 0; jerseysDisposed = 0;

  private now: () => number;
  constructor(now: () => number = () => performance.now()) { this.now = now; }

  /** Record a named moment once (a second call with the same name is ignored). */
  mark(name: string) { if (!(name in this.marks)) this.marks[name] = round(this.now()); }

  /** Run `fn`, timing its synchronous cost under `key`; the first run per key also captures the frame interval that follows. */
  timed<T>(key: string, fn: () => T): T {
    const t0 = this.now();
    try { return fn(); } finally {
      const ms = this.now() - t0;
      if (!(key in this.firsts)) { this.firsts[key] = { at: round(t0), syncMs: round(ms), frameMs: null }; this.awaiting = { key, at: t0 }; }
      else push(this.calls[key] ??= [], round(ms), RING.calls);
    }
  }

  /** One rendered-frame interval in ms (rAF to rAF). The interval right after a first use is attributed to it. */
  frame(intervalMs: number) {
    push(this.frames, intervalMs, RING.frames);
    push(this.pending, intervalMs, RING.pending);
    if (this.awaiting) { const f = this.firsts[this.awaiting.key]; if (f && f.frameMs === null) f.frameMs = round(intervalMs); this.awaiting = null; }
  }

  longTask(start: number, dur: number) {
    this.taskCount++; this.taskTotal += dur; this.taskWorst = Math.max(this.taskWorst, dur);
    push(this.tasks, { start: round(start), dur: round(dur) }, RING.longTasks);
  }
  longTasksSupported() { this.taskSupported = true; }

  setRendererSource(fn: (() => { geometries: number; textures: number; programs: number }) | null) { this.source = fn; }
  setJerseyCounter(fn: () => number) { this.jerseyCount = fn; }

  /** Frame-interval stats since the last `resetFrames()`, optionally only the newest `last` samples. */
  frameStats(last?: number): FrameStats { return frameStats(last ? this.frames.slice(-last) : this.frames); }
  resetFrames() { this.frames = []; }
  /** Raw frame intervals since the last drain (so a long run can be summarised exactly, not from the rolling window). */
  drainFrames(): number[] { const r = this.pending; this.pending = []; return r; }

  snapshot(heap: { usedMB: number; limitMB: number } | null): PerfSnapshot {
    const repeats: Record<string, FrameStats> = {};
    for (const [k, v] of Object.entries(this.calls)) repeats[k] = frameStats(v);
    return {
      env: "dev", marks: { ...this.marks }, firsts: { ...this.firsts }, repeats, frames: frameStats(this.frames),
      renderer: this.source ? this.source() : null,
      longTasks: { supported: this.taskSupported, count: this.taskCount, totalMs: round(this.taskTotal), worstMs: round(this.taskWorst) },
      heap: heap ? { supported: true, usedMB: heap.usedMB, limitMB: heap.limitMB } : { supported: false, usedMB: null, limitMB: null },
      prewarm: this.prewarm,
      lifecycle: { directorsCreated: this.created, directorsDisposed: this.disposed, jerseyTextures: this.jerseyCount(), jerseysDisposed: this.jerseysDisposed },
    };
  }
}

export const perfLog = new PerfLog();

type Mem = { usedJSHeapSize: number; jsHeapSizeLimit: number };

/** Dev only: expose `window.__perfTelemetry()` and start the long-task observer where the browser supports one. */
export function installPerfTelemetry() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __perfTelemetry?: () => PerfSnapshot };
  if (w.__perfTelemetry) return;
  try {
    const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) perfLog.longTask(e.startTime, e.duration); });
    po.observe({ type: "longtask", buffered: true });
    perfLog.longTasksSupported();
  } catch { /* longtask entries unsupported: reported as such */ }
  (w as { __perfFrames?: () => number[] }).__perfFrames = () => perfLog.drainFrames();
  w.__perfTelemetry = () => {
    const m = (performance as unknown as { memory?: Mem }).memory; // Chromium only
    return perfLog.snapshot(m ? { usedMB: round(m.usedJSHeapSize / 1048576), limitMB: round(m.jsHeapSizeLimit / 1048576) } : null);
  };
}
