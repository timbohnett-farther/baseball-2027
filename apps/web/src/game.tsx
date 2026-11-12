import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { MyTeam, TeamSummary } from "@bb/shared";
import type { GameEvent, GameHistory, PlayedGame, Side, SimPlayer } from "@bb/sim";
import { api, ApiError } from "./api.ts";
import { Ovr } from "./players.tsx";
const FieldView = lazy(() => import("./field.tsx").then((m) => ({ default: m.FieldView })));

// --- Pick an opponent ------------------------------------------------------------------

export function PlayView({ teams, onDraft }: { teams: TeamSummary[]; onDraft: () => void }) {
  const [myTeam, setMyTeam] = useState<MyTeam | null | undefined>(undefined);
  const [history, setHistory] = useState<GameHistory | null>(null);
  const [opponent, setOpponent] = useState<number | null>(null);
  const [game, setGame] = useState<PlayedGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<MyTeam>("/api/my-team").then(setMyTeam).catch((e) => (e instanceof ApiError && e.status === 404 ? setMyTeam(null) : setError(e.message)));
    api<GameHistory>("/api/games").then(setHistory).catch(() => {});
  };
  useEffect(load, []);

  async function play() {
    if (!opponent) return;
    setBusy(true);
    setError(null);
    try { setGame(await api<PlayedGame>("/api/games", { body: { opponentTeamId: opponent } })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const open = async (id: number) => {
    try { setGame(await api<PlayedGame>(`/api/games/${id}`)); } catch (e) { setError((e as Error).message); }
  };

  if (game) return <GameView game={game} onDone={() => { setGame(null); load(); }} />;
  if (myTeam === undefined) return <section className="panel">{error ?? "Loading…"}</section>;
  if (!myTeam || myTeam.status !== "ready") {
    return (
      <section className="panel narrow">
        <h2>Finish your team first</h2>
        <p className="muted">Draft 9 hitters and 3 pitchers, then press Finish draft. Then you can play any MLB team.</p>
        <button className="primary" onClick={onDraft}>Go to my team</button>
      </section>
    );
  }

  const sorted = [...teams].sort((a, b) => b.strength - a.strength);
  return (
    <>
      <section className="panel">
        <div className="team-title">
          <h2>Play ball</h2>
          {history && <span className="chip">{history.record.w}-{history.record.l}{history.record.t ? `-${history.record.t}` : ""}</span>}
        </div>
        <p className="muted">
          <b style={{ color: "var(--text)" }}>{myTeam.name}</b> (team power {myTeam.chemistry.teamPower.toFixed(1)}) hosts a real MLB lineup.
          3 innings, you bat last.
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
        {error && <p className="error">{error}</p>}
        <p><button className="primary" disabled={!opponent || busy} onClick={play}>{busy ? "Warming up…" : "Play ball"}</button></p>
      </section>

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
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** How long each event stays on screen at 1x (ms). Big plays linger so their card can land. */
function holdFor(e: GameEvent): number {
  switch (e.type) {
    case "pitch": return 450;
    case "half_start": return 1300;
    case "pitching_change": return 1400;
    case "final": return 0;
    case "play": return e.tier === 1 ? 4200 : e.tier === 2 ? 3000 : e.tier === 3 ? 1700 : 1300;
  }
}

function GameView({ game, onDone }: { game: PlayedGame; onDone: () => void }) {
  const { events } = game.result;
  const [i, setI] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [card, setCard] = useState<Extract<GameEvent, { type: "play" }> | null>(null);
  const feedRef = useRef<HTMLOListElement>(null);
  const players = useMemo(() => {
    const m = new Map<number, SimPlayer>();
    for (const side of ["away", "home"] as Side[]) for (const p of [...game.teams[side].lineup, ...game.teams[side].pitchers]) m.set(p.id, p);
    return m;
  }, [game]);
  const done = i >= events.length - 1;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setI((n) => n + 1), holdFor(events[i]) / speed);
    return () => clearTimeout(t);
  }, [i, speed, done, events]);

  useEffect(() => {
    const e = events[i];
    if (e.type === "play" && e.card && (e.tier === 1 || e.tier === 2)) {
      setCard(e);
      const t = setTimeout(() => setCard(null), (e.tier === 1 ? 3800 : 2600) / speed);
      return () => clearTimeout(t);
    }
  }, [i, events, speed]);

  const current = events[i];
  const s = current.state;
  const side: Side = s.half === "top" ? "away" : "home";
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
          {!done && <button className="link" onClick={() => setI(events.length - 1)}>Skip to final</button>}
          {done && <button className="primary" onClick={onDone}>Done</button>}
        </div>
      </div>

      <Suspense fallback={<div className="field" />}><FieldView game={game} index={i} speed={speed} /></Suspense>

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

      {card && !reducedMotion() && (
        <div className={`big-play tier-${card.tier}`} key={i}>
          <div className="big-play-title">{card.card}</div>
          <div className="big-play-name">{players.get(card.batterId)?.name}</div>
          {card.stat && <div className="big-play-stat">{card.stat}</div>}
        </div>
      )}

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
function Scorebug({ game, index }: { game: PlayedGame; index: number }) {
  const e = game.result.events[index];
  const s = e.state;
  const showCount = e.type === "pitch";
  const flash = e.type === "play" && e.runs > 0;
  const row = (side: Side) => (
    <div className="bug-row" style={{ ["--team" as string]: game.teams[side].color }}>
      <span className="bug-abbr">{game.teams[side].abbr}</span>
      <span className={`bug-score ${flash && (s.half === "top" ? "away" : "home") === side ? "flash" : ""}`} key={`${side}${s.score[side]}`}>{s.score[side]}</span>
    </div>
  );
  return (
    <div className="scorebug" aria-label={`${game.teams.away.abbr} ${s.score.away}, ${game.teams.home.abbr} ${s.score.home}`}>
      <div className="bug-teams">{row("away")}{row("home")}</div>
      <div className="bug-state">
        <span className="bug-inning">{s.half === "top" ? "▲" : "▼"} {s.inning}</span>
        <Diamond bases={s.bases} />
        <span className="bug-outs">{[0, 1, 2].map((n) => <i key={n} className={n < Math.min(s.outs, 3) ? "on" : ""} />)}</span>
        <span className="bug-count">{showCount ? `${s.balls}-${s.strikes}` : " "}</span>
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

function BoxScoreView({ game }: { game: PlayedGame }) {
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
