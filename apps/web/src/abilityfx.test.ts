import { test } from "node:test";
import assert from "node:assert/strict";
import type { AbilityId, GameEvent } from "@bb/sim";
import { ABILITY_FX, DOMAIN_COLOR, cueFor } from "./abilityfx.ts";

const ids = Object.keys(ABILITY_FX) as AbilityId[];

test("all ten abilities have a cue with a name, an icon and a sound", () => {
  assert.equal(ids.length, 10);
  for (const id of ids) { const f = ABILITY_FX[id]; assert.ok(f.name && f.icon && f.sound.dur > 0 && f.ms <= 1000); }
});

test("icons and names are unique, so colour is never the only identifier", () => {
  assert.equal(new Set(ids.map((i) => ABILITY_FX[i].icon)).size, ids.length);
  assert.equal(new Set(ids.map((i) => ABILITY_FX[i].name)).size, ids.length);
});

test("sound recipes are distinct per ability", () => {
  assert.equal(new Set(ids.map((i) => JSON.stringify(ABILITY_FX[i].sound))).size, ids.length);
});

test("domain colours follow PUP 12", () => {
  assert.equal(ABILITY_FX.BAT_COMET.domain, "bat");
  assert.equal(ABILITY_FX.PITCH_MIRAGE.domain, "pitch");
  assert.equal(ABILITY_FX.FIELD_ACROBAT.domain, "field");
  assert.equal(ABILITY_FX.RUN_AFTERBURNER.domain, "run");
  assert.equal(new Set(Object.values(DOMAIN_COLOR)).size, 4);
});

test("Mirage's cue carries nothing that could reveal the pitch type", () => {
  const blob = JSON.stringify(ABILITY_FX.PITCH_MIRAGE).toLowerCase();
  for (const w of ["fastball", "curve", "slider", "change", "sinker", "cutter", "pitchtype"]) assert.ok(!blob.includes(w), w);
  const e = { type: "ability", phase: "committed", side: "home", ability: "PITCH_MIRAGE", text: "x" } as unknown as GameEvent;
  assert.deepEqual(Object.keys(cueFor(e) ?? {}).sort(), ["fx", "id", "phase", "side"]);
});

test("only committed and triggered phases show a cue", () => {
  const mk = (phase: string) => ({ type: "ability", phase, side: "home", ability: "BAT_LASER" }) as unknown as GameEvent;
  assert.ok(cueFor(mk("committed")));
  assert.ok(cueFor(mk("triggered")));
  assert.equal(cueFor(mk("expired")), null);
  assert.equal(cueFor(mk("rejected")), null);
  assert.equal(cueFor({ type: "pitch" } as GameEvent), null);
});
