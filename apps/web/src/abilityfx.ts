import type { AbilityId, GameEvent } from "@bb/sim";

// PUP 12: every ability has a short activation cue (colour + icon shape + name) and a synthesized sound.
// Colour is never the only identifier. Mirage's spec carries nothing about the pitch it disguises.

export type AbilityDomain = "bat" | "pitch" | "field" | "run";

/** PUP 12 domain colours: batting amber, pitching violet, fielding cyan, running green. */
export const DOMAIN_COLOR: Record<AbilityDomain, string> = { bat: "#f5a524", pitch: "#9b6dff", field: "#22c7e0", run: "#3ccf6e" };

export interface AbilityFx {
  name: string; domain: AbilityDomain; icon: string;
  /** Visual cue length. Under the 300 ms arming cap plus a short fade; never full-screen. */
  ms: number;
  /** Sound recipe consumed by audio.ts (all synthesized). */
  sound: { wave: "sine" | "triangle" | "square" | "sawtooth"; from: number; to: number; dur: number; noise?: "high" | "band" | "low" };
}

export const ABILITY_FX: Record<AbilityId, AbilityFx> = {
  BAT_COMET: { name: "Comet", domain: "bat", icon: "☄", ms: 700, sound: { wave: "sawtooth", from: 1400, to: 300, dur: 0.28, noise: "high" } },
  BAT_LASER: { name: "Laser", domain: "bat", icon: "━", ms: 600, sound: { wave: "square", from: 2200, to: 2200, dur: 0.12, noise: "high" } },
  BAT_GAP_MASTER: { name: "Gap Master", domain: "bat", icon: "⇔", ms: 700, sound: { wave: "triangle", from: 300, to: 700, dur: 0.3 } },
  BAT_SECOND_SWING: { name: "Second Swing", domain: "bat", icon: "↻", ms: 700, sound: { wave: "triangle", from: 500, to: 500, dur: 0.1 } },
  PITCH_MIRAGE: { name: "Mirage", domain: "pitch", icon: "?", ms: 700, sound: { wave: "sine", from: 600, to: 880, dur: 0.35 } },
  PITCH_VORTEX: { name: "Vortex", domain: "pitch", icon: "@", ms: 700, sound: { wave: "sawtooth", from: 200, to: 900, dur: 0.4, noise: "band" } },
  FIELD_WALL_REAPER: { name: "Wall Reaper", domain: "field", icon: "▲", ms: 700, sound: { wave: "square", from: 180, to: 120, dur: 0.22, noise: "low" } },
  FIELD_ACROBAT: { name: "Acrobat", domain: "field", icon: "✦", ms: 700, sound: { wave: "sine", from: 500, to: 1200, dur: 0.25 } },
  FIELD_CANNON_ARM: { name: "Cannon Arm", domain: "field", icon: "➤", ms: 700, sound: { wave: "sawtooth", from: 900, to: 150, dur: 0.2, noise: "band" } },
  RUN_AFTERBURNER: { name: "Afterburner", domain: "run", icon: "»", ms: 700, sound: { wave: "sawtooth", from: 250, to: 1100, dur: 0.45, noise: "high" } },
};

export interface AbilityCue { id: AbilityId; fx: AbilityFx; phase: "committed" | "triggered"; side: "home" | "away" }

/** The cue an event should show, or null (expired/rejected abilities and other event types show none). */
export function cueFor(e: GameEvent): AbilityCue | null {
  if (e.type !== "ability" || (e.phase !== "committed" && e.phase !== "triggered")) return null;
  const fx = ABILITY_FX[e.ability];
  return fx ? { id: e.ability, fx, phase: e.phase, side: e.side } : null;
}
