import { useEffect, useState } from "react";

// Presentation-only build label and frame-rate readout (W39). Off by default; never read by the sim, never stored in a
// snapshot or input log. Same persistence pattern as comfort.ts.
const KEY = "bb.buildLabel";
const listeners = new Set<() => void>();
let on = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export function setBuildLabel(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

export function useBuildLabel(): [boolean, () => void] {
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return [on, () => setBuildLabel(!on)];
}

/** "build abc1234 · 59 fps"; the build is the server's /health version ("dev" locally), fps is omitted until measured. */
export function buildLabelText(version: string | null, fps: number | null): string {
  return `build ${version ?? "…"}${fps === null ? "" : ` · ${Math.round(fps)} fps`}`;
}

/** Frames per second from a list of frame timestamps (ms); null with fewer than two. */
export function fpsFromFrames(times: number[]): number | null {
  if (times.length < 2) return null;
  const span = times[times.length - 1] - times[0];
  return span > 0 ? ((times.length - 1) * 1000) / span : null;
}
