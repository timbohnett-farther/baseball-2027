import { useEffect, useState } from "react";

// Graphics quality tier (roadmap 8.5 degradation order). It only trims how much the renderer draws: crowd, dust,
// shadows, pixel ratio and frame cap. It is never read by the sim, never stored in a snapshot, and never changes
// physics, input timing, ball position, ability tells, rule text or touch-target size.
export type Quality = "high" | "standard" | "battery";
export const QUALITIES: Quality[] = ["high", "standard", "battery"];
export const QUALITY_LABEL: Record<Quality, string> = { high: "High", standard: "Standard", battery: "Battery saver" };

export interface QualityProfile {
  pixelRatio: number;
  shadowMap: number; // 0 = shadows off
  crowd: number; // share of crowd points kept
  dust: number; // share of dust particles kept
  minFrameMs: number; // 0 = render every display frame; 29 = about 30 fps
  surface: 0 | 1 | 2; // W33 material detail: 0 flat colours, 1 procedural speckle maps, 2 adds bump and soft shadows
}

/** What the live stadium materials and shadows do at a tier (pure, so the tier -> look mapping is testable). */
export interface SurfaceLook {
  speckle: number; // 0..1 strength of the procedural grass/dirt maps; 0 = untextured flat colour
  bump: number; // bump-map scale on grass and dirt; 0 = no bump map
  softShadows: boolean; // PCF soft shadow filtering (only meaningful when shadowMap > 0)
}
export function surfaceLook(p: QualityProfile): SurfaceLook {
  return { speckle: p.surface === 0 ? 0 : p.surface === 1 ? 0.6 : 1, bump: p.surface >= 2 ? 0.5 : 0, softShadows: p.surface >= 2 && p.shadowMap > 0 };
}

export const QUALITY_PROFILE: Record<Quality, QualityProfile> = {
  high: { pixelRatio: 2, shadowMap: 2048, crowd: 1, dust: 1, minFrameMs: 0, surface: 2 },
  standard: { pixelRatio: 1.5, shadowMap: 1024, crowd: 0.5, dust: 0.5, minFrameMs: 0, surface: 1 },
  battery: { pixelRatio: 1, shadowMap: 0, crowd: 0.25, dust: 0.25, minFrameMs: 29, surface: 0 },
};

const KEY = "bb.quality";
let current = read();
const listeners = new Set<() => void>();

function read(): Quality {
  try { const v = localStorage.getItem(KEY); return QUALITIES.includes(v as Quality) ? (v as Quality) : "high"; } catch { return "high"; }
}

/** The tier a renderer should build with (read at construction; a change applies to the next game view). */
export const getQuality = (): Quality => current;

export function setQuality(q: Quality) {
  current = q;
  try { localStorage.setItem(KEY, q); } catch { /* private mode */ }
  for (const l of listeners) l();
}

export function useQuality(): [Quality, (q: Quality) => void] {
  const [q, setQ] = useState(current);
  useEffect(() => {
    const l = () => setQ(current);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [q, setQuality];
}
