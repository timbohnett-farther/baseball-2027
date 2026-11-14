#!/usr/bin/env node
// W35a resource and first-use evidence. Boots the dev server, drives headless Chrome (SwiftShader), reads `window.__perfTelemetry()`.
//   node --experimental-strip-types apps/web/scripts/perf.mjs cold   [--runs=5] [--variant=on|off] [--json=FILE]
//   node --experimental-strip-types apps/web/scripts/perf.mjs rematch [--rounds=12] [--variant=on|off] [--json=FILE]
//   node --experimental-strip-types apps/web/scripts/perf.mjs soak   [--minutes=15] [--sample=15] [--variant=on|off] [--json=FILE]
// W35b: --cadence=hz30|hz60|hz144|uneven|stall replaces requestAnimationFrame with that cadence (scripts/raf-scheduler.mjs). The soak verdict
// comes from post-unmount samples (same state every round); mid-match samples are reported by phase as information only.
// --phone (844x390 touch viewport), --quality=high|standard|battery, SHOT_PORT (default 5199) as in shot.mjs.
// variant=off adds `?w35a=off` (no prewarm, pre-W35a dispose) so before/after run on one build.
// Everything is desktop headless Chromium on a software renderer. It is not device evidence and a soak here is not a thermal test.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { frameStats, assessGrowth, assessSoak } from "../src/perftelemetry.ts";
import { schedule } from "../src/cadence.ts";
import { installScheduler } from "./raf-scheduler.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--")) ?? "cold";
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = args.includes("--phone"), quality = opt("quality"), jsonOut = opt("json"), variant = opt("variant", "on"), cadence = opt("cadence");
const suffix = variant === "off" ? "&w35a=off" : "";
const port = Number(process.env.SHOT_PORT) || 5199;
const base = `http://localhost:${port}/`;

const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: web, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, no) => {
  vite.stdout.on("data", (d) => { if (String(d).includes("Local:")) ok(); });
  vite.on("exit", (c) => no(new Error(`vite exited ${c}`)));
  setTimeout(() => no(new Error("vite did not start")), 20000);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
const launch = () => chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const ctxOpts = phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
async function newPage() {
  const ctx = await browser.newContext(ctxOpts);
  if (quality) await ctx.addInitScript((q) => { try { localStorage.setItem("bb.quality", q); } catch { /* run without storage */ } }, quality);
  if (cadence) await ctx.addInitScript(installScheduler, schedule(cadence, 20 * 60000, 1)); // --cadence=hz30|hz60|hz144|uneven|stall replaces rAF with that cadence
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  return { ctx, page };
}
const env = async (page) => ({
  mode, variant, viewport: phone ? "844x390 touch" : "1280x720", quality: quality ?? "stored (default)", cadence: cadence ?? "native rAF",
  browser: `Chrome ${browser.version()} headless, --use-angle=swiftshader`, host: `${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} cpus (${os.cpus()[0]?.model})`, node: process.version,
  renderer: await page.evaluate(() => { const c = document.createElement("canvas"), g = c.getContext("webgl2"); const e = g?.getExtension("WEBGL_debug_renderer_info"); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; }),
  note: "desktop headless software rendering; not device evidence; not a thermal test",
});
const tele = (page) => page.evaluate(() => window.__perfTelemetry?.());
const heapMB = (page) => page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 10485.76) / 100 : null);
const fmt = (x) => (x === null || x === undefined ? "n/a" : x);

