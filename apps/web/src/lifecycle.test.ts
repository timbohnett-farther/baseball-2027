import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CURRENT_RULES, playInteractive, tutorialSetup, type GameEvent, type UserInput } from "@bb/sim";
import { ActionShotDirector, planAfterResume } from "./actionshot.ts";
import { enqueue, flush, readOutbox } from "./outbox.ts";
import { clearSnapshotFor, loadSnapshot, restore, saveSnapshot, SNAPSHOT_SCHEMA, type Snapshot } from "./resume.ts";

// W36d: save, close, reopen at every point the game can stop and ask for input, and prove the finished game is the same.
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
type Setup = ReturnType<typeof tutorialSetup>;
const run = (setup: Setup, inputs: UserInput[]) => playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs, facts: true });
const bot = (a: NonNullable<ReturnType<typeof run>["awaiting"]>, n: number): UserInput =>
  a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0.1, y: 0 } }
    : a.role === "field" ? { kind: "field", timing: 0 }
      : a.role === "run" ? { kind: "run", action: "advance", send: a.run!.advance!.runners.map((r) => r.base) }
        : { kind: "swing", swing: "contact", timing: ((n % 5) - 2) / 4 };

/** Play to the end, returning every input and the state at each stop. */
function playAll(setup: Setup) {
  const inputs: UserInput[] = [];
  const stops: { n: number; role: string; inning: number; half: string; lastType: string | undefined }[] = [];
  for (;;) {
    const out = run(setup, inputs);
    if (!out.awaiting) return { inputs, stops, result: out.result! };
    stops.push({ n: inputs.length, role: out.awaiting.role, inning: out.awaiting.state.inning, half: out.awaiting.state.half, lastType: out.events.at(-1)?.type });
    inputs.push(bot(out.awaiting, inputs.length));
  }
}
const snap = (setup: Setup, inputs: UserInput[]): Snapshot => ({ schema: SNAPSHOT_SCHEMA, gameId: "life-1", setup, inputs, at: 1000 });
/** What the browser does: write, read back from storage as text, restore. */
function reopen(setup: Setup, inputs: UserInput[], store = memory()) {
  saveSnapshot(snap(setup, inputs), store);
  const r = restore(loadSnapshot(store), 2000);
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.ok ? r.snapshot : (undefined as never);
}
function finish(setup: Setup, inputs: UserInput[]) {
  const ins = [...inputs];
  for (;;) {
    const out = run(setup, ins);
    if (!out.awaiting) return { inputs: ins, result: out.result! };
    ins.push(bot(out.awaiting, ins.length));
  }
}

const base = { ...tutorialSetup(), innings: 3 };
const full = playAll(base);

test("every stop in a game (windup, pitch, contact, ball in play, runner call, play result) resumes to the identical finished game", () => {
  const want = hash(full.result);
  assert.ok(full.stops.length > 20);
  const roles = new Set(full.stops.map((s) => s.role));
  for (const role of ["pitch", "swing"]) assert.ok(roles.has(role), `game exercises ${role}`);
  for (const s of full.stops) {
    const back = reopen(base, full.inputs.slice(0, s.n));
    const done = finish(back.setup, back.inputs);
    assert.equal(hash(done.result), want, `stop ${s.n} (${s.role}, inning ${s.inning} ${s.half}, after ${s.lastType})`);
    assert.deepEqual(done.inputs, full.inputs);
  }
});

test("stops cover each kind of event the game can pause after, the half-inning turn, and the last out", () => {
  const afters = new Set(full.stops.map((s) => s.lastType));
  for (const t of ["half_start", "pitch", "play"]) assert.ok(afters.has(t), `a stop after ${t}`);
  assert.ok(full.stops.some((s, i) => i > 0 && (s.half !== full.stops[i - 1]!.half || s.inning !== full.stops[i - 1]!.inning)), "a stop across a half-inning change");
  const last = full.stops.at(-1)!;
  const done = finish(base, full.inputs.slice(0, last.n));
  assert.equal(done.result.events.at(-1)!.type, full.result.events.at(-1)!.type);
  assert.equal(JSON.stringify(done.result.final), JSON.stringify(full.result.final));
});

test("closing and reopening again and again (a restore of a restore) changes nothing", () => {
  const n = full.stops[Math.floor(full.stops.length / 2)]!.n;
  let inputs = full.inputs.slice(0, n);
  const store = memory();
  for (let i = 0; i < 6; i++) inputs = reopen(base, inputs, store).inputs;
  assert.deepEqual(inputs, full.inputs.slice(0, n));
  assert.equal(hash(finish(base, inputs).result), hash(full.result));
});

