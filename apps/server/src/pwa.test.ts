import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { closeDb, initDb } from "./db/index.ts";
import { startStore } from "./store.ts";

let app: FastifyInstance;
let dir: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "bb-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>x</title>");
  writeFileSync(join(dir, "sw.js"), "self.addEventListener('fetch',()=>{});");
  writeFileSync(join(dir, "manifest.webmanifest"), JSON.stringify({ name: "x", display: "standalone" }));
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
  await initDb({ localDir: "memory://" });
  await startStore(() => {}, { autoRefresh: false });
  app = await buildApp({ webRoot: dir });
});
after(async () => { await app.close(); await closeDb(); rmSync(dir, { recursive: true, force: true }); });

test("the service worker, shell page and manifest always revalidate", async () => {
  for (const url of ["/sw.js", "/manifest.webmanifest", "/index.html", "/", "/some/client/route"]) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200, url);
    assert.equal(res.headers["cache-control"], "no-cache", url);
  }
  assert.match(String((await app.inject({ url: "/sw.js" })).headers["content-type"]), /javascript/);
  assert.match(String((await app.inject({ url: "/manifest.webmanifest" })).headers["content-type"]), /manifest\+json/);
});

test("hashed assets cache for good, and the API is never given a cache policy", async () => {
  const asset = await app.inject({ url: "/assets/index-abc123.js" });
  assert.match(String(asset.headers["cache-control"]), /immutable/);
  const api = await app.inject({ url: "/api/teams" });
  assert.equal(api.headers["cache-control"], undefined);
  const missing = await app.inject({ url: "/api/nope" });
  assert.equal(missing.statusCode, 404);
});
