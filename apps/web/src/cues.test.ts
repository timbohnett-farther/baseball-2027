import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { playInteractive, tutorialSetup, type GameEvent, type Side, type UserInput } from "@bb/sim";
import { CUES, CUE_IDS, CueEngine, MAX_VOICES, RESERVE_VOICES, calmSteps, cueOf, cuesFor, stepVoices, type Caption, type Settings, type Step } from "./cues.ts";
import { hapticFor, type HapticCue } from "./haptics.ts";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const USER: Side = "home";

function play() {
  const setup = tutorialSetup();
  const inputs: UserInput[] = [];
  for (;;) {
    const out = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs });
    if (!out.awaiting) return { setup, inputs, result: out.result! };
    const a = out.awaiting, n = inputs.length;
    inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.1, y: 0 } }
      : a.role === "field" ? { kind: "field", timing: 0 }
        : a.role === "run" ? { kind: "run", action: "advance", send: a.run!.advance!.runners.map((r) => r.base) }
          : { kind: "swing", swing: "contact", timing: ((n % 5) - 2) / 4 });
  }
}

interface Rig { engine: CueEngine; sounds: Step[][]; buzzes: Array<[HapticCue, boolean]>; caps: Array<Caption | null>; set: Settings; clock: { t: number } }
function rig(over: Partial<Settings> = {}): Rig {
  const sounds: Step[][] = [], buzzes: Array<[HapticCue, boolean]> = [], caps: Array<Caption | null> = [];
  const set: Settings = { muted: false, hapticsOn: true, calm: false, captionsOn: true, ...over };
  const clock = { t: 100000 };
  const engine = new CueEngine({ sound: (s) => sounds.push(s), haptic: (h, c) => buzzes.push([h, c]), caption: (c) => caps.push(c) }, () => set, () => clock.t);
  return { engine, sounds, buzzes, caps, set, clock };
}

// A minimal event stub: the engine only reads type, the fields cuesFor uses, and state.half/score.
const st = (half: "top" | "bottom" = "bottom") => ({ half, score: { away: 0, home: 1 } }) as GameEvent["state"];
const playEv = (outcome: string, extra: object = {}) => ({ type: "play", state: st(), outcome, runs: 0, rbi: 0, text: "", tier: 1, ...extra }) as unknown as GameEvent;
const pitchEv = (result: string) => ({ type: "pitch", state: st(), result }) as unknown as GameEvent;

test("catalog: every cue has text, a sound recipe, sane limits and commentary variants", () => {
  assert.ok(CUE_IDS.length >= 28);
  for (const id of CUE_IDS) {
    const c = cueOf(id);
    assert.ok(c.text.length > 3, `${id} text`);
    assert.ok(c.cooldownMs >= 0 && c.lineCooldownMs >= 0, `${id} cooldowns`);
    assert.ok(c.lines.length >= 1 && c.lines.every((l) => l.trim().length > 2), `${id} lines`);
    assert.ok(c.sound({ id, good: true, ability: "heater" as never, haptic: null }).length >= 1, `${id} sound`);
  }
  // each major family is covered by at least one cue
  const fams = new Set(CUE_IDS.map((id) => cueOf(id).family));
  for (const f of ["pitch", "contact", "catch", "tag", "run", "out", "inning", "ability", "breaker", "shot", "objective", "result"]) assert.ok(fams.has(f as never), f);
});

