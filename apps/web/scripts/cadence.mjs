#!/usr/bin/env node
// W35b browser half of the render-cadence invariance check. Plays a whole fixture match through the real GameView/FieldView in headless
// Chrome (SwiftShader) with requestAnimationFrame replaced by a scheduler that follows a cadence (30/60/144 Hz, uneven, or 60 Hz with
// real 500 ms main-thread stalls), at a chosen quality tier, action-shot mode and reduced-motion setting. Per run it records the
// authoritative result hash (at mount and after the presentation, re-simulated from the seed), the action-shot selection, and the
// frame intervals the page actually achieved. Runs of one seed must all agree on hash and shot selection.
//   node --experimental-strip-types apps/web/scripts/cadence.mjs [--seed=11] [--cadences=hz30,hz60,hz144,uneven,stall]
//        [--tiers=high,standard,battery] [--shots=full,reduced,off] [--motion=no-preference,reduce] [--matrix=full|lean] [--json=FILE]
// SHOT_PORT (default 5199) as in shot.mjs/perf.mjs. Desktop headless software rendering: not device evidence.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { schedule } from "../src/cadence.ts";
import { frameStats } from "../src/perftelemetry.ts";
import { installScheduler } from "./raf-scheduler.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const list = (k, d) => opt(k, d).split(",").filter(Boolean);
const seed = Number(opt("seed", 11)), jsonOut = opt("json"), matrix = opt("matrix", "lean"), maxMinutes = Number(opt("max-minutes", 12));
const port = Number(process.env.SHOT_PORT) || 5199, base = `http://localhost:${port}/`;
const cadences = list("cadences", "hz30,hz60,hz144,uneven,stall"), tiers = list("tiers", "high,standard,battery");
const shotModes = list("shots", "full,reduced,off"), motions = list("motion", "no-preference,reduce");

// lean: every cadence at High/full/no-preference, then every tier, shot mode and motion setting at 60 Hz and at the stall cadence.
const cells = [];
const add = (c, t, s, m) => { if (!cells.some((x) => x.c === c && x.t === t && x.s === s && x.m === m)) cells.push({ c, t, s, m }); };
if (matrix === "full") { for (const c of cadences) for (const t of tiers) for (const s of shotModes) for (const m of motions) add(c, t, s, m); }
else {
  for (const c of cadences) add(c, "high", "full", "no-preference");
  for (const c of ["hz60", "stall"].filter((x) => cadences.includes(x))) { for (const t of tiers) add(c, t, "full", "no-preference"); for (const s of shotModes) add(c, "high", s, "no-preference"); for (const m of motions) add(c, "high", "full", m); }
}

const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: web, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, no) => {
  vite.stdout.on("data", (d) => { if (String(d).includes("Local:")) ok(); });
  vite.on("exit", (c) => no(new Error(`vite exited ${c}`)));
  setTimeout(() => no(new Error("vite did not start")), 20000);
});

let browser;
const results = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  console.log(`cadence matrix: ${cells.length} runs, seed ${seed}, whole fixture match each, 4x playback; desktop headless Chromium (SwiftShader), not device evidence`);
  for (const [n, cell] of cells.entries()) {
    const times = schedule(cell.c, maxMinutes * 60000, 1);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: cell.m });
    await ctx.addInitScript(([tier, shots]) => { try { localStorage.setItem("bb.quality", tier); localStorage.setItem("bb.actionShots", shots); } catch { /* run without storage */ } }, [cell.t, cell.s]);
    await ctx.addInitScript(installScheduler, times);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    const t0 = Date.now(); let row;
    try {
      await page.goto(`${base}?shot=cadence-match&seed=${seed}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__cadence, null, { timeout: 30000 });
      await page.getByRole("button", { name: "4x", exact: true }).click();
      const frames = [];
      const deadline = Date.now() + maxMinutes * 60000;
      while (Date.now() < deadline) {
        frames.push(...await page.evaluate(() => window.__cadFrames()));
        if (await page.getByRole("button", { name: "Done", exact: true }).isVisible().catch(() => false)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      frames.push(...await page.evaluate(() => window.__cadFrames()));
      const finished = await page.getByRole("button", { name: "Done", exact: true }).isVisible().catch(() => false);
      const tele = await page.evaluate(() => window.__actionShotTelemetry?.() ?? null);
      if (finished) await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.waitForFunction(() => window.__cadence?.done, null, { timeout: 10000 }).catch(() => {});
      const cad = await page.evaluate(() => window.__cadence);
      const shots = (tele?.shots ?? []).map((s) => `${s.index}:${s.family ?? "-"}:${s.status}:${s.reason ?? ""}`);
      row = { ...cell, ok: finished && !!cad?.done, hashStart: cad?.hashStart, hashEnd: cad?.hashEnd, events: cad?.events, shots, shotTotals: tele?.totals, seconds: Math.round((Date.now() - t0) / 1000), achieved: frameStats(frames) };
    } catch (e) { row = { ...cell, ok: false, error: String(e.message).split("\n")[0] }; }
    await ctx.close();
    results.push(row);
    console.log(`${String(n + 1).padStart(2)}/${cells.length} ${cell.c.padEnd(6)} ${cell.t.padEnd(8)} shots=${cell.s.padEnd(7)} motion=${cell.m.padEnd(13)} ok=${row.ok} hash=${row.hashStart}/${row.hashEnd} shotsShown=${row.shotTotals?.shown ?? "n/a"} ${row.seconds ?? "?"}s frames p50/p95/worst=${row.achieved ? `${row.achieved.medianMs}/${row.achieved.p95Ms}/${row.achieved.worstMs}` : "n/a"}${row.error ? " ERROR " + row.error : ""}`);
  }
} finally {
  await browser?.close();
  vite.kill();
}

const done = results.filter((r) => r.ok);
const hashes = new Set(done.flatMap((r) => [r.hashStart, r.hashEnd]));
const sel = new Map(); // shot selection per (mode, motion): must not depend on cadence or tier
for (const r of done) { const k = `${r.s}/${r.m}`; (sel.get(k) ?? sel.set(k, new Set()).get(k)).add(JSON.stringify(r.shots)); }
const selectionStable = [...sel.values()].every((v) => v.size === 1);
const verdict = { runs: results.length, completed: done.length, distinctHashes: hashes.size, hashStartEqualsEnd: done.every((r) => r.hashStart === r.hashEnd), shotSelectionIdenticalAcrossCadenceAndTier: selectionStable, selectionGroups: Object.fromEntries([...sel].map(([k, v]) => [k, v.size])) };
console.log("verdict:", JSON.stringify(verdict));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ seed, matrix, verdict, results }, null, 2));
process.exit(done.length === results.length && hashes.size === 1 && verdict.hashStartEqualsEnd && selectionStable ? 0 : 1);
