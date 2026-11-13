import type { AbilityDirection, AbilityId, AbilityRequest, AbilityStatus, DisabledReason } from "./types.ts";

/**
 * Power-up abilities (PUP sections 4-8), rules v4. Two halves live here:
 *  - the activation service (arm / cancel / commit / expire, Heat reservation, cooldowns), which only
 *    knows ids and numbers, and
 *  - the modifier pipeline: each ability's physics from the PRD, translated into small bounded nudges on
 *    this engine's probabilities. Nothing here draws from the RNG, so a game that never commits an
 *    ability plays out exactly as it did under rules v3.
 */

export type AbilityRole = "bat" | "pitch" | "field" | "run";
export type SwingKind = "contact" | "power";

/**
 * Everything an ability may change, neutral by default. Stages run in this order (PUP 5.1: pre-pitch
 * ability, then timing window, then contact, then caps):
 *  pitch   - where the user's pitch lands and how hard it is to square up (missScale, locShift, whiffAdd)
 *  timing  - how forgiving the swing window is (windowScale) and the near-miss rescue (rescueQ)
 *  batted  - the odds for the ball in play (dHr, dHit, dGround, dDouble, dFly, popupBelowQ)
 */
export interface Effects {
  missScale: number; locShift: number; whiffAdd: number;
  windowScale: number; rescueQ: number;
  dHr: number; dHit: number; dGround: number; dDouble: number; dFly: number; popupBelowQ: number;
  /** fielding (rules v5): reach shifts a contested ball toward the out, in fractions of the contest band; fieldWindow widens the glove timing window; dDp / wildThrow change the double-play throw. */
  reach: number; fieldWindow: number; dDp: number; wildThrow: number;
  /** baserunning (rules v6): added to the runner's own chance to steal or to beat the throw, before the final cap in game.ts. */
  run: number;
}

export const NEUTRAL: Effects = {
  missScale: 1, locShift: 0, whiffAdd: 0, windowScale: 1, rescueQ: 0,
  dHr: 0, dHit: 0, dGround: 0, dDouble: 0, dFly: 0, popupBelowQ: 0,
  reach: 0, fieldWindow: 1, dDp: 0, wildThrow: 0, run: 0,
};

/** PUP 5.1 step 7, global caps: however abilities stack, no field leaves its range. */
export const BOUNDS: Record<keyof Effects, [number, number]> = {
  missScale: [1, 1.5], locShift: [-0.2, 0.2], whiffAdd: [0, 0.06],
  windowScale: [0.8, 1], rescueQ: [0, 0.3],
  dHr: [-0.03, 0.05], dHit: [-0.08, 0.08], dGround: [-0.1, 0.05], dDouble: [0, 0.1], dFly: [-0.12, 0.05], popupBelowQ: [0, 0.5],
  reach: [0, 0.6], fieldWindow: [1, 1.4], dDp: [0, 0.2], wildThrow: [0, 0.1], run: [0, 0.1],
};

