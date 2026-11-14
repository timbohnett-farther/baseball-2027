// Presentation cues (W37a): which sound, haptic and subtitle an authoritative game event earns.
// Pure and React-free. Cues only READ events; nothing here can write game state, delay input or
// change a replay. Events carry no ids, so the array index within one game is the stable key and
// each cue fires at most once per index. Commentary is text-only (no speech), original, and
// neutral about who benefits, so it can never contradict the result it sits beside.
import type { AbilityId, GameEvent, Side } from "@bb/sim";
import { hapticFor, type HapticCue } from "./haptics.ts";

export type CueFamily = "pitch" | "contact" | "catch" | "tag" | "run" | "out" | "inning" | "ability" | "breaker" | "shot" | "objective" | "result";

/** Declarative sound recipes. audio.ts renders them; the engine only counts and filters them. */
export type Step =
  | { k: "crack"; hard: number }
  | { k: "pop" }
  | { k: "whoosh" }
  | { k: "sting"; up: boolean }
  | { k: "organ" }
  | { k: "swell"; amount: number; hold: number }
  | { k: "ability"; id: AbilityId }
  | { k: "chime"; notes: number[] };

export interface Hit { id: CueId; good: boolean; ability?: AbilityId; haptic: HapticCue | null }

export interface Cue {
  family: CueFamily;
  /** 0 background, 1 normal, 2 notable, 3 critical. Higher may interrupt a held subtitle and may use the voice reserve. */
  priority: 0 | 1 | 2 | 3;
  /** Min gap before this cue may sound or buzz again. */
  cooldownMs: number;
  /** Min gap before this cue's commentary may show again. */
  lineCooldownMs: number;
  /** What the sound is, in words: the text equivalent of the audio. */
  text: string;
  /** Subtitle variants, picked deterministically from the event index. Empty = sound only. */
  lines: string[];
  sound: (h: Hit) => Step[];
  /** Haptic for cues that are not game events. Event haptics come from hapticFor (haptics.ts). */
  haptic?: HapticCue;
}

const none = (): Step[] => [];
const swell = (good: boolean, a: number, b: number, hold: number): Step => ({ k: "swell", amount: good ? a : b, hold });

