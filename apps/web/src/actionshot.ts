import type { GameEvent } from "@bb/sim";

// W32 action shots (ROAD WO6-7, SLICE WO10): a short replay camera after a big dead ball. It is presentation only. The
// scorer and director read the event log; nothing here touches the sim, draws gameplay randomness, or changes an
// outcome. Every decision depends only on events up to and including the one being shown, so replays agree.

export type ShotFamily = "CONTACT" | "MOUND_RELEASE" | "SLIDE_TAG";
export type ActionShotMode = "full" | "reduced" | "off";
export type ShotCamera = "contact" | "release" | "slide";

export interface ActionShotDefinition {
  family: ShotFamily;
  camera: ShotCamera;
  /** Full variant and shortest variant, in ms. Both sit in the 0.75-1.2 s window. */
  fullMs: number;
  shortMs: number;
  /** The event must carry these recorded facts, or the shot falls back to the broadcast camera. */
  needs: "play" | "pitch" | "run" | "none";
}

export const CATALOG: Record<ShotFamily, ActionShotDefinition> = {
  CONTACT: { family: "CONTACT", camera: "contact", fullMs: 1200, shortMs: 750, needs: "none" },
  MOUND_RELEASE: { family: "MOUND_RELEASE", camera: "release", fullMs: 1000, shortMs: 750, needs: "pitch" },
  SLIDE_TAG: { family: "SLIDE_TAG", camera: "slide", fullMs: 1000, shortMs: 750, needs: "none" },
};

export const SHOT_MIN_MS = 750;
export const SHOT_MAX_MS = 1200;
/** A tap may skip a shot after this long. */
export const SHOT_SKIP_MS = 250;
export const SHOT_CAP = 4;
const REDUCED_CAP = 3;
const THRESHOLD: Record<Exclude<ActionShotMode, "off">, number> = { full: 60, reduced: 70 };

type Play = Extract<GameEvent, { type: "play" }>;
type Run = Extract<GameEvent, { type: "run" }>;

export interface Score { score: number; family: ShotFamily; reasons: string[] }

export interface ShotCtx { innings: number }

const isOut = (o: Play["outcome"]) => o === "flyout" || o === "lineout" || o === "sac_fly";

/** Triggered abilities earlier in the same plate appearance (back to the last result, pitch-free of other PAs). */
function abilities(events: GameEvent[], i: number): string[] {
  const out: string[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const e = events[j];
    if (e.type === "play" || e.type === "half_start" || e.type === "final") break;
    if (e.type === "ability" && e.phase === "triggered") out.push(e.ability);
  }
  return out;
}

const late = (e: GameEvent, ctx: ShotCtx) => e.state.inning >= ctx.innings;
const lead = (e: GameEvent) => e.state.score.home - e.state.score.away;
/** +1 when the home team is batting, -1 for the away team: multiply a lead to see it from the batting side. */
const batSign = (e: GameEvent) => (e.state.half === "top" ? -1 : 1);

/** Home batting in the last inning or later and takes the lead: the game is over. */
function walkOff(events: GameEvent[], i: number, ctx: ShotCtx) {
  const e = events[i], prev = events[i - 1];
  return e.state.half === "bottom" && late(e, ctx) && lead(e) > 0 && (!prev || lead(prev) <= 0);
}

function matchEnding(events: GameEvent[], i: number, ctx: ShotCtx) {
  const e = events[i];
  if (!late(e, ctx)) return false;
  if (walkOff(events, i, ctx)) return true;
  if (e.type !== "play" || e.state.outs !== 3) return false;
  return e.state.half === "bottom" ? lead(e) < 0 : lead(e) > 0; // the last out with the game decided
}

