import { useEffect, useState } from "react";

// Presentation-only comfort settings (W36a). Never read by the sim, never stored in a snapshot or an input log, so
// neither can change an outcome or a replay hash. Same persistence pattern as quality.ts and haptics.ts.
export type Comfort = "lefty" | "calm";
const KEY: Record<Comfort, string> = { lefty: "bb.lefty", calm: "bb.reducedFlash" };
const listeners = new Set<() => void>();
const read = (k: Comfort): boolean => { try { return localStorage.getItem(KEY[k]) === "1"; } catch { return false; } };
const state: Record<Comfort, boolean> = { lefty: read("lefty"), calm: read("calm") };
const osReduced = () => { try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; } };

/** Reduced flash: the setting, or the OS reduced-motion preference. Removes flashes and pulses; every cue stays as text or shape. */
export const reducedFlash = () => state.calm || osReduced();
export const isLefty = () => state.lefty;

/** `data-calm` / `data-lefty` on <html> let CSS drop every flash and pulse, and mirror every control cluster, in one place. */
function sync() { try { const d = document.documentElement.dataset; d.calm = reducedFlash() ? "1" : "0"; d.lefty = state.lefty ? "1" : "0"; } catch { /* no document */ } }
sync();
try { window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => { sync(); listeners.forEach((l) => l()); }); } catch { /* no matchMedia */ }

export function setComfort(k: Comfort, on: boolean) {
  state[k] = on;
  try { localStorage.setItem(KEY[k], on ? "1" : "0"); } catch { /* private mode */ }
  sync();
  listeners.forEach((l) => l());
}

export function useComfort(k: Comfort): [boolean, () => void] {
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return [k === "calm" ? reducedFlash() : state[k], () => setComfort(k, !state[k])];
}
