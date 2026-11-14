// Ballpark audio, all procedural (no files): a crowd bed, bat crack, glove pop, PA stings.
// Browsers only let audio start after a user gesture, so the context is created lazily on the
// first gesture and every cue is a no-op until then. Mute is remembered per browser.
// Signal path: crowd / effects / PA+UI buses -> master -> compressor -> out. Which cue fires,
// and when, is decided by cues.ts; this file only renders its recipes.
import { useEffect, useState } from "react";
import type { AbilityId, GameEvent, Side } from "@bb/sim";
import { ABILITY_FX } from "./abilityfx.ts";
import { CueEngine, type CueId, type Step } from "./cues.ts";
import { hapticsEnabled, vibrate } from "./haptics.ts";
import { reducedFlash } from "./comfort.ts";
import { captionsOn, showCaption } from "./captions.tsx";

const KEY = "bb.sound";
const VOL_KEY = "bb.volume";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
type Bus = "crowd" | "fx" | "ui";
const BUSES: Bus[] = ["crowd", "fx", "ui"];
const buses: Partial<Record<Bus, GainNode>> = {};
const mix: Record<Bus, number> = { crowd: readBus("crowd"), fx: readBus("fx"), ui: readBus("ui") };
let noiseBuf: AudioBuffer | null = null;
let crowd: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let enabled = read();
let volume = readVolume();
const listeners = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

function readVolume(): number {
  try { const v = Number(localStorage.getItem(VOL_KEY)); return localStorage.getItem(VOL_KEY) !== null && v >= 0 && v <= 1 ? v : 0.8; } catch { return 0.8; }
}
const level = () => (enabled ? volume : 0);

function readBus(b: Bus): number {
  try { const raw = localStorage.getItem(`bb.vol.${b}`); const v = Number(raw); return raw !== null && v >= 0 && v <= 1 ? v : 1; } catch { return 1; }
}

/** First user gesture: create (or resume) the context. Safe to call repeatedly. */
function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = level();
    // Peaks (a home run swell over a crack and a sting) are squeezed instead of clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ctx.destination);
    for (const b of BUSES) { const g = ctx.createGain(); g.gain.value = mix[b]; g.connect(master); buses[b] = g; }
    // Two seconds of white noise, looped and filtered into everything from crowd murmur to a bat crack.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}
if (typeof window !== "undefined") {
  // iOS only honours resume() inside some gestures (touchend/click), so listen for all until the context is running.
  const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
  const once = () => {
    unlock();
    if (ctx?.state === "running") for (const g of GESTURES) window.removeEventListener(g, once);
  };
  for (const g of GESTURES) window.addEventListener(g, once);
  // A hidden tab or a backgrounded page should not keep playing; coming back resumes only a context a gesture already unlocked.
  const park = () => { if (ctx?.state === "running") ctx.suspend().catch(() => {}); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) park(); else if (ctx?.state === "suspended") ctx.resume().catch(() => {}); });
  window.addEventListener("pagehide", park);
  window.addEventListener("pageshow", () => { if (ctx?.state === "suspended") ctx.resume().catch(() => {}); });
}

function noise(filter: BiquadFilterType, freq: number, q = 1): { src: AudioBufferSourceNode; out: BiquadFilterNode } {
  const src = ctx!.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx!.createBiquadFilter();
  f.type = filter; f.frequency.value = freq; f.Q.value = q;
  src.connect(f);
  return { src, out: f };
}

/** A short shaped burst: gain ramps up fast and decays. */
function env(node: AudioNode, peak: number, attack: number, decay: number, bus: Bus = "fx"): GainNode {
  const g = ctx!.createGain();
  const t = ctx!.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  node.connect(g);
  g.connect(buses[bus]!);
  return g;
}

function tone(freq: number, type: OscillatorType, peak: number, attack: number, decay: number, at = 0, bus: Bus = "fx") {
  const o = ctx!.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ctx!.createGain();
  const t = ctx!.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g); g.connect(buses[bus]!);
  o.start(t); o.stop(t + attack + decay + 0.05);
}

const ready = () => !!ctx && !!master && ctx.state === "running";

/** Bat on ball: a crack of bright noise over a low thump. Harder for extra-base hits. */
function crack(hard: number) {
  const n = noise("highpass", 1800, 0.7);
  env(n.out, 0.5 + 0.3 * hard, 0.004, 0.08 + 0.05 * hard);
  n.src.start(); n.src.stop(ctx!.currentTime + 0.3);
  tone(110, "sine", 0.35, 0.005, 0.12);
}

/** Ball into the glove: a soft pop. */
function pop() {
  const n = noise("bandpass", 500, 2);
  env(n.out, 0.3, 0.003, 0.05);
  n.src.start(); n.src.stop(ctx!.currentTime + 0.15);
}

/** Two-note PA sting: up for the home side's good news, down for an out. */
function sting(up: boolean) {
  const [a, b] = up ? [523, 784] : [392, 262];
  tone(a, "triangle", 0.18, 0.01, 0.18, 0, "ui");
  tone(b, "triangle", 0.18, 0.01, 0.35, 0.16, "ui");
}

/** Organ chord at the start of each half-inning. */
function organ() {
  for (const f of [262, 330, 392]) tone(f, "square", 0.05, 0.02, 0.5, 0, "ui");
}

