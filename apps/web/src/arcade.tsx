import { useState } from "react";
import type { ArcadeFixture, ArcadeSeasonState, ArcadeStanding, BracketGame, LifetimeTrack, SuggestedDifficulty } from "@bb/shared";
import { ErrorNote } from "./ui.tsx";

const DIFFS: { id: SuggestedDifficulty; label: string }[] = [{ id: "rookie", label: "Rookie" }, { id: "pro", label: "Pro" }, { id: "allstar", label: "All-Star" }];
const diffLabel = (d: SuggestedDifficulty) => DIFFS.find((x) => x.id === d)!.label;
const rec = (r: { w: number; l: number; t: number }) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;

export function Stars({ n, of = 3, label }: { n: number; of?: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${n} of ${of} stars`}>
      {Array.from({ length: of }, (_, i) => <span key={i} className={i < n ? "star on" : "star"} aria-hidden>{i < n ? "★" : "☆"}</span>)}
    </span>
  );
}

/** Season hub for the 7-game arcade format: round tracker, next opponent with its objectives, standings, bracket, lifetime track. */
export function ArcadeHub({ season, busy, error, onPlay }: { season: ArcadeSeasonState; busy: boolean; error: string | null; onPlay: (mode: "sim" | "duel", difficulty: SuggestedDifficulty) => void }) {
  const { next } = season;
  return (
    <>
      <section className="panel">
        <div className="team-title">
          <h2>Season {season.number}</h2>
          <span className="chip">{rec(season.record)}</span>
          <span className="chip ready">{season.stars.season}/{season.stars.max} stars</span>
          {season.rewardCoins > 0 && <span className="chip"><span className="coin" aria-hidden /> +{season.rewardCoins} season coins</span>}
        </div>
        <RoundTracker season={season} />
        {next && <NextUp key={next.gameNo} fixture={next} busy={busy} error={error} onPlay={onPlay} />}
      </section>
      <div className="arc-cols">
        <Standings rows={season.standings} playoffs={season.status !== "regular"} />
        <Lifetime track={season.lifetime} />
      </div>
      {season.bracket && <Bracket semis={season.bracket.semis} final={season.bracket.final} />}
    </>
  );
}

function RoundTracker({ season }: { season: ArcadeSeasonState }) {
  const nextNo = season.next?.gameNo;
  return (
    <ol className="arc-rounds" aria-label="Season rounds">
      {season.schedule.map((f) => (
        <li key={f.gameNo} className={`arc-round ${f.result ?? ""} ${f.gameNo === nextNo ? "next" : ""} ${f.opponent.rival ? "rival" : ""}`}>
          <span className="arc-round-label">{f.round === 0 ? `G${f.gameNo}` : f.label}</span>
          <span className="abbr">{f.opponent.abbr}</span>
          {f.result ? <span className={`result ${f.result}`}>{f.result} {f.userScore}-{f.opponentScore}</span> : <span className="muted small">{f.gameNo === nextNo ? "Next" : "Upcoming"}</span>}
          {f.result && <Stars n={f.stars} />}
        </li>
      ))}
    </ol>
  );
}

function NextUp({ fixture: f, busy, error, onPlay }: { fixture: ArcadeFixture; busy: boolean; error: string | null; onPlay: (mode: "sim" | "duel", d: SuggestedDifficulty) => void }) {
  const [diff, setDiff] = useState<SuggestedDifficulty>(f.suggested);
  const o = f.opponent;
  return (
    <div className="arc-next">
      <div className="arc-opp">
        <p className="arc-kicker">{f.round > 0 ? f.label : `Game ${f.gameNo} of 7`}{o.rival && <span className="chip ready arc-rival-chip">Rival</span>}</p>
        <h3>{o.name}</h3>
        <p><span className="chip">{o.styleLabel}</span></p>
        <p className="muted">{o.scouting}</p>
        <p className="small muted">Watch for {o.star}.</p>
      </div>
      <div className="arc-objs">
        <h4>Earn up to 3 stars</h4>
        <ul>
          {f.objectives.map((ob) => <li key={ob.id}><span className="star" aria-hidden>☆</span> {ob.label}</li>)}
        </ul>
        <div className="arc-diff" role="group" aria-label="CPU difficulty">
          {DIFFS.map((d) => <button key={d.id} className={`chip ${diff === d.id ? "ready" : ""}`} aria-pressed={diff === d.id} onClick={() => setDiff(d.id)}>{d.label}{d.id === f.suggested ? " ·" : ""}</button>)}
        </div>
        <p className="small muted">Suggested for this game: {diffLabel(f.suggested)}. The sim ignores difficulty.</p>
        <ErrorNote message={error} />
        <p className="play-buttons">
          <button className="primary" disabled={busy} onClick={() => onPlay("duel", diff)}>{busy ? "Warming up…" : "Play it yourself"}</button>
          <button disabled={busy} onClick={() => onPlay("sim", diff)}>Watch the sim</button>
        </p>
      </div>
    </div>
  );
}

export function Standings({ rows, playoffs }: { rows: ArcadeStanding[]; playoffs: boolean }) {
  return (
    <section className="panel">
      <h3>Standings</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Club</th><th className="num">W</th><th className="num">L</th><th className="num">Diff</th></tr></thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.id} className={`${s.you ? "you" : ""} ${s.rival ? "rival" : ""} ${s.inPlayoffs && playoffs ? "in" : ""}`}>
                <td className="muted">{i + 1}</td>
                <td>{s.you ? <b>{s.name}</b> : s.name} <span className="muted">{s.abbr}</span>{s.rival && <span className="chip arc-rival-chip">Rival</span>}</td>
                <td className="num">{s.w}</td>
                <td className="num">{s.l}</td>
                <td className="num">{s.diff > 0 ? `+${s.diff}` : s.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.why) && <ul className="arc-why small muted">{rows.filter((r) => r.why).map((r) => <li key={r.id}>{r.abbr}: {r.why}</li>)}</ul>}
      <p className="small muted">Top 4 reach the playoffs. Ties: head-to-head, then run differential, then runs scored.</p>
    </section>
  );
}

function Slot({ g, label }: { g: BracketGame; label: string }) {
  const row = (s: BracketGame["home"]) => s
    ? <div className={`arc-slot ${s.you ? "you" : ""} ${g.winner === s.id ? "won" : ""}`}><span>{s.abbr}</span><span className="num">{s.score ?? "–"}</span></div>
    : <div className="arc-slot tbd"><span>TBD</span><span className="num">–</span></div>;
  return <div className="arc-game" aria-label={label}><span className="arc-kicker">{g.label}</span>{row(g.away)}{row(g.home)}</div>;
}

export function Bracket({ semis, final }: { semis: BracketGame[]; final: BracketGame }) {
  return (
    <section className="panel">
      <h3>Playoffs</h3>
      <div className="arc-bracket">
        <div className="arc-col">{semis.map((g, i) => <Slot key={i} g={g} label={`Semifinal ${i + 1}`} />)}</div>
        <div className="arc-col"><Slot g={final} label="Final" /></div>
      </div>
    </section>
  );
}

export function Lifetime({ track }: { track: LifetimeTrack }) {
  return (
    <section className="panel">
      <h3>Lifetime stars <span className="chip ready">{track.stars}</span></h3>
      <ul className="arc-track">
        {track.track.map((u) => (
          <li key={u.stars} className={u.earned ? "earned" : ""}>
            <span className="arc-track-at">{u.stars}★</span>
            <span>{u.label}{u.kind === "coins" && u.coins ? ` · ${u.coins} coins` : ""}</span>
            <span className="small muted">{u.earned ? "Unlocked" : `${u.stars - track.stars} to go`}</span>
          </li>
        ))}
      </ul>
      {track.next && <p className="small muted">Next: {track.next.label} at {track.next.stars} stars.</p>}
    </section>
  );
}

/** The post-game star summary under a final band. */
export function StarSummary({ arcade }: { arcade: NonNullable<NonNullable<import("@bb/sim").PlayedGame["reward"]>["arcade"]> }) {
  return (
    <div className="arc-summary">
      <p className="arc-kicker">Game stars <Stars n={arcade.stars} /></p>
      <ul>
        {arcade.objectives.map((o) => <li key={o.id} className={o.earned ? "earned" : ""}><span className="star" aria-hidden>{o.earned ? "★" : "☆"}</span> {o.label}</li>)}
      </ul>
      {arcade.unlocks.map((u) => <span key={u.stars} className="chip ready">Unlocked at {u.stars}★: {u.label}</span>)}
      <small className="muted">{arcade.lifetimeStars} lifetime stars</small>
    </div>
  );
}

export function ArcadeOver({ season }: { season: ArcadeSeasonState }) {
  const p = season.placement;
  return (
    <section className={`panel final-band ${season.champion ? "win" : ""}`}>
      <span className="display">Season {season.number}: {rec(season.record)}</span>
      <span>{p?.label ?? "Season complete."}</span>
      <Stars n={Math.round((season.stars.season / season.stars.max) * 3)} label={`${season.stars.season} of ${season.stars.max} stars`} />
      <span className="chip">{season.stars.season}/{season.stars.max} stars</span>
      {season.rewardCoins > 0 && <span className="chip ready"><span className="coin" aria-hidden /> +{season.rewardCoins} season coins</span>}
    </section>
  );
}
