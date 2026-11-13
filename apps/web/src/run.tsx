// Rules v6 baserunning controls: steal and pickoff taps before a pitch, and the send/hold choice on a hit or a fly out.
// Everything here is a plain button (tap or click); the engine decides the outcome from ratings.

import { useState } from "react";
import type { AbilityStatus, Awaiting, RunnerOption, SimPlayer, UserInput } from "@bb/sim";
import { reasonText } from "./touch.ts";

const BASE = { first: "1B", second: "2B", third: "3B" } as const;
const NEXT = { first: "2B", second: "3B", third: "HOME" } as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The Afterburner toggle: cost, the odds it buys, and the reason in words when it is off. */
function Burn({ status, base, boost, heat, on, onToggle }: { status: AbilityStatus; base: number; boost: number; heat: number; on: boolean; onToggle: () => void }) {
  return (
    <button className={`tp-toggle run-burn ${on ? "on" : ""}`} aria-pressed={on} aria-disabled={!status.available} onClick={() => status.available && onToggle()}>
      <b>AFTERBURNER</b>
      <small>{status.available ? `COST ${status.cost} · ${pct(base)} TO ${pct(boost)}` : reasonText(status, heat)}</small>
    </button>
  );
}

/** Before a pitch: your runners can steal when you bat, and you can throw over when you pitch. Logged ahead of the pitch itself. */
export function RunStrip({ run, heat, players, onRun }: { run: NonNullable<Awaiting["run"]>; heat: Record<number, number>; players: Map<number, SimPlayer>; onRun: (i: UserInput) => void }) {
  const [burn, setBurn] = useState(false);
  const pick = run.pickoff.length && run.pickoffsLeft > 0 ? run.pickoff : [];
  if (!run.steal.length && !pick.length) return null;
  const lead = run.steal.find((o) => o.afterburner);
  return (
    <div className="tp run-strip" role="group" aria-label="Baserunning">
      <div className="run-box">
        {run.steal.map((o) => (
          <button key={o.base} className="tp-toggle run-go" disabled={o.base === "third"}
            onClick={() => o.base !== "third" && onRun({ kind: "run", action: "steal", from: o.base, ...(burn && o.afterburner?.available ? { ability: { id: "RUN_AFTERBURNER" as const } } : {}) })}>
            <b>STEAL {NEXT[o.base]}</b><small>{players.get(o.runnerId)?.lastName} · {pct(burn && o.afterburner?.available ? o.boost : o.chance)}</small>
          </button>
        ))}
        {lead?.afterburner && <Burn status={lead.afterburner} base={lead.chance} boost={lead.boost} heat={heat[lead.runnerId] ?? 0} on={burn} onToggle={() => setBurn((v) => !v)} />}
        {pick.map((o) => (
          <button key={`p${o.base}`} className="tp-toggle run-go" onClick={() => onRun({ kind: "run", action: "pickoff", at: o.base })}>
            <b>PICKOFF {BASE[o.base]}</b><small>{run.pickoffsLeft} LEFT</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A hit or a fly out with runners on: tap a runner to send or hold, then GO. Runners left on SEND are the ones the odds favour. */
export function AdvancePanel({ adv, heat, players, onGo }: { adv: NonNullable<NonNullable<Awaiting["run"]>["advance"]>; heat: Record<number, number>; players: Map<number, SimPlayer>; onGo: (i: UserInput) => void }) {
  const [send, setSend] = useState<Set<RunnerOption["base"]>>(() => new Set(adv.runners.filter((r) => r.chance >= 0.5).map((r) => r.base)));
  const [burn, setBurn] = useState(false);
  const flip = (b: RunnerOption["base"]) => setSend((s) => { const n = new Set(s); if (n.has(b)) n.delete(b); else n.add(b); return n; });
  const lead = adv.runners.find((r) => r.afterburner && send.has(r.base));
  const go = () => onGo({ kind: "run", action: "advance", send: adv.runners.filter((r) => send.has(r.base)).map((r) => r.base), ...(burn && lead?.afterburner?.available ? { ability: { id: "RUN_AFTERBURNER" as const } } : {}) });
  return (
    <div className="tp run-adv" role="group" aria-label={adv.kind === "fly" ? "Tag up" : "Send or hold"}>
      <div className="run-box">
        <p className="run-title">{adv.kind === "fly" ? "FLY OUT: TAG UP?" : `${adv.outcome.replace("_", " ").toUpperCase()}: SEND THEM?`}</p>
        {adv.runners.map((r) => (
          <button key={r.base} className={`tp-toggle run-go ${send.has(r.base) ? "on" : ""}`} aria-pressed={send.has(r.base)} onClick={() => flip(r.base)}>
            <b>{BASE[r.base]} {send.has(r.base) ? "SEND" : "HOLD"}</b><small>{players.get(r.runnerId)?.lastName} · {pct(r.chance)}</small>
          </button>
        ))}
        {lead?.afterburner && <Burn status={lead.afterburner} base={lead.chance} boost={lead.boost} heat={heat[lead.runnerId] ?? 0} on={burn} onToggle={() => setBurn((v) => !v)} />}
        <button className="swing-btn run-confirm" onClick={go}>GO<small>{send.size ? `${send.size} SENT` : "HOLD ALL"}</small></button>
      </div>
    </div>
  );
}