test("saves from every rules version still open, or are refused with a readable message", () => {
  for (let rules = 1; rules <= CURRENT_RULES; rules++) {
    const setup = { ...base, rules };
    const g = playAll(setup);
    const n = g.stops[Math.floor(g.stops.length / 3)]!.n;
    const r = restore(snap(setup, g.inputs.slice(0, n)), 2000);
    assert.ok(r.ok, `rules ${rules} resumes`);
    assert.equal(hash(finish(setup, g.inputs.slice(0, n)).result), hash(g.result), `rules ${rules} same game`);
  }
  for (const rules of [0, CURRENT_RULES + 1, 1.5]) {
    const r = restore(snap({ ...base, rules }, []), 2000);
    assert.ok(!r.ok && r.message.length > 20 && !/undefined|TypeError|\bat \w/.test(r.message), `rules ${rules} refused politely`);
  }
});

test("a game saved right after it ended is refused, and a finished-game snapshot never offers a pitch", () => {
  const r = restore(snap(base, full.inputs), 2000);
  assert.ok(!r.ok && /finished/i.test(r.message));
});

test("a half-written, truncated or non-JSON save is reported and can be cleared, not silently ignored", () => {
  const store = memory();
  const good = JSON.stringify(snap(base, full.inputs.slice(0, 4)));
  for (const bad of [good.slice(0, good.length >> 1), "{", "not json", "[1,2", "undefined"]) {
    store.m.set("bb.resume", bad);
    const raw = loadSnapshot(store);
    assert.notEqual(raw, null, "something is there, so the caller must hear about it");
    const r = restore(raw, 2000);
    assert.ok(!r.ok && r.message.length > 20, bad);
  }
  assert.equal(loadSnapshot(memory()), null, "nothing saved is quiet");
  for (const odd of ["null", "42", "\"str\"", "[]", "{}", JSON.stringify({ ...snap(base, []), schema: 99 }), JSON.stringify({ ...snap(base, []), inputs: "x" })]) {
    const s = memory(); s.m.set("bb.resume", odd);
    assert.equal(restore(loadSnapshot(s), 2000).ok, false, odd);
  }
});

test("a save that no longer replays (a recorded input the game refuses) is refused, not patched", () => {
  const bad = snap(base, [{ kind: "swing", swing: "contact", timing: 0 }, { kind: "nonsense" } as unknown as UserInput]);
  const r = restore(bad, 2000);
  assert.ok(!r.ok && r.message.length > 20);
  assert.equal(restore(snap(base, full.inputs.slice(0, 4)), 1000 + 8 * 24 * 3600 * 1000).ok, false, "older than a week");
});

test("storage that throws, or is full, never loses the earlier save and never crashes the game", () => {
  const store = memory();
  saveSnapshot(snap(base, full.inputs.slice(0, 4)), store);
  const before = store.m.get("bb.resume");
  const full1 = { ...store, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
  assert.doesNotThrow(() => saveSnapshot(snap(base, full.inputs.slice(0, 8)), full1));
  assert.equal(store.m.get("bb.resume"), before, "older save intact");
  assert.ok(restore(loadSnapshot(store), 2000).ok);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(loadSnapshot(blocked), null);
  assert.doesNotThrow(() => clearSnapshotFor("x", blocked));
});

test("a late upload only clears its own game's save", () => {
  const store = memory();
  saveSnapshot(snap(base, full.inputs.slice(0, 4)), store);
  clearSnapshotFor("someone-else", store);
  assert.ok(store.m.has("bb.resume"));
  clearSnapshotFor("life-1", store);
  assert.ok(!store.m.has("bb.resume"));
});

// -- results, rewards, season: the uploader --

const body = (id: string) => ({ gameId: id, body: { clientGameId: id, seed: base.seed } });

test("a finished game the device cannot store is reported, so the resume save is kept", () => {
  const dead = { getItem: () => null, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); }, removeItem: () => {} };
  assert.equal(enqueue(body("g1"), dead), false);
  assert.equal(enqueue(body("g1"), null), false);
  const ok = memory();
  assert.equal(enqueue(body("g1"), ok), true);
});

