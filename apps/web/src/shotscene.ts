import type { GameEvent, PlayShot, PitchShot } from "@bb/sim";
import { BASE_XZ, shotPose, slideAxes, type ShotCamera, type Vec3 } from "./actionshot.ts";

// W32c: the staging model for the three action shots. Pure data and maths (no three, no DOM, no sim writes), so the
// recorder, the poses, the slide-subject rule and canFrame are unit-tested under node. field.tsx owns the meshes.

/** Fielder slots in FIELD_POS order (pitcher, catcher, 1B, 2B, SS, 3B, LF, CF, RF), metres, plate at the origin. */
export const FIELD_XZ: [number, number][] = [[0, -18.4], [0, 2.2], [17, -24], [8, -35], [-8, -35], [-17, -24], [-34, -66], [0, -80], [34, -66]];
/** The fielder who covers each base: first, second, third base are slots 2B->(1B), 3, 5 in FIELD_POS order. */
export const COVER_SLOT: Record<1 | 2 | 3, number> = { 1: 2, 2: 3, 3: 5 };
/**
 * One ball size for every shot and camera: the live world size (radius 0.15 m, scale 1). It is never scaled per camera.
 * The 0.15 m ball is already about four times a real one so it reads on the long gameplay lens; the close action
 * cameras are the same ball, not a bigger or smaller one.
 */
export const BALL_SCALE = 1;
export const BALL_RADIUS = 0.15;
/** Standing figure used for occlusion: a 1.85 m player about 0.4 m across. */
export const FIGURE_RADIUS = 0.4;
export const FIGURE_HEIGHT = 1.85;

// --- transform recorder -----------------------------------------------------------------------------------------------

/** A figure root: position on the ground and its facing (rotation about y). */
export interface Placement { x: number; y: number; z: number; ry: number }
export interface RecFrame {
  /** The event index being shown when this was recorded. */
  event: number;
  /** Seconds on the recorder's own running clock. */
  t: number;
  /** Athlete roots by key: "batter", "r<playerId>" for runners, "f<slot>" for fielders. */
  actors: Record<string, Placement>;
  /** Ball position while the ball is live, else null. */
  ball: Vec3 | null;
}

export const REC_SECONDS = 6;
export const REC_MAX_FRAMES = 240;

/** Ring buffer of the last few seconds of live transforms, keyed by the event being shown. Presentation only. */
export class TransformRecorder {
  private frames: RecFrame[] = [];
  private seconds: number;
  private cap: number;

  constructor(seconds = REC_SECONDS, cap = REC_MAX_FRAMES) { this.seconds = seconds; this.cap = cap; }

  get size() { return this.frames.length; }

  record(f: RecFrame) {
    this.frames.push(f);
    while (this.frames.length > this.cap) this.frames.shift();
    while (this.frames.length > 1 && f.t - this.frames[0].t > this.seconds) this.frames.shift();
  }

  forEvent(event: number): RecFrame[] { return this.frames.filter((f) => f.event === event); }

  /** First (or last) recorded placement of `key` during `event`. */
  placement(event: number, key: string, which: "first" | "last"): Placement | null {
    const fs = this.forEvent(event);
    const list = which === "first" ? fs : [...fs].reverse();
    for (const f of list) if (f.actors[key]) return f.actors[key];
    return null;
  }

  /** The most recent placement of `key` recorded at or before `event`. */
  latest(event: number, key: string): Placement | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.event <= event && f.actors[key]) return f.actors[key];
    }
    return null;
  }

  /** The recorded ball path during `event`: the live samples in order, with their time since the first sample. */
  ballPath(event: number): { t: number; p: Vec3 }[] {
    const out: { t: number; p: Vec3 }[] = [];
    let t0 = -1;
    for (const f of this.forEvent(event)) {
      if (!f.ball) continue;
      if (t0 < 0) t0 = f.t;
      out.push({ t: f.t - t0, p: f.ball });
    }
    return out;
  }
}

// --- handedness -------------------------------------------------------------------------------------------------------

