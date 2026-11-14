// Subtitles for the cue engine: a small non-blocking status line. The line is text-only, never
// the sole carrier of a result (the play card and scorebug show it too), and works while muted.
import { useEffect, useState } from "react";
import type { Caption } from "./cues.ts";

const KEY = "bb.captions";
let on = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } })();
let current: Caption | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const captionsOn = () => on;

/** Engine sink. Clears itself when the hold time is up. */
export function showCaption(c: Caption | null) {
  current = c;
  clearTimeout(timer);
  if (c) timer = setTimeout(() => { if (current === c) { current = null; emit(); } }, Math.max(0, c.until - Date.now()));
  emit();
}

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function useCaptions(): [boolean, () => void] {
  const [v, setV] = useState(on);
  useEffect(() => subscribe(() => setV(on)), []);
  return [v, () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
    if (!on) showCaption(null);
    emit();
  }];
}

/** Pointer-transparent so it can never block a touch target; layout lives in styles.css. */
export function CueCaption() {
  const [c, setC] = useState(current);
  const [enabled] = useCaptions();
  useEffect(() => subscribe(() => setC(current)), []);
  return (
    <div className="cue-caption" role="status" aria-live="polite" aria-atomic="true" data-on={enabled && c ? "1" : "0"}>
      {enabled && c ? c.text : ""}
    </div>
  );
}