export const CUES = {
  pitch_ball: { family: "pitch", priority: 0, cooldownMs: 120, lineCooldownMs: 6000, text: "Glove pop, ball", lines: ["Ball.", "Just off the plate.", "Takes it."], sound: () => [{ k: "pop" }] },
  pitch_strike: { family: "pitch", priority: 0, cooldownMs: 120, lineCooldownMs: 6000, text: "Glove pop, called strike", lines: ["Called strike.", "Right on the edge.", "Strike, looking."], sound: () => [{ k: "pop" }] },
  pitch_whiff: { family: "pitch", priority: 0, cooldownMs: 120, lineCooldownMs: 6000, text: "Glove pop, swing and a miss", lines: ["Swung on and missed.", "Strike, swinging.", "Nothing but air."], sound: () => [{ k: "pop" }] },
  pitch_foul: { family: "pitch", priority: 0, cooldownMs: 120, lineCooldownMs: 6000, text: "Light bat tick, foul", lines: ["Fouled off.", "Back it goes, foul.", "Stays alive, foul ball."], sound: () => [{ k: "crack", hard: 0 }] },
  walk: { family: "pitch", priority: 1, cooldownMs: 300, lineCooldownMs: 1500, text: "Glove pop, ball four", lines: ["Ball four, take your base.", "Draws the walk.", "Four balls, to first."], sound: () => [{ k: "pop" }] },
  contact_single: { family: "contact", priority: 1, cooldownMs: 300, lineCooldownMs: 1500, text: "Bat crack, base hit", lines: ["Base hit.", "Into the outfield for a single.", "Finds a hole, one base."], sound: (h) => [{ k: "crack", hard: 0.6 }, swell(h.good, 0.15, 0.04, 0.8)] },
  contact_double: { family: "contact", priority: 2, cooldownMs: 300, lineCooldownMs: 1500, text: "Hard bat crack, double", lines: ["Into the gap for a double.", "Off the wall, two bases.", "Standing up at second."], sound: (h) => [{ k: "crack", hard: 0.8 }, swell(h.good, 0.3, 0.08, 1.5)] },
  contact_triple: { family: "contact", priority: 2, cooldownMs: 300, lineCooldownMs: 1500, text: "Hard bat crack, triple", lines: ["All the way to third, a triple.", "Digging for three.", "Rolling to the corner, three bases."], sound: (h) => [{ k: "crack", hard: 0.9 }, swell(h.good, 0.3, 0.08, 1.5)] },
  contact_homer: { family: "contact", priority: 3, cooldownMs: 600, lineCooldownMs: 1500, text: "Huge bat crack, home run", lines: ["Home run.", "That one is gone.", "Over the fence."], sound: (h) => [{ k: "crack", hard: 1 }, swell(h.good, 0.5, 0.1, 3), { k: "sting", up: h.good }] },
  catch_fly: { family: "catch", priority: 1, cooldownMs: 300, lineCooldownMs: 1500, text: "Soft bat tick, fly ball caught", lines: ["Fly ball, caught.", "Settles under it, out.", "Easy catch for the out."], sound: () => [{ k: "crack", hard: 0.2 }] },
  catch_line: { family: "catch", priority: 1, cooldownMs: 300, lineCooldownMs: 1500, text: "Sharp bat crack, line drive caught", lines: ["Line drive, caught.", "Snagged for the out.", "Hit hard, but right at a glove."], sound: () => [{ k: "crack", hard: 0.2 }] },
  catch_sac: { family: "catch", priority: 1, cooldownMs: 300, lineCooldownMs: 1500, text: "Soft bat tick, sacrifice fly", lines: ["Sacrifice fly, the run counts.", "Fly ball caught, and the runner tags up."], sound: () => [{ k: "crack", hard: 0.2 }] },
  out_ground: { family: "out", priority: 1, cooldownMs: 300, lineCooldownMs: 1500, text: "Soft bat tick, ground out", lines: ["Grounder, thrown out.", "Ground ball, one out.", "Fielded cleanly, out at first."], sound: () => [{ k: "crack", hard: 0.2 }] },
  out_strikeout: { family: "out", priority: 2, cooldownMs: 300, lineCooldownMs: 1500, text: "Glove pop, strike three", lines: ["Strike three.", "Struck him out.", "Down on strikes."], sound: (h) => [{ k: "pop" }, swell(h.good, 0.05, 0.2, 0.8)] },
  out_double_play: { family: "out", priority: 2, cooldownMs: 300, lineCooldownMs: 1500, text: "Soft bat tick, double play", lines: ["Double play.", "Turns two.", "Two outs on one play."], sound: () => [{ k: "crack", hard: 0.2 }] },
  run_score: { family: "run", priority: 2, cooldownMs: 400, lineCooldownMs: 1500, text: "Crowd swell, a run scores", lines: ["A run scores.", "Across the plate.", "That run counts."], sound: (h) => [swell(h.good, 0.3, 0.08, 1.5), { k: "sting", up: h.good }] },
  run_safe: { family: "run", priority: 1, cooldownMs: 300, lineCooldownMs: 1500, text: "Quick scuff, runner safe", lines: ["Safe.", "He takes the base.", "Gets in safely."], sound: () => [{ k: "whoosh" }] },
  tag_out: { family: "tag", priority: 2, cooldownMs: 300, lineCooldownMs: 1500, text: "Glove slap, runner out", lines: ["Tagged out.", "Out on the play.", "Caught, that runner is out."], sound: () => [{ k: "pop" }] },
  inning_start: { family: "inning", priority: 1, cooldownMs: 1500, lineCooldownMs: 1500, text: "Organ chord, new half-inning", lines: ["New half-inning under way.", "Teams trade places."], sound: () => [{ k: "organ" }] },
  ability_arm: { family: "ability", priority: 1, cooldownMs: 250, lineCooldownMs: 1200, text: "Soft rising blip, ability armed", lines: ["Ability armed."], sound: () => [{ k: "chime", notes: [440, 587] }] },
  ability_commit: { family: "ability", priority: 2, cooldownMs: 300, lineCooldownMs: 1200, text: "Ability sweep, ability committed", lines: ["Ability committed.", "The ability is locked in."], sound: (h) => [{ k: "ability", id: h.ability! }] },
  ability_trigger: { family: "ability", priority: 2, cooldownMs: 300, lineCooldownMs: 1200, text: "Bright double blip, ability triggered", lines: ["The ability triggers.", "Ability triggered."], sound: () => [{ k: "chime", notes: [660, 880] }] },
  ability_fizzle: { family: "ability", priority: 1, cooldownMs: 300, lineCooldownMs: 1200, text: "Falling blip, ability expired", lines: ["The ability expires unused.", "Ability expired."], sound: () => [{ k: "chime", notes: [330, 247] }] },
  ability_fail: { family: "ability", priority: 1, cooldownMs: 300, lineCooldownMs: 1200, text: "Low buzz, ability rejected", lines: ["The ability was rejected.", "Ability could not be used."], sound: () => [{ k: "chime", notes: [196] }] },
  rally_breaker: { family: "breaker", priority: 3, cooldownMs: 800, lineCooldownMs: 1500, text: "Rising swell, Rally Breaker", lines: ["Rally Breaker.", "The Rally Breaker kicks in."], sound: (h) => [swell(h.good, 0.4, 0.15, 2.5), { k: "sting", up: h.good }] },
  action_shot: { family: "shot", priority: 1, cooldownMs: 800, lineCooldownMs: 1500, text: "Camera whoosh, action shot", lines: ["Action camera on the play."], sound: () => [{ k: "whoosh" }] },
  objective_done: { family: "objective", priority: 2, cooldownMs: 800, lineCooldownMs: 1500, text: "Bright chime, objective complete", lines: ["Objective complete."], sound: () => [{ k: "chime", notes: [523, 659, 784] }], haptic: "tap" },
  result_win: { family: "result", priority: 3, cooldownMs: 1500, lineCooldownMs: 1500, text: "Victory swell, game won", lines: ["Final. Your side takes it.", "That is the ballgame, and it is yours."], sound: () => [swell(true, 0.5, 0.5, 4), { k: "sting", up: true }], haptic: "hit" },
  result_loss: { family: "result", priority: 3, cooldownMs: 1500, lineCooldownMs: 1500, text: "Low sting, game lost", lines: ["Final. Not this time.", "That is the ballgame."], sound: () => [swell(false, 0.15, 0.15, 4), { k: "sting", up: false }] },
} satisfies Record<string, Cue>;