test("commentary is original, text-only and never contradicts its result", () => {
  const claims: Record<string, RegExp> = {
    contact_single: /\b(out|strike|walk|homer|double|triple|gone)\b/i, contact_double: /\b(single|out\b|strike|homer|triple|gone)\b/i, contact_triple: /\b(single|double|strike|homer|gone|out\b)/i,
    contact_homer: /\b(single|double|triple|strike|caught|out\b)/i, catch_fly: /\b(hit|safe|single|double|homer|gone)\b/i, catch_line: /\b(safe|single|double|homer|gone)\b/i,
    out_ground: /\b(safe|single|double|homer|strike)\b/i, out_strikeout: /\b(safe|hit|single|homer|walk)\b/i, walk: /\b(strike|out|hit|homer)\b/i,
    tag_out: /\b(safe|steals)\b/i, run_safe: /\b(out|tagged|caught)\b/i, pitch_ball: /\b(strike|foul|out)\b/i, pitch_strike: /\b(ball\b|foul|swung)/i, pitch_whiff: /\b(ball\b|foul|looking|called)/i, pitch_foul: /\b(strike three|miss)/i,
    ability_fail: /\b(triggers|committed|armed)\b/i, ability_fizzle: /\b(triggers|committed|armed)\b/i,
  };
  for (const [id, bad] of Object.entries(claims)) for (const l of CUES[id as keyof typeof CUES].lines) assert.ok(!bad.test(l), `${id}: "${l}"`);
  // no speech, no catchphrases, no real-announcer or league names
  const all = CUE_IDS.flatMap((id) => cueOf(id).lines).join(" | ");
  assert.ok(!/boomshakalaka|he'?s on fire|from downtown|nba|espn|mlb|scully|vin /i.test(all));
});

test("cuesFor: real tutorial events map to cues and the haptic matches hapticFor", () => {
  const { result } = play();
  let n = 0;
  for (const e of result.events) {
    const hits = cuesFor(e, USER);
    const mine = (e.state.half === "top" ? "away" : "home") === USER;
    n += hits.length;
    if (e.type === "play" || e.type === "team" || e.type === "ability" || (e.type === "pitch" && e.result !== "in_play")) {
      assert.equal(hits[0]?.haptic ?? null, e.type === "ability" ? hapticFor(e, e.side === USER) : e.type === "team" ? hapticFor(e, e.side === USER) : hapticFor(e, mine), e.type);
    }
    if (e.type === "pitch" && e.result === "in_play") assert.equal(hits.length, 0);
    if (e.type === "final") assert.ok(hits[0].id === "result_win" || hits[0].id === "result_loss");
  }
  assert.ok(n >= 5);
});

test("once per event: the same index never fires twice, even from a regenerated event object", () => {
  const r = rig();
  const e = playEv("home_run", { runs: 1 });
  assert.equal(r.engine.event(5, e, USER).length, 1);
  r.clock.t += 5000;
  assert.equal(r.engine.event(5, { ...e } as GameEvent, USER).length, 0);
  assert.equal(r.sounds.length, 1);
  r.clock.t += 5000;
  assert.equal(r.engine.event(6, e, USER).length, 1);
  // keyed cues (ability armed, action shot) are once-only per key as well
  assert.equal(r.engine.ui("shot:g:6", "action_shot").length, 1);
  r.clock.t += 5000;
  assert.equal(r.engine.ui("shot:g:6", "action_shot").length, 0);
  // replay stepping (index null) repeats on each explicit step
  r.clock.t += 5000;
  assert.equal(r.engine.event(null, e, USER).length, 1);
  r.clock.t += 5000;
  assert.equal(r.engine.event(null, e, USER).length, 1);
});

test("no cue for an event settled before a resume", () => {
  const r = rig();
  r.engine.startMatch(10);
  r.caps.length = 0;
  assert.equal(r.engine.event(9, playEv("home_run"), USER).length, 0);
  assert.equal(r.engine.event(0, playEv("single"), USER).length, 0);
  assert.equal(r.sounds.length + r.buzzes.length + r.caps.length, 0);
  assert.equal(r.engine.event(10, playEv("single"), USER).length, 1);
  // starting a new match forgets the old keys
  r.engine.startMatch(0);
  r.clock.t += 5000;
  assert.equal(r.engine.event(10, playEv("single"), USER).length, 1);
});

test("cooldown: a cue is held back for its gap, then allowed again", () => {
  const r = rig();
  assert.equal(r.engine.event(1, pitchEv("ball"), USER)[0].sound, 1);
  r.clock.t += 50;
  assert.equal(r.engine.event(2, pitchEv("ball"), USER).length, 0, "inside the 120 ms gap");
  r.clock.t += 200;
  const f = r.engine.event(3, pitchEv("ball"), USER);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, null, "commentary has its own, longer cooldown");
});