/** +1 right-handed (stands on the third-base side, x < 0), -1 left-handed (mirror image across the plate). A switch hitter bats right: the sim records no pitcher hand to switch against. */
export const batSide = (bats: "L" | "R" | "S" | undefined): 1 | -1 => (bats === "L" ? -1 : 1);

/** Mirror a placement across the plate (x = 0): the left-handed batter's stance. */
export const mirrorPlacement = (p: Placement, side: 1 | -1): Placement => (side === 1 ? p : { x: -p.x, y: p.y, z: p.z, ry: -p.ry });

// --- scenes: where each shot's subjects stand, from the recording when there is one ---------------------------------------

export interface ContactScene {
  /** Batter's root and facing, already mirrored for a left-hander. */
  batter: Placement;
  side: 1 | -1;
  /** Where the ball leaves the bat, and the unit direction it travels. */
  origin: Vec3;
  dir: Vec3;
  /** True when the batter and ball came from the recording rather than the event facts. */
  recorded: boolean;
}

const DEFAULT_BATTER: Placement = { x: -0.95, y: 0, z: 0.3, ry: Math.PI / 2 };
const DEFAULT_ORIGIN: Vec3 = [0, 1, 0];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Field angle (0 = centre, + = first-base side) for a recorded spray 0..1: the same mapping the field uses. */
export const sprayToAngle = (spray: number) => (spray - 0.5) * 1.5;

/** The launch direction implied by the event's recorded shot facts (the fallback when no live ball was recorded). */
export function factsDir(shot: PlayShot | undefined): Vec3 {
  const ang = shot ? sprayToAngle(shot.spray) : 0, kind = shot?.kind ?? "fly", str = shot?.strength ?? 1;
  const up = kind === "grounder" ? 0.08 : kind === "liner" ? 0.3 : 0.7 + 0.1 * str;
  return norm([Math.sin(ang), up, -Math.cos(ang)]);
}

export function contactScene(rec: TransformRecorder | null, event: number, bats: "L" | "R" | "S" | undefined, shot: PlayShot | undefined): ContactScene {
  const side = batSide(bats);
  const live = rec?.placement(event, "batter", "first") ?? rec?.latest(event, "batter") ?? null;
  const path = rec ? rec.ballPath(event) : [];
  const launch = path.find((s) => s.t >= 0)?.p;
  const away = path.find((s) => launch && Math.hypot(s.p[0] - launch[0], s.p[1] - launch[1], s.p[2] - launch[2]) > 1.5)?.p;
  const originOk = !!launch && Math.hypot(launch[0], launch[1] - 1, launch[2]) < 3; // a live launch starts at the plate
  const origin: Vec3 = originOk ? launch! : DEFAULT_ORIGIN;
  const dir = originOk && away ? norm([away[0] - origin[0], away[1] - origin[1], away[2] - origin[2]]) : factsDir(shot);
  return { batter: mirrorPlacement(live ?? DEFAULT_BATTER, side), side, origin, dir, recorded: !!live && originOk && !!away };
}

export interface ReleaseScene {
  pitcher: Placement;
  /** The recorded live release point of the ball (where the live pitch leaves the hand), or null. */
  release: Vec3 | null;
  /** Plate crossing, from the recorded pitch location. */
  target: Vec3;
  recorded: boolean;
}

/** Plate-crossing point (metres) for a recorded pitch location; the zone is -1..1, about 0.45 m wide and 0.5-1.1 m high. */
export const pitchTarget = (s: PitchShot | undefined): Vec3 => (s ? [s.x * 0.24, Math.max(0.1, 0.8 + s.y * 0.3), 0] : [0, 0.8, 0]);

export function releaseScene(rec: TransformRecorder | null, pitchEvent: number, shot: PitchShot | undefined): ReleaseScene {
  const live = rec?.placement(pitchEvent, "f0", "first") ?? rec?.latest(pitchEvent, "f0") ?? null;
  const path = rec ? rec.ballPath(pitchEvent) : [];
  return {
    pitcher: live ?? { x: FIELD_XZ[0][0], y: 0, z: FIELD_XZ[0][1], ry: 0 },
    release: path.length ? path[0].p : null,
    target: pitchTarget(shot),
    recorded: !!live && path.length > 0,
  };
}

