import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { playInteractive, tutorialSetup, type UserInput } from "@bb/sim";
import { QUALITIES, QUALITY_PROFILE, getQuality, setQuality } from "./quality.ts";
import { SNAPSHOT_SCHEMA, type Snapshot } from "./resume.ts";

// W31: a graphics tier trims drawing only. The replay hash, the saved recipe and the inputs never see it.
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

test("every quality tier and frame cap leaves the replay hash unchanged and out of the saved recipe", () => {
  const { setup, inputs, result } = play();
  const before = hash(result);
  const snapshot: Snapshot = { schema: SNAPSHOT_SCHEMA, gameId: "quality-0001", setup, inputs, at: 1 };
  assert.deepEqual(Object.keys(snapshot).sort(), ["at", "gameId", "inputs", "schema", "setup"]);
  assert.ok(!/quality|battery|fps|shadow|pixelRatio/i.test(JSON.stringify([Object.keys(setup), inputs, Object.keys(snapshot)])));
  for (const q of QUALITIES) {
    setQuality(q);
    assert.equal(getQuality(), q);
    const p = QUALITY_PROFILE[q];
    for (const fps of [0, p.minFrameMs]) { // the cap is a render-loop throttle, so replay it at both rates
      const again = playInteractive({ ...setup.teams, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs }).result!;
      assert.equal(hash(again), before, `quality ${q} frame cap ${fps} ms`);
    }
  }
  // The tiers only ever shed work: each is no heavier than the one above it.
  for (const k of ["pixelRatio", "shadowMap", "crowd", "dust"] as const)
    assert.ok(QUALITY_PROFILE.standard[k] <= QUALITY_PROFILE.high[k] && QUALITY_PROFILE.battery[k] <= QUALITY_PROFILE.standard[k], k);
  assert.equal(hash(result), before);
});
