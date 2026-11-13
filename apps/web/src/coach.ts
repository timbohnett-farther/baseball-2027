import type { Awaiting } from "@bb/sim";

// Pure rules for the Rookie Rally guide and the in-game coach hints (ARC Appendix C). The bubble itself is coach.tsx.

export interface Situation {
  role: Awaiting["role"];
  strikes: number;
  /** Some ability chip is affordable and usable right now. */
  abilityReady: boolean;
  /** A ball in play with throw options (a force play to make). */
  force: boolean;
  /** At least one runner could steal on this pitch. */
  steal: boolean;
  breaker: boolean;
}

export function situationOf(a: Awaiting): Situation {
  return {
    role: a.role,
    strikes: a.state.strikes,
    abilityReady: a.abilities.some((x) => x.available),
    force: a.role === "field" && !!a.ball?.throws,
    steal: !!a.run?.steal.length,
    breaker: !!a.team?.available,
  };
}

// --- Rookie Rally lessons, in teaching order ------------------------------------------------------

export interface Lesson { id: string; title: string; text: string; when: (s: Situation) => boolean }

export const LESSONS: readonly Lesson[] = [
  { id: "pitch-pick", title: "Pick a pitch", text: "Tap Fastball, Slider, Change or Curve.", when: (s) => s.role === "pitch" },
  { id: "pitch-aim", title: "Aim it", text: "Tap one of the 9 squares. Corners are hard to hit; the middle is easy.", when: (s) => s.role === "pitch" },
  { id: "swing-timing", title: "Time your swing", text: "Tap SWING just as the ball reaches the plate. Too early or late is a miss.", when: (s) => s.role === "swing" },
  { id: "swing-kind", title: "Contact or Power", text: "Contact finds hits. Power can crush homers but is harder to time. Take a bad pitch.", when: (s) => s.role === "swing" },
  { id: "heat-chip", title: "Use your Heat", text: "Heat is high enough! Tap a glowing chip to arm a special move, then go.", when: (s) => s.abilityReady && s.role !== "field" && s.role !== "run" },
  { id: "field-auto", title: "Fielding", text: "Your fielder runs to the ball by himself. Just tap GLOVE as it arrives.", when: (s) => s.role === "field" },
  { id: "field-throw", title: "Throw to a base", text: "Force play! Tap a base on the diamond to throw there. The star is the safe call.", when: (s) => s.force },
  { id: "field-special", title: "Special catch", text: "Arm a glove chip before you tap for a diving or wall catch.", when: (s) => s.role === "field" && s.abilityReady },
  { id: "run-go", title: "Baserunning", text: "Tap GO to send a runner for the extra base, or hold them.", when: (s) => s.role === "run" },
  { id: "run-steal", title: "Steal", text: "Tap a runner's STEAL before the pitch. A good lead means better odds.", when: (s) => s.steal },
  { id: "rally-breaker", title: "Rally Breaker", text: "When the whole team is hot, Rally Breaker cools the other side. Tap once, then confirm.", when: (s) => s.breaker },
];

/** The first lesson not yet seen that fits this moment, or null. */
export function nextLesson(seen: readonly string[], s: Situation | null): Lesson | null {
  if (!s) return null;
  return LESSONS.find((l) => !seen.includes(l.id) && l.when(s)) ?? null;
}

export const withSeen = (seen: readonly string[], id: string): string[] => (seen.includes(id) ? [...seen] : [...seen, id]);

/** 1-based place of a lesson in the course, for "Step 3 of 11". */
export const stepOf = (id: string) => ({ n: LESSONS.findIndex((l) => l.id === id) + 1, of: LESSONS.length });

// --- Coach hints in normal games ------------------------------------------------------------------

export interface Hint { id: string; text: string; /** Most times it is ever shown on this device. */ max: number; when: (s: Situation) => boolean }

export const HINTS: readonly Hint[] = [
  { id: "ability_ready", text: "Heat is up. Tap a glowing chip to arm a special move.", max: 2, when: (s) => s.abilityReady && s.role !== "field" && s.role !== "run" },
  { id: "force_play", text: "Force play: tap the base to throw to. The star is the safe call.", max: 2, when: (s) => s.force },
  { id: "steal_chance", text: "Steal chance: tap a runner's STEAL before the pitch.", max: 2, when: (s) => s.steal },
  { id: "two_strikes", text: "Two strikes. Protect the plate: Contact is safer than Power.", max: 3, when: (s) => s.role === "swing" && s.strikes === 2 },
];

export interface HintPrefs { off: boolean; shown: Record<string, number> }
export const FRESH_PREFS: HintPrefs = { off: false, shown: {} };

export function pickHint(s: Situation | null, prefs: HintPrefs): Hint | null {
  if (!s || prefs.off) return null;
  return HINTS.find((h) => (prefs.shown[h.id] ?? 0) < h.max && h.when(s)) ?? null;
}
export const recordShown = (p: HintPrefs, id: string): HintPrefs => ({ ...p, shown: { ...p.shown, [id]: (p.shown[id] ?? 0) + 1 } });
/** Dismissing retires a hint for good. */
export const retireHint = (p: HintPrefs, id: string): HintPrefs => {
  const h = HINTS.find((x) => x.id === id);
  return h ? { ...p, shown: { ...p.shown, [id]: h.max } } : p;
};
export const setHintsOff = (p: HintPrefs, off: boolean): HintPrefs => ({ ...p, off });

/** Reads stored prefs, tolerating anything a past version or a hand edit left behind. */
export function parsePrefs(raw: string | null): HintPrefs {
  try {
    const o = JSON.parse(raw ?? "") as Partial<HintPrefs>;
    const shown: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.shown ?? {})) if (typeof v === "number" && Number.isFinite(v)) shown[k] = v;
    return { off: o.off === true, shown };
  } catch { return FRESH_PREFS; }
}