export interface SlideSubject { runnerId: number; base: 1 | 2 | 3 }
type Bases = { first: number | null; second: number | null; third: number | null };
const BASE_KEY = ["first", "second", "third"] as const;
const baseOf = (b: Bases, id: number): 0 | 1 | 2 | 3 => { for (let k = 0; k < 3; k++) if (b[BASE_KEY[k]] === id) return (k + 1) as 1 | 2 | 3; return 0; };

/**
 * The actual runner and base for a slide/tag shot. A run event carries both. A play event is the batter reaching or
 * being retired at first, unless a runner advanced: then the lead advancing runner at his new base; a double play
 * with a runner forced off first is the play at second.
 */
export function slideSubject(events: GameEvent[], i: number): SlideSubject | null {
  const e = events[i];
  if (!e) return null;
  if (e.type === "run") {
    const base = e.shot ? ({ first: 1, second: 2, third: 3 } as const)[e.shot.base] : null;
    return base ? { runnerId: e.runnerId, base } : null;
  }
  if (e.type !== "play") return null;
  const before = events[i - 1]?.state.bases, after = e.state.bases;
  if (before) {
    let lead: SlideSubject | null = null;
    for (let k = 0; k < 3; k++) {
      const id = after[BASE_KEY[k]];
      if (id === null) continue;
      const was = baseOf(before, id);
      if (was !== 0 && k + 1 > was && (!lead || k + 1 > lead.base)) lead = { runnerId: id, base: (k + 1) as 1 | 2 | 3 };
    }
    if (lead) return lead;
    if (e.outcome === "double_play" && before.first !== null && baseOf(after, before.first) === 0) return { runnerId: before.first, base: 2 };
  }
  return { runnerId: e.batterId, base: 1 };
}

export interface SlideScene {
  subject: SlideSubject;
  axes: ReturnType<typeof slideAxes>;
  /** Slot of the fielder covering the base. */
  slot: number;
  /** Recorded final transforms of the runner and the covering fielder, when they are close enough to the bag to trust. */
  runner: Placement | null;
  fielder: Placement | null;
}

export function slideScene(rec: TransformRecorder | null, event: number, subject: SlideSubject): SlideScene {
  const axes = slideAxes(subject.base), slot = COVER_SLOT[subject.base];
  const near = (p: Placement | null, r: number) => (p && Math.hypot(p.x - axes.bx, p.z - axes.bz) <= r ? p : null);
  return {
    subject, axes, slot,
    runner: near(rec?.placement(event, `r${subject.runnerId}`, "last") ?? null, 3),
    fielder: near(rec?.placement(event, `f${slot}`, "last") ?? null, 4),
  };
}

// --- poses ------------------------------------------------------------------------------------------------------------

export type E3 = [number, number, number];
/**
 * A body pose in the figure's own frame (it faces +z, +x is its left). All angles in radians, every joint hangs along -y
 * at zero. Arm and leg x swings the limb backward when positive (forward when negative), z swings it out toward +x when
 * positive; a knee or elbow bend is the second joint's x (negative flexes the forearm forward, positive folds the shin
 * back). Torso x positive leans it forward.
 */
export interface Pose {
  hips: E3; torso: E3; head: E3;
  armL: E3; foreL: number; armR: E3; foreR: number;
  legL: E3; shinL: number; legR: E3; shinR: number;
  /** Barrel direction (handle to tip) in the torso frame; the bat is held in the right-hand grip (armR). Null when no bat. */
  bat: E3 | null;
}

export const THIGH = 0.45, SHIN = 0.45, ANKLE = 0.07, FOREARM = 0.3, UPPER = 0.32;