export type CueId = keyof typeof CUES;
export const cueOf = (id: CueId): Cue => CUES[id] as Cue;
export const CUE_IDS = Object.keys(CUES) as CueId[];

const PLAY_CUE: Record<string, CueId> = {
  single: "contact_single", double: "contact_double", triple: "contact_triple", home_run: "contact_homer",
  flyout: "catch_fly", lineout: "catch_line", sac_fly: "catch_sac",
  groundout: "out_ground", strikeout: "out_strikeout", double_play: "out_double_play", walk: "walk",
};
const HIT_OUTCOMES = new Set(["single", "double", "triple", "home_run"]);

/** The cues an authoritative event earns, in priority order of listing. `userSide` is the human's side. */
export function cuesFor(e: GameEvent, userSide: Side): Hit[] {
  const batting: Side = e.state.half === "top" ? "away" : "home";
  const mine = batting === userSide;
  const hit = (id: CueId, good: boolean, extra: Partial<Hit> = {}): Hit => ({ id, good, haptic: null, ...extra });
  switch (e.type) {
    case "half_start": return [hit("inning_start", true)];
    case "pitch": {
      if (e.result === "in_play") return []; // the play event carries the contact
      const id = e.result === "ball" ? "pitch_ball" : e.result === "called_strike" ? "pitch_strike" : e.result === "swinging_strike" ? "pitch_whiff" : "pitch_foul";
      return [hit(id, !mine, { haptic: hapticFor(e, mine) })];
    }
    case "play": {
      const good = HIT_OUTCOMES.has(e.outcome) ? mine : !mine; // a hit is good for the batting side, an out for the other
      const out: Hit[] = [hit(PLAY_CUE[e.outcome], good, { haptic: hapticFor(e, mine) })];
      if (e.runs > 0 && e.outcome !== "home_run") out.push(hit("run_score", mine));
      return out;
    }
    case "run": {
      const safe = e.action === "steal" || e.action === "advance";
      const out = e.action === "caught" || e.action === "thrown_out" || e.action === "pickoff";
      const good = e.side === userSide ? safe : out;
      return safe ? [hit("run_safe", good)] : out ? [hit("tag_out", good)] : [];
    }
    case "team": return [hit("rally_breaker", e.side === userSide, { haptic: hapticFor(e, e.side === userSide) })];
    case "ability": {
      const id = e.phase === "committed" ? "ability_commit" : e.phase === "triggered" ? "ability_trigger" : e.phase === "expired" ? "ability_fizzle" : "ability_fail";
      return [hit(id, e.side === userSide, { ability: e.ability, haptic: hapticFor(e, e.side === userSide) })];
    }
    case "final": {
      const won = (e.state.score.home > e.state.score.away ? "home" : "away") === userSide;
      return [hit(won ? "result_win" : "result_loss", won)];
    }
    default: return [];
  }
}

