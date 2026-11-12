// Play it yourself: you pitch when your team is in the field and swing when it bats.
// The engine (@bb/sim) is pure, so the browser replays the game from its seed plus your
// choices so far; each new choice reveals the next few events, which play out on the field.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playInteractive, type Aim, type GameEvent, type InteractiveSetup, type PitchType, type PlayedGame, type SimPlayer, type Side, type UserInput } from "@bb/sim";
import { api } from "./api.ts";
import { BoxScoreView, holdFor, Scorebug } from "./game.tsx";

const FieldView = lazy(() => import("./field.tsx").then((m) => ({ default: m.FieldView })));

const TYPES: { type: PitchType; label: string; hint: string }[] = [
  { type: "fastball", label: "Fastball", hint: "fast, safe" },
  { type: "slider", label: "Slider", hint: "fools hitters" },
  { type: "change", label: "Change-up", hint: "slow, tricky" },
  { type: "curve", label: "Curveball", hint: "big drop" },
];

/** Milliseconds a pitch takes to reach the plate. Slower pitches give more time, and are harder to time. */
const flightMs = (mph: number) => Math.max(700, Math.min(1300, 900 + (93 - mph) * 14));
/** Where on the flight (0 = release, 1 = plate) the swing is perfectly timed, and how forgiving it is. */
const SWEET = 0.85, WINDOW = 0.25;

const GRID = 1.8; // zone drawing spans -GRID..GRID
const toPct = (v: number) => ((v + GRID) / (2 * GRID)) * 100;

export function DuelView({ setup, onDone }: { setup: InteractiveSetup; onDone: () => void }) {
  const [inputs, setInputs] = useState<UserInput[]>([]);
  const [shown, setShown] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [pitchType, setPitchType] = useState<PitchType>("fastball");

  // One stable object for the field and scorebug; its events grow as the game does.
  const shell = useMemo<PlayedGame>(() => ({
    id: 0, createdAt: "", opponent: setup.opponent, userSide: setup.userSide, teams: setup.teams,
    result: { seed: setup.seed, innings: setup.innings, final: { away: 0, home: 0 }, winner: null, events: [], box: { linescore: { away: [], home: [] }, hits: { away: 0, home: 0 }, batting: { away: [], home: [] }, pitching: { away: [], home: [] } } },
  }), [setup]);

  const g = useMemo(() => {
    const out = playInteractive({ away: setup.teams.away, home: setup.teams.home, seed: setup.seed, innings: setup.innings, userSide: setup.userSide, inputs });
    shell.result = out.result ?? { ...shell.result, events: out.events };
    return out;
  }, [setup, inputs, shell]);

  const events = g.events;
  const players = useMemo(() => {
    const m = new Map<number, SimPlayer>();
    for (const side of ["away", "home"] as Side[]) for (const p of [...setup.teams[side].lineup, ...setup.teams[side].pitchers]) m.set(p.id, p);
    return m;
  }, [setup]);

  // Play out newly revealed events, one after another.
  const caughtUp = shown >= events.length - 1;
  useEffect(() => {
    if (caughtUp) return;
    const t = setTimeout(() => setShown((n) => n + 1), holdFor(events[shown]) / speed);
    return () => clearTimeout(t);
  }, [shown, caughtUp, speed, events]);

  const submit = useCallback((input: UserInput) => setInputs((prev) => [...prev, input]), []);
  const current = events[Math.min(shown, events.length - 1)];
  const youWon = g.result?.winner === setup.userSide;
  const done = !!g.result && caughtUp;
  const awaiting = caughtUp ? g.awaiting : null;

  // Once it's over, the server replays our choices against the seed and records the game.
  const [saved, setSaved] = useState<"saving" | "saved" | string | null>(null);
  useEffect(() => {
    if (!g.result || saved) return;
    setSaved("saving");
    api("/api/games/interactive/finish", { body: { opponentTeamId: setup.opponent.id, seed: setup.seed, inputs, final: g.result.final } })
      .then(() => setSaved("saved"), (e: Error) => setSaved(e.message));
  }, [g.result, saved, inputs, setup]);
  const lastCall = [...events.slice(0, shown + 1)].reverse().find((e): e is Extract<GameEvent, { type: "play" }> => e.type === "play");

  return (
    <section className="panel game">
      <div className="game-top">
        <Scorebug game={shell} index={Math.min(shown, events.length - 1)} />
        <div className="game-controls">
          {!done && [1, 2].map((x) => <button key={x} className={`speed ${speed === x ? "on" : ""}`} onClick={() => setSpeed(x)}>{x}x</button>)}
          {done ? <button className="primary" onClick={onDone}>Done</button> : <button className="link" onClick={onDone}>Quit</button>}
        </div>
      </div>

      <Suspense fallback={<div className="field" />}><FieldView game={shell} index={Math.min(shown, events.length - 1)} speed={speed} /></Suspense>

      {awaiting?.role === "pitch" && (
        <PitchPanel key={inputs.length} pitcher={players.get(awaiting.pitcherId)} batter={players.get(awaiting.batterId)}
          heat={awaiting.state.heat} type={pitchType} onType={setPitchType} onThrow={(aim) => submit({ kind: "pitch", type: pitchType, aim })} />
      )}
      {awaiting?.role === "swing" && awaiting.incoming && (
        <SwingPanel key={inputs.length} pitcher={players.get(awaiting.pitcherId)} batter={players.get(awaiting.batterId)}
          heat={awaiting.state.heat} incoming={awaiting.incoming} onSwing={(swing, timing) => submit({ kind: "swing", swing, timing })} />
      )}

      {!awaiting && !done && lastCall && current.type !== "final" && (
        <p className="muted duel-note" aria-live="polite">{lastCall.text}</p>
      )}

      {done && g.result && (
        <>
          <div className={`final-band ${youWon ? "win" : g.result.winner ? "loss" : ""}`}>
            <span className="display">{youWon ? "Victory" : g.result.winner ? "Defeat" : "Tie game"}</span>
            <span>{(events[events.length - 1] as Extract<GameEvent, { type: "final" }>).text}</span>
          </div>
          {saved && saved !== "saving" && (
            <p className={`muted duel-note ${saved === "saved" ? "" : "bad"}`} aria-live="polite">
              {saved === "saved" ? "Counted toward your record." : saved}
            </p>
          )}
          <BoxScoreView game={shell} />
        </>
      )}
    </section>
  );
}