async function cold() {
  const runs = Number(opt("runs", 5));
  const moments = ["pitch", "shot-contact", "shot-release", "shot-slide"];
  const rows = [];
  for (const m of moments) for (let i = 0; i < runs; i++) {
    const { ctx, page } = await newPage();
    await page.goto(`${base}?shot=${m}&t=700${suffix}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
    await sleep(2500); // let the first-use frame land and some more frames render
    const t = await tele(page);
    const e = i === 0 && m === "pitch" ? await env(page) : null;
    rows.push({ moment: m, run: i, t, env: e });
    await ctx.close();
  }
  const keys = { pitch: "pitch", "shot-contact": "shot:contact", "shot-release": "shot:release", "shot-slide": "shot:slide" };
  console.log(`cold reload, variant=${variant}, ${runs} runs per moment (fresh browser context each); desktop headless Chromium (SwiftShader), not device evidence`);
  console.log("moment         n   sync ms median/worst   frame-after ms median/worst   prewarm ms   programs before->after   longtasks(total)");
  const summary = {};
  for (const m of moments) {
    const rs = rows.filter((r) => r.moment === m), f = rs.map((r) => r.t.firsts[keys[m]]).filter(Boolean);
    const sync = frameStats(f.map((x) => x.syncMs)), fr = frameStats(f.map((x) => x.frameMs).filter((x) => x !== null));
    const pw = rs.map((r) => r.t.prewarm).filter((p) => p && p.ok);
    const pws = frameStats(pw.map((p) => p.ms));
    const lt = rs.reduce((a, r) => a + r.t.longTasks.count, 0);
    summary[m] = { n: f.length, syncMs: sync, frameAfterMs: fr, prewarmMs: pws, prewarmOk: pw.length, prewarmFailed: rs.filter((r) => r.t.prewarm && r.t.prewarm.ok === false).length, longTasks: lt };
    console.log(`${m.padEnd(13)} ${String(f.length).padStart(2)}   ${String(sync.medianMs).padStart(7)} / ${String(sync.worstMs).padEnd(9)}   ${String(fr.medianMs).padStart(9)} / ${String(fr.worstMs).padEnd(9)}   ${String(pws.medianMs).padStart(8)}   ${pw.length ? `${pw[0].programsBefore}->${pw[0].programsAfter}` : "n/a"}   ${lt}`);
  }
  return { env: rows[0].env, summary, rows: rows.map(({ env: _e, ...r }) => r) };
}

async function rematch() {
  const rounds = Number(opt("rounds", 12));
  const { page } = await newPage();
  await page.goto(`${base}?shot=perf-soak${suffix}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__perfTelemetry && window.__soak, null, { timeout: 30000 });
  const e = await env(page);
  const samples = [];
  let last = -1;
  const t0 = Date.now();
  while (Date.now() - t0 < 25 * 60000) {
    const s = await page.evaluate(() => window.__soak);
    if (s.round !== last && s.phase === 3) { // at the unmounted gap: the previous match is gone
      last = s.round;
      const t = await tele(page);
      samples.push({ t: Date.now() - t0, round: s.round, geometries: t.renderer.geometries, textures: t.renderer.textures, programs: t.renderer.programs, heapMB: await heapMB(page), lifecycle: t.lifecycle });
      if (s.round + 1 >= rounds) break;
    }
    await sleep(100);
  }
  const final = await tele(page);
  const growth = assessGrowth(samples, { warmup: 2, tolerance: 0 });
  console.log(`rematch, variant=${variant}: ${samples.length} unmount samples over ${rounds} matches; desktop headless Chromium (SwiftShader), not device evidence`);
  console.log("round  geoms  tex  prog  jerseyTex  heapMB  created/disposed");
  for (const s of samples) console.log(`${String(s.round).padStart(5)} ${String(s.geometries).padStart(6)} ${String(s.textures).padStart(4)} ${String(s.programs).padStart(5)} ${String(s.lifecycle.jerseyTextures).padStart(10)} ${String(fmt(s.heapMB)).padStart(7)}  ${s.lifecycle.directorsCreated}/${s.lifecycle.directorsDisposed}`);
  console.log(`growth after warm-up: ${growth.verdict}`, JSON.stringify(growth.metrics));
  return { env: e, samples, growth, final };
}

async function soak() {
  const minutes = Number(opt("minutes", 15)), every = Number(opt("sample", 15)) * 1000;
  const { page } = await newPage();
  const longTaskSeen = [];
  await page.goto(`${base}?shot=perf-soak${suffix}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__perfTelemetry && window.__soak, null, { timeout: 30000 });
  const e = await env(page);
  const t0 = Date.now(), end = t0 + minutes * 60000;
  const samples = [], frames = [], perMinute = [];
  let minuteFrames = [], nextMinute = t0 + 60000;
  const drain = async () => { const f = await page.evaluate(() => window.__perfFrames()); frames.push(...f); minuteFrames.push(...f); };
  let nextSample = t0 + every;
  console.log(`soak start ${new Date(t0).toISOString()} for ${minutes} min, sample every ${every / 1000}s, variant=${variant}`);
  let gapRound = -1, nextDrain = t0;
  const snap = async (kind, now) => { const t = await tele(page), s = await page.evaluate(() => window.__soak); samples.push({ t: now - t0, kind, round: s.round, phase: s.phase, geometries: t.renderer.geometries, textures: t.renderer.textures, programs: t.renderer.programs, heapMB: await heapMB(page), jerseyTextures: t.lifecycle.jerseyTextures, longTasks: t.longTasks.count }); };
  while (Date.now() < end) {
    await sleep(100);
    let now = Date.now();
    // Like-for-like sample: the unmounted gap between matches (phase 3), once per round, so every sample has the same scene content.
    const s0 = await page.evaluate(() => window.__soak);
    if (s0.phase === 3 && s0.round !== gapRound) { gapRound = s0.round; await snap("gap", now); }
    if (now < nextDrain) continue;
    nextDrain = now + 2000;
    await drain();
    now = Date.now();
    if (now >= nextMinute) { perMinute.push({ minute: perMinute.length + 1, ...frameStats(minuteFrames) }); minuteFrames = []; nextMinute += 60000; }
    if (now >= nextSample) { nextSample += every; await snap("live", now); } // mid-match sample, informational: content differs per round
  }
  await drain();
  const final = await tele(page), actualMs = Date.now() - t0;
  // like for like: samples grouped by play-cycle phase (live mid-match counts are not compared with the unmounted gap)
  // Verdict from the gap samples (post-unmount, same state every round). Live samples are summarised by phase, informational only:
  // what is staged mid-match differs per round (club, shot family), so their drift is not leak evidence on its own.
  const growth = assessSoak(samples.filter((x) => x.kind === "gap"), { warmup: 3, minSamples: 8 });
  const liveByPhase = assessSoak(samples.filter((x) => x.kind === "live"), { warmup: 2 });
  const heap = samples.map((s) => s.heapMB).filter((x) => x !== null);
  const out = { env: e, requestedMinutes: minutes, liveByPhase, actualSeconds: Math.round(actualMs / 1000), started: new Date(t0).toISOString(), frames: frameStats(frames), perMinute, samples, growth, heap: heap.length ? { first: heap[0], last: heap[heap.length - 1], min: Math.min(...heap), max: Math.max(...heap), supported: true } : { supported: false }, final };
  console.log(`soak done: ${out.actualSeconds}s actual (requested ${minutes} min); ${samples.length} samples; rounds completed ${samples.at(-1)?.round}`);
  console.log("frame intervals (all, ms):", JSON.stringify(out.frames));
  console.log("growth verdict (post-unmount gap samples, early vs late third):", growth.verdict, JSON.stringify(growth.groups));
  console.log("live mid-match samples by phase (informational):", liveByPhase.verdict, JSON.stringify(liveByPhase.groups));
  console.log("heap MB:", JSON.stringify(out.heap));
  console.log("lifecycle:", JSON.stringify(final.lifecycle), "longTasks:", JSON.stringify(final.longTasks));
  return out;
}

try {
  browser = await launch();
  const result = await ({ cold, rematch, soak }[mode] ?? (() => { throw new Error(`unknown mode ${mode}`); }))();
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(result, null, 2)); console.log(jsonOut); }
  await browser.close();
} finally {
  vite.kill();
}
