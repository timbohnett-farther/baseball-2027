#!/usr/bin/env node
// Art review: boot the web dev server, open `/?shot=<moment>` for each moment and save JPEGs.
//   node apps/web/scripts/shot.mjs [outDir] [moment ...]
// Uses the locally installed Google Chrome through playwright-core (no browser download).
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
// --phone: 844x390 landscape touch viewport (iPhone-class), for the tap-control layout.
const phone = args.includes("--phone");
// --check: layout assertions per duel-* moment (no overlapping HUD/controls, all inside the viewport, ballpark pixels in the centre).
const check = args.includes("--check");
// --perf: no pictures; print renderer stats (draw calls, triangles, frame time) per moment. --json=FILE also writes them.
// --reduced emulates prefers-reduced-motion.
// --quality=high|standard|battery sets the stored quality tier before the page loads.
const perf = args.includes("--perf");
// --phase=early|mid|late freezes an action shot at 0.15 / 0.5 / 0.85 of its run; --hand=L|R picks a left- or right-handed batter; --seed=N starts the fixture seed walk there.
const phase = args.find((a) => a.startsWith("--phase="))?.slice(8);
const hand = args.find((a) => a.startsWith("--hand="))?.slice(7);
const throwsArg = args.find((a) => a.startsWith("--throws="))?.slice(9); // pitcher throwing hand for the release shot
const seedArg = args.find((a) => a.startsWith("--seed="))?.slice(7);
const hold = { early: 0.15, mid: 0.5, late: 0.85 }[phase ?? ""];
const jsonOut = args.find((a) => a.startsWith("--json="))?.slice(7);
const reduced = args.includes("--reduced"); // prefers-reduced-motion: reduce
// W36a comfort flags: --lefty / --calm seed the stored settings, --gray applies a grayscale filter, --pseudo expands every string ~40%,
// --inset=T,R,B,L simulates env(safe-area-inset-*) through CDP, --vp=WxH overrides the phone viewport.
const lefty = args.includes("--lefty"), calm = args.includes("--calm"), gray = args.includes("--gray"), pseudo = args.includes("--pseudo");
const inset = args.find((a) => a.startsWith("--inset="))?.slice(8).split(",").map(Number);
const vpArg = args.find((a) => a.startsWith("--vp="))?.slice(5).split("x").map(Number);
const quality = args.find((a) => a.startsWith("--quality="))?.slice(10);
const [outDir = join(web, "shots"), ...only] = args.filter((a) => !a.startsWith("--") && a !== "--phone" && a !== "--check" && a !== "--perf" && a !== "--reduced" && !a.startsWith("--phase=") && !a.startsWith("--hand=") && !a.startsWith("--seed=") && !a.startsWith("--throws=") && !a.startsWith("--json=") && !a.startsWith("--quality="));
// duel-* shots must show live controls; a shot taken after the panel closed is a failure, not a picture.
const CONTROLS = { "duel-pitch": ".tp .target-cell", "duel-caption": ".tp .target-cell", "duel-swing": ".tp .swing-btn", "duel-field": ".tp .swing-btn", "duel-run": ".tp .run-confirm", "duel-steal": ".tp .run-go", "duel-tutorial-pitch": ".coach", "duel-tutorial-swing": ".coach", "duel-hint": ".coach", "duel-resume": ".pause-gate .primary", "duel-result": ".result-continue", "duel-windup": ".windup-gate" };
// Static W28 presentation shots (no controls): an ability cue over the ballpark, and a big-play card.
const STATIC = { ability: ".ability-cue", bigplay: ".big-play" };
const DUELS = Object.keys(CONTROLS);
// Season hub shots are plain pages (no ballpark): checked for overflow, touch size and key content instead.
const HUBS = { "season-hub": [".arc-rounds", ".arc-next", ".arc-objs li", ".arc-track", "table"], "season-bracket": [".arc-bracket", ".arc-game", "table", ".arc-track"], "season-stars": [".arc-summary", ".final-band"] };
const moments = only.length ? only : perf ? ["pitch", "single", "hr", "bigplay", "shot-contact", "shot-release", "shot-slide"] : check ? [...DUELS, ...Object.keys(HUBS), ...Object.keys(STATIC)] : ["pitch", "swing", "hr", "k", "single", "double", "final", ...Object.keys(STATIC)];
const HUD = ".ability-cue, .big-play, .scorebug, .game-controls button, .matchup, .heat-meter, .tp-note, .cue-caption:not(:empty), .coach p, .coach button, .tp button, .tp .zone, .result-continue";
async function layoutCheck(page, m) {
  const vp = page.viewportSize();
  // The ballpark is a lazy chunk: wait for its canvas to exist and draw a few frames before sampling.
  await page.waitForSelector(".field canvas", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const boxes = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { n: (e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().split(" ").slice(0, 2).join(".") + ":" + (e.textContent || "").trim().slice(0, 14), x: r.left, y: r.top, w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0" };
  }), m === "duel-resume" ? ".pause-gate button" : HUD);
  // Skip wrappers that contain another listed box (a chip's inner span is not listed; the container .scorebug contains no listed box).
  const vis = boxes.filter((b) => b.vis);
  const bad = [];
  const E = 0.5;
  for (let i = 0; i < vis.length; i++) {
    const a = vis[i];
    if (a.x < -E || a.y < -E || a.x + a.w > vp.width + E || a.y + a.h > vp.height + E) bad.push(`outside viewport: ${a.n} [${a.x | 0},${a.y | 0},${a.w | 0}x${a.h | 0}]`);
    for (let j = i + 1; j < vis.length; j++) {
      const b = vis[j];
      if (a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E) bad.push(`overlap: ${a.n} x ${b.n} [${[a.x,a.y,a.w,a.h,b.x,b.y,b.w,b.h].map(Math.round)}]`);
    }
    if (phone && a.n.startsWith("") && /^(?:[^:]*button|tp-|pchip|swing|target|duel|approach|run-|coach|chip|speed|link|primary)/.test(a.n) && Math.min(a.w, a.h) < 43.5 && a.w * a.h > 0) bad.push(`touch target <44px: ${a.n} ${a.w | 0}x${a.h | 0}`);
  }
  // Touch contract (Kimi CLAUDE.md section 4, phone only): primary action >= 112x88, other gameplay controls >= 56x56,
  // base targets >= 64x64, and 8pt between neighbouring gameplay controls. Measured from the real DOM rects in CSS px.
  if (phone) {
    const SIZES = [[".swing-btn, .run-confirm, .result-continue", 112, 88, "primary action"], [".duel-type, .approach button, .tp-toggle, .run-go, .run-burn, .target-cell, .pchip > button:first-child", 56, 56, "gameplay control"], [".throw-diamond button", 64, 64, "base target"]];
    const rects = await page.evaluate((groups) => groups.flatMap(([sel, w, h, kind]) => [...document.querySelectorAll(sel)].map((e) => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { n: ((e.className.baseVal === undefined ? e.className : "") + ":" + (e.textContent || "").trim()).slice(0, 24), x: r.left, y: r.top, w: r.width, h: r.height, need: [w, h], kind, vis: r.width * r.height > 0 && s.visibility !== "hidden" && s.display !== "none" };
    })).filter((b) => b.vis), SIZES);
    for (const r of rects) if (r.w < r.need[0] - E || r.h < r.need[1] - E) bad.push(`${r.kind} too small: ${r.n} ${r.w | 0}x${r.h | 0}, needs ${r.need[0]}x${r.need[1]}`);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (Math.max(gx, gy) < 8 - E && Math.min(gx, gy) < 0 + E) bad.push(`gap under 8pt (${Math.max(gx, gy).toFixed(1)}): ${a.n} next to ${b.n}`);
    }
  }
  // W36a: controls stay inside the safe area (simulated insets), text is not clipped in its box, and a left-handed layout puts the primary action on the left.
  const ins = inset ?? [0, 0, 0, 0];
  if (inset) for (const a of vis) if (/button|tp-|swing|target|run-|pchip/.test(a.n) && (a.x < ins[3] - E || a.y < ins[0] - E || a.x + a.w > vp.width - ins[1] + E || a.y + a.h > vp.height - ins[2] + E)) bad.push(`inside unsafe area: ${a.n} [${a.x | 0},${a.y | 0},${a.w | 0}x${a.h | 0}] insets ${ins}`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll(".tp button, .tp-note, .coach, .coach button, .scorebug, .scorebug *, .game-controls button, .windup-gate *, .matchup, .pchip, .run-box *")].filter((e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width * r.height > 0 && s.visibility !== "hidden" && e.children.length === 0 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && s.overflow !== "visible" && s.textOverflow !== "ellipsis"; }).map((e) => `${e.tagName}.${String(e.className).split(" ")[0]}:${(e.textContent || "").trim().slice(0, 14)} ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight}`));
  for (const c of clipped) bad.push(`text clipped: ${c}`);
  if (lefty && phone) {
    const pr = await page.evaluate(() => { const e = document.querySelector(".tp .swing-btn, .tp .run-confirm, .windup-gate .swing-btn"); const r = e?.getBoundingClientRect(); return r && r.width ? r.left + r.width / 2 : null; });
    if (pr !== null && pr > vp.width / 2) bad.push(`left-handed: primary action centre x=${pr | 0} is on the right half`);
  }
  // Centre of the screen must be live ballpark pixels, not the flat page background.
  const cx = (vp.width / 2) | 0, cy = (vp.height / 2) | 0;
  // The big-play card is opaque and can cover the centre in a short landscape viewport: probe the clear band above it instead.
  const card = await page.evaluate(() => { const r = document.querySelector(".big-play")?.getBoundingClientRect(); return r && r.width ? r.top : null; });
  const py = card !== null && card < cy + 40 ? Math.max(0, (card / 2 - 40) | 0) : cy - 40;
  const png = await page.screenshot({ type: "png", clip: { x: cx - 60, y: py, width: 120, height: 80 } });
  const spread = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4);
    return seen.size;
  }, png.toString("base64"));
  // The coach card must never sit on the plate or batter: that is where the player looks to time the swing.
  const plate = await page.evaluate(() => document.querySelector(".field canvas")?.dataset.plate ?? "");
  if (plate && process.env.SHOT_DEBUG) console.log("   plate", plate, vis.filter((b) => /^(P|BUTTON:OK)/.test(b.n)).map((b) => `${b.n}[${b.x | 0},${b.y | 0},${b.w | 0}x${b.h | 0}]`).join(" "));
  if (plate) {
    const [px, py, pw, ph] = plate.split(",").map(Number);
    const c = await page.evaluate(() => { const r = document.querySelector(".coach")?.getBoundingClientRect(); return r && r.width ? [r.left, r.top, r.width, r.height] : null; });
    if (c && c[0] < px + pw && px < c[0] + c[2] && c[1] < py + ph && py < c[1] + c[3]) bad.push(`coach covers the plate/batter: [${c.map(Math.round)}] vs plate [${plate}]`);
  }
  // The resume gate dims the whole field on purpose, so only its own button is measured; on the result screen the viewport centre is the page top, not the field.
  if (spread < 6 && m !== "duel-resume" && m !== "duel-result") bad.push(`centre pixels are flat (${spread} colours): ballpark not rendered`);
  console.log(`${bad.length ? "FAIL" : "ok  "} ${m}: ${vis.length} HUD boxes, centre colours ${spread}`);
  for (const b of bad) console.log("   - " + b);
  return bad.length;
}
async function hubCheck(page, m) {
  const vp = page.viewportSize();
  const bad = [];
  for (const sel of HUBS[m]) if (!(await page.locator(sel).first().isVisible().catch(() => false))) bad.push(`missing or hidden: ${sel}`);
  const r = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll("button")].map((b) => { const q = b.getBoundingClientRect(); return { t: (b.textContent || "").trim().slice(0, 16), w: q.width, h: q.height }; }).filter((b) => b.w * b.h > 0 && Math.min(b.w, b.h) < 43.5),
  }));
  if (r.overflow > 0) bad.push(`horizontal page overflow ${r.overflow}px`);
  if (phone) for (const b of r.small) bad.push(`touch target <44px: button "${b.t}" ${b.w | 0}x${b.h | 0}`);
  console.log(`${bad.length ? "FAIL" : "ok  "} ${m}: ${vp.width}x${vp.height}`);
  for (const b of bad) console.log("   - " + b);
  return bad.length;
}
const port = Number(process.env.SHOT_PORT) || 5199;
mkdirSync(outDir, { recursive: true });