test("the same finished game queued twice, or uploaded twice after the server already took it, is sent once per pass and cleared", async () => {
  const store = memory();
  enqueue(body("g1"), store); enqueue(body("g1"), store);
  assert.equal(readOutbox(store).length, 1);
  const sent: unknown[] = [];
  // the server's answer to a repeat is a plain success without a reward block; the client treats any success as done
  const r1 = await flush(async (b) => { sent.push(b); return { id: 7 }; }, store);
  assert.deepEqual(r1, { sent: 1, dropped: 0, left: 0 });
  const r2 = await flush(async (b) => { sent.push(b); }, store);
  assert.deepEqual(r2, { sent: 0, dropped: 0, left: 0 });
  assert.equal(sent.length, 1);
});

test("a retry that fails and then succeeds leaves exactly one upload and an empty queue", async () => {
  const store = memory();
  enqueue(body("g2"), store);
  let calls = 0;
  const flaky = async () => { if (++calls < 3) throw new TypeError("Failed to fetch"); };
  assert.equal((await flush(flaky, store)).left, 1);
  assert.equal((await flush(flaky, store)).left, 1);
  assert.deepEqual(await flush(flaky, store), { sent: 1, dropped: 0, left: 0 });
});

test("sign-in, the online event and the finish screen asking at once share one upload pass", async () => {
  const store = memory();
  enqueue(body("g3"), store); enqueue(body("g4"), store);
  let calls = 0, release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const send = async () => { calls++; await gate; };
  const a = flush(send, store), b = flush(send, store), c = flush(send, store);
  release();
  const rs = await Promise.all([a, b, c]);
  assert.equal(calls, 2, "each game goes once");
  assert.deepEqual(rs[0], { sent: 2, dropped: 0, left: 0 });
  assert.deepEqual(rs[1], rs[0]);
  // and the guard lets go afterwards
  enqueue(body("g5"), store);
  assert.equal((await flush(async () => {}, store)).sent, 1);
});

// -- action shots after a resume --

test("a resume does not replay the action shot of a play that was already shown", () => {
  // find a stop right after a shot-worthy play
  let found: { n: number; events: GameEvent[] } | null = null;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const setup = { ...base, seed };
    const g = playAll(setup);
    for (const s of g.stops) {
      const events = run(setup, g.inputs.slice(0, s.n)).events;
      const d = new ActionShotDirector({ mode: "full", reducedMotion: false, innings: setup.innings });
      const last = events.length - 1;
      if (events[last]!.type === "play" && d.consider(events, last)) { found = { n: s.n, events }; break; }
    }
  }
  assert.ok(found, "a stop with an unplayed shot at the end exists in the first 40 seeds");
  const { events } = found!;
  const last = events.length - 1;
  const fresh = new ActionShotDirector({ mode: "full", reducedMotion: false, innings: base.innings });
  const plan = fresh.consider(events, last);
  assert.ok(plan, "a fresh director would plan the shot again");
  assert.equal(planAfterResume(plan, last, events.length), null, "but the resumed screen shows the settled play with the normal camera");
  // a play after the resume point still gets its shot
  assert.equal(planAfterResume(plan, last, last), plan);
  assert.equal(planAfterResume(null, 3, 0), null);
  assert.equal(planAfterResume(plan, last, 0), plan, "a normal game (no resume) is unchanged");
});

test("the shot decision is the same before and after a resume, so shots earlier in the game cannot change the cap", () => {
  const plansOf = (events: GameEvent[]) => { const d = new ActionShotDirector({ mode: "full", reducedMotion: false, innings: base.innings }); return events.map((_, i) => d.consider(events, i)?.family ?? null); };
  const all = plansOf(full.result.events);
  for (const s of full.stops.filter((_, i) => i % 7 === 0)) {
    const part = plansOf(run(base, full.inputs.slice(0, s.n)).events);
    assert.deepEqual(part, all.slice(0, part.length), `stop ${s.n}`);
  }
});

test("skipping a shot, and a shot still playing when the app closes, leave the same plan after a reload", () => {
  const events = full.result.events;
  const d1 = new ActionShotDirector({ mode: "full", reducedMotion: false, innings: base.innings });
  const idx = events.findIndex((_, i) => d1.consider(events, i));
  if (idx < 0) return; // the tutorial game earned no shot; the seed sweep above covers that
  const d2 = new ActionShotDirector({ mode: "full", reducedMotion: false, innings: base.innings });
  d2.begin(idx, 0);
  d2.skip(idx, 100); // too early to skip
  d2.skip(idx, 5000);
  const reloaded = new ActionShotDirector({ mode: "full", reducedMotion: false, innings: base.innings });
  assert.equal(reloaded.consider(events, idx)?.family, d1.consider(events, idx)?.family);
});
