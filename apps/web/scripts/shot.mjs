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
const [outDir = join(web, "shots"), ...only] = args.filter((a) => a !== "--phone");
const moments = only.length ? only : ["pitch", "swing", "hr", "k", "single", "double", "final"];
// duel-* shots must show live controls; a shot taken after the panel closed is a failure, not a picture.
const CONTROLS = { "duel-pitch": ".tp .target-cell", "duel-swing": ".tp .swing-btn", "duel-field": ".tp .swing-btn", "duel-run": ".tp .run-confirm", "duel-steal": ".tp .run-go" };
const port = 5199;
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
  for (const m of moments) {
    await page.goto(`http://localhost:${port}/?shot=${m}&t=700`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
    if (CONTROLS[m]) {
      const n = await page.locator(CONTROLS[m]).count();
      if (!n) throw new Error(`${m}: controls (${CONTROLS[m]}) missing from the shot`);
    }
    const file = join(outDir, `${m}${phone ? "-phone" : ""}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log(file);
  }
  await browser.close();
} finally {
  vite.kill();
}
