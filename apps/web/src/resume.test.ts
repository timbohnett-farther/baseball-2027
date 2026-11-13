import assert from "node:assert/strict";
import { test } from "node:test";
import { CURRENT_RULES, playInteractive, tutorialSetup, type UserInput } from "@bb/sim";
import { clearSnapshot, loadSnapshot, restore, saveSnapshot, SNAPSHOT_SCHEMA, type Snapshot } from "./resume.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const run = (n: number): UserInput[] => {
  const s = tutorialSetup();
  const inputs: UserInput[] = [];
  for (let i = 0; i < n; i++) {
    const g = playInteractive({ away: s.teams.away, home: s.teams.home, seed: s.seed, innings: s.innings, rules: s.rules, difficulty: s.difficulty, userSide: s.userSide, inputs });
    const a = g.awaiting!;
    inputs.push(a.role === "swing" ? { kind: "swing", swing: "contact", timing: 0 } : a.role === "run" ? { kind: "run", action: "advance", send: [] } : a.role === "field" ? { kind: "field", timing: 0 } : { kind: "pitch", type: "fastball", aim: { x: 0.5, y: 0.5 } });
  }
  return inputs;
};
const snap = (inputs: UserInput[], over: Partial<Snapshot> = {}): Snapshot => ({ schema: SNAPSHOT_SCHEMA, gameId: "game-00000001", setup: tutorialSetup(), inputs, at: 1000, ...over });

test("save, load and clear round-trip through storage", () => {
  const store = memory();
  const s = snap(run(6));
  saveSnapshot(s, store);
  assert.deepEqual(loadSnapshot(store), s);
  clearSnapshot(store);
  assert.equal(loadSnapshot(store), null);
});

test("storage that throws never breaks the game", () => {
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
  saveSnapshot(snap([]), bad);
  clearSnapshot(bad);
  assert.equal(loadSnapshot(bad), null);
  assert.equal(loadSnapshot(null), null);
});

test("restore replays the log: the rebuilt game matches a direct replay and waits at the same pitch", () => {
  const inputs = run(12);
  const r = restore(snap(inputs), 2000);
  assert.ok(r.ok);
  const s = tutorialSetup();
  const direct = playInteractive({ away: s.teams.away, home: s.teams.home, seed: s.seed, innings: s.innings, rules: s.rules, difficulty: s.difficulty, userSide: s.userSide, inputs });
  assert.equal(r.balls, direct.awaiting!.state.balls);
  assert.equal(r.strikes, direct.awaiting!.state.strikes);
  assert.deepEqual(r.score, direct.awaiting!.state.score);
});

test("restore never trusts a snapshot: bad schema, newer rules, a log that does not fit, a finished game, old age", () => {
  const inputs = run(4);
  assert.equal(restore(null).ok, false);
  assert.equal(restore(snap(inputs, { schema: 99 })).ok, false);
  const newer = tutorialSetup();
  const future = restore(snap(inputs, { setup: { ...newer, rules: (CURRENT_RULES + 1) as never } }), 2000);
  assert.equal(future.ok, false);
  assert.match(!future.ok ? future.message : "", /older version/);
  assert.equal(restore(snap([{ kind: "swing", swing: "contact", timing: 0 }, ...inputs.slice(0, 3)]), 2000).ok, false);
  assert.equal(restore(snap(inputs, { at: 0 }), 8 * 24 * 3600 * 1000).ok, false);
  // A full game is no longer resumable.
  const s = tutorialSetup();
  const all: UserInput[] = [];
  for (let i = 0; i < 400; i++) {
    const g = playInteractive({ away: s.teams.away, home: s.teams.home, seed: s.seed, innings: s.innings, rules: s.rules, difficulty: s.difficulty, userSide: s.userSide, inputs: all });
    if (!g.awaiting) break;
    const a = g.awaiting;
    all.push(a.role === "swing" ? { kind: "swing", swing: "contact", timing: 0 } : a.role === "run" ? { kind: "run", action: "advance", send: [] } : a.role === "field" ? { kind: "field", timing: 0 } : { kind: "pitch", type: "fastball", aim: { x: 0.5, y: 0.5 } });
  }
  assert.equal(restore(snap(all), 2000).ok, false);
});
