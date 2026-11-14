import { useEffect, useState } from "react";
import type { GameEvent } from "@bb/sim";

// ARC 10.7: haptics are an extra, never the only channel; they can be turned off; unsupported devices do nothing.
const KEY = "bb.haptics";
let enabled = read();
const listeners = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

export type HapticCue = "tap" | "contact" | "hit" | "homer" | "out" | "strikeout" | "ability" | "breaker";

/** vibrate() patterns in ms (on, off, on, ...). Kept short; the longest is under 300 ms. */
export const HAPTIC_PATTERNS: Record<HapticCue, number[]> = {
  tap: [8],
  contact: [18],
  hit: [20, 30, 20],
  homer: [30, 40, 30, 40, 80],
  out: [14],
  strikeout: [24, 50, 24],
  ability: [12, 24, 12],
  breaker: [40, 30, 60],
};

/** Which cue, if any, an event earns. `mine` = the event belongs to the user's side. */
export function hapticFor(e: GameEvent, mine: boolean): HapticCue | null {
  switch (e.type) {
    case "ability": return e.phase === "triggered" && mine ? "ability" : null;
    case "team": return "breaker";
    case "pitch": return e.result === "in_play" ? null : e.result === "swinging_strike" ? "tap" : null;
    case "play":
      if (!mine) return null; // buzz for what you did, not for what happened to you
      if (e.outcome === "home_run") return "homer";
      if (e.outcome === "strikeout") return "strikeout";
      if (e.outcome === "single" || e.outcome === "double" || e.outcome === "triple") return "hit";
      return null;
    default: return null;
  }
}

/** Pure: the pattern to send, or null when the cue is off, unknown, or the user has haptics disabled. */
export function patternFor(cue: HapticCue | null, on: boolean, reduced = false): number[] | null {
  if (!cue || !on) return null;
  const p = HAPTIC_PATTERNS[cue];
  return reduced ? [p[0]] : p; // reduced motion keeps a single tick
}

export const hapticsEnabled = () => enabled;

export function vibrate(cue: HapticCue | null, calm = false) {
  try {
    const reduced = calm || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const p = patternFor(cue, enabled, reduced);
    if (p && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(p);
  } catch { /* unsupported or blocked: stay silent */ }
}

export const hapticsSupported = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export function useHaptics(): [boolean, () => void] {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    const l = () => setOn(enabled);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [on, () => {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { /* private mode */ }
    if (enabled) vibrate("tap");
    for (const l of listeners) l();
  }];
}
