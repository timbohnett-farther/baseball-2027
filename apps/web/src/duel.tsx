// Play it yourself: you pitch when your team is in the field and swing when it bats.
// The engine (@bb/sim) is pure, so the browser replays the game from its seed plus your
// choices so far; each new choice reveals the next few events, which play out on the field.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TutorialCompleteResponse } from "@bb/shared";
import { playInteractive, type Aim, type AbilityRequest, type AbilityStatus, type Awaiting, type Base, type GameEvent, type InteractiveSetup, type PitchType, type PlayedGame, type SimPlayer, type Side, type UserInput } from "@bb/sim";
import { api, ApiError } from "./api.ts";
import { dequeue, enqueue, isFinal } from "./outbox.ts";
import { clearSnapshot, newGameId, saveSnapshot, SNAPSHOT_SCHEMA } from "./resume.ts";
import { crowdBed, playEvent } from "./audio.ts";
import { hapticFor, vibrate } from "./haptics.ts";
import { PaceTracker } from "./pace.ts";
import { AbilityCue, BoxScoreView, holdFor, PlayCard, ReelCard, Scorebug, SkipPlay, usePlayCard, useReel } from "./game.tsx";
import { Coach } from "./coach.tsx";
import { RewardLine } from "./store.tsx";
import { AdvancePanel, RunStrip } from "./run.tsx";
import { ABILITY_ICON, APPROACH_TEXT, cellAim, cellTag, chipState, chipTap, keyCell, survivesApproach, type Approach, type ChipCtx } from "./touch.ts";

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

/** Art-review mode (`?shot=...`): the swing and glove panels hold still instead of auto-taking on a timer. */
const SHOT = typeof location !== "undefined" && new URLSearchParams(location.search).has("shot");

/** `shotInputs` (dev screenshots only) starts the game already this far in, with every event shown. */
/**
 * `coach` is Rookie Rally ("tutorial": guided lessons, no auto-take timers, completion goes to /api/tutorial/complete
 * instead of the game record, and `onSkip` replaces Quit) or "hints" (one-time tips in a normal game).
 */
