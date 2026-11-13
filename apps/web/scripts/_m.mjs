import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
const web="/Users/tim/Projects/baseball-2027/apps/web";
const vite = spawn("npx", ["vite","--port","5197","--strictPort"],{cwd:web,stdio:["ignore","pipe","inherit"]});
await new Promise(ok=>vite.stdout.on("data",d=>String(d).includes("Local:")&&ok()));
const b = await chromium.launch({channel:"chrome",headless:true,args:["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const p = await b.newPage({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
for (const m of process.argv.slice(2)){
await p.goto("http://localhost:5197/?shot="+m+"&t=300");
await p.waitForFunction(()=>window.__shotReady===true);
console.log(m, JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll(".scorebug,.game-top,.game-controls,.matchup,.heat-meter,.tp-chips,.tp-note,.tp-side,.tp-action,.run-box,.tp-swing-row,.pchip,.tp-mini")].map(e=>{const r=e.getBoundingClientRect();return e.className.split(" ")[0]+" "+[r.left,r.top,r.width,r.height].map(Math.round)}))));}
await b.close(); vite.kill();