export const REST: Pose = {
  hips: [0, 0, 0], torso: [0, 0, 0], head: [0, 0, 0],
  armL: [-0.25, 0, 0.25], foreL: -0.5, armR: [-0.25, 0, -0.25], foreR: -0.5,
  legL: [0, 0, 0.1], shinL: 0, legR: [0, 0, -0.1], shinR: 0, bat: null,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const c01 = (n: number) => Math.min(1, Math.max(0, n));

/** Blend two poses joint by joint. */
export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const e3 = (x: E3, y: E3): E3 => [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
  const bat: E3 | null = a.bat && b.bat ? e3(a.bat, b.bat) : (t < 0.5 ? a.bat : b.bat);
  return {
    hips: e3(a.hips, b.hips), torso: e3(a.torso, b.torso), head: e3(a.head, b.head),
    armL: e3(a.armL, b.armL), foreL: lerp(a.foreL, b.foreL, t), armR: e3(a.armR, b.armR), foreR: lerp(a.foreR, b.foreR, t),
    legL: e3(a.legL, b.legL), shinL: lerp(a.shinL, b.shinL, t), legR: e3(a.legR, b.legR), shinR: lerp(a.shinR, b.shinR, t), bat,
  };
}

/** Walk a keyframe list (time, pose) with smoothstep between neighbours. */
export function keyed(keys: [number, Pose][], q: number): Pose {
  if (q <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (q <= keys[i][0]) { const [t0, p0] = keys[i - 1], [t1, p1] = keys[i]; return mixPose(p0, p1, smooth((q - t0) / (t1 - t0))); }
  }
  return keys[keys.length - 1][1];
}

/** A left-handed figure is the mirror image: swap sides and negate the y and z rotations. */
export function mirrorPose(p: Pose): Pose {
  const m = (e: E3): E3 => [e[0], -e[1], -e[2]];
  return {
    hips: m(p.hips), torso: m(p.torso), head: m(p.head),
    armL: m(p.armR), foreL: p.foreR, armR: m(p.armL), foreR: p.foreL,
    legL: m(p.legR), shinL: p.shinR, legR: m(p.legL), shinR: p.shinL,
    bat: p.bat ? [-p.bat[0], p.bat[1], p.bat[2]] : null,
  };
}

/** Vertical reach of one leg (hip to sole) for its angles; the pelvis must sit this high for that foot to touch the ground. */
export const legReach = (leg: E3, shin: number): number => (THIGH * Math.cos(leg[0]) + SHIN * Math.cos(leg[0] + shin)) * Math.cos(leg[2]) + ANKLE;
/** Pelvis height above the ground for a pose: the longer leg stands, the other foot may lift (a stride, a trailing toe). */
export const pelvisHeight = (p: Pose): number => Math.max(legReach(p.legL, p.shinL), legReach(p.legR, p.shinR));
/** Heights of the soles above the ground at that pelvis height (>= 0; the planted foot is 0). */
export function footHeights(p: Pose): [number, number] {
  const h = pelvisHeight(p);
  return [h - legReach(p.legL, p.shinL), h - legReach(p.legR, p.shinR)];
}

const pose = (o: Partial<Pose>): Pose => ({ ...REST, ...o });

// Contact (right-handed, the figure faces +z at zero): load, swing, contact at q = CONTACT_Q, follow through.
export const CONTACT_Q = 0.3;
/** Metres the ball is shown to travel per unit of shot time after contact. The recorded direction is kept; only the display speed is slowed so the ball stays beside the bat in a close frame. */
export const CONTACT_SLOW = 3;
export const contactBall = (q: number, hit: Vec3, dir: Vec3): Vec3 => {
  const d = Math.max(0, q - CONTACT_Q) * CONTACT_SLOW;
  return [hit[0] + dir[0] * d, Math.max(BALL_RADIUS, hit[1] + dir[1] * d), hit[2] + dir[2] * d];
};
/** Where the bat meets the ball for the default batter (right, left); the live stage measures the real barrel. */
export const HIT_DEFAULT: [Vec3, Vec3] = [[0.16, 1.1, -0.3], [0.03, 1.07, -0.75]];
const C_LOAD = pose({
  hips: [0, -0.15, 0], torso: [0.12, -0.45, 0], head: [0, 0.15, 0],
  armL: [-0.55, 0.1, 0.55], foreL: -1.55, armR: [-0.55, -0.2, -0.55], foreR: -1.75,
  legL: [0.1, 0, 0.18], shinL: 0.2, legR: [0.25, 0, -0.2], shinR: 0.3,
  bat: [0.25, 1, -0.45],
});
const C_HIT = pose({
  hips: [0, 0.4, 0], torso: [0.2, -0.05, 0], head: [0.1, -0.2, 0],
  armL: [-1.25, -0.1, 0.2], foreL: -0.1, armR: [-1.3, 0.1, -0.05], foreR: -0.15,
  legL: [-0.35, 0, 0.14], shinL: 0.15, legR: [0.1, 0, -0.18], shinR: 0.35,
  bat: [0.55, 0.05, 0.85],
});
const C_FOLLOW = pose({
  hips: [0, 0.6, 0], torso: [0.1, 0.2, 0], head: [0, -0.2, 0],
  armL: [-1.1, 0.5, 0.35], foreL: -1.1, armR: [-1.0, 0.9, -0.1], foreR: -1.4,
  legL: [-0.3, 0, 0.14], shinL: 0.12, legR: [0.05, 0, -0.2], shinR: 0.3,
  bat: [0.7, 0.4, -0.6],
});
export const contactPose = (q: number): Pose => keyed([[0, C_LOAD], [CONTACT_Q - 0.12, C_LOAD], [CONTACT_Q, C_HIT], [0.7, C_FOLLOW], [1, C_FOLLOW]], c01(q));

// Release (right-handed pitcher, throwing with the figure's right arm, index 0; the glove is on the left): cocked, release at
// q = RELEASE_Q with the stride leg planted and the chest upright over it, the throwing arm reaching out front, follow through.
export const RELEASE_Q = 0.3;
export type Hand = "L" | "R";
const R_COCK = pose({
  hips: [0, -0.2, 0], torso: [-0.15, -0.25, 0.1], head: [0, 0, 0],
  armL: [-0.9, 0, 0.6], foreL: -1.3, armR: [0.7, 0, -1.25], foreR: -1.5,
  legL: [-0.7, 0, 0.1], shinL: 0.4, legR: [0.1, 0, -0.1], shinR: 0.1,
});
const R_REL = pose({
  hips: [0, 0.1, 0], torso: [0.02, 0.05, 0], head: [-0.05, 0, 0],
  armL: [-0.55, -0.1, 0.5], foreL: -1.9, armR: [-2.5, 0, -0.3], foreR: -0.05,
  legL: [-0.6, 0, 0.12], shinL: 0.1, legR: [0.35, 0, -0.15], shinR: 0.5,
});
const R_FOLLOW = pose({
  hips: [0, 0.3, 0], torso: [0.6, 0.2, 0], head: [-0.1, 0, 0],
  armL: [-0.3, 0.2, 0.7], foreL: -1.6, armR: [-1.0, -0.2, -0.1], foreR: -0.5,
  legL: [-0.65, 0, 0.12], shinL: 0.15, legR: [0.5, 0, -0.15], shinR: 0.8,
});
/** A left-hander is the mirror image: he throws with the figure's left arm (index 1) and wears the glove on the right. */
export const releasePose = (q: number, hand: Hand = "R"): Pose => {
  const p = keyed([[0, R_COCK], [0.1, R_COCK], [RELEASE_Q, R_REL], [0.7, R_FOLLOW], [1, R_FOLLOW]], c01(q));
  return hand === "L" ? mirrorPose(p) : p;
};
/** Which palm (shot figure index) throws: 0 is the figure's right (-x when it faces +z), 1 its left. */
export const throwIndex = (hand: Hand): 0 | 1 => (hand === "L" ? 1 : 0);

// Fielder at the bag: crouched, glove reaching toward the runner, tag at q = TAG_Q.
export const TAG_Q = 0.55;
/** Where the covering fielder stands, behind the bag on the camera side's far edge (metres from the bag along the camera normal). */
export const FIELDER_BACK = 0.45;
/** The tag point: low, on the runner's leading foot, which is `run` metres short of the bag along the travel direction. */
export const tagPoint = (a: { bx: number; bz: number; dx: number; dz: number }, run: number): Vec3 => [a.bx - a.dx * (run + 0.1), 0.3, a.bz - a.dz * (run + 0.1)];
const F_SET = pose({
  hips: [0, 0, 0], torso: [0.55, 0, 0], head: [-0.4, 0, 0],
  armR: [-1.0, 0, -0.35], foreR: -0.55, armL: [-0.8, 0, 0.5], foreL: -1.3,
  legL: [-1.0, 0, 0.35], shinL: 1.6, legR: [-0.85, 0, -0.35], shinR: 1.45,
});
const F_TAG = pose({
  hips: [0, 0.2, 0], torso: [1.0, 0.2, 0], head: [-0.7, 0, 0],
  armR: [-1.45, 0, -0.1], foreR: -0.1, armL: [-0.9, 0, 0.55], foreL: -1.45,
  legL: [-1.0, 0, 0.35], shinL: 1.65, legR: [-0.95, 0, -0.3], shinR: 1.5,
});
export const fielderPose = (q: number): Pose => keyed([[0, F_SET], [TAG_Q, F_TAG], [1, F_TAG]], c01(q));

// Runner sliding feet first. The whole figure is laid back by the field code (see SLIDER_TILT); these are the limbs.
export const SLIDER_TILT = 1.3;
/** Height of the runner's hips above the dirt while sliding (the pelvis is the tilt pivot). */
export const SLIDER_HIP = 0.3;
const S_SLIDE = pose({
  hips: [0, 0, 0], torso: [-0.1, 0, 0], head: [-0.3, 0, 0],
  armL: [0.7, 0, 0.9], foreL: -0.5, armR: [0.5, 0, -0.95], foreR: -0.4,
  legL: [-0.12, 0, 0.08], shinL: 0.05, legR: [-0.55, 0, -0.5], shinR: 1.7,
});
export const sliderPose = (_q: number): Pose => S_SLIDE;

// --- framing ----------------------------------------------------------------------------------------------------------

/** The widest vertical lens the shot cameras are authored for; a narrower screen widens the lens to keep the same horizontal view. */
export const REF_ASPECT = 1.5;
/** Vertical fov for the screen aspect, keeping the authored horizontal field of view when the screen is narrower than the reference. */
export function fitFov(fov: number, aspect: number): number {
  if (!(aspect > 0) || aspect >= REF_ASPECT) return fov;
  const half = Math.tan((fov * Math.PI) / 360) * (REF_ASPECT / aspect);
  return Math.min(100, (2 * Math.atan(half) * 180) / Math.PI);
}

export interface Blocker { x: number; z: number; r?: number; h?: number }
export interface FrameCheck {
  pos: Vec3; look: Vec3; fov: number; aspect: number;
  /** Points on the people the shot is about (head, feet, hands, bat end). */
  subjects: Vec3[];
  /** Ball positions that must be visible. */
  ball?: Vec3[];
  /** Other standing figures that may hide a subject. */
  blockers?: Blocker[];
  /** Fraction of the half-frame kept clear at every edge. */
  margin?: number;
}

/** Normalised device coords of a world point for a look-at camera, or null when it is behind the lens. x, y in -1..1 inside the frame. */
export function project(pos: Vec3, look: Vec3, fov: number, aspect: number, p: Vec3): { x: number; y: number; depth: number } | null {
  const f = norm([look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]]);
  const rt = norm([-f[2], 0, f[0]]); // right = forward x up(0,1,0)
  const up: Vec3 = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
  const d: Vec3 = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (depth < 0.1) return null;
  const th = Math.tan((fov * Math.PI) / 360);
  return {
    x: (d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2]) / (depth * th * aspect),
    y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (depth * th),
    depth,
  };
}

