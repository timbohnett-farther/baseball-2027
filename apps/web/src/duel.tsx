// Play it yourself: you pitch when your team is in the field and swing when it bats.
// The engine (@bb/sim) is pure, so the browser replays the game from its seed plus your
// choices so far; each new choice reveals the next few events, which play out on the field.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playInteractive, type Aim, type Awaiting, type GameEvent, type InteractiveSetup, type PitchType, type PlayedGame, type SimPlayer, type Side, type UserInput } from "@bb/sim";
import { api } from "./api.ts";
import { crowdBed, playEvent } from "./audio.ts";
import { BoxScoreView, holdFor, PlayCard, ReelCard, Scorebug, SkipPlay, usePlayCard, useReel } from "./game.tsx";
import { RewardLine } from "./store.tsx";

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
/** How long a close ball takes to reach the fielder: liners are on you fast, flies hang. */
const BALLS = { grounder: { ms: 950, label: "Grounder", hint: "Charge it and glove it on the hop." }, liner: { ms: 700, label: "Line drive", hint: "Quick hands. Snag it." }, fly: { ms: 1500, label: "Fly ball", hint: "Track it down and squeeze it." } } as const;

const GRID = 1.8; // zone drawing spans -GRID..GRID
const toPct = (v: number) => ((v + GRID) / (2 * GRID)) * 100;

