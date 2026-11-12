// Ballpark audio, all procedural (no files): a crowd bed, bat crack, glove pop, PA stings.
// Browsers only let audio start after a user gesture, so the context is created lazily on the
// first pointer/key event and every cue is a no-op until then. Mute is remembered per browser.
import { useEffect, useState } from "react";
import type { GameEvent } from "@bb/sim";

const KEY = "bb.sound";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let crowd: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let enabled = read();
const listeners = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** First user gesture: create (or resume) the context. Safe to call repeatedly. */
function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(ctx.destination);
    // Two seconds of white noise, looped and filtered into everything from crowd murmur to a bat crack.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}
if (typeof window !== "undefined") {
  const once = () => { unlock(); window.removeEventListener("pointerdown", once); window.removeEventListener("keydown", once); };
  window.addEventListener("pointerdown", once);
  window.addEventListener("keydown", once);
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
function env(node: AudioNode, peak: number, attack: number, decay: number): GainNode {
  const g = ctx!.createGain();
  const t = ctx!.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  node.connect(g);
  g.connect(master!);
  return g;
}

function tone(freq: number, type: OscillatorType, peak: number, attack: number, decay: number, at = 0) {
  const o = ctx!.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ctx!.createGain();
  const t = ctx!.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g); g.connect(master!);
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
  tone(a, "triangle", 0.18, 0.01, 0.18);
  tone(b, "triangle", 0.18, 0.01, 0.35, 0.16);
}

/** Organ chord at the start of each half-inning. */
function organ() {
  for (const f of [262, 330, 392]) tone(f, "square", 0.05, 0.02, 0.5);
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
    n.out.connect(gain); gain.connect(master!);
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

/** Play the cue for a game event as it appears on screen. `home` = the user's side batting. */
export function playEvent(e: GameEvent, home: boolean) {
  if (!ready() || !enabled) return;
  const calm = reducedMotion(); // smaller swells, no stings
  switch (e.type) {
    case "half_start": if (!calm) organ(); return;
    case "pitch":
      if (e.result === "in_play") return; // the play event carries the crack
      if (e.result === "foul") crack(0); else pop();
      return;
    case "play": {
      const hit = e.outcome === "single" || e.outcome === "double" || e.outcome === "triple" || e.outcome === "home_run";
      const contact = e.outcome !== "strikeout" && e.outcome !== "walk";
      if (contact) crack(e.outcome === "home_run" ? 1 : hit ? 0.6 : 0.2);
      else pop();
      const good = hit ? home : !home; // a hit is good for the batting side; an out is good for the other
      if (e.outcome === "home_run") { swell(good ? (calm ? 0.2 : 0.5) : 0.1, 3); if (!calm) sting(good); }
      else if (e.tier === 2 || (e.runs > 0)) { swell(good ? 0.3 : 0.08, 1.5); if (!calm && e.tier <= 2) sting(good); }
      else if (e.outcome === "strikeout") { swell(good ? 0.2 : 0.05, 0.8); }
      else if (hit) swell(good ? 0.15 : 0.04, 0.8);
      return;
    }
    case "final": swell(e.state.score.home > e.state.score.away ? 0.5 : 0.15, 4); if (!calm) sting(e.state.score.home > e.state.score.away); return;
    default: return;
  }
}

function setEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
  if (master && ctx) master.gain.linearRampToValueAtTime(on ? 1 : 0, ctx.currentTime + 0.2);
  for (const l of listeners) l();
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