const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: web, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, no) => {
  vite.stdout.on("data", (d) => { if (String(d).includes("Local:")) ok(); });
  vite.on("exit", (c) => no(new Error(`vite exited ${c}`)));
  setTimeout(() => no(new Error("vite did not start")), 20000);
});

try {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage(phone ? { viewport: { width: vpArg?.[0] ?? 844, height: vpArg?.[1] ?? 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  if (quality) await page.addInitScript((q) => { try { localStorage.setItem("bb.quality", q); } catch { /* shot runs without storage */ } }, quality);
  if (lefty || calm) await page.addInitScript(([l, c]) => { try { if (l) localStorage.setItem("bb.lefty", "1"); if (c) localStorage.setItem("bb.reducedFlash", "1"); } catch { /* shot runs without storage */ } }, [lefty, calm]);
  if (inset) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: inset[0], right: inset[1], bottom: inset[2], left: inset[3] } }).catch((e) => { throw new Error(`--inset needs Chrome safe-area emulation: ${e.message}`); });
  }
  if (pseudo) await page.addInitScript(() => { // dev-only: pad every text node by ~40% with accented filler, re-applied as React re-renders
    const grow = (t) => { const v = t.nodeValue; if (!v || !v.trim() || t.__p === v) return; const out = v + "e".repeat(Math.ceil(v.trim().length * 0.4)); t.__p = out; t.nodeValue = out; };
    const walk = (n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) if (t.parentElement && !/^(SCRIPT|STYLE)$/.test(t.parentElement.tagName)) grow(t); };
    addEventListener("DOMContentLoaded", () => { walk(document.body); new MutationObserver(() => walk(document.body)).observe(document.body, { childList: true, subtree: true, characterData: true }); });
  });
  let failures = 0;
  const rows = [];
  for (const m of moments) {
    await page.goto(`http://localhost:${port}/?shot=${m}&t=${process.env.SHOT_T ?? 700}${hold !== undefined ? `&hold=${hold}` : ""}${hand ? `&hand=${hand}` : ""}${throwsArg ? `&throws=${throwsArg}` : ""}${seedArg ? `&seed=${seedArg}` : ""}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
    if (gray) await page.addStyleTag({ content: "html { filter: grayscale(1); }" });
    let shotStats = null;
    if (m.startsWith("shot-")) { // an action shot lasts about a second: wait until its camera is a third of the way through
      const want = { "shot-contact": "contact", "shot-release": "release", "shot-slide": "slide" }[m];
      await page.waitForFunction(([k, h]) => { const r = window.__renderStats; return r && r.shotKind === k && r.shotP > (h ?? 0.35) - 0.01; }, [want, hold], { timeout: 60000, polling: 20 });
      shotStats = await page.evaluate(() => ({ ...window.__renderStats }));
    }
    if (CONTROLS[m] || STATIC[m]) {
      const n = await page.locator(CONTROLS[m] ?? STATIC[m]).count();
      if (!n) throw new Error(`${m}: controls (${CONTROLS[m] ?? STATIC[m]}) missing from the shot`);
    }
    if (perf && shotStats) { rows.push({ moment: m, quality: quality ?? "stored", ...shotStats }); continue; } // measured while the shot camera is live
    if (perf) { // sample a fixed window of 60 rendered frames after the moment is ready
      await page.waitForSelector(".field canvas", { timeout: 15000 });
      const from = await page.evaluate(() => window.__renderStats?.seq ?? 0);
      await page.waitForFunction((n) => (window.__renderStats?.seq ?? 0) >= n + 60, from, { timeout: 120000, polling: 100 });
      rows.push({ moment: m, quality: quality ?? "stored", ...(await page.evaluate(() => window.__renderStats)) });
      continue;
    }
    if (HUBS[m]) {
      if (check) { failures += await hubCheck(page, m); continue; }
      const file = join(outDir, `${m}${phone ? "-phone" : "-desktop"}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 82, fullPage: true });
      console.log(file);
      continue;
    }
    if (check) { failures += await layoutCheck(page, m); continue; }
    await page.waitForSelector(".field canvas", { timeout: 15000 }); // the ballpark is a lazy chunk; never shoot before it mounts
    if (!shotStats) await page.waitForTimeout(800);
    const file = join(outDir, `${m}${phase ? "-" + phase : ""}${hand ? "-" + hand : ""}${throwsArg ? "-t" + throwsArg : ""}${phone ? "-phone" : ""}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log(file);
  }
  await browser.close();
  if (perf) {
    const BUDGET = 250; // graphics-production-plan 2.3, higher tier. Soft: warn, never fail.
    console.log("desktop headless Chromium (SwiftShader), not device evidence");
    console.log("moment     quality    calls  tris    points  geoms  tex  prog  median ms  p95 ms  frames");
    for (const r of rows) console.log(`${r.moment.padEnd(10)} ${String(r.quality).padEnd(9)} ${String(r.calls).padStart(6)} ${String(r.triangles).padStart(6)} ${String(r.points).padStart(7)} ${String(r.geometries).padStart(6)} ${String(r.textures).padStart(4)} ${String(r.programs).padStart(5)} ${r.frameMedianMs.toFixed(1).padStart(10)} ${r.frameP95Ms.toFixed(1).padStart(7)} ${String(r.samples).padStart(7)}`);
    for (const r of rows) if (r.calls > BUDGET) console.warn(`WARN ${r.moment}: ${r.calls} draw calls over the soft budget of ${BUDGET}`);
    if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(rows, null, 2)); console.log(jsonOut); }
  }
  if (failures) { console.error(`${failures} layout failure(s)`); process.exitCode = 1; }
} finally {
  vite.kill();
}
