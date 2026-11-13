import assert from "node:assert/strict";
import { test } from "node:test";
import { dequeue, enqueue, flush, readOutbox } from "./outbox.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const err = (status?: number) => Object.assign(new Error("x"), { status });

test("enqueue is idempotent per game id and dequeue removes it", () => {
  const store = memory();
  enqueue({ gameId: "a", body: { n: 1 } }, store);
  enqueue({ gameId: "a", body: { n: 2 } }, store);
  enqueue({ gameId: "b", body: { n: 3 } }, store);
  assert.deepEqual(readOutbox(store).map((p) => p.body.n), [2, 3]);
  dequeue("a", store);
  assert.deepEqual(readOutbox(store).map((p) => p.gameId), ["b"]);
});

test("flush keeps games on network errors, 5xx and sign-out, and drops them on success or a final refusal", async () => {
  const store = memory();
  for (const id of ["ok", "net", "five", "auth", "conflict"]) enqueue({ gameId: id, body: { id } }, store);
  const r = await flush(async (body) => {
    if (body.id === "net") throw new TypeError("Failed to fetch");
    if (body.id === "five") throw err(503);
    if (body.id === "auth") throw err(401);
    if (body.id === "conflict") throw err(409);
  }, store);
  assert.deepEqual(r, { sent: 1, dropped: 1, left: 3 });
  assert.deepEqual(readOutbox(store).map((p) => p.gameId).sort(), ["auth", "five", "net"]);
  // Back online: everything goes through, and an empty queue is a no-op.
  assert.deepEqual(await flush(async () => {}, store), { sent: 3, dropped: 0, left: 0 });
  assert.deepEqual(await flush(async () => { throw err(500); }, store), { sent: 0, dropped: 0, left: 0 });
});

test("a corrupt outbox reads as empty", () => {
  const store = memory();
  store.setItem("bb.outbox", "{nope");
  assert.deepEqual(readOutbox(store), []);
});
