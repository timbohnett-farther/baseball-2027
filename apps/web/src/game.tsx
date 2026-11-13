import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Me, MyTeam, TeamSummary } from "@bb/shared";
import { DIFFICULTIES, rallyAssist, tutorialSetup, type Difficulty, type GameEvent, type GameHistory, type InteractiveSetup, type PlayedGame, type Side, type SimPlayer } from "@bb/sim";
import { api, ApiError } from "./api.ts";
import { crowdBed, playEvent } from "./audio.ts";
import { cueFor, DOMAIN_COLOR } from "./abilityfx.ts";
import { blockingBudgetMs, cardWindowMs, skipAfterMs } from "./presentation.ts";
import { useCoachTips } from "./coach.tsx";
import { Ovr } from "./players.tsx";
import { RewardLine } from "./store.tsx";
import { Empty, ErrorNote, Loading } from "./ui.tsx";
const FieldView = lazy(() => import("./field.tsx").then((m) => ({ default: m.FieldView })));
const DuelView = lazy(() => import("./duel.tsx").then((m) => ({ default: m.DuelView })));

const rookieSetup = tutorialSetup();

/** The first-run offer (and, once played, nothing: replay lives next to Play it yourself). */
function RookieRally({ status, onStart }: { status: Me["tutorial"] | undefined; onStart: () => void }) {
  if (status !== null) return null;
  return (
    <section className="panel narrow">
      <h3>New here? Try Rookie Rally</h3>
      <p className="muted">One quick practice inning with tips on the screen. It does not count toward your record, and finishing earns a one-time coin bonus.</p>
      <button className="primary" onClick={onStart}>Start Rookie Rally</button>
    </section>
  );
}

// --- Pick an opponent ------------------------------------------------------------------