/** Approximate length and voice use of a step, for the polyphony bound. */
export const stepMs = (s: Step) => (s.k === "organ" ? 600 : s.k === "sting" ? 550 : s.k === "chime" ? 250 + s.notes.length * 150 : s.k === "ability" ? 600 : s.k === "swell" ? 0 : 350);
export const stepVoices = (s: Step) => (s.k === "organ" ? 3 : s.k === "sting" || s.k === "crack" ? 2 : s.k === "chime" ? s.notes.length : s.k === "swell" ? 0 : 1);

export const MAX_VOICES = 8;
/** Notable and critical cues may use a few extra voices so a home run is never dropped for a pitch pop. */
export const RESERVE_VOICES = 2;
const HOLD_MS = [1400, 1800, 2200, 3000];
const FIRED_KEEP = 512;

export interface Settings { muted: boolean; hapticsOn: boolean; calm: boolean; captionsOn: boolean }
export interface Caption { key: string; cue: CueId; text: string; priority: number; until: number }
export interface Sinks { sound(steps: Step[]): void; haptic(h: HapticCue, calm: boolean): void; caption(c: Caption | null): void }
export interface Fired { cue: CueId; sound: number; haptic: HapticCue | null; line: string | null }

/** Calm keeps the information and drops the flourish: no stings or organ, quieter crowd. */
export function calmSteps(steps: Step[]): Step[] {
  return steps.filter((s) => s.k !== "sting" && s.k !== "organ").map((s) => (s.k === "swell" ? { ...s, amount: s.amount * 0.4 } : s));
}

/** Idempotent, rate-limited dispatcher. Sinks and clock are injected so it is testable in node. */
export class CueEngine {
  private floor = 0;
  private fired = new Set<string>();
  private last = new Map<CueId, number>();
  private lastLine = new Map<CueId, number>();
  private voices: number[] = [];
  private cap: Caption | null = null;

  private sinks: Sinks;
  private settings: () => Settings;
  private now: () => number;

  constructor(sinks: Sinks, settings: () => Settings, now: () => number) {
    this.sinks = sinks;
    this.settings = settings;
    this.now = now;
  }