/** Score one event for a shot: null or a score under the mode's threshold means routine. Pure. */
export function scoreEvent(events: GameEvent[], i: number, ctx: ShotCtx): Score | null {
  const e = events[i];
  if (!e) return null;
  const reasons: string[] = [];
  const add = (n: number, why: string) => { s += n; reasons.push(why); };
  let s = 0;
  const ab = abilities(events, i);

  if (e.type === "play") {
    const p = e as Play;
    if (p.outcome === "strikeout") {
      add(20, "strikeout");
      if (p.state.outs === 3) add(30, "ends inning");
      if (p.state.bases.second !== null || p.state.bases.third !== null) add(20, "runner in scoring position");
      if (matchEnding(events, i, ctx)) add(40, "ends game");
      return { score: s, family: "MOUND_RELEASE", reasons };
    }
    if (p.outcome === "home_run") {
      add(50, "home run");
      if (p.rbi >= 2) add(Math.min(30, (p.rbi - 1) * 10), `${p.rbi} RBI`);
      if (walkOff(events, i, ctx)) add(40, "walk-off");
      else if (events[i - 1] && lead(events[i - 1]) * batSign(p) <= 0 && lead(p) * batSign(p) > 0) add(15, "takes the lead");
      if (late(p, ctx)) add(10, "late");
      if (p.tier === 1) add(10, "signature");
      return { score: s, family: "CONTACT", reasons };
    }
    if (isOut(p.outcome) && ab.some((a) => a === "FIELD_WALL_REAPER" || a === "FIELD_ACROBAT")) {
      add(80, "wall or acrobat catch");
      return { score: s, family: "CONTACT", reasons };
    }
    if ((p.outcome === "groundout" || p.outcome === "double_play" || isOut(p.outcome) || p.outcome === "single") && ab.some((a) => a === "FIELD_CANNON_ARM" || a === "RUN_AFTERBURNER")) {
      add(75, "cannon arm or afterburner close play");
      return { score: s, family: "SLIDE_TAG", reasons };
    }
    if (isOut(p.outcome) && (p.tier === 1 || p.tier === 2)) {
      add(70, "spectacular catch");
      return { score: s, family: "CONTACT", reasons };
    }
    return null;
  }

  if (e.type === "run") {
    const r = e as Run;
    if (ab.some((a) => a === "FIELD_CANNON_ARM" || a === "RUN_AFTERBURNER")) { add(75, "cannon arm or afterburner close play"); return { score: s, family: "SLIDE_TAG", reasons }; }
    const shot = r.shot;
    if (!shot || shot.close < 0.5) return null;
    add(40 + Math.round(40 * shot.close), "close call");
    if (!shot.safe) add(10, "out");
    if (shot.base === "third") add(10, "third base");
    if (late(r, ctx)) add(10, "late");
    return { score: s, family: "SLIDE_TAG", reasons };
  }
  return null;
}

export interface ShotPlan {
  index: number;
  family: ShotFamily;
  camera: ShotCamera;
  durMs: number;
  score: number;
  reasons: string[];
  /** reduced: a hard cut with no camera move. */
  still: boolean;
}

export interface DirectorOptions {
  mode: ActionShotMode;
  reducedMotion: boolean;
  innings: number;
  /** The stage says it cannot frame the shot reliably: the broadcast camera stays. */
  canFrame?: (plan: ShotPlan, e: GameEvent) => boolean;
}

/** The effective mode: reduced motion never gets more than the reduced variant. */
export function effectiveMode(mode: ActionShotMode, reducedMotion: boolean): ActionShotMode {
  return reducedMotion && mode === "full" ? "reduced" : mode;
}

type Phase = "pending" | "playing" | "skipped" | "done";

/** Decides which events get a shot. Idempotent per event index; remembers the match so far. */
export class ActionShotDirector {
  private plans = new Map<number, ShotPlan | null>();
  private phase = new Map<number, Phase>();
  private startedAt = new Map<number, number>();
  private count = 0;
  private lastPa = -10;
  private lastSeq = -1;
  private lastFamily: ShotFamily | null = null;
  private seen = new Set<string>();
  private mode: ActionShotMode;
  private opts: DirectorOptions;

  constructor(opts: DirectorOptions) { this.opts = opts; this.mode = effectiveMode(opts.mode, opts.reducedMotion); }

  get shots() { return this.count; }

  /** The plan for event `i`, or null for the broadcast camera. The same index always gives the same answer. */
  consider(events: GameEvent[], i: number): ShotPlan | null {
    if (this.plans.has(i)) return this.plans.get(i)!;
    // Earlier events must be decided first and in order, so a late call cannot skip the cap or the spacing rules.
    for (let j = 0; j < i; j++) if (!this.plans.has(j)) this.decide(events, j);
    return this.decide(events, i);
  }

  private decide(events: GameEvent[], i: number): ShotPlan | null {
    const plan = this.evaluate(events, i);
    this.plans.set(i, plan);
    if (plan) { this.count++; this.phase.set(i, "pending"); this.lastFamily = plan.family; this.lastPa = this.paOf(events, i); this.lastSeq = this.seqOf(events, i); this.seen.add(plan.reasons[0] + plan.family); }
    return plan;
  }

  private paOf(events: GameEvent[], i: number) { let n = 0; for (let j = 0; j <= i; j++) if (events[j].type === "play") n++; return n; }
  private seqOf(events: GameEvent[], i: number) { let n = 0; for (let j = 0; j <= i; j++) if (events[j].type === "pitch" || events[j].type === "half_start") n++; return n; }

  private evaluate(events: GameEvent[], i: number): ShotPlan | null {
    const e = events[i];
    const mode = this.mode;
    if (mode === "off" || !e) return null;
    // Only a result event can start a shot: a ball still in play is live, and a result with runners still moving is not dead.
    if (e.type !== "play" && e.type !== "run") return null;
    const next = events[i + 1];
    if (next && next.type === "run" && (next.action === "advance" || next.action === "thrown_out")) return null;
    if (this.count >= (mode === "full" ? SHOT_CAP : REDUCED_CAP)) return null;
    const sc = scoreEvent(events, i, { innings: this.opts.innings });
    if (!sc || sc.score < THRESHOLD[mode]) return null;
    if (this.seqOf(events, i) === this.lastSeq) return null; // one per dead-ball sequence
    const def = CATALOG[sc.family];
    if (def.needs === "pitch" && !this.lastPitchShot(events, i)) return null; // nothing recorded to replay
    const pa = this.paOf(events, i);
    if (pa - this.lastPa === 1 && e.type === "play") {
      const ending = matchEnding(events, i, { innings: this.opts.innings });
      const firstTime = !this.seen.has(sc.reasons[0] + sc.family) && sc.score >= 90;
      if (!ending && !firstTime) return null;
    }
    const short = mode === "reduced" || this.lastFamily === sc.family;
    const plan: ShotPlan = {
      index: i, family: sc.family, camera: def.camera, durMs: short ? def.shortMs : def.fullMs,
      score: sc.score, reasons: sc.reasons, still: mode === "reduced",
    };
    if (this.opts.canFrame && !this.opts.canFrame(plan, e)) return null;
    return plan;
  }