export interface AbilityDef {
  id: AbilityId; name: string; role: AbilityRole; cost: number;
  /** Swings it can ride on; empty for pitch abilities. */
  swings: SwingKind[];
  needsDirection: boolean;
  /** Pitches that must pass after it commits before the same athlete can use it again. 0 = none beyond the Heat cost. */
  cooldownPitches: number;
  summary: string;
  /**
   * The PRD physics as this engine's numbers, with the PRD line each one comes from.
   * Returns only what changes; the pipeline fills in the rest and clamps to BOUNDS.
   */
  effects: (direction?: AbilityDirection) => Partial<Effects>;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  BAT_COMET: {
    id: "BAT_COMET", name: "Comet", role: "bat", cost: 50, swings: ["power"], needsDirection: false, cooldownPitches: 0,
    summary: "Power swing: a more forgiving window and a harder, higher ball. Mis-timed ones pop up.",
    // PRD: window x0.85, exit speed x1.12, launch +6 degrees, popup risk when timing is poor, no automatic homer.
    // Harder and higher is about +4% homers and fewer grounders; the +8 degree popup risk below 0.45 timing is -6% hits.
    effects: () => ({ windowScale: 0.85, dHr: 0.04, dGround: -0.05, popupBelowQ: 0.45 }),
  },
  BAT_LASER: {
    id: "BAT_LASER", name: "Laser", role: "bat", cost: 50, swings: ["contact", "power"], needsDirection: false, cooldownPitches: 0,
    summary: "A hard line drive: more hits, fewer grounders and fly balls, a few fewer homers.",
    // PRD: exit speed x1.15, launch clamped to a line-drive band, fewer homers, more line drives.
    // Line drives fall for hits more often (+5%), so grounders (-8%) and flies (the fly/liner split moves 0.35 -> 0.25) shrink.
    effects: () => ({ dHr: -0.02, dHit: 0.05, dGround: -0.08, dFly: -0.1 }),
  },
  BAT_GAP_MASTER: {
    id: "BAT_GAP_MASTER", name: "Gap Master", role: "bat", cost: 40, swings: ["contact", "power"], needsDirection: true, cooldownPitches: 0,
    summary: "Spray it to the gap: more doubles, fewer homers. Pick left or right.",
    // PRD: +-10 degrees toward the chosen side, exit speed x0.90. A softer ball into the gap: more doubles (+8% of hits), a touch fewer homers.
    // The side only shows in the log and the play-by-play; the engine has no field geometry to steer.
    effects: () => ({ dHr: -0.015, dDouble: 0.08 }),
  },
  BAT_SECOND_SWING: {
    id: "BAT_SECOND_SWING", name: "Second Swing", role: "bat", cost: 60, swings: ["contact", "power"], needsDirection: false, cooldownPitches: 0,
    summary: "Save a badly mistimed swing: a clean miss becomes a foul. Never a strikeout out of nowhere, never a hit.",
    // PRD: rescues only a miss outside 1.20x and inside 1.60x of the windows, as one constrained foul.
    // Timing here is clamped to 0-1 so the band is "timing worse than 0.75 of perfect" (q below 0.25).
    effects: () => ({ rescueQ: 0.25 }),
  },
  PITCH_MIRAGE: {
    id: "PITCH_MIRAGE", name: "Mirage", role: "pitch", cost: 40, swings: [], needsDirection: false, cooldownPitches: 0,
    summary: "Hides the pitch type from the batter until it is almost on top of them.",
    // PRD: hides the type label until 200 ms after release; no physics change. So no numbers move: it only
    // matters to a hitter who reads the label, which the computer batter does not (W24).
    effects: () => ({}),
  },
  PITCH_VORTEX: {
    id: "PITCH_VORTEX", name: "Vortex", role: "pitch", cost: 50, swings: [], needsDirection: true, cooldownPitches: 0,
    summary: "Late, sharper break toward a side you pick, with a little less control.",
    // PRD: late break +0.40x base break, dispersion x1.35, same flight time, no automatic whiff.
    // The break is a 0.12 shift toward the chosen side, dispersion is the miss radius x1.35, and a pitch that bites is slightly harder to square up (+3% whiff).
    effects: (dir) => ({ missScale: 1.35, locShift: dir === "left" ? -0.12 : dir === "right" ? 0.12 : 0, whiffAdd: 0.03 }),
  },
  FIELD_WALL_REAPER: {
    id: "FIELD_WALL_REAPER", name: "Wall Reaper", role: "field", cost: 60, swings: [], needsDirection: false, cooldownPitches: 0,
    summary: "Fly ball at the wall: a better chance to rob a double or triple. Never undoes a home run.",
    // PRD: outfielder, wall robbery only, no reversal of a declared homer, never forces the catch.
    // The glove tap still decides the play; this only moves a close extra-base fly half a contest band toward the out.
    effects: () => ({ reach: 0.5 }),
  },
  FIELD_ACROBAT: {
    id: "FIELD_ACROBAT", name: "Acrobat", role: "field", cost: 50, swings: [], needsDirection: false, cooldownPitches: 0,
    summary: "Dive for a liner or fly: a wider glove window and a little more range.",
    // PRD: more catch range on a dive or liner. A wider tap window (x1.3) and 0.15 of a contest band of reach, on top of the tap.
    effects: () => ({ fieldWindow: 1.3, reach: 0.15 }),
  },
  FIELD_CANNON_ARM: {
    id: "FIELD_CANNON_ARM", name: "Cannon Arm", role: "field", cost: 45, swings: [], needsDirection: false, cooldownPitches: 0,
    summary: "Turn two with a faster throw: more double plays, with a small chance it sails.",
    // PRD: throw speed x1.30 and accuracy window x0.65. The speed is +15% on the double-play chance; the tighter window is an 8% chance the throw is wild and the double play is lost.
    effects: () => ({ dDp: 0.15, wildThrow: 0.08 }),
  },
  RUN_AFTERBURNER: {
    id: "RUN_AFTERBURNER", name: "Afterburner", role: "run", cost: 40, swings: [], needsDirection: false, cooldownPitches: 0,
    summary: "A burst of speed on a steal or a send: a better chance to beat the throw. Never a sure thing.",
    // PRD: 1.10 s burst, accel x1.60, top speed x1.12, movement only, never assigns a safe result, no force/tag ignored, no pickoff prevented.
    // A runner who is 12% faster for a second gets to the bag about a step sooner, which is +10 points on the runner's own odds (BOUNDS.run);
    // game.ts caps the final chance at 92%, so a throw can always still win.
    effects: () => ({ run: 0.1 }),
  },
};