/** Crowd reaction: the bed swells, then settles. */
function swell(amount: number, hold: number) {
  if (!crowd) return;
  const t = ctx!.currentTime;
  const g = crowd.gain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0.12 + amount, t + 0.25);
  g.linearRampToValueAtTime(0.12, t + 0.25 + hold);
}

/** Start the crowd murmur while a game is on screen. Returns the stop function for a cleanup. */
export function crowdBed(): () => void {
  let alive = true;
  const start = () => {
    if (!alive || crowd || !ready()) return;
    const n = noise("lowpass", 900, 0.5);
    const gain = ctx!.createGain();
    gain.gain.value = 0;
    n.out.connect(gain); gain.connect(buses.crowd!);
    n.src.start();
    gain.gain.linearRampToValueAtTime(0.12, ctx!.currentTime + 1.5);
    crowd = { src: n.src, gain };
  };
  start();
  // The context may unlock after the view mounts: try again on the next gesture.
  const retry = () => start();
  window.addEventListener("pointerdown", retry);
  window.addEventListener("keydown", retry);
  return () => {
    alive = false;
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("keydown", retry);
    if (crowd && ctx) {
      const { src, gain } = crowd;
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      src.stop(ctx.currentTime + 0.7);
      crowd = null;
    }
  };
}

/** Render one cue recipe. Pure WebAudio: every voice is an oscillator or filtered noise, nothing is loaded. */
function render(steps: Step[]) {
  if (!ready()) return;
  for (const st of steps) {
    switch (st.k) {
      case "crack": crack(st.hard); break;
      case "pop": pop(); break;
      case "sting": sting(st.up); break;
      case "organ": organ(); break;
      case "swell": swell(st.amount, st.hold); break;
      case "ability": abilityVoice(st.id); break;
      case "whoosh": { const n = noise("bandpass", 900, 0.8); env(n.out, 0.12, 0.04, 0.18); n.src.start(); n.src.stop(ctx!.currentTime + 0.3); break; }
      case "chime": st.notes.forEach((f, i) => tone(f, "sine", 0.12, 0.01, 0.2, i * 0.09, "ui")); break;
    }
  }
}

// Cues are decided by the engine from authoritative events; sinks here never touch game state.
const engine = new CueEngine(
  { sound: render, haptic: (h, calm) => vibrate(h, calm), caption: showCaption },
  () => ({ muted: !enabled, hapticsOn: hapticsEnabled(), calm: reducedFlash(), captionsOn: captionsOn() }),
  () => Date.now(),
);

/** New game (or a resume): events before `floor` were settled earlier and get no cue. */
export function startCues(floor = 0) { engine.startMatch(floor); }

/** Cue for the event at `index` of the current game; each index fires once. `index` null = replay stepping. */
export function playEvent(e: GameEvent, userSide: Side, index: number | null = null) { engine.event(index, e, userSide); }

/** Cues that are not game events (ability armed, action shot, objective); `key` makes them once-only. */
export function playCue(key: string, id: CueId, good = true) { engine.ui(key, id, good); }

function setEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
  if (master && ctx) master.gain.linearRampToValueAtTime(level(), ctx.currentTime + 0.2);
  for (const l of listeners) l();
}

/** One synthesized cue per ability (PUP 12): a swept tone, optionally with a noise burst. */
function abilityVoice(id: AbilityId) {
  if (!ready() || !enabled) return;
  const { sound: s } = ABILITY_FX[id];
  const t = ctx!.currentTime;
  const o = ctx!.createOscillator();
  o.type = s.wave;
  o.frequency.setValueAtTime(s.from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, s.to), t + s.dur);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur + 0.05);
  o.connect(g); g.connect(buses.fx!);
  o.start(t); o.stop(t + s.dur + 0.1);
  if (s.noise) {
    const n = noise(s.noise === "high" ? "highpass" : s.noise === "band" ? "bandpass" : "lowpass", s.noise === "high" ? 3000 : s.noise === "band" ? 1200 : 300, 1);
    env(n.out, 0.14, 0.01, s.dur * 0.8);
    n.src.start(); n.src.stop(t + s.dur + 0.1);
  }
}

function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  try { localStorage.setItem(VOL_KEY, String(volume)); } catch { /* private mode */ }
  if (master && ctx) master.gain.linearRampToValueAtTime(level(), ctx.currentTime + 0.1);
  for (const l of listeners) l();
}

/** Master volume 0..1 for the slider; mute stays a separate switch. */
export function useVolume(): [number, (v: number) => void] {
  const [v, setV] = useState(volume);
  useEffect(() => {
    const l = () => setV(volume);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [v, setVolume];
}

/** Sound on/off for the mute button. */
export function useSound(): [boolean, () => void] {
  const [on, setOn] = useState(enabled);
  useEffect(() => {
    const l = () => setOn(enabled);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [on, () => setEnabled(!enabled)];
}

/** Per-bus levels for the mix sliders (crowd, effects, PA and UI sounds). Master volume and mute sit above them. */
export function useMix(): [Record<Bus, number>, (b: Bus, v: number) => void] {
  const [m, setM] = useState({ ...mix });
  useEffect(() => {
    const l = () => setM({ ...mix });
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [m, (b, v) => {
    mix[b] = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(`bb.vol.${b}`, String(mix[b])); } catch { /* private mode */ }
    if (buses[b] && ctx) buses[b]!.gain.linearRampToValueAtTime(mix[b], ctx.currentTime + 0.1);
    for (const l of listeners) l();
  }];
}
