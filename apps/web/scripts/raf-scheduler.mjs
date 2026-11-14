// W35b: shared by cadence.mjs and perf.mjs. Self-contained on purpose: Playwright serialises it into the page.
// Installed before any page script: rAF callbacks queue, a pump releases them at the schedule's timestamps. A gap of 400 ms or more is a
// real main-thread stall (busy wait), because that is what a long frame does to the page; shorter gaps are timer waits.
export function installScheduler(times) {
  const queue = []; let id = 0, frame = 0; const achieved = []; let last = null; const t0 = performance.now();
  window.requestAnimationFrame = (cb) => { queue.push([++id, cb]); return id; };
  window.cancelAnimationFrame = (h) => { const i = queue.findIndex((q) => q[0] === h); if (i >= 0) queue.splice(i, 1); };
  // A slow frame is not caught up afterwards (a display does not replay missed vsyncs): each target is the previous release plus the interval.
  let due = performance.now();
  const pump = () => {
    const gap = frame > 0 ? times[Math.min(frame, times.length - 1)] - times[frame - 1] : 0;
    if (frame > 0 && due === undefined) due = performance.now();
    const wait = due - performance.now();
    if (wait > 1 && gap < 400) return void setTimeout(pump, Math.max(0, wait - 1));
    if (gap >= 400) { const end = performance.now() + Math.max(0, wait); while (performance.now() < end) { /* real stall */ } }
    const now = performance.now(); if (last !== null) achieved.push(now - last); last = now; frame++;
    const run = queue.splice(0); for (const [, cb] of run) { try { cb(now); } catch (e) { console.error("raf cb", e); } }
    due = performance.now() + (times[Math.min(frame, times.length - 1)] - times[frame - 1]);
    setTimeout(pump, 0);
  };
  window.__cadFrames = () => { const a = achieved.splice(0); return a; };
  setTimeout(pump, 0);
}
