import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLabelText, fpsFromFrames } from "./buildlabel.ts";

test("build label shows the sha, and fps once measured", () => {
  assert.equal(buildLabelText("abc1234", null), "build abc1234");
  assert.equal(buildLabelText(null, null), "build …");
  assert.equal(buildLabelText("abc1234", 59.6), "build abc1234 · 60 fps");
});

test("fps from frame timestamps", () => {
  assert.equal(fpsFromFrames([0]), null);
  assert.equal(fpsFromFrames([5, 5]), null);
  assert.equal(Math.round(fpsFromFrames([0, 16.667, 33.333, 50])!), 60);
});