/** True when the sight line from the camera to `p` passes through a standing figure that is in front of `p`. */
export function hiddenBy(pos: Vec3, p: Vec3, b: Blocker): boolean {
  const r = b.r ?? FIGURE_RADIUS, h = b.h ?? FIGURE_HEIGHT;
  const dx = p[0] - pos[0], dz = p[2] - pos[2], len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return false;
  const t = Math.min(1, Math.max(0, ((b.x - pos[0]) * dx + (b.z - pos[2]) * dz) / len2));
  const cx = pos[0] + dx * t, cz = pos[2] + dz * t;
  if (Math.hypot(cx - b.x, cz - b.z) >= r) return false;
  if (Math.hypot(p[0] - b.x, p[2] - b.z) < r + 0.1) return false; // the point belongs to this figure
  const y = pos[1] + (p[1] - pos[1]) * t;
  return t < 1 && y >= 0 && y <= h;
}

/** Do the subjects and the ball project inside the frame with margin, and is none of them hidden by another figure? */
export function canFrame(c: FrameCheck): boolean {
  const m = 1 - (c.margin ?? 0.08), fov = fitFov(c.fov, c.aspect);
  for (const p of [...c.subjects, ...(c.ball ?? [])]) {
    const s = project(c.pos, c.look, fov, c.aspect, p);
    if (!s || Math.abs(s.x) > m || Math.abs(s.y) > m) return false;
    if ((c.blockers ?? []).some((b) => hiddenBy(c.pos, p, b))) return false;
  }
  return true;
}

