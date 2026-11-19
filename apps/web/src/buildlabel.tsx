import { useEffect, useState } from "react";
import { buildLabelText, fpsFromFrames, useBuildLabel } from "./buildlabel.ts";

/** Small corner readout while the Settings toggle is on. The frame loop and the /health fetch only run while it is shown. */
export function BuildLabel() {
  const [on] = useBuildLabel();
  const [version, setVersion] = useState<string | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetch("/health").then((r) => r.json()).then((h) => { if (live) setVersion(String(h.version ?? "unknown")); }).catch(() => { if (live) setVersion("unknown"); });
    const times: number[] = [];
    let raf = 0, last = 0;
    const tick = (now: number) => {
      times.push(now);
      while (times.length > 61) times.shift();
      if (now - last > 500) { last = now; setFps(fpsFromFrames(times)); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { live = false; cancelAnimationFrame(raf); };
  }, [on]);
  if (!on) return null;
  return <div className="build-label" aria-hidden>{buildLabelText(version, fps)}</div>;
}
