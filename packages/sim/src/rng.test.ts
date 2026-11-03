import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng } from "./rng.ts";

test("same seed gives the same sequence", () => {
  const a = createRng(2027);
  const b = createRng(2027);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test("different seeds diverge", () => {
  assert.notEqual(createRng(1).next(), createRng(2).next());
});

test("int stays in range", () => {
  const rng = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const n = rng.int(1, 6);
    assert.ok(n >= 1 && n <= 6 && Number.isInteger(n));
  }
});
