import { useEffect, useMemo, useState } from "react";
import type { GameEvent } from "@bb/sim";
import { ActionShotDirector, type ActionShotMode, type ShotPlan } from "./actionshot.ts";
import { canFrame, framesFor } from "./shotscene.ts";

// The `actionShots` setting: how often the post-play action cameras run. Stored like quality.ts's `bb.quality`. It is
// never read by the sim and never stored in a snapshot or an input log, so it cannot change a replay.
export const ACTION_SHOT_MODES: ActionShotMode[] = ["full", "reduced", "off"];
export const ACTION_SHOT_LABEL: Record<ActionShotMode, string> = { full: "Full", reduced: "Reduced", off: "Off" };

const KEY = "bb.actionShots";
const DEFAULT: ActionShotMode = "reduced";
let current = read();
const listeners = new Set<() => void>();

function read(): ActionShotMode {
  try { const v = localStorage.getItem(KEY); return ACTION_SHOT_MODES.includes(v as ActionShotMode) ? (v as ActionShotMode) : DEFAULT; } catch { return DEFAULT; }
}

export const getActionShots = (): ActionShotMode => current;

export function setActionShots(m: ActionShotMode) {
  current = m;
  try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
  for (const l of listeners) l();
}

export function useActionShots(): [ActionShotMode, (m: ActionShotMode) => void] {
  const [m, setM] = useState(current);
  useEffect(() => {
    const l = () => setM(current);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [m, setActionShots];
}

/** True when the OS asks for less motion; action shots then never run the full variant. */
export const prefersReducedMotion = () => { try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; } };

/** The plan for each event, plus the director that owns the lifecycle (begin/finish/active/skip) of every shot. */
export type ShotPlans = ((i: number) => ShotPlan | null) & { director: ActionShotDirector };

/** The viewport aspect the shots are framed for; a plan whose subjects would not fit is dropped before it runs. */
const viewAspect = () => { try { return window.innerWidth / Math.max(1, window.innerHeight); } catch { return 1.5; } };

/** The shot plan for each event of one game view. One director per game and setting, so every consumer (hold timer, skip button, field) agrees. */
export function useShotPlans(events: GameEvent[], innings: number, key: unknown): ShotPlans {
  const [mode] = useActionShots();
  const reduced = prefersReducedMotion();
  const director = useMemo(() => new ActionShotDirector({
    mode, reducedMotion: reduced, innings,
    canFrame: (plan) => {
      const checks = framesFor(plan.camera, events, plan.index, viewAspect());
      return checks.length > 0 && checks.every(canFrame);
    },
  }), [mode, reduced, innings, key, events]);
  // Dev/shot readout: `__actionShotTelemetry()` in the console. Nothing in the app reads it back.
  if (import.meta.env.DEV) (window as unknown as { __actionShotTelemetry: unknown }).__actionShotTelemetry = () => director.telemetry();
  return useMemo(() => Object.assign((i: number) => (events[i] ? director.consider(events, i) : null), { director }), [director, events]);
}