/**
 * The ball a fielding ability is committed on (rules v5). Wall Reaper needs a fly ball, Acrobat a fly or a liner
 * (the plays you dive for), Cannon Arm a grounder with a double play on.
 */
export interface FieldContext { kind: "grounder" | "liner" | "fly"; doublePlay: boolean }
const FIELD_CONTEXT: Record<string, (c: FieldContext) => boolean> = {
  FIELD_WALL_REAPER: (c) => c.kind === "fly",
  FIELD_ACROBAT: (c) => c.kind !== "grounder",
  FIELD_CANNON_ARM: (c) => c.kind === "grounder" && c.doublePlay,
};
export const fieldContextOk = (id: string, c: FieldContext): boolean => FIELD_CONTEXT[id]?.(c) ?? false;

/** Fold ability effects into one set: scales multiply, nudges add, then global caps. The order of `list` is stage order. */
export function combine(list: Partial<Effects>[]): Effects {
  const out: Effects = { ...NEUTRAL };
  for (const e of list) {
    for (const k of Object.keys(e) as (keyof Effects)[]) {
      const v = e[k]!;
      out[k] = k === "missScale" || k === "windowScale" || k === "fieldWindow" ? out[k] * v : k === "rescueQ" || k === "popupBelowQ" ? Math.max(out[k], v) : out[k] + v;
    }
  }
  for (const k of Object.keys(BOUNDS) as (keyof Effects)[]) out[k] = Math.max(BOUNDS[k][0], Math.min(BOUNDS[k][1], out[k]));
  return out;
}

// --- Activation service (PUP 4) -----------------------------------------------------------

/** One athlete's side of the state machine. `armed` is the single Heat reservation (PUP 4.1). */
export interface Ledger {
  armed: { actorId: number; cost: number; request: AbilityRequest } | null;
  /** `${actorId}:${abilityId}` -> the pitch number it is usable again on. */
  cooldownUntil: Record<string, number>;
  /** Pitches thrown so far in the match; cooldowns count in these. */
  pitch: number;
}
export const newLedger = (): Ledger => ({ armed: null, cooldownUntil: {}, pitch: 0 });

export interface Actor { id: number; role: AbilityRole; heat: number }
export type Verdict = { ok: true } | { ok: false; reason: DisabledReason; message: string };

const no = (reason: DisabledReason, message: string): Verdict => ({ ok: false, reason, message });
const heatLeft = (ledger: Ledger, actor: Actor) => actor.heat - (ledger.armed && ledger.armed.actorId === actor.id ? ledger.armed.cost : 0);