  private lastPitchShot(events: GameEvent[], i: number) {
    for (let j = i - 1; j >= 0; j--) {
      const e = events[j];
      if (e.type === "pitch") return e.shot ?? null;
      if (e.type === "play" || e.type === "half_start") return null;
    }
    return null;
  }

  // --- playback state: the stage reports starts and taps; the director owns whether a skip is allowed ---

  /** The shot begins now. A shot that was skipped or finished does not begin again (a re-render or resume cannot replay it). */
  begin(i: number, nowMs: number): ShotPlan | null {
    const plan = this.plans.get(i);
    if (!plan || this.phase.get(i) !== "pending") return null;
    this.phase.set(i, "playing");
    this.startedAt.set(i, nowMs);
    return plan;
  }

  /** A tap. Allowed once the shot has run SHOT_SKIP_MS; returns whether it skipped. */
  skip(i: number, nowMs: number): boolean {
    if (this.phase.get(i) !== "playing") return false;
    if (nowMs - (this.startedAt.get(i) ?? nowMs) < SHOT_SKIP_MS) return false;
    this.phase.set(i, "skipped");
    return true;
  }

  finish(i: number) { if (this.phase.get(i) === "playing") this.phase.set(i, "done"); }

  /** Skipped and finished shots no longer hold the camera. */
  active(i: number): boolean { return this.phase.get(i) === "playing"; }
}

/** The blocking budget for an event with a shot: the shot fits inside the existing budget when it can, else the budget grows to the shot, never past SHOT_MAX_MS. */
export function holdWithShot(baseMs: number, plan: ShotPlan | null | undefined): number {
  if (!plan) return baseMs;
  return Math.max(baseMs, Math.min(plan.durMs, SHOT_MAX_MS));
}

// --- camera poses (pure, so the clearance rules are unit-tested) -----------------------------------------------------

export type Vec3 = [number, number, number];
export interface ShotPose { pos: Vec3; look: Vec3; fov: number }
/** Base positions in the field's coordinate space (plate at the origin): 0 home, 1 first, 2 second, 3 third. */
export const BASE_XZ: [number, number][] = [[0, 0], [19.4, -19.4], [0, -38.8], [-19.4, -19.4]];
/** Lowest a shot camera may sit, and the smallest allowed distance to a standing figure. */
export const MIN_CAM_Y = 0.4;
export const MIN_FIGURE_GAP = 1.2;

/** Geometry shared by the slide camera and the slide staging: travel direction d into the base and the camera side n (always toward +z, so the park is behind the shot). */
export function slideAxes(base: number) {
  const b = Math.min(3, Math.max(0, base));
  const [bx, bz] = BASE_XZ[b], [px, pz] = BASE_XZ[(b + 3) % 4];
  let dx = bx - px, dz = bz - pz;
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  let nx = -dz, nz = dx;
  if (nz < 0) { nx = -nx; nz = -nz; }
  return { bx, bz, dx, dz, nx, nz };
}

/**
 * `p` runs 0..1 over the shot; a `still` shot holds p at the midpoint so it is a plain cut with no camera move.
 * Every pose looks toward -z: the park (stands, wall, towers) is only built beyond the plate, so a camera that looks
 * the other way sees black.
 */
export function shotPose(camera: ShotCamera, p: number, still: boolean, base = 1, side: 1 | -1 = 1): ShotPose {
  const q = still ? 0.5 : Math.min(1, Math.max(0, p));
  switch (camera) {
    case "contact": // low, first-base side of the plate, looking across the open stance: swing-through, bat and ball with the stadium behind
      return { pos: [side * (3.6 - 0.3 * q), 1.0, 3.6 - 0.2 * q], look: [side * -0.7, 1.05, -1.1], fov: 30 };
    case "release": // plate side, off the line to the mound: release pose and the ball in flight with the stands behind the pitcher
      return { pos: [3.4, 1.4, -10.4 + 0.4 * q], look: [0.1, 1.3, -17.8], fov: 22 };
    case "slide": { // low and outside, looking across the bag at runner and fielder
      const a = slideAxes(base), d = 4.4 - 0.4 * q;
      return { pos: [a.bx + a.nx * d, 0.6, a.bz + a.nz * d], look: [a.bx - a.dx * 0.4, 0.85, a.bz - a.dz * 0.4], fov: 34 };
    }
  }
}