/** Heat flames: one per level, earned on the field (hits for batters, strikeouts for pitchers). */
function Heat({ level }: { level: number }) {
  if (!level) return null;
  return <span className={`heat heat-${level}`} aria-label={`heat ${level} of 3`}>{"🔥".repeat(level)}</span>;
}

function Who({ batter, pitcher, heat }: { batter?: SimPlayer; pitcher?: SimPlayer; heat: Record<number, number> }) {
  return (
    <div className="matchup">
      <span><small>AT BAT</small> {batter?.name}<Heat level={batter ? heat[batter.id] ?? 0 : 0} /></span>
      <span><small>PITCHING</small> {pitcher?.name}<Heat level={pitcher ? heat[pitcher.id] ?? 0 : 0} /></span>
    </div>
  );
}

/** A strike-zone diagram. Children draw on top; `onPick` turns a click into plate coordinates. */
function Zone({ onPick, children }: { onPick?: (aim: Aim) => void; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className={`zone ${onPick ? "pickable" : ""}`} ref={ref}
      onClick={(e) => {
        if (!onPick || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 2 * GRID - GRID;
        const y = GRID - ((e.clientY - r.top) / r.height) * 2 * GRID;
        onPick({ x: Math.max(-GRID, Math.min(GRID, x)), y: Math.max(-GRID, Math.min(GRID, y)) });
      }}>
      <div className="zone-box" style={{ left: `${toPct(-1)}%`, top: `${toPct(-1)}%`, width: `${toPct(1) - toPct(-1)}%`, height: `${toPct(1) - toPct(-1)}%` }} />
      {children}
    </div>
  );
}

function PitchPanel({ pitcher, batter, heat, type, onType, onThrow }: {
  pitcher?: SimPlayer; batter?: SimPlayer; heat: Record<number, number>; type: PitchType; onType: (t: PitchType) => void; onThrow: (aim: Aim) => void;
}) {
  return (
    <div className="duel-panel">
      <Who batter={batter} pitcher={pitcher} heat={heat} />
      <div className="duel-row">
        <div className="duel-types" role="group" aria-label="Pitch type">
          {TYPES.map((t) => (
            <button key={t.type} className={`duel-type ${type === t.type ? "on" : ""}`} onClick={() => onType(t.type)}>
              <b>{t.label}</b><small>{t.hint}</small>
            </button>
          ))}
        </div>
        <div className="duel-zone-wrap">
          <Zone onPick={onThrow} />
          <small className="muted">Tap where to throw it. Strikes are in the box.</small>
        </div>
      </div>
    </div>
  );
}

function SwingPanel({ pitcher, batter, heat, incoming, onSwing }: {
  pitcher?: SimPlayer; batter?: SimPlayer; heat: Record<number, number>; incoming: { type: PitchType; mph: number; aim: Aim };
  onSwing: (swing: "contact" | "power" | "take", timing: number) => void;
}) {
  const ms = flightMs(incoming.mph);
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);
  const onSwingRef = useRef(onSwing);
  onSwingRef.current = onSwing;

  const swing = useCallback((kind: "contact" | "power" | "take") => {
    if (doneRef.current) return;
    doneRef.current = true;
    const p = (performance.now() - startRef.current) / ms;
    onSwingRef.current(kind, Math.max(-1, Math.min(1, (p - SWEET) / WINDOW)));
  }, [ms]);

  // Let it go by and it's a take.
  useEffect(() => {
    const t = setTimeout(() => swing("take"), ms * 1.25);
    return () => clearTimeout(t);
  }, [ms, swing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.key === "c" || e.key === "C") { e.preventDefault(); swing("contact"); }
      else if (e.key === "p" || e.key === "P") swing("power");
      else if (e.key === "t" || e.key === "T") swing("take");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swing]);

  const label = TYPES.find((t) => t.type === incoming.type)!.label;
  return (
    <div className="duel-panel">
      <Who batter={batter} pitcher={pitcher} heat={heat} />
      <div className="duel-row">
        <div className="duel-incoming">
          <div className="duel-pitch"><b>{label}</b> {incoming.mph} mph</div>
          <div className="timing" aria-hidden>
            <i className="timing-sweet" style={{ left: `${(SWEET - WINDOW * 0.2) * 100}%`, width: `${WINDOW * 0.4 * 100}%` }} />
            <i className="timing-marker" style={{ animationDuration: `${ms}ms` }} />
          </div>
          <div className="duel-buttons">
            <button className="primary" onClick={() => swing("contact")}>Contact <small>Space</small></button>
            <button className="primary" onClick={() => swing("power")}>Power <small>P</small></button>
            <button onClick={() => swing("take")}>Take <small>T</small></button>
          </div>
          <small className="muted">Swing when the marker hits the gold. Contact for hits, Power for homers.</small>
        </div>
        <Zone>
          <i className="zone-ball" style={{ left: `${toPct(incoming.aim.x)}%`, top: `${toPct(-incoming.aim.y)}%`, animationDuration: `${ms}ms` }} />
        </Zone>
      </div>
    </div>
  );
}