/** Can this request be armed (or committed) right now? Pure: no state changes, no Heat touched. */
export function check(catalog: Record<string, AbilityDef>, ledger: Ledger, actor: Actor, req: AbilityRequest, swing?: SwingKind | "take"): Verdict {
  const def = catalog[req.id];
  if (!def) return no("WRONG_CONTEXT", "That ability isn't available.");
  if (def.role !== actor.role) return no("INELIGIBLE_ACTOR", def.role === "bat" ? "Only the batter can use this." : def.role === "pitch" ? "Only the pitcher can use this." : def.role === "run" ? "Only a runner can use this." : "Only the fielder can use this.");
  if (ledger.armed && ledger.armed.request.id !== req.id) return no("ALREADY_USED", "Another ability is already armed.");
  const until = ledger.cooldownUntil[`${actor.id}:${req.id}`] ?? 0;
  if (ledger.pitch < until) return no("COOLDOWN", `Recharging for ${until - ledger.pitch} more pitch${until - ledger.pitch === 1 ? "" : "es"}.`);
  if (swing === "take") return no("WRONG_CONTEXT", "You have to swing to use this.");
  if (swing && def.swings.length && !def.swings.includes(swing)) return no("WRONG_SWING", `${def.name} needs a ${def.swings.join(" or ")} swing.`);
  if (def.needsDirection && req.direction !== "left" && req.direction !== "right") return no("SELECT_DIRECTION", "Pick left or right first.");
  const free = heatLeft(ledger, actor) + (ledger.armed?.request.id === req.id ? ledger.armed.cost : 0);
  if (free < def.cost) return no("INSUFFICIENT_HEAT", `Needs ${def.cost} Heat, you have ${Math.max(0, Math.floor(free))}.`);
  return { ok: true };
}

/** Reserve the Heat. Refused requests change nothing. */
export function arm(catalog: Record<string, AbilityDef>, ledger: Ledger, actor: Actor, req: AbilityRequest): Verdict {
  const v = check(catalog, ledger, actor, req);
  if (v.ok) ledger.armed = { actorId: actor.id, cost: catalog[req.id].cost, request: req };
  return v;
}

/** PUP 4.6: cancelling (or a take, or a substitution) releases the whole reservation. */
export function cancel(ledger: Ledger): void { ledger.armed = null; }

/**
 * The commit point: re-checks against the swing actually made, deducts the cost and starts the cooldown.
 * Returns the Heat left. Once committed the cost is spent whether or not the effect ever triggers.
 */
export function commit(catalog: Record<string, AbilityDef>, ledger: Ledger, actor: Actor, swing?: SwingKind | "take"): Verdict & { heat?: number; def?: AbilityDef } {
  const a = ledger.armed;
  if (!a || a.actorId !== actor.id) return no("WRONG_CONTEXT", "Nothing is armed.");
  const v = check(catalog, ledger, actor, a.request, swing);
  if (!v.ok) return v;
  const def = catalog[a.request.id];
  ledger.armed = null;
  if (def.cooldownPitches > 0) ledger.cooldownUntil[`${actor.id}:${def.id}`] = ledger.pitch + 1 + def.cooldownPitches;
  return { ok: true, heat: Math.max(0, actor.heat - def.cost), def };
}

/** The pitch is over: an unspent reservation is released and the pitch counter moves on. */
export function expire(ledger: Ledger): void { ledger.armed = null; ledger.pitch++; }

/** What the UI chips show for this athlete right now. Swing kind isn't known until the swing, so it is checked at commit. */
export function statuses(catalog: Record<string, AbilityDef>, ledger: Ledger, actor: Actor): AbilityStatus[] {
  return Object.values(catalog).filter((d) => d.role === actor.role).map((d) => {
    const v = check(catalog, ledger, actor, { id: d.id, direction: d.needsDirection ? "left" : undefined });
    return { id: d.id, name: d.name, cost: d.cost, summary: d.summary, needsDirection: d.needsDirection, swings: d.swings, available: v.ok, ...(v.ok ? {} : { reason: v.reason, message: v.message }) };
  });
}