export function DuelView({ setup, seasonId, onDone }: { setup: InteractiveSetup; seasonId?: number; onDone: () => void }) {
  const [inputs, setInputs] = useState<UserInput[]>([]);
  const [shown, setShown] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [pitchType, setPitchType] = useState<PitchType>("fastball");

  // One stable object for the field and scorebug; its events grow as the game does.
  const shell = useMemo<PlayedGame>(() => ({
    id: 0, createdAt: "", opponent: setup.opponent, userSide: setup.userSide, teams: setup.teams, rules: setup.rules,
    result: { seed: setup.seed, innings: setup.innings, final: { away: 0, home: 0 }, winner: null, events: [], box: { linescore: { away: [], home: [] }, hits: { away: 0, home: 0 }, batting: { away: [], home: [] }, pitching: { away: [], home: [] } } },
  }), [setup]);

  const g = useMemo(() => {
    const out = playInteractive({ away: setup.teams.away, home: setup.teams.home, seed: setup.seed, innings: setup.innings, rules: setup.rules, userSide: setup.userSide, inputs });
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
  useEffect(() => crowdBed(), []);
  useEffect(() => { playEvent(current, (current.state.half === "top" ? "away" : "home") === setup.userSide); }, [current, setup.userSide]);
  const highlights = useReel(events, speed);
  const fieldIndex = highlights.index ?? Math.min(shown, events.length - 1);
  const card = usePlayCard(events[fieldIndex], speed, highlights.reel?.at);
  const youWon = g.result?.winner === setup.userSide;
  const done = !!g.result && caughtUp;
  const awaiting = caughtUp ? g.awaiting : null;

  // Once it's over, the server replays our choices against the seed and records the game.
  const [saved, setSaved] = useState<"saving" | "saved" | string | null>(null);
  const [reward, setReward] = useState<PlayedGame["reward"]>(undefined);
  useEffect(() => {
    if (!g.result || saved) return;
    setSaved("saving");
    api<PlayedGame>("/api/games/interactive/finish", { body: { opponentTeamId: setup.opponent.id, seasonId, seed: setup.seed, inputs, innings: setup.innings, rules: setup.rules, final: g.result.final } })
      .then((p) => { setReward(p.reward); setSaved("saved"); }, (e: Error) => setSaved(e.message));
  }, [g.result, saved, inputs, setup]);
  const lastCall = [...events.slice(0, shown + 1)].reverse().find((e): e is Extract<GameEvent, { type: "play" }> => e.type === "play");

  return (
    <section className="panel game">
      <div className="game-top">
        <Scorebug game={shell} index={Math.min(shown, events.length - 1)} />
        <div className="game-controls">
          {!done && [1, 2].map((x) => <button key={x} className={`speed ${speed === x ? "on" : ""}`} onClick={() => setSpeed(x)}>{x}x</button>)}
          {!done && !caughtUp && <SkipPlay e={current} speed={speed} onSkip={() => setShown((n) => n + 1)} />}
          {done && highlights.reel && <SkipPlay e={events[fieldIndex]} speed={speed} onSkip={highlights.skip} />}
          {done && highlights.reel && <button className="link" onClick={highlights.stop}>Stop</button>}
          {done && !highlights.reel && highlights.available && <button className="link" onClick={highlights.start}>Watch highlights</button>}
          {done ? !highlights.reel && <button className="primary" onClick={onDone}>Done</button> : <button className="link" onClick={onDone}>Quit</button>}
        </div>
      </div>

      <p className="rotate-hint" aria-hidden>Turn your phone sideways for the full field.</p>
      <Suspense fallback={<div className="field" />}><FieldView game={shell} index={fieldIndex} speed={speed} /></Suspense>
      {highlights.reel && g.result && <ReelCard reel={highlights.reel} game={shell} finalText={(events[events.length - 1] as Extract<GameEvent, { type: "final" }>).text} />}
      <PlayCard card={card} players={players} />

      {awaiting?.role === "pitch" && (
        <PitchPanel key={inputs.length} pitcher={players.get(awaiting.pitcherId)} batter={players.get(awaiting.batterId)}
          heat={awaiting.state.heat} v3={setup.rules >= 3} type={pitchType} onType={setPitchType} onThrow={(aim) => submit({ kind: "pitch", type: pitchType, aim })} />
      )}
      {awaiting?.role === "swing" && awaiting.incoming && (
        <SwingPanel key={inputs.length} pitcher={players.get(awaiting.pitcherId)} batter={players.get(awaiting.batterId)}
          heat={awaiting.state.heat} v3={setup.rules >= 3} incoming={awaiting.incoming} sup={awaiting.super}
          onSwing={(swing, timing, sup) => submit(sup ? { kind: "swing", swing, timing, super: true } : { kind: "swing", swing, timing })} />
      )}
      {awaiting?.role === "field" && awaiting.ball && (
        <FieldPanel key={inputs.length} batter={players.get(awaiting.batterId)} fielder={players.get(awaiting.ball.fielderId)}
          kind={awaiting.ball.kind} onGlove={(timing) => submit({ kind: "field", timing })} />
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
          {reward && <RewardLine reward={reward} />}
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

/** Rules 1-2: flames, one per level. Rules 3: a 0-100 Heat number, "on fire" from 50. */
function Heat({ level, v3 }: { level: number; v3: boolean }) {
  if (v3) return <span className={`heat-num ${level >= 50 ? "hot" : ""}`} aria-label={`heat ${level} of 100`}>{level >= 50 ? "🔥 " : ""}{level}</span>;
  if (!level) return null;
  return <span className={`heat heat-${level}`} aria-label={`heat ${level} of 3`}>{"🔥".repeat(level)}</span>;
}

function Who({ batter, pitcher, heat, v3 }: { batter?: SimPlayer; pitcher?: SimPlayer; heat: Record<number, number>; v3: boolean }) {
  return (
    <div className="matchup">
      <span><small>AT BAT</small> {batter?.name}<Heat v3={v3} level={batter ? heat[batter.id] ?? 0 : 0} /></span>
      <span><small>PITCHING</small> {pitcher?.name}<Heat v3={v3} level={pitcher ? heat[pitcher.id] ?? 0 : 0} /></span>
    </div>
  );
}

/** A strike-zone diagram. Children draw on top; `onPick` turns a tap or click into plate coordinates.
 *  pointerdown (not click) so a phone tap lands the instant the finger touches, with no tap delay. */
// Keyboard aim: number keys laid out like a numpad (7 8 9 high, 4 5 6 middle, 1 2 3 low), all inside the strike zone.
const KEY_AIM: Record<string, Aim> = {};
"123456789".split("").forEach((k, i) => { KEY_AIM[k] = { x: ((i % 3) - 1) * 0.6, y: (Math.floor(i / 3) - 1) * 0.6 }; });

function Zone({ onPick, children }: { onPick?: (aim: Aim) => void; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className={`zone ${onPick ? "pickable" : ""}`} ref={ref}
      role={onPick ? "button" : undefined} tabIndex={onPick ? 0 : undefined}
      aria-label={onPick ? "Strike zone. Press 1 to 9 to aim like a numpad, or Enter for the middle." : undefined}
      onKeyDown={(e) => {
        if (!onPick) return;
        const aim = KEY_AIM[e.key] ?? (e.key === "Enter" || e.key === " " ? KEY_AIM["5"] : undefined);
        if (!aim) return;
        e.preventDefault();
        onPick(aim);
      }}
      onPointerDown={(e) => {
        if (!onPick || !ref.current || e.button !== 0) return;
        e.preventDefault();
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

function PitchPanel({ pitcher, batter, heat, v3, type, onType, onThrow }: {
  pitcher?: SimPlayer; batter?: SimPlayer; heat: Record<number, number>; v3: boolean; type: PitchType; onType: (t: PitchType) => void; onThrow: (aim: Aim) => void;
}) {
  return (
    <div className="duel-panel">
      <Who batter={batter} pitcher={pitcher} heat={heat} v3={v3} />
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
          <small className="muted">Tap where to throw it. Strikes are in the box. <span className="key">Keys 1–9 aim.</span></small>
        </div>
      </div>
    </div>
  );
}

function SwingPanel({ pitcher, batter, heat, v3, incoming, sup, onSwing }: {
  pitcher?: SimPlayer; batter?: SimPlayer; heat: Record<number, number>; v3: boolean; incoming: { type: PitchType; mph: number; aim: Aim };
  sup: Awaiting["super"];
  onSwing: (swing: "contact" | "power" | "take", timing: number, superSwing?: boolean) => void;
}) {
  const ms = flightMs(incoming.mph);
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);
  const onSwingRef = useRef(onSwing);
  onSwingRef.current = onSwing;
  const canSuper = !v3 && !!sup && sup.clutch && sup.charges > 0;

  const swing = useCallback((kind: "contact" | "power" | "take", superSwing = false) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const p = (performance.now() - startRef.current) / ms;
    onSwingRef.current(kind, Math.max(-1, Math.min(1, (p - SWEET) / WINDOW)), superSwing);
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
      else if ((e.key === "s" || e.key === "S") && canSuper) swing("power", true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swing, canSuper]);

  const label = TYPES.find((t) => t.type === incoming.type)!.label;
  return (
    <div className="duel-panel">
      <Who batter={batter} pitcher={pitcher} heat={heat} v3={v3} />
      <div className="duel-row">
        <div className="duel-incoming">
          <div className="duel-pitch"><b>{label}</b> {incoming.mph} mph</div>
          <div className="timing" aria-hidden>
            <i className="timing-sweet" style={{ left: `${(SWEET - WINDOW * 0.2) * 100}%`, width: `${WINDOW * 0.4 * 100}%` }} />
            <i className="timing-marker" style={{ animationDuration: `${ms}ms` }} />
          </div>
          <div className="duel-buttons">
            <button className="primary" onPointerDown={() => swing("contact")} onClick={() => swing("contact")}>Contact <small className="key">Space</small></button>
            <button className="primary" onPointerDown={() => swing("power")} onClick={() => swing("power")}>Power <small className="key">P</small></button>
            <button onPointerDown={() => swing("take")} onClick={() => swing("take")}>Take <small className="key">T</small></button>
            {sup && !v3 && (
              <button className={`super ${canSuper ? "ready" : ""}`} disabled={!canSuper} onPointerDown={() => swing("power", true)} onClick={() => swing("power", true)}
                title={sup.charges === 0 ? "No charges left" : sup.clutch ? "Clutch spot. Spend a charge." : "Only in clutch spots"}>
                Super <small><span className="key">S · </span>{sup.charges} left</small>
              </button>
            )}
          </div>
          <small className="muted">
            Swing when the marker hits the gold. Contact for hits, Power for homers.
            {sup && !v3 && (canSuper ? " Clutch spot: a Super Swing is ready." : ` ${sup.bat} charges only in clutch spots.`)}
          </small>
        </div>
        <Zone>
          <i className="zone-ball" style={{ left: `${toPct(incoming.aim.x)}%`, top: `${toPct(-incoming.aim.y)}%`, animationDuration: `${ms}ms` }} />
        </Zone>
      </div>
    </div>
  );
}

/** A close ball on your defense: one timed tap, same gold window as a swing. Let it go and it drops in. */
function FieldPanel({ batter, fielder, kind, onGlove }: {
  batter?: SimPlayer; fielder?: SimPlayer; kind: keyof typeof BALLS; onGlove: (timing: number) => void;
}) {
  const { ms, label, hint } = BALLS[kind];
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);
  const onGloveRef = useRef(onGlove);
  onGloveRef.current = onGlove;

  const glove = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const p = (performance.now() - startRef.current) / ms;
    onGloveRef.current(Math.max(-1, Math.min(1, (p - SWEET) / WINDOW)));
  }, [ms]);

  useEffect(() => {
    const t = setTimeout(glove, ms * 1.25);
    return () => clearTimeout(t);
  }, [ms, glove]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.key === "g" || e.key === "G") { e.preventDefault(); glove(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [glove]);

  return (
    <div className="duel-panel">
      <div className="matchup">
        <span><small>{label.toUpperCase()}</small> {batter?.name}</span>
        <span><small>YOUR PLAY</small> {fielder?.name} ({fielder?.position})</span>
      </div>
      <div className="duel-row">
        <div className="duel-incoming">
          <div className="duel-pitch"><b>{label}</b> {hint}</div>
          <div className="timing" aria-hidden>
            <i className="timing-sweet" style={{ left: `${(SWEET - WINDOW * 0.2) * 100}%`, width: `${WINDOW * 0.4 * 100}%` }} />
            <i className="timing-marker" style={{ animationDuration: `${ms}ms` }} />
          </div>
          <div className="duel-buttons">
            <button className="primary" onPointerDown={glove} onClick={glove}>Glove it <small className="key">Space</small></button>
          </div>
          <small className="muted">Tap when the marker hits the gold. Nail it and you steal a hit; miss and it drops in.</small>
        </div>
      </div>
    </div>
  );
}