const FIG_TOP = 1.85;
/** Points that outline a standing/crouched figure at a root: feet, hips and head. */
const body = (x: number, z: number, top = FIG_TOP): Vec3[] => [[x, 0.1, z], [x, top * 0.55, z], [x, top, z]];

/**
 * The subjects and the ball the shot must keep in frame, at the three timing fixtures (early, mid, late), for a plan's
 * event. Built from the event facts (the stage re-derives the same anchors from the recording). `aspect` is the screen's.
 */
export function framesFor(camera: ShotCamera, events: GameEvent[], i: number, aspect: number, bats?: "L" | "R" | "S", throws: Hand = "R"): FrameCheck[] {
  const e = events[i];
  const standing = (skip: number[]): Blocker[] => FIELD_XZ.filter((_, k) => !skip.includes(k)).map(([x, z]) => ({ x, z }));
  const out: FrameCheck[] = [];
  for (const q of [0.15, 0.5, 0.85]) {
    if (camera === "contact" && e?.type === "play") {
      const sc = contactScene(null, i, bats, e.shot), p = shotPose("contact", q, false, 1, sc.side);
      const b = sc.batter, ball = contactBall(q, HIT_DEFAULT[sc.side === 1 ? 0 : 1], sc.dir);
      out.push({
        pos: p.pos, look: p.look, fov: p.fov, aspect, subjects: body(b.x, b.z),
        // The ball must be in frame while it leaves the bat (early, mid); by the late fixture it is allowed to have flown on.
        ball: q <= 0.5 ? [ball] : [],
        blockers: [],
      });
    } else if (camera === "release") {
      const sc = releaseScene(null, i, undefined), pt = sc.pitcher, hs = throws === "L" ? 1 : -1;
      const p = shotPose("release", q, false, 1, hs);
      const root = pt.z + 0.6 * Math.min(1, q / 0.35) ** 2, palm: Vec3 = [pt.x + hs * 0.35, 1.82, root + 0.42];
      const f = Math.max(0, (q - RELEASE_Q) / (1 - RELEASE_Q)), ee = f * f * 0.9 + f * 0.1, tg = sc.target;
      const ball: Vec3 = [palm[0] + (tg[0] - palm[0]) * ee, palm[1] + (tg[1] - palm[1]) * ee, palm[2] + (tg[2] - palm[2]) * ee];
      out.push({ pos: p.pos, look: p.look, fov: p.fov, aspect, subjects: [...body(pt.x, root), palm], ball: q <= 0.5 ? [ball] : [], blockers: standing([0]) });
    } else if (camera === "slide") {
      const sub = slideSubject(events, i);
      if (!sub) return [];
      const sc = slideScene(null, i, sub), a = sc.axes, p = shotPose("slide", q, false, sub.base);
      const run = 1.7 - 1.35 * q, tag = tagPoint(a, run);
      out.push({
        pos: p.pos, look: p.look, fov: p.fov, aspect,
        subjects: [[a.bx - a.dx * run, 0.3, a.bz - a.dz * run], ...body(a.bx - a.nx * FIELDER_BACK, a.bz - a.nz * FIELDER_BACK, 1.4)],
        ball: q >= TAG_Q ? [tag] : [],
        blockers: standing([0, sc.slot]),
      });
    }
  }
  return out;
}

// Re-exports the shot code needs from one place.
export { BASE_XZ };
