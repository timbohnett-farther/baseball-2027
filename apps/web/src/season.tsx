import { lazy, Suspense, useEffect, useState } from "react";
import { PLAYOFF_ROUNDS, SEASON_LENGTH, type SeasonGame, type SeasonState } from "@bb/shared";
import type { InteractiveSetup, PlayedGame } from "@bb/sim";
import { api, ApiError } from "./api.ts";
import { GameView } from "./game.tsx";
import { ErrorNote, Loading } from "./ui.tsx";
const DuelView = lazy(() => import("./duel.tsx").then((m) => ({ default: m.DuelView })));

const ROUND_NAMES = ["", "Wild Card", "League Series", "World Series"];

/** Season tab: a 20-game schedule vs real clubs, standings, then a best-of-3 playoff run. */
export function SeasonView({ onDraft }: { onDraft: () => void }) {
  const [season, setSeason] = useState<SeasonState | null | undefined>(undefined);
  const [game, setGame] = useState<PlayedGame | null>(null);
  const [duel, setDuel] = useState<InteractiveSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<SeasonState>("/api/season").then(setSeason).catch((e) => (e instanceof ApiError && e.status === 404 ? setSeason(null) : setError(e.message)));
  };
  useEffect(load, []);

  async function run<T>(f: () => Promise<T>, then: (v: T) => void) {
    setBusy(true);
    setError(null);
    try { then(await f()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const start = () => run(() => api<SeasonState>("/api/season", { method: "POST" }), setSeason);
  const play = (mode: "sim" | "duel") => {
    if (!season?.next) return;
    const body = { opponentTeamId: season.next.opponent.id, seasonId: season.id };
    if (mode === "duel") run(() => api<InteractiveSetup>("/api/games/interactive", { body }), setDuel);
    else run(() => api<PlayedGame>("/api/games", { body }), setGame);
  };

  if (duel && season) return <Suspense fallback={<section className="panel">Taking the field…</section>}><DuelView setup={duel} seasonId={season.id} onDone={() => { setDuel(null); load(); }} /></Suspense>;
  if (game) return <GameView game={game} onDone={() => { setGame(null); load(); }} />;
  if (season === undefined) return error ? <section className="panel"><ErrorNote message={error} onRetry={load} /></section> : <Loading label="Loading your season…" />;

  if (season === null || season.status === "done") {
    return (
      <>
        {season && <SeasonOver season={season} />}
        <section className="panel narrow">
          <h2>{season ? `Season ${season.number + 1}` : "Start a season"}</h2>
          <p className="muted">
            {SEASON_LENGTH} games against real MLB clubs. Finish over .500 and you're into a {PLAYOFF_ROUNDS}-round playoff, best of 3 each.
            Season bonuses are paid on top of every game's coins.
          </p>
          <ErrorNote message={error} />
          <p className="play-buttons">
            <button className="primary" disabled={busy} onClick={start}>{busy ? "Setting the schedule…" : "Start season"}</button>
            <button onClick={onDraft}>My team</button>
          </p>
        </section>
        {season && <Standings season={season} />}
      </>
    );
  }

  const { record, next } = season;
  const regular = season.schedule.filter((g) => g.round === 0);
  const playoffs = season.schedule.filter((g) => g.round > 0);
  return (
    <>
      <section className="panel">
        <div className="team-title">
          <h2>Season {season.number}</h2>
          <span className="chip">{record.w}-{record.l}{record.t ? `-${record.t}` : ""}</span>
          {season.status === "playoffs" && <span className="chip ready">{ROUND_NAMES[season.playoffRound]} · {season.playoffWins}-{season.playoffLosses}</span>}
          {season.rewardCoins > 0 && <span className="chip"><span className="coin" aria-hidden /> +{season.rewardCoins} season coins</span>}
        </div>
        {next && (
          <>
            <p className="muted">
              {next.round > 0
                ? <>{ROUND_NAMES[next.round]}, game {next.gameNo - Math.min(...playoffs.filter((g) => g.round === next.round).map((g) => g.gameNo)) + 1} vs <b style={{ color: "var(--text)" }}>{next.opponent.name}</b>. First to 2 wins.</>
                : <>Game {next.gameNo} of {SEASON_LENGTH} vs <b style={{ color: "var(--text)" }}>{next.opponent.name}</b>.</>}
            </p>
            <ErrorNote message={error} />
            <p className="play-buttons">
              <button className="primary" disabled={busy} onClick={() => play("duel")}>{busy ? "Warming up…" : "Play it yourself"}</button>
              <button disabled={busy} onClick={() => play("sim")}>Watch the sim</button>
            </p>
          </>
        )}
        <Schedule title="Regular season" games={regular} nextNo={next?.gameNo} />
        {playoffs.length > 0 && <Schedule title="Playoffs" games={playoffs} nextNo={next?.gameNo} />}
      </section>
      <Standings season={season} />
    </>
  );
}

function Schedule({ title, games, nextNo }: { title: string; games: SeasonGame[]; nextNo?: number }) {
  return (
    <>
      <h3 style={{ marginTop: 16 }}>{title}</h3>
      <div className="schedule">
        {games.map((g) => (
          <div key={g.gameNo} className={`slot ${g.result ?? ""} ${g.gameNo === nextNo ? "next" : ""}`} title={g.opponent.name}>
            <span className="abbr">{g.opponent.abbr}</span>
            {g.result
              ? <span className={`result ${g.result}`}>{g.result} {g.userScore}-{g.opponentScore}</span>
              : <span className="muted">{g.gameNo === nextNo ? "Next" : g.round > 0 ? `Game ${g.gameNo}` : `#${g.gameNo}`}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

function Standings({ season }: { season: SeasonState }) {
  return (
    <section className="panel">
      <h3>Standings</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Club</th><th className="num">W</th><th className="num">L</th><th className="num">Pct</th></tr></thead>
          <tbody>
            {season.standings.map((s, i) => (
              <tr key={s.id} className={s.you ? "you" : ""}>
                <td className="muted">{i + 1}</td>
                <td>{s.you ? <b>{s.name}</b> : s.name} <span className="muted">{s.abbr}</span></td>
                <td className="num">{s.w}</td>
                <td className="num">{s.l}</td>
                <td className="num">{s.w + s.l ? (s.w / (s.w + s.l)).toFixed(3).replace(/^0/, "") : ".000"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SeasonOver({ season }: { season: SeasonState }) {
  const { record } = season;
  const lastRound = season.playoffRound;
  const line = season.champion
    ? "World Series champions!"
    : lastRound > 0 ? `Knocked out in the ${ROUND_NAMES[lastRound]}.` : record.w > record.l ? "Season complete." : "Missed the playoffs. Next year.";
  return (
    <section className={`panel final-band ${season.champion ? "win" : ""}`}>
      <span className="display">Season {season.number}: {record.w}-{record.l}{record.t ? `-${record.t}` : ""}</span>
      <span>{line}</span>
      {season.rewardCoins > 0 && <span className="chip ready"><span className="coin" aria-hidden /> +{season.rewardCoins} season coins</span>}
    </section>
  );
}