test("priority: a held critical subtitle is not replaced by a background one, and expires", () => {
  const r = rig();
  r.engine.event(1, playEv("home_run", { runs: 1 }), USER);
  assert.equal(r.engine.caption()?.cue, "contact_homer");
  r.clock.t += 500;
  r.engine.event(2, pitchEv("ball"), USER);
  assert.equal(r.engine.caption()?.cue, "contact_homer", "pitch chatter cannot interrupt a home run");
  r.clock.t += 600;
  r.engine.event(3, playEv("triple"), USER);
  assert.equal(r.engine.caption()?.cue, "contact_homer", "a lower priority play cannot interrupt either");
  r.clock.t += 3000;
  assert.equal(r.engine.caption(), null, "held lines expire");
  r.engine.event(4, pitchEv("called_strike"), USER);
  assert.equal(r.engine.caption()?.cue, "pitch_strike");
  r.clock.t += 400;
  r.engine.event(5, playEv("home_run"), USER);
  assert.equal(r.engine.caption()?.cue, "contact_homer", "a higher priority line interrupts");
});

test("the subtitle text is deterministic for an event and comes from the cue's own lines", () => {
  const a = rig(), b = rig();
  a.engine.event(7, playEv("double"), USER); b.engine.event(7, playEv("double"), USER);
  assert.equal(a.engine.caption()?.text, b.engine.caption()?.text);
  assert.ok(CUES.contact_double.lines.includes(a.engine.caption()!.text));
});

test("voice cap: bounded polyphony with a reserve for notable cues, freed as voices end", () => {
  const r = rig();
  // hammer the engine with distinct low-priority cues faster than they finish
  const ids = ["pitch_ball", "pitch_strike", "pitch_whiff", "pitch_foul", "walk", "contact_single", "catch_fly", "out_ground", "catch_line", "run_safe"] as const;
  let t = 0;
  for (const id of ids) { r.clock.t = 100000 + t++; r.engine.ui(`k${id}`, id); assert.ok(r.engine.activeVoices() <= MAX_VOICES + RESERVE_VOICES, `after ${id}`); }
  assert.ok(r.engine.activeVoices() <= MAX_VOICES);
  const dropped = ids.length - r.sounds.length;
  assert.ok(dropped > 0, "some low priority sounds were dropped at the cap");
  // notable cues may use the reserve above the cap; find one small enough to fit
  const h = (id: (typeof CUE_IDS)[number]) => ({ id, good: true, haptic: null });
  const need = (id: (typeof CUE_IDS)[number]) => cueOf(id).sound(h(id)).reduce((n, x) => n + stepVoices(x), 0);
  const bump = CUE_IDS.find((id) => cueOf(id).priority >= 2 && need(id) <= RESERVE_VOICES);
  assert.ok(bump, "a notable cue small enough for the reserve exists");
  assert.equal(r.engine.activeVoices(), MAX_VOICES);
  const before = r.sounds.length;
  r.engine.ui("bump", bump);
  assert.equal(r.sounds.length, before + 1, "reserve admits a notable cue");
  assert.ok(r.engine.activeVoices() <= MAX_VOICES + RESERVE_VOICES);
  r.clock.t += 5000;
  assert.equal(r.engine.activeVoices(), 0);
  assert.ok(stepVoices({ k: "organ" }) === 3);
});

