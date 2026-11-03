import { useEffect, useState } from "react";
import type { HealthStatus, MlbTeamWithPlayers, TeamSummary } from "@bb/shared";

const DIVISION_ORDER = [
  "American League East", "American League Central", "American League West",
  "National League East", "National League Central", "National League West",
];

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [data, setData] = useState<{ season: number; teams: TeamSummary[] } | null>(null);
  const [selected, setSelected] = useState<MlbTeamWithPlayers | null>(null);

  useEffect(() => {
    fetch("/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    fetch("/api/teams").then((r) => r.json()).then(setData);
  }, []);

  const openTeam = (id: number) => fetch(`/api/teams/${id}`).then((r) => r.json()).then(setSelected);

  const total = data?.teams.reduce((n, t) => n + t.playerCount, 0) ?? 0;

  return (
    <div className="page">
      <header className="hero">
        <div className="ball" aria-hidden>⚾</div>
        <h1>Baseball 2027</h1>
        <p className="tag">Draft real big-leaguers. Win games. Earn gear.</p>
        <div className="status">
          <span className={health?.ok ? "dot ok" : "dot"} /> Server {health?.ok ? "online" : "checking…"}
          <span className="sep">·</span> Database {health?.database ?? "…"}
          {data && <><span className="sep">·</span> {data.teams.length} teams, {total} players ({data.season})</>}
        </div>
      </header>

      {selected ? (
        <section className="roster">
          <button className="back" onClick={() => setSelected(null)}>← All teams</button>
          <h2>{selected.name}</h2>
          <p className="muted">{selected.division} · {selected.players.length} players</p>
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Pos</th><th>B/T</th><th>Age</th><th>Status</th></tr>
            </thead>
            <tbody>
              {selected.players.map((p) => (
                <tr key={p.id}>
                  <td>{p.jersey ?? ""}</td>
                  <td>{p.name}</td>
                  <td>{p.position}</td>
                  <td>{p.bats}/{p.throws}</td>
                  <td>{p.age}</td>
                  <td className={p.status === "Active" ? "" : "muted"}>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <main className="divisions">
          {DIVISION_ORDER.map((division) => (
            <section key={division} className="division">
              <h2>{division.replace("League ", "League · ")}</h2>
              {data?.teams.filter((t) => t.division === division).map((t) => (
                <button key={t.id} className="team" onClick={() => openTeam(t.id)}>
                  <span className="abbr">{t.abbreviation}</span>
                  <span className="name">{t.name}</span>
                  <span className="count">{t.playerCount}</span>
                </button>
              ))}
            </section>
          ))}
        </main>
      )}
    </div>
  );
}
