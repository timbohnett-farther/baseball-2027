import { gameplayTelemetry } from "./gameplaytelemetry.ts";
import { useEffect, useRef, useState } from "react";
import type { Awaiting } from "@bb/sim";
import { HINTS, nextLesson, parsePrefs, pickHint, recordShown, retireHint, setHintsOff, situationOf, stepOf, withSeen, type HintPrefs } from "./coach.ts";

const KEY = "bb.coach";
const read = (): HintPrefs => { try { return parsePrefs(localStorage.getItem(KEY)); } catch { return parsePrefs(null); } };
const write = (p: HintPrefs) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } };

/** Coach tips on/off, remembered on this device. */
export function useCoachTips(): [boolean, () => void] {
  const [on, setOn] = useState(() => !read().off);
  return [on, () => setOn((v) => { write(setHintsOff(read(), v)); return !v; })];
}

/**
 * The speech bubble: Rookie Rally lessons in order, or one-time hints in a normal game. It never takes input from the
 * field (only its own OK button is clickable), and it moves out of the way on its own: `moveKey` changes on every play.
 */
export function Coach({ mode, awaiting, moveKey }: { mode: "tutorial" | "hints"; awaiting: Awaiting | null; moveKey: number }) {
  const [seen, setSeen] = useState<string[]>([]);
  const [shot, setShot] = useState<{ id: string; at: number } | null>(null); // the hint on screen, and the move it appeared on
  const [dismissed, setDismissed] = useState<{ id: string; at: number } | null>(null);
  const sit = awaiting ? situationOf(awaiting) : null;

  const lesson = mode === "tutorial" ? nextLesson(seen, sit) : null;
  // Each hint is counted once, the moment it first appears, and then stays up until the player moves on.
  const prefsRef = useRef<HintPrefs>(read());
  const picked = mode === "hints" && !shot ? pickHint(sit, prefsRef.current) : null;
  useEffect(() => {
    if (shot && shot.at !== moveKey) setShot(null);
    else if (picked) { prefsRef.current = recordShown(prefsRef.current, picked.id); write(prefsRef.current); gameplayTelemetry.hint(picked.id); setShot({ id: picked.id, at: moveKey }); }
  }, [picked, shot, moveKey]);
  const hint = mode === "hints" && shot && shot.at === moveKey && !(dismissed?.id === shot.id && dismissed.at === moveKey)
    ? HINTS.find((h) => h.id === shot.id) ?? null : null;

  // Acting on a lesson counts as having learned it. (Declared in this order: the move effect must read the lesson
  // that was on screen before the move, then the ref moves on to the next one.)
  const lessonId = lesson?.id;
  const lastLesson = useRef<string | undefined>(undefined);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (lastLesson.current) setSeen((s) => withSeen(s, lastLesson.current!));
  }, [moveKey]);
  useEffect(() => { lastLesson.current = lessonId; }, [lessonId]);

  if (!awaiting) return null;
  if (lesson) {
    const { n, of } = stepOf(lesson.id);
    return (
      <div className="coach" role="note" aria-live="polite">
        <p><b>{lesson.title}</b> <span className="coach-step">{n}/{of}</span><br />{lesson.text}</p>
        <button onClick={() => setSeen((s) => withSeen(s, lesson.id))}>OK</button>
      </div>
    );
  }
  if (hint) {
    return (
      <div className="coach" role="note" aria-live="polite">
        <p>{hint.text}</p>
        <button aria-label="Dismiss tip" onClick={() => { prefsRef.current = retireHint(prefsRef.current, hint.id); write(prefsRef.current); setDismissed({ id: hint.id, at: moveKey }); }}>OK</button>
      </div>
    );
  }
  return null;
}