test("settings: mute silences sound only; haptics off silences buzz only; calm drops flourish; captions off hides lines", () => {
  const hr = playEv("home_run", { runs: 1 });
  const muted = rig({ muted: true });
  muted.engine.event(1, hr, USER);
  assert.equal(muted.sounds.length, 0); assert.equal(muted.buzzes.length, 1); assert.ok(muted.engine.caption(), "subtitles work with sound off");

  const quiet = rig({ hapticsOn: false });
  quiet.engine.event(1, hr, USER);
  assert.equal(quiet.buzzes.length, 0); assert.equal(quiet.sounds.length, 1);

  const calm = rig({ calm: true });
  calm.engine.event(1, hr, USER);
  assert.ok(calm.sounds[0].every((s) => s.k !== "sting" && s.k !== "organ"), "no stings in calm");
  assert.deepEqual(calm.buzzes[0], ["homer", true], "haptic is flagged calm so it is a single tick");
  assert.ok(calm.engine.caption(), "calm keeps the text");
  const loud = rig(); loud.engine.event(1, hr, USER);
  const swellOf = (s: Step[]) => (s.find((x) => x.k === "swell") as { amount: number }).amount;
  assert.ok(swellOf(calm.sounds[0]) < swellOf(loud.sounds[0]));
  assert.ok(calmSteps([{ k: "organ" }]).length === 0);

  const nocap = rig({ captionsOn: false });
  nocap.engine.event(1, hr, USER);
  assert.equal(nocap.engine.caption(), null);
  assert.equal(nocap.sounds.length, 1);
});

test("haptics: only committed actions and big results, and never for the opponent's good play", () => {
  const r = rig();
  const buzzFor = (e: GameEvent) => { r.clock.t += 5000; const n = r.buzzes.length; r.engine.event(Math.floor(r.clock.t), e, USER); return r.buzzes.length - n; };
  assert.equal(buzzFor(pitchEv("ball")), 0);
  assert.equal(buzzFor(playEv("groundout")), 0);
  assert.equal(buzzFor(playEv("walk")), 0);
  assert.equal(buzzFor(playEv("home_run")), 1);
  const theirs = { ...playEv("home_run"), state: st("top") } as GameEvent;
  assert.equal(buzzFor(theirs), 0, "no buzz for what happened to you");
});

test("perspective: a hit is good for the batting side and an out for the fielding side", () => {
  const single = cuesFor(playEv("single"), "home")[0], out = cuesFor(playEv("groundout"), "home")[0];
  assert.equal(single.good, true); assert.equal(out.good, false);
  assert.equal(cuesFor(playEv("single"), "away")[0].good, false);
  assert.equal(cuesFor(playEv("groundout"), "away")[0].good, true);
});

test("replay hash is identical with cues enabled, disabled, muted or calm", () => {
  const { setup, inputs, result } = play();
  const before = hash(result);
  const frozen = JSON.stringify(result.events);
  for (const settings of [{}, { muted: true }, { hapticsOn: false }, { calm: true }, { captionsOn: false }, { muted: true, hapticsOn: false, captionsOn: false }]) {
    const r = rig(settings);
    r.engine.startMatch(0);
    result.events.forEach((e, i) => { r.clock.t += 700; r.engine.event(i, e, USER); });
    assert.equal(hash(result), before, JSON.stringify(settings));
  }
  assert.equal(JSON.stringify(result.events), frozen, "the engine does not mutate events");
  const again = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs });
  assert.equal(hash(again.result), before, "replaying after cues ran gives the same game");
});

test("a full tutorial game fires each event once and every cue it hits has text", () => {
  const { result } = play();
  const r = rig();
  const seen = new Set<string>();
  result.events.forEach((e, i) => {
    r.clock.t += 900;
    for (const f of r.engine.event(i, e, USER)) seen.add(f.cue);
    assert.equal(r.engine.event(i, e, USER).length, 0, "second dispatch of the same index is empty");
  });
  assert.ok(seen.size >= 3);
  for (const id of seen) assert.ok(cueOf(id as never).text);
});