export function DuelView({ setup, seasonId, onDone, shotInputs, coach, onSkip, resume, shotPaused }: { setup: InteractiveSetup; seasonId?: number; onDone: () => void; shotInputs?: UserInput[]; coach?: "tutorial" | "hints"; onSkip?: () => void; resume?: { gameId: string; inputs: UserInput[] }; shotPaused?: boolean }) {
  const tutorial = coach === "tutorial";
  const [gameId] = useState(() => resume?.gameId ?? newGameId());
  const start = shotInputs ?? resume?.inputs;
  const [inputs, setInputs] = useState<UserInput[]>(start ?? []);
  const [shown, setShown] = useState(start ? 1e6 : 0);
  // A resumed game (or one the app lost sight of) waits for a tap before the next pitch, so nothing happens while you look away.
  const [paused, setPaused] = useState(!!resume || !!shotPaused);
  useEffect(() => {
    const stop = () => { if (document.visibilityState === "hidden") setPaused(true); };
    const hide = () => setPaused(true);
    document.addEventListener("visibilitychange", stop);
    window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", stop); window.removeEventListener("pagehide", hide); };
  }, []);
  const [speed, setSpeed] = useState(1);
  const [pitchType, setPitchType] = useState<PitchType>("fastball");
  const [approach, setApproach] = useState<Approach>("contact");

  // One stable object for the field and scorebug; its events grow as the game does.
  const shell = useMemo<PlayedGame>(() => ({
    id: 0, createdAt: "", opponent: setup.opponent, userSide: setup.userSide, teams: setup.teams, rules: setup.rules,
    result: { seed: setup.seed, innings: setup.innings, final: { away: 0, home: 0 }, winner: null, events: [], box: { linescore: { away: [], home: [] }, hits: { away: 0, home: 0 }, batting: { away: [], home: [] }, pitching: { away: [], home: [] } } },
  }), [setup]);

  const g = useMemo(() => {
    const out = playInteractive({ away: setup.teams.away, home: setup.teams.home, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs });
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
    if (caughtUp || paused) return;
    const t = setTimeout(() => setShown((n) => n + 1), holdFor(events[shown]) / speed);
    return () => clearTimeout(t);
  }, [shown, caughtUp, speed, events, paused]);

  const submit = useCallback((input: UserInput) => setInputs((prev) => [...prev, input]), []);
  const current = events[Math.min(shown, events.length - 1)];
  useEffect(() => crowdBed(), []);
  const pace = useRef<PaceTracker | null>(null);
  if (!pace.current) { pace.current = new PaceTracker(); pace.current.begin(Date.now()); }
  useEffect(() => {
    const mine = (current.state.half === "top" ? "away" : "home") === setup.userSide;
    playEvent(current, mine);
    vibrate(hapticFor(current, mine));
    if (current.type === "pitch") pace.current!.onPitch(Date.now());
    else if (current.type === "half_start") pace.current!.onHalfStart(Date.now());
  }, [current, setup.userSide]);
  useEffect(() => { pace.current!.setBusy(!caughtUp, Date.now()); }, [caughtUp]);
  const highlights = useReel(events, speed);
  const fieldIndex = highlights.index ?? Math.min(shown, events.length - 1);
  const card = usePlayCard(events[fieldIndex], speed, highlights.reel?.at);
  const youWon = g.result?.winner === setup.userSide;
  const done = !!g.result && caughtUp;
  const awaiting = caughtUp && !paused ? g.awaiting : null;

  // Every time the game stops to ask you something, remember how to get back here. Tutorials and dev shots never save.
  useEffect(() => {
    if (tutorial || SHOT || !caughtUp || !g.awaiting) return;
    saveSnapshot({ schema: SNAPSHOT_SCHEMA, gameId, seasonId, setup, inputs, at: Date.now() });
  }, [caughtUp, g.awaiting, tutorial, gameId, seasonId, setup, inputs]);
  const quit = () => { clearSnapshot(); onDone(); };

  // Once it's over, the server replays our choices against the seed and records the game.
  const [saved, setSaved] = useState<"saving" | "saved" | string | null>(null);
  const [reward, setReward] = useState<PlayedGame["reward"]>(undefined);
  const [badge, setBadge] = useState<number | null>(null);
  useEffect(() => {
    if (!g.result || saved) return;
    setSaved("saving");
    if (tutorial) {
      api<TutorialCompleteResponse>("/api/tutorial/complete", { body: { inputs } })
        .then((r) => { setBadge(r.reward); setSaved("saved"); }, (e: Error) => setSaved(e.message));
      return;
    }
    // Queue first, so a dead connection at the last out (or closing the tab right now) can't lose the game.
    const body = { opponentTeamId: setup.opponent.id, seasonId, seed: setup.seed, inputs, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, final: g.result.final, pace: pace.current!.report(Date.now()), clientGameId: gameId };
    enqueue({ gameId, body });
    clearSnapshot();
    api<PlayedGame>("/api/games/interactive/finish", { body })
      .then((p) => { dequeue(gameId); setReward(p.reward); setSaved("saved"); }, (e: Error) => {
        if (e instanceof ApiError && isFinal(e.status)) { dequeue(gameId); setSaved(e.message); }
        else setSaved("Saved on this device. It will upload when you're back online.");
      });
  }, [g.result, saved, inputs, setup, tutorial, gameId, seasonId]);
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
          {done ? !highlights.reel && <button className="primary" onClick={onDone}>Done</button> : tutorial ? <button className="link" aria-label="Skip tutorial" onClick={onSkip}>Skip</button> : <button className="link" onClick={quit}>Quit</button>}
        </div>
      </div>

      <p className="rotate-hint" aria-hidden>Turn your phone sideways for the full field.</p>
      {paused && !done && (
        <div className="pause-gate" role="dialog" aria-label="Game paused">
          <b className="display">{resume && inputs === resume.inputs ? "Welcome back" : "Paused"}</b>
          <span>{setup.teams.away.abbr} {current.state.score.away} - {current.state.score.home} {setup.teams.home.abbr}</span>
          <small>Picks up at the start of the pitch.</small>
          <button className="primary" autoFocus onClick={() => setPaused(false)}>Ready</button>
        </div>
      )}
      <Suspense fallback={<div className="field" />}><FieldView game={shell} index={fieldIndex} speed={speed}><AbilityCue e={events[fieldIndex]} speed={speed} /></FieldView></Suspense>
      {highlights.reel && g.result && <ReelCard reel={highlights.reel} game={shell} finalText={(events[events.length - 1] as Extract<GameEvent, { type: "final" }>).text} />}
      <PlayCard card={card} players={players} />

      {(awaiting?.role === "pitch" || awaiting?.role === "swing") && awaiting.team?.available && (
        <BreakerChip key={`b${inputs.length}`} team={awaiting.team} onGo={submit} />
      )}
      {(awaiting?.role === "pitch" || awaiting?.role === "swing") && awaiting.run && (
        <RunStrip key={`r${inputs.length}`} run={awaiting.run} heat={awaiting.state.heat} players={players} onRun={submit} />
      )}
      {awaiting?.role === "run" && awaiting.run?.advance && (
        <AdvancePanel key={inputs.length} adv={awaiting.run.advance} heat={awaiting.state.heat} players={players} onGo={submit} />
      )}
      {awaiting?.role === "pitch" && (
        <PitchPanel key={inputs.length} pitcher={players.get(awaiting.pitcherId)} batter={players.get(awaiting.batterId)}
          heat={awaiting.state.heat} v3={setup.rules >= 3} type={pitchType} onType={setPitchType} abilities={awaiting.abilities} actorId={awaiting.pitcherId}
          onThrow={(aim, ability) => submit(ability ? { kind: "pitch", type: pitchType, aim, ability } : { kind: "pitch", type: pitchType, aim })} />
      )}
      {awaiting?.role === "swing" && awaiting.incoming && (
        <SwingPanel still={tutorial} key={inputs.length} pitcher={players.get(awaiting.pitcherId)} batter={players.get(awaiting.batterId)}
          heat={awaiting.state.heat} v3={setup.rules >= 3} incoming={awaiting.incoming} sup={awaiting.super} approach={approach} onApproach={setApproach}
          abilities={awaiting.abilities} actorId={awaiting.batterId}
          onSwing={(swing, timing, sup, ability) => submit({ kind: "swing", swing, timing, ...(sup ? { super: true } : {}), ...(ability ? { ability } : {}) })} />
      )}
      {awaiting?.role === "field" && awaiting.ball && (
        <FieldPanel still={tutorial} key={inputs.length} batter={players.get(awaiting.batterId)} fielder={players.get(awaiting.ball.fielderId)}
          kind={awaiting.ball.kind} throws={awaiting.ball.throws} heat={awaiting.state.heat[awaiting.ball.fielderId] ?? 0} abilities={awaiting.abilities}
          onGlove={(timing, throwTo, ability) => submit({ kind: "field", timing, ...(throwTo ? { throwTo } : {}), ...(ability ? { ability } : {}) })} />
      )}

      {coach && !done && <Coach mode={coach} awaiting={awaiting} moveKey={inputs.length} />}

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
          {tutorial && saved === "saved" && (
            <div className="reward">
              <span className="reward-total"><span className="coin" aria-hidden /> {badge ? `+${badge} coins` : "Rookie Rally done"}</span>
              <small className="muted">{badge ? "Rookie Rally badge" : "You already have the badge."}</small>
            </div>
          )}
          {saved && saved !== "saving" && (
            <p className={`muted duel-note ${saved === "saved" ? "" : "bad"}`} aria-live="polite">
              {saved === "saved" ? (tutorial ? "Practice games stay off your record." : "Counted toward your record.") : saved}
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

/** Strike-zone diagram, display only: batting shows where the ball is headed (pitching uses the tap grid). */
function Zone({ children }: { children?: React.ReactNode }) {
  return (
    <div className="zone">
      <div className="zone-box" style={{ left: `${toPct(-1)}%`, top: `${toPct(-1)}%`, width: `${toPct(1) - toPct(-1)}%`, height: `${toPct(1) - toPct(-1)}%` }} />
      {children}
    </div>
  );
}

/** Arm/disarm state for the ability chips. Panels remount per pitch, so an armed chip never outlives its pitch. */
function useArmed() {
  const [armed, setArmed] = useState<AbilityRequest | null>(null);
  const ref = useRef(armed);
  ref.current = armed;
  return { armed, ref, setArmed };
}

/** Left-handed mode mirrors the control clusters only (ARC 4.2); the field never flips. */
function useLefty(): [boolean, () => void] {
  const [lefty, setLefty] = useState(() => { try { return localStorage.getItem("bb.lefty") === "1"; } catch { return false; } });
  return [lefty, () => setLefty((v) => { try { localStorage.setItem("bb.lefty", v ? "0" : "1"); } catch { /* private mode */ } return !v; })];
}

function HeatMeter({ heat, reserved }: { heat: number; reserved: number }) {
  const h = Math.max(0, Math.min(100, Math.floor(heat)));
  return (
    <div className="heat-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={h} aria-label={`Heat ${h} of 100`}>
      <span className="heat-meter-text">HEAT {h} / 100{reserved > 0 ? ` (${reserved} RESERVED)` : ""}</span>
      <span className="heat-meter-bar"><i style={{ width: `${h - reserved}%` }} /><i className="reserved" style={{ width: `${reserved}%` }} /></span>
    </div>
  );
}

/** PUP 12.2: icon, name, cost and state on every chip; the reason a chip is off is on the chip, and a tap or long press says it in words. */
function AbilityChips({ abilities, heat, armed, onArm, approach, onApproach }: {
  abilities: AbilityStatus[]; heat: number; armed: AbilityRequest | null; onArm: (r: AbilityRequest | null) => void;
  approach: Approach | null; onApproach?: (a: Approach) => void;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; to?: Approach } | null>(null);
  const press = useRef<{ t: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  useEffect(() => { if (!note || note.to) return; const t = setTimeout(() => setNote(null), 2500); return () => clearTimeout(t); }, [note]);
  if (!abilities.length) return null;
  const reserved = armed ? abilities.find((a) => a.id === armed.id)?.cost ?? 0 : 0;
  const ctx: ChipCtx = { armed, heat, approach, choosing };
  const tap = (a: AbilityStatus) => {
    const act = chipTap(a, ctx);
    setNote(null);
    if (act.do !== "choose") setChoosing(null);
    if (act.do === "arm") onArm(act.req);
    else if (act.do === "cancel") onArm(null);
    else if (act.do === "choose") { onArm(null); setChoosing(act.id); }
    else if (act.do === "note") setNote({ text: act.text });
    else setNote({ text: act.text, to: act.to });
  };
  return (
    <div className="tp-chips" role="group" aria-label="Abilities">
      <HeatMeter heat={heat} reserved={reserved} />
      <div className="tp-chip-row">
        {abilities.map((a) => {
          const v = chipState(a, ctx);
          return (
            <div key={a.id} className={`pchip pchip-${v.state}`}>
              <button aria-pressed={v.state === "armed"} aria-disabled={v.state === "disabled"}
                onPointerDown={() => { press.current = { fired: false, t: setTimeout(() => { if (press.current) { press.current.fired = true; setNote({ text: a.summary }); } }, 450) }; }}
                onPointerUp={() => press.current && clearTimeout(press.current.t)}
                onPointerLeave={() => press.current && clearTimeout(press.current.t)}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => { if (press.current?.fired) { press.current = null; return; } tap(a); }}>
                <span className="chip-icon" aria-hidden>{ABILITY_ICON[a.id] ?? "*"}</span>
                <span className="chip-main"><b>{a.name.toUpperCase()}</b><small>COST {a.cost}</small></span>
                <span className="chip-state">{v.label}{v.state === "armed" ? " · TAP TO CANCEL" : ""}</span>
              </button>
              {v.state === "choosing" && (["left", "right"] as const).map((d) => (
                <button key={d} className="chip-dir" onClick={() => { onArm({ id: a.id, direction: d }); setChoosing(null); }}>{d.toUpperCase()}</button>
              ))}
            </div>
          );
        })}
      </div>
      {note && (
        <p className="tp-note" role="status">{note.text}
          {note.to && onApproach && (
            <button className="chip-dir" onClick={() => {
              const a = abilities.find((x) => x.swings.length && !x.swings.includes(approach!) && x.swings.includes(note.to!));
              onApproach(note.to!);
              if (a) onArm({ id: a.id });
              setNote(null);
            }}>SWITCH TO {note.to.toUpperCase()} + ARM</button>
          )}
        </p>
      )}
    </div>
  );
}

function PitchPanel({ pitcher, batter, heat, v3, type, onType, onThrow, abilities, actorId }: {
  pitcher?: SimPlayer; batter?: SimPlayer; heat: Record<number, number>; v3: boolean; type: PitchType; onType: (t: PitchType) => void; onThrow: (aim: Aim, ability?: AbilityRequest) => void;
  abilities: AbilityStatus[]; actorId: number;
}) {
  const { armed, ref: armedRef, setArmed } = useArmed();
  const [chase, setChase] = useState(false);
  const [lefty, toggleLefty] = useLefty();
  const throwAt = useCallback((cell: number) => onThrow(cellAim(cell, chase), armedRef.current ?? undefined), [onThrow, chase, armedRef]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = keyCell(e.key);
      if (c >= 0 && !e.repeat) { e.preventDefault(); throwAt(c); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [throwAt]);
  return (
    <div className={`duel-panel tp ${lefty ? "lefty" : ""}`}>
      <Who batter={batter} pitcher={pitcher} heat={heat} v3={v3} />
      <div className="tp-grid-layout">
        <div className="tp-side">
          <div className="duel-types" role="group" aria-label="Pitch type">
            {TYPES.map((t) => (
              <button key={t.type} className={`duel-type ${type === t.type ? "on" : ""}`} aria-pressed={type === t.type} onClick={() => onType(t.type)}>
                <b>{t.label}</b><small>{t.hint}</small>
              </button>
            ))}
          </div>
          <div className="tp-mini">
            <button className={`tp-toggle ${chase ? "on" : ""}`} aria-pressed={chase} onClick={() => setChase((v) => !v)}>WASTE PITCH {chase ? "ON" : "OFF"}</button>
            <button className={`tp-toggle ${lefty ? "on" : ""}`} aria-pressed={lefty} onClick={toggleLefty}>LEFTY LAYOUT</button>
          </div>
        </div>
        <AbilityChips abilities={abilities} heat={heat[actorId] ?? 0} armed={armed} onArm={setArmed} approach={null} />
        <div className="tp-action">
          <div className="target-grid" role="group" aria-label="Pitch target. Tap a cell to throw.">
            {Array.from({ length: 9 }, (_, i) => (
              <button key={i} className={`target-cell ${i === 4 ? "mid" : ""} ${chase && i !== 4 ? "chase" : ""}`} onClick={() => throwAt(i)}
                aria-label={`${cellTag(i, chase).toLowerCase()} ${["high", "middle", "low"][Math.floor(i / 3)]} ${["left", "middle", "right"][i % 3]}`}>
                <small>{cellTag(i, chase)}</small>
              </button>
            ))}
          </div>
          <small className="muted tp-hint">Tap a cell to throw. <span className="key">Keys 1–9 aim.</span></small>
        </div>
      </div>
    </div>
  );
}

/** Rally Breaker: a team ability, so it sits outside the per-player chips. A second tap confirms when the targets have no Heat to lose. */
function BreakerChip({ team, onGo }: { team: NonNullable<Awaiting["team"]>; onGo: (i: UserInput) => void }) {
  const [armed, setArmed] = useState(false);
  const go = () => { if (team.needsConfirm && !armed) setArmed(true); else onGo({ kind: "team", action: "rally_breaker" }); };
  return (
    <p className="play-buttons">
      <button className="chip ready" onClick={go} title={team.summary}>
        {armed ? "Tap again: their Heat is already 0" : `${team.name} (${team.cost} Rally)`}
      </button>
    </p>
  );
}

function SwingPanel({ pitcher, batter, heat, v3, incoming, sup, approach, onApproach, onSwing, abilities, actorId, still }: {
  /** Rookie Rally: nothing is taken for you. */ still?: boolean;
  pitcher?: SimPlayer; batter?: SimPlayer; heat: Record<number, number>; v3: boolean; incoming: { type: PitchType | null; mph: number; aim: Aim };
  sup: Awaiting["super"]; approach: Approach; onApproach: (a: Approach) => void;
  onSwing: (swing: "contact" | "power" | "take", timing: number, superSwing?: boolean, ability?: AbilityRequest) => void;
  abilities: AbilityStatus[]; actorId: number;
}) {
  const { armed, ref: armedRef, setArmed } = useArmed();
  const [lefty, toggleLefty] = useLefty();
  const ms = flightMs(incoming.mph);
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);
  const onSwingRef = useRef(onSwing);
  onSwingRef.current = onSwing;
  const approachRef = useRef(approach);
  approachRef.current = approach;
  const canSuper = !v3 && !!sup && sup.clutch && sup.charges > 0;

  const swing = useCallback((kind: "contact" | "power" | "take", superSwing = false) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const p = (performance.now() - startRef.current) / ms;
    // A take releases the reservation, so no ability rides on it.
    onSwingRef.current(kind, Math.max(-1, Math.min(1, (p - SWEET) / WINDOW)), superSwing, kind === "take" ? undefined : armedRef.current ?? undefined);
  }, [ms, armedRef]);

  // No tap is a take (ARC 5.2): let it go by.
  useEffect(() => {
    if (SHOT || still) return;
    const t = setTimeout(() => swing("take"), ms * 1.25);
    return () => clearTimeout(t);
  }, [ms, swing, still]);

  const pick = useCallback((a: Approach) => {
    onApproach(a);
    const held = abilities.find((x) => x.id === armedRef.current?.id);
    if (!survivesApproach(held, a)) setArmed(null);
  }, [onApproach, abilities, armedRef, setArmed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space") { e.preventDefault(); swing(approachRef.current); }
      else if (e.key === "c" || e.key === "C") pick("contact");
      else if (e.key === "p" || e.key === "P") pick("power");
      else if (e.key === "t" || e.key === "T") swing("take");
      else if ((e.key === "s" || e.key === "S") && canSuper) swing("power", true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swing, pick, canSuper]);

  const label = TYPES.find((t) => t.type === incoming.type)?.label ?? "???";
  return (
    <div className={`duel-panel tp ${lefty ? "lefty" : ""}`}>
      <Who batter={batter} pitcher={pitcher} heat={heat} v3={v3} />
      <div className="tp-grid-layout">
        <div className="tp-side">
          <div className="approach" role="radiogroup" aria-label="Swing approach">
            {(["contact", "power"] as const).map((a) => (
              <button key={a} role="radio" aria-checked={approach === a} className={approach === a ? "on" : ""} onClick={() => pick(a)}>
                <b>{a.toUpperCase()}</b><small>{APPROACH_TEXT[a].split(": ")[1]}</small>
              </button>
            ))}
          </div>
          <div className="tp-mini"><button className={`tp-toggle ${lefty ? "on" : ""}`} aria-pressed={lefty} onClick={toggleLefty}>LEFTY LAYOUT</button></div>
        </div>
        <AbilityChips abilities={abilities} heat={heat[actorId] ?? 0} armed={armed} onArm={setArmed} approach={approach} onApproach={pick} />
        <div className="tp-action">
          <div className="duel-pitch"><b>{label}</b> {incoming.mph} mph</div>
          <Zone><i className="zone-ball" style={{ left: `${toPct(incoming.aim.x)}%`, top: `${toPct(-incoming.aim.y)}%`, animationDuration: `${ms}ms` }} /></Zone>
          <div className="timing" aria-hidden>
            <i className="timing-sweet" style={{ left: `${(SWEET - WINDOW * 0.2) * 100}%`, width: `${WINDOW * 0.4 * 100}%` }} />
            <i className="timing-marker" style={{ animationDuration: `${ms}ms` }} />
          </div>
          <div className="tp-swing-row">
            {sup && !v3 && (
              <button className={`super ${canSuper ? "ready" : ""}`} disabled={!canSuper} onPointerDown={() => swing("power", true)}
                title={sup.charges === 0 ? "No charges left" : sup.clutch ? "Clutch spot. Spend a charge." : "Only in clutch spots"}>
                Super <small>{sup.charges} left</small>
              </button>
            )}
            <button className="swing-btn" onPointerDown={() => swing(approach)}>SWING<small className="key">Space</small></button>
          </div>
          <small className="muted tp-hint">Swing when the marker hits the gold. Don't tap to take.</small>
        </div>
      </div>
    </div>
  );
}

/** The contextual action the one button performs (ARC 7): the same timed tap, named for the ball. */
const GLOVE_VERB = { grounder: "FIELD", liner: "DIVE", fly: "CATCH" } as const;
const BASE_LABEL: Record<Base, string> = { first: "1B", second: "2B", third: "3B", home: "HOME" };

/** A close ball on your defense: one timed tap, same gold window as a swing. Let it go and it drops in. On a force-play grounder you also pick the throw; the recommended base is pre-picked and pulses. */
function FieldPanel({ batter, fielder, kind, throws, heat, abilities, onGlove, still }: {
  still?: boolean;
  batter?: SimPlayer; fielder?: SimPlayer; kind: keyof typeof BALLS; throws?: { recommended: Base; options: Base[] };
  heat: number; abilities: AbilityStatus[]; onGlove: (timing: number, throwTo?: Base, ability?: AbilityRequest) => void;
}) {
  const { ms, label, hint } = BALLS[kind];
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);
  const onGloveRef = useRef(onGlove);
  onGloveRef.current = onGlove;
  const { armed, ref: armedRef, setArmed } = useArmed();
  const [pick, setPick] = useState<Base | null>(throws?.recommended ?? null);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const glove = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const p = (performance.now() - startRef.current) / ms;
    onGloveRef.current(Math.max(-1, Math.min(1, (p - SWEET) / WINDOW)), pickRef.current ?? undefined, armedRef.current ?? undefined);
  }, [ms, armedRef]);

  useEffect(() => {
    if (SHOT || still) return;
    const t = setTimeout(glove, ms * 1.25);
    return () => clearTimeout(t);
  }, [ms, glove, still]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.key === "g" || e.key === "G") { e.preventDefault(); glove(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [glove]);

  return (
    <div className="duel-panel tp">
      <div className="matchup">
        <span><small>{label.toUpperCase()}</small> {batter?.name}</span>
        <span><small>YOUR PLAY</small> {fielder?.name} ({fielder?.position})</span>
      </div>
      <div className="tp-grid-layout">
        <div className="tp-side">
          {throws && (
            <div className="throw-diamond" role="radiogroup" aria-label="Throw to">
              {(["second", "third", "first", "home"] as const).filter((b) => throws.options.includes(b)).map((b) => (
                <button key={b} role="radio" aria-checked={pick === b} data-base={b}
                  className={`${pick === b ? "on" : ""} ${b === throws.recommended ? "rec" : ""}`} onClick={() => setPick(b)}>
                  <b>{BASE_LABEL[b]}</b>{b === throws.recommended && <small>BEST</small>}
                </button>
              ))}
            </div>
          )}
        </div>
        <AbilityChips abilities={abilities} heat={heat} armed={armed} onArm={setArmed} approach={null} />
        <div className="tp-action">
          <div className="duel-pitch"><b>{label}</b> {hint}</div>
          <div className="timing" aria-hidden>
            <i className="timing-sweet" style={{ left: `${(SWEET - WINDOW * 0.2) * 100}%`, width: `${WINDOW * 0.4 * 100}%` }} />
            <i className="timing-marker" style={{ animationDuration: `${ms}ms` }} />
          </div>
          <div className="tp-swing-row">
            <button className="swing-btn" onPointerDown={glove}>{GLOVE_VERB[kind]}<small className="key">Space</small></button>
          </div>
          <small className="muted tp-hint">Tap when the marker hits the gold. Nail it and you steal a hit; miss and it drops in.{throws ? " Pick the throw first: the wrong base costs the double play." : ""}</small>
        </div>
      </div>
    </div>
  );
}
