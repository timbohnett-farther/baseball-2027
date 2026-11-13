#!/usr/bin/env node
// Art review: boot the web dev server, open `/?shot=<moment>` for each moment and save JPEGs.
//   node apps/web/scripts/shot.mjs [outDir] [moment ...]
// Uses the locally installed Google Chrome through playwright-core (no browser download).
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
// --phone: 844x390 landscape touch viewport (iPhone-class), for the tap-control layout.
const phone = args.includes("--phone");
// --check: layout assertions per duel-* moment (no overlapping HUD/controls, all inside the viewport, ballpark pixels in the centre).
const check = args.includes("--check");
const [outDir = join(web, "shots"), ...only] = args.filter((a) => a !== "--phone" && a !== "--check");
// duel-* shots must show live controls; a shot taken after the panel closed is a failure, not a picture.
const CONTROLS = { "duel-pitch": ".tp .target-cell", "duel-swing": ".tp .swing-btn", "duel-field": ".tp .swing-btn", "duel-run": ".tp .run-confirm", "duel-steal": ".tp .run-go", "duel-tutorial-pitch": ".coach", "duel-tutorial-swing": ".coach", "duel-hint": ".coach" };
const DUELS = Object.keys(CONTROLS);
// Season hub shots are plain pages (no ballpark): checked for overflow, touch size and key content instead.
const HUBS = { "season-hub": [".arc-rounds", ".arc-next", ".arc-objs li", ".arc-track", "table"], "season-bracket": [".arc-bracket", ".arc-game", "table", ".arc-track"], "season-stars": [".arc-summary", ".final-band"] };
const moments = only.length ? only : check ? [...DUELS, ...Object.keys(HUBS)] : ["pitch", "swing", "hr", "k", "single", "double", "final"];
const HUD = ".scorebug, .game-controls button, .matchup, .heat-meter, .tp-note, .coach p, .coach button, .tp button, .tp .zone";
async function layoutCheck(page, m) {
  const vp = page.viewportSize();
  // The ballpark is a lazy chunk: wait for its canvas to exist and draw a few frames before sampling.
  await page.waitForSelector(".field canvas", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const boxes = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { n: (e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().split(" ").slice(0, 2).join(".") + ":" + (e.textContent || "").trim().slice(0, 14), x: r.left, y: r.top, w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0" };
  }), HUD);
  // Skip wrappers that contain another listed box (a chip's inner span is not listed; the container .scorebug contains no listed box).
  const vis = boxes.filter((b) => b.vis);
  const bad = [];
  const E = 0.5;
  for (let i = 0; i < vis.length; i++) {
    const a = vis[i];
    if (a.x < -E || a.y < -E || a.x + a.w > vp.width + E || a.y + a.h > vp.height + E) bad.push(`outside viewport: ${a.n} [${a.x | 0},${a.y | 0},${a.w | 0}x${a.h | 0}]`);
    for (let j = i + 1; j < vis.length; j++) {
      const b = vis[j];
      if (a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E) bad.push(`overlap: ${a.n} x ${b.n}`);
    }
    if (phone && a.n.startsWith("") && /^(?:[^:]*button|tp-|pchip|swing|target|duel|approach|run-|coach|chip|speed|link|primary)/.test(a.n) && Math.min(a.w, a.h) < 43.5 && a.w * a.h > 0) bad.push(`touch target <44px: ${a.n} ${a.w | 0}x${a.h | 0}`);
  }
  // Centre of the screen must be live ballpark pixels, not the flat page background.
  const cx = (vp.width / 2) | 0, cy = (vp.height / 2) | 0;
  const png = await page.screenshot({ type: "png", clip: { x: cx - 60, y: cy - 40, width: 120, height: 80 } });
  const spread = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | d[i + 2] >> 4);
    return seen.size;
  }, png.toString("base64"));
  if (spread < 6) bad.push(`centre pixels are flat (${spread} colours): ballpark not rendered`);
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
  const page = await browser.newPage(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  let failures = 0;
  for (const m of moments) {
    await page.goto(`http://localhost:${port}/?shot=${m}&t=700`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
    if (CONTROLS[m]) {
      const n = await page.locator(CONTROLS[m]).count();
      if (!n) throw new Error(`${m}: controls (${CONTROLS[m]}) missing from the shot`);
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
    await page.waitForTimeout(800);
    const file = join(outDir, `${m}${phone ? "-phone" : ""}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log(file);
  }
  await browser.close();
  if (failures) { console.error(`${failures} layout failure(s)`); process.exitCode = 1; }
} finally {
  vite.kill();
}