export function PlayView({ teams, onDraft }: { teams: TeamSummary[]; onDraft: () => void }) {
  const [myTeam, setMyTeam] = useState<MyTeam | null | undefined>(undefined);
  const [history, setHistory] = useState<GameHistory | null>(null);
  const [opponent, setOpponent] = useState<number | null>(null);
  const [game, setGame] = useState<PlayedGame | null>(null);
  const [duel, setDuel] = useState<InteractiveSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [innings, setInnings] = useState<number>(3);
  const [difficulty, setDifficulty] = useState<Difficulty>("pro");
  const [tutorial, setTutorial] = useState<Me["tutorial"] | undefined>(undefined);
  const [rookie, setRookie] = useState(false);
  const [tips, toggleTips] = useCoachTips();

  const load = () => {
    api<MyTeam>("/api/my-team").then(setMyTeam).catch((e) => (e instanceof ApiError && e.status === 404 ? setMyTeam(null) : setError(e.message)));
    api<GameHistory>("/api/games").then(setHistory).catch(() => {});
    api<Me>("/api/me").then((m) => setTutorial(m.tutorial)).catch(() => {});
  };
  useEffect(load, []);

  async function play(mode: "sim" | "duel") {
    if (!opponent) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "duel") setDuel(await api<InteractiveSetup>("/api/games/interactive", { body: { opponentTeamId: opponent, innings, difficulty } }));
      else setGame(await api<PlayedGame>("/api/games", { body: { opponentTeamId: opponent, innings } }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const open = async (id: number) => {
    try { setGame(await api<PlayedGame>(`/api/games/${id}`)); } catch (e) { setError((e as Error).message); }
  };

  const leaveRookie = () => { setRookie(false); load(); };
  const skipRookie = () => { api("/api/tutorial/skip", { method: "POST" }).catch(() => {}); leaveRookie(); };
  if (rookie) return <Suspense fallback={<section className="panel">Taking the field…</section>}><DuelView setup={rookieSetup} coach="tutorial" onSkip={skipRookie} onDone={leaveRookie} /></Suspense>;
  if (duel) return <Suspense fallback={<section className="panel">Taking the field…</section>}><DuelView setup={duel} coach={tips ? "hints" : undefined} onDone={() => { setDuel(null); load(); }} /></Suspense>;
  if (game) return <GameView game={game} onDone={() => { setGame(null); load(); }} />;
  if (myTeam === undefined) return error ? <section className="panel"><ErrorNote message={error} onRetry={load} /></section> : <Loading label="Checking your lineup…" />;
  if (!myTeam || myTeam.status !== "ready") {
    return (
      <>
      <section className="panel narrow">
        <h2>Finish your team first</h2>
        <p className="muted">Draft 9 hitters and 3 pitchers, then press Finish draft. Then you can play any MLB team.</p>
        <button className="primary" onClick={onDraft}>Go to my team</button>
      </section>
      <RookieRally status={tutorial} onStart={() => setRookie(true)} />
      </>
    );
  }

  const sorted = [...teams].sort((a, b) => b.strength - a.strength);
  return (
    <>
      {tutorial === null && <RookieRally status={tutorial} onStart={() => setRookie(true)} />}
      <section className="panel">
        <div className="team-title">
          <h2>Play ball</h2>
          {history && <span className="chip">{history.record.w}-{history.record.l}{history.record.t ? `-${history.record.t}` : ""}</span>}
        </div>
        <p className="muted">
          <b style={{ color: "var(--text)" }}>{myTeam.name}</b> (team power {myTeam.chemistry.teamPower.toFixed(1)}) hosts a real MLB lineup.
          You bat last.
        </p>
        <p className="play-buttons">
          {[1, 3, 5].map((n) => (
            <button key={n} className={`chip ${innings === n ? "ready" : ""}`} aria-pressed={innings === n} onClick={() => setInnings(n)}>{n} {n === 1 ? "inning" : "innings"}</button>
          ))}
        </p>
        <p className="play-buttons">
          {DIFFICULTIES.map((d) => (
            <button key={d} className={`chip ${difficulty === d ? "ready" : ""}`} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>{d === "allstar" ? "All-Star" : d[0].toUpperCase() + d.slice(1)}</button>
          ))}
        </p>
        <div className="opponents">
          {sorted.map((t) => (
            <button key={t.id} className={`opponent ${opponent === t.id ? "on" : ""}`} onClick={() => setOpponent(t.id)}>
              <span className="abbr">{t.abbreviation}</span>
              <span className="name">{t.name}</span>
              <Ovr value={t.strength} />
            </button>
          ))}
        </div>
        <ErrorNote message={error} />
        <p className="play-buttons">
          <button className="primary" disabled={!opponent || busy} onClick={() => play("duel")}>{busy ? "Warming up…" : "Play it yourself"}</button>
          <button disabled={!opponent || busy} onClick={() => play("sim")}>Watch the sim</button>
        </p>
        <p className="play-buttons">
          <button className="link" onClick={() => setRookie(true)}>Replay Rookie Rally</button>
          <button className="link" aria-pressed={tips} onClick={toggleTips}>Coach tips: {tips ? "on" : "off"}</button>
        </p>
      </section>

      {history && history.games.length === 0 && (
        <section className="panel">
          <h3>Recent games</h3>
          <Empty title="No games yet" hint="Pick an opponent above and play your first one. Every win pays coins." />
        </section>
      )}
      {history && history.games.length > 0 && (
        <section className="panel">
          <h3>Recent games</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Result</th><th>Opponent</th><th className="num">Score</th><th>When</th><th /></tr></thead>
              <tbody>
                {history.games.map((g) => (
                  <tr key={g.id}>
                    <td><span className={`result ${g.result}`}>{g.result}</span></td>
                    <td>{g.opponent.name}</td>
                    <td className="num">{g.userScore}-{g.opponentScore}</td>
                    <td className="muted">{new Date(g.createdAt).toLocaleString()}</td>
                    <td><button className="link" onClick={() => open(g.id)}>Replay</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// --- Watch the game ----------------------------------------------------------------------

const SPEEDS = [1, 2, 4];

/** How long each event stays on screen at 1x (ms): the ARC 10.3 blocking budget. */
export function holdFor(e: GameEvent): number { return blockingBudgetMs(e); }

/** A big play may be skipped by tap once its opening beat has landed. */
export function skipAfter(e: GameEvent): number | null { return skipAfterMs(e); }

/** Show the card after `delay`, for `dur`, both scaled by playback speed. */
export function usePlayCard(e: GameEvent | undefined, speed: number, key: unknown) {
  const [card, setCard] = useState<Extract<GameEvent, { type: "play" }> | null>(null);
  useEffect(() => {
    setCard(null);
    if (!e || e.type !== "play" || !e.card || !(e.tier === 1 || e.tier === 2)) return;
    const [delay, dur] = cardWindowMs(e);
    const show = setTimeout(() => setCard(e), delay / speed);
    const hide = setTimeout(() => setCard(null), (delay + dur) / speed);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [e, speed, key]);
  return card;
}

export function PlayCard({ card, players }: { card: Extract<GameEvent, { type: "play" }> | null; players: Map<number, SimPlayer> }) {
  if (!card) return null;
  return (
    <div className={`big-play tier-${card.tier}`}>
      <div className="big-play-title">{card.card}</div>
      <div className="big-play-name">{players.get(card.batterId)?.name}</div>
      {card.stat && <div className="big-play-stat">{card.stat}</div>}
    </div>
  );
}

/** A "skip" affordance for a big play that unlocks after its opening beats. */
/** Ability cue: icon + name in the domain colour, top of the field, away from the lower-third card. Names only; nothing about hidden info. */
export function AbilityCue({ e, speed }: { e: GameEvent | undefined; speed: number }) {
  const cue = e ? cueFor(e) : null;
  if (!cue) return null;
  const mine = cue.phase === "triggered";
  return (
    <div className={`ability-cue ${cue.phase}`} key={`${cue.id}-${cue.phase}-${cue.side}`} role="status"
      style={{ ["--cue" as string]: DOMAIN_COLOR[cue.fx.domain], animationDuration: `${cue.fx.ms / speed}ms` }}>
      <span className="ability-icon" aria-hidden>{cue.fx.icon}</span>
      <span>{cue.fx.name}{mine ? "!" : ""}</span>
    </div>
  );
}

export function SkipPlay({ e, speed, onSkip }: { e: GameEvent | undefined; speed: number; onSkip: () => void }) {
  const [ready, setReady] = useState(false);
  const after = e ? skipAfter(e) : null;
  useEffect(() => {
    setReady(false);
    if (after === null) return;
    const t = setTimeout(() => setReady(true), after / speed);
    return () => clearTimeout(t);
  }, [e, after, speed]);
  if (after === null || !ready) return null;
  return <button className="link skip-play" onClick={onSkip}>Skip ▸</button>;
}

// --- Highlight reel (VISUAL_DESIGN 3.5) ----------------------------------------------------

/** Indices of the plays worth replaying: every signature play, then the best highlights, in game order. */
export function highlightPicks(events: GameEvent[], max = 6): number[] {
  const scored = events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === "play" && (e.tier === 1 || e.tier === 2)) as { e: Extract<GameEvent, { type: "play" }>; i: number }[];
  scored.sort((a, b) => a.e.tier - b.e.tier || b.e.runs - a.e.runs || b.i - a.i);
  return scored.slice(0, max).map(({ i }) => i).sort((a, b) => a - b);
}

export interface Reel { picks: number[]; at: number } // at: -1 title card, 0..n-1 plays, n closing card

/** Drives a reel through title → plays → closing on the same clock as live playback. */
export function useReel(events: GameEvent[], speed: number) {
  const [reel, setReel] = useState<Reel | null>(null);
  const picks = useMemo(() => highlightPicks(events), [events]);
  useEffect(() => {
    if (!reel) return;
    const n = reel.picks.length;
    const ms = reel.at < 0 ? 2200 : reel.at < n ? holdFor(events[reel.picks[reel.at]]) : 2800;
    const t = setTimeout(() => setReel(reel.at >= n ? null : { ...reel, at: reel.at + 1 }), ms / speed);
    return () => clearTimeout(t);
  }, [reel, speed, events]);
  const index = reel && reel.at >= 0 && reel.at < reel.picks.length ? reel.picks[reel.at] : null;
  return {
    reel, index, available: picks.length > 0,
    start: () => setReel({ picks, at: -1 }),
    stop: () => setReel(null),
    skip: () => setReel((r) => (r && r.at < r.picks.length ? { ...r, at: r.at + 1 } : r)),
  };
}

export function ReelCard({ reel, game, finalText }: { reel: Reel; game: PlayedGame; finalText: string }) {
  if (reel.at === -1) return (
    <div className="big-play tier-1 reel-card">
      <div className="big-play-title">Highlights</div>
      <div className="big-play-name">{game.teams.away.abbr} at {game.teams.home.abbr}</div>
      <div className="big-play-stat">{reel.picks.length} {reel.picks.length === 1 ? "play" : "plays"}</div>
    </div>
  );
  if (reel.at === reel.picks.length) return (
    <div className="big-play tier-1 reel-card">
      <div className="big-play-title">Final</div>
      <div className="big-play-name">{finalText}</div>
    </div>
  );
  return null;
}

export function GameView({ game, onDone }: { game: PlayedGame; onDone: () => void }) {
  const { events } = game.result;
  const [i, setI] = useState(0);
  const [speed, setSpeed] = useState(1);
  const feedRef = useRef<HTMLOListElement>(null);
  const players = useMemo(() => {
    const m = new Map<number, SimPlayer>();
    for (const side of ["away", "home"] as Side[]) for (const p of [...game.teams[side].lineup, ...game.teams[side].pitchers]) m.set(p.id, p);
    return m;
  }, [game]);
  const done = i >= events.length - 1;
  const highlights = useReel(events, speed);
  const shownIndex = highlights.index ?? i; // the reel borrows the field after the final
  const card = usePlayCard(events[shownIndex], speed, highlights.reel?.at);

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setI((n) => n + 1), holdFor(events[i]) / speed);
    return () => clearTimeout(t);
  }, [i, speed, done, events]);

  const current = events[i];
  const s = current.state;
  const side: Side = s.half === "top" ? "away" : "home";
  useEffect(() => crowdBed(), []);
  useEffect(() => { playEvent(current, side === game.userSide); }, [current, side, game.userSide]);
  const batterId = current.type === "pitch" || current.type === "play" ? current.batterId : null;
  const pitcherId = current.type === "pitch" || current.type === "play" ? current.pitcherId : null;
  const lastPitch = [...events.slice(0, i + 1)].reverse().find((e) => e.type === "pitch") as Extract<GameEvent, { type: "pitch" }> | undefined;

  // Feed: grouped by half-inning, newest half on top; header first, then that half's plays newest first.
  const groups: GameEvent[][] = [];
  for (const e of events.slice(0, i + 1)) {
    if (e.type === "pitch") continue;
    if (e.type === "half_start" || e.type === "final" || !groups.length) groups.push([e]);
    else groups[groups.length - 1].push(e);
  }
  const feed = groups.reverse().flatMap(([head, ...rest]) => [head, ...rest.reverse()]);
  const youWon = game.result.winner === game.userSide;

  return (
    <section className="panel game">
      <div className="game-top">
        <Scorebug game={game} index={i} />
        <div className="game-controls">
          {!done && SPEEDS.map((x) => <button key={x} className={`speed ${speed === x ? "on" : ""}`} onClick={() => setSpeed(x)}>{x}x</button>)}
          {!done && <SkipPlay e={current} speed={speed} onSkip={() => setI((n) => n + 1)} />}
          {!done && <button className="link" onClick={() => setI(events.length - 1)}>Skip to final</button>}
          {done && highlights.reel && <SkipPlay e={events[shownIndex]} speed={speed} onSkip={highlights.skip} />}
          {done && highlights.reel && <button className="link" onClick={highlights.stop}>Stop</button>}
          {done && !highlights.reel && highlights.available && <button className="link" onClick={highlights.start}>Watch highlights</button>}
          {done && !highlights.reel && <button className="primary" onClick={onDone}>Done</button>}
        </div>
      </div>

      <Suspense fallback={<div className="field" />}><FieldView game={game} index={shownIndex} speed={speed} /></Suspense>
      {highlights.reel && <ReelCard reel={highlights.reel} game={game} finalText={(events[events.length - 1] as Extract<GameEvent, { type: "final" }>).text} />}

      {!done && batterId && (
        <div className="matchup">
          <span><small>AT BAT</small> {players.get(batterId)?.name}</span>
          <span><small>PITCHING</small> {pitcherId ? players.get(pitcherId)?.name : ""}{lastPitch && ` · ${lastPitch.mph} mph`}</span>
          <span><small>{game.teams[side].abbr}</small> batting</span>
        </div>
      )}

      {done && (
        <div className={`final-band ${youWon ? "win" : game.result.winner ? "loss" : ""}`}>
          <span className="display">{youWon ? "Victory" : game.result.winner ? "Defeat" : "Tie game"}</span>
          <span>{(current as Extract<GameEvent, { type: "final" }>).text}</span>
        </div>
      )}
      {done && game.reward && <RewardLine reward={game.reward} />}

      <PlayCard card={card} players={players} />

      <ol className="feed" ref={feedRef}>
        {feed.map((e) => <FeedItem key={events.indexOf(e)} e={e} />)}
      </ol>

      {done && <BoxScoreView game={game} />}
    </section>
  );
}

function FeedItem({ e }: { e: GameEvent }) {
  if (e.type === "half_start") return <li className="feed-inning">{e.text}</li>;
  if (e.type === "pitching_change") return <li className="feed-change">{e.text}</li>;
  if (e.type === "final") return <li className="feed-final">{e.text}</li>;
  if (e.type === "run" || e.type === "team") return <li className="feed-change">{e.text}</li>;
  if (e.type !== "play") return null;
  return (
    <li className={`feed-play tier-${e.tier}`}>
      <span className="feed-text">{e.text}</span>
      {e.call && <span className="feed-call">"{e.call}"</span>}
      {(e.runs > 0) && <span className="feed-score">{e.state.score.away}-{e.state.score.home}</span>}
    </li>
  );
}

/** Scorebug (docs/VISUAL_DESIGN.md 4.1): score, inning, outs, count, runners in one compact unit. */
export function Scorebug({ game, index }: { game: PlayedGame; index: number }) {
  const e = game.result.events[index];
  const s = e.state;
  const flash = e.type === "play" && e.runs > 0;
  const assist = (game.rules ?? 0) >= 3 ? rallyAssist(s) : null;
  const row = (side: Side) => (
    <div className={`bug-row ${s.fire === side ? "fire" : ""}`} style={{ ["--team" as string]: game.teams[side].color }}>
      <span className="bug-abbr">{game.teams[side].abbr}</span>
      <span className={`bug-score ${flash && (s.half === "top" ? "away" : "home") === side ? "flash" : ""}`} key={`${side}${s.score[side]}`}>{s.score[side]}</span>
      {assist === side && <span className="bug-assist" title="Trailing by 3+: Heat gains are 25% bigger">ASSIST ×1.25</span>}
      <span className="bug-rally" role="meter" aria-label={s.fire === side ? "On fire" : `Rally ${s.rally[side]}%`} aria-valuenow={s.rally[side]} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${s.rally[side]}%` }} />
      </span>
    </div>
  );
  return (
    <div className="scorebug" aria-label={`${game.teams.away.abbr} ${s.score.away}, ${game.teams.home.abbr} ${s.score.home}`}>
      {/* ARC 10.6 reading order: inning, score, outs, count, bases. Heat and Rally stay secondary. */}
      <div className="bug-teams">
        <span className="bug-inning">{s.half === "top" ? "▲ Top" : "▼ Bot"} {s.inning}</span>
        {row("away")}{row("home")}
      </div>
      <div className="bug-state">
        <span className="bug-outs" aria-label={`${s.outs} out`}>{[0, 1, 2].map((n) => <i key={n} className={n < Math.min(s.outs, 3) ? "on" : ""} />)}</span>
        <span className="bug-count" aria-label="Count">{s.balls}-{s.strikes}</span>
        <Diamond bases={s.bases} />
      </div>
    </div>
  );
}

function Diamond({ bases }: { bases: { first: number | null; second: number | null; third: number | null } }) {
  return (
    <svg className="bug-diamond" viewBox="0 0 30 22" aria-hidden>
      <rect x="18" y="8" width="7" height="7" transform="rotate(45 21.5 11.5)" className={bases.first !== null ? "on" : ""} />
      <rect x="11.5" y="1.5" width="7" height="7" transform="rotate(45 15 5)" className={bases.second !== null ? "on" : ""} />
      <rect x="5" y="8" width="7" height="7" transform="rotate(45 8.5 11.5)" className={bases.third !== null ? "on" : ""} />
    </svg>
  );
}

export function BoxScoreView({ game }: { game: PlayedGame }) {
  const { box, final } = game.result;
  const innings = Math.max(box.linescore.away.length, box.linescore.home.length);
  const sides: Side[] = ["away", "home"];
  return (
    <div className="box">
      <h3>Box score</h3>
      <div className="table-wrap">
        <table className="linescore">
          <thead><tr><th />{Array.from({ length: innings }, (_, n) => <th key={n} className="num">{n + 1}</th>)}<th className="num">R</th><th className="num">H</th></tr></thead>
          <tbody>
            {sides.map((side) => (
              <tr key={side}>
                <td className="display">{game.teams[side].abbr}</td>
                {Array.from({ length: innings }, (_, n) => <td key={n} className="num">{box.linescore[side][n] ?? "x"}</td>)}
                <td className="num"><b>{final[side]}</b></td>
                <td className="num">{box.hits[side]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sides.map((side) => (
        <div key={side} className="table-wrap">
          <table>
            <thead><tr><th>{game.teams[side].name} batting</th><th className="num">AB</th><th className="num">R</th><th className="num">H</th><th className="num">HR</th><th className="num">RBI</th><th className="num">BB</th><th className="num">K</th></tr></thead>
            <tbody>
              {box.batting[side].map((b) => (
                <tr key={b.playerId}><td>{b.name} <span className="muted small">{b.pos}</span></td>
                  <td className="num">{b.ab}</td><td className="num">{b.r}</td><td className="num">{b.h}</td><td className="num">{b.hr}</td><td className="num">{b.rbi}</td><td className="num">{b.bb}</td><td className="num">{b.k}</td></tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead><tr><th>Pitching</th><th className="num">IP</th><th className="num">H</th><th className="num">R</th><th className="num">BB</th><th className="num">K</th><th className="num">HR</th><th className="num">Pitches</th></tr></thead>
            <tbody>
              {box.pitching[side].map((p) => (
                <tr key={p.playerId}><td>{p.name}</td><td className="num">{Math.floor(p.outs / 3)}.{p.outs % 3}</td>
                  <td className="num">{p.h}</td><td className="num">{p.r}</td><td className="num">{p.bb}</td><td className="num">{p.k}</td><td className="num">{p.hr}</td><td className="num">{p.pitches}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
