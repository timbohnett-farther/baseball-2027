import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { playInteractive, tutorialSetup, type UserInput } from "@bb/sim";
import { blockingBudgetMs, skipAfterMs, cardWindowMs, blendRate, cameraViewFor, fitShots } from "./presentation.ts";
import { hapticFor, patternFor } from "./haptics.ts";
import { restore, SNAPSHOT_SCHEMA, type Snapshot } from "./resume.ts";

// ARC 17.7: presentation settings (playback speed, reduced motion, haptics) never change what is replayed.
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

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

test("speed 1x/2x, reduced motion and haptics leave the replay hash unchanged", () => {
  const { setup, inputs, result } = play();
  const before = hash(result);
  const snapshot: Snapshot = { schema: SNAPSHOT_SCHEMA, gameId: "invariance-0001", setup, inputs, at: 1 };
  // The recipe a game is saved and uploaded as carries no presentation setting at all.
  assert.deepEqual(Object.keys(snapshot).sort(), ["at", "gameId", "inputs", "schema", "setup"]);
  assert.ok(!/speed|reduced|haptic/i.test(JSON.stringify([Object.keys(setup), inputs])));
  for (const speed of [1, 2]) for (const reduced of [false, true]) for (const haptics of [true, false]) {
    for (const e of result.events) {
      // everything the presentation layer derives from an event, as the screen would at this setting
      blockingBudgetMs(e) / speed; skipAfterMs(e); cameraViewFor(e); blendRate(reduced);
      patternFor(hapticFor(e, true), haptics, reduced);
      if (e.type === "play") cardWindowMs(e);
    }
    fitShots([{ dur: 2 }, { dur: 2 }], 1);
    const again = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs }).result!;
    assert.equal(hash(again), before, `speed ${speed}x reduced ${reduced} haptics ${haptics}`);
    const mid = restore({ ...snapshot, inputs: inputs.slice(0, 6) }, 2);
    assert.ok(mid.ok, "a mid-game snapshot resumes the same whatever the settings");
  }
  assert.equal(hash(result), before);
});