  /** New match, or a resume: events below `floor` were settled before now and never get a cue. */
  startMatch(floor = 0) {
    this.floor = floor; this.fired.clear(); this.last.clear(); this.lastLine.clear(); this.voices = []; this.setCaption(null);
  }

  /** `index` is the event's position in the game; null = replay stepping, where each explicit step may repeat. */
  event(index: number | null, e: GameEvent, userSide: Side): Fired[] {
    if (index !== null) {
      if (index < this.floor || !this.claim(`e${index}`)) return [];
    }
    return this.run(cuesFor(e, userSide), index ?? 0, index === null ? "r" : `e${index}`);
  }

  /** A cue that is not a game event (arming, action shot, objective): `key` makes it once-only. */
  ui(key: string, id: CueId, good = true, ability?: AbilityId): Fired[] {
    if (!this.claim(key)) return [];
    const c = cueOf(id);
    return this.run([{ id, good, ability, haptic: c.haptic ?? null }], hashKey(key), key);
  }

  caption(): Caption | null { return this.cap && this.cap.until > this.now() ? this.cap : null; }

  private claim(key: string): boolean {
    if (this.fired.has(key)) return false;
    this.fired.add(key);
    if (this.fired.size > FIRED_KEEP) this.fired.delete(this.fired.values().next().value as string);
    return true;
  }

  private run(hits: Hit[], variant: number, key: string): Fired[] {
    const s = this.settings();
    const t = this.now();
    const out: Fired[] = [];
    let best: { hit: Hit; line: string } | null = null;
    for (const h of hits) {
      const c = cueOf(h.id);
      const gap = this.last.get(h.id);
      if (gap !== undefined && t - gap < c.cooldownMs) continue;
      this.last.set(h.id, t);
      const f: Fired = { cue: h.id, sound: 0, haptic: null, line: null };
      if (!s.muted) f.sound = this.play(c, h, s.calm, t);
      if (s.hapticsOn && h.haptic) { f.haptic = h.haptic; this.sinks.haptic(h.haptic, s.calm); }
      const lastLine = this.lastLine.get(h.id);
      if (c.lines.length && (lastLine === undefined || t - lastLine >= c.lineCooldownMs)) {
        f.line = c.lines[variant % c.lines.length];
        if (!best || c.priority > cueOf(best.hit.id).priority) best = { hit: h, line: f.line };
      }
      out.push(f);
    }
    if (best && s.captionsOn) this.show(best.hit.id, best.line, key, t);
    return out;
  }

  /** Returns how many steps were sent to the sound sink (0 when silenced or over the voice bound). */
  private play(c: Cue, h: Hit, calm: boolean, t: number): number {
    let steps = c.sound(h);
    if (calm) steps = calmSteps(steps);
    if (!steps.length) return 0;
    this.voices = this.voices.filter((end) => end > t);
    const need = steps.reduce((n, st) => n + stepVoices(st), 0);
    const limit = MAX_VOICES + (c.priority >= 2 ? RESERVE_VOICES : 0);
    if (this.voices.length + need > limit) return 0;
    for (const st of steps) for (let i = 0; i < stepVoices(st); i++) this.voices.push(t + stepMs(st));
    this.sinks.sound(steps);
    return steps.length;
  }

  /** A held subtitle is only replaced by one of equal or higher priority, or after it has expired. */
  private show(id: CueId, text: string, key: string, t: number) {
    const p = cueOf(id).priority;
    if (this.cap && this.cap.until > t && p < this.cap.priority) return;
    this.lastLine.set(id, t);
    this.setCaption({ key, cue: id, text, priority: p, until: t + HOLD_MS[p] });
  }

  private setCaption(c: Caption | null) { this.cap = c; this.sinks.caption(c); }

  /** Test hook: active voice count at the engine's clock. */
  activeVoices(): number { const t = this.now(); return this.voices.filter((end) => end > t).length; }
}

function hashKey(k: string): number { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; return h; }
