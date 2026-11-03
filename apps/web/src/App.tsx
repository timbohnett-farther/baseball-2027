import { useEffect, useState } from "react";
import type { HealthStatus, Player, TeamDetail, TeamSummary } from "@bb/shared";

const DIVISION_ORDER = [
  "American League East", "American League Central", "American League West",
  "National League East", "National League Central", "National League West",
];
const POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "P"];

type View = { kind: "teams" } | { kind: "team"; team: TeamDetail } | { kind: "players" };

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [data, setData] = useState<{ season: number; teams: TeamSummary[] } | null>(null);
  const [view, setView] = useState<View>({ kind: "teams" });

  useEffect(() => {
    fetch("/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    fetch("/api/teams").then((r) => r.json()).then(setData);
  }, []);

  const openTeam = (id: number) => fetch(`/api/teams/${id}`).then((r) => r.json()).then((team) => setView({ kind: "team", team }));
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
          {data && <><span className="sep">·</span> {data.teams.length} teams, {total} rostered players ({data.season} stats)</>}
        </div>
        <nav className="tabs">
          <button className={view.kind !== "players" ? "on" : ""} onClick={() => setView({ kind: "teams" })}>Teams</button>
          <button className={view.kind === "players" ? "on" : ""} onClick={() => setView({ kind: "players" })}>Player board</button>
        </nav>
      </header>

      {view.kind === "team" && (
        <section className="panel">
          <button className="back" onClick={() => setView({ kind: "teams" })}>← All teams</button>
          <h2>{view.team.name}</h2>
          <p className="muted">{view.team.division} · {view.team.players.length} players</p>
          <PlayerTable players={view.team.players} showTeam={false} />
        </section>
      )}

      {view.kind === "players" && <PlayerBoard teams={data?.teams ?? []} />}

      {view.kind === "teams" && (
        <main className="divisions">
          {DIVISION_ORDER.map((division) => (
            <section key={division} className="division">
              <h2>{division.replace("League ", "League · ")}</h2>
              {data?.teams.filter((t) => t.division === division).map((t) => (
                <button key={t.id} className="team" onClick={() => openTeam(t.id)}>
                  <span className="abbr">{t.abbreviation}</span>
                  <span className="name">{t.name}</span>
                  <Ovr value={t.strength} />
                </button>
              ))}
            </section>
          ))}
        </main>
      )}
    </div>
  );
}

function PlayerBoard({ teams }: { teams: TeamSummary[] }) {
  const [position, setPosition] = useState("");
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ total: number; players: Player[] } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: "150" });
    if (position) params.set("position", position);
    if (team) params.set("team", team);
    if (q.trim()) params.set("q", q.trim());
    const ctrl = new AbortController();
    fetch(`/api/players?${params}`, { signal: ctrl.signal }).then((r) => r.json()).then(setResult).catch(() => {});
    return () => ctrl.abort();
  }, [position, team, q]);

  return (
    <section className="panel">
      <div className="filters">
        <input placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="">All positions</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          <option value="FA">Free agents</option>
          {[...teams].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation)).map((t) => <option key={t.id} value={t.abbreviation}>{t.abbreviation}</option>)}
        </select>
      </div>
      <p className="muted">{result ? `${result.total} players${result.total > 150 ? ", showing top 150" : ""}` : "Loading…"}</p>
      {result && <PlayerTable players={result.players} showTeam />}
    </section>
  );
}

function PlayerTable({ players, showTeam }: { players: Player[]; showTeam: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>OVR</th><th>Name</th><th>Pos</th>{showTeam && <th>Team</th>}<th>Age</th>
            <th title="Hitters: Contact · Power · Eye · Speed · Fielding. Pitchers: Stuff · Control · Movement · Stamina">Ratings</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <td><Ovr value={p.ratings.overall} /></td>
              <td>{p.name}</td>
              <td>{p.ratings.role === "SP" || p.ratings.role === "RP" ? p.ratings.role : p.position}</td>
              {showTeam && <td>{p.teamAbbr ?? "FA"}</td>}
              <td>{p.age}</td>
              <td className="skills"><Skills player={p} /></td>
              <td className={p.status === "Active" ? "" : "muted"}>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skills({ player }: { player: Player }) {
  const { hitting: h, pitching: pi, role } = player.ratings;
  const items: [string, number][] = [];
  if (pi && role !== "H") items.push(["STF", pi.stuff], ["CTL", pi.control], ["MOV", pi.movement], ["STA", pi.stamina]);
  if (h && (role === "H" || role === "TWP")) items.push(["CON", h.contact], ["POW", h.power], ["EYE", h.eye], ["SPD", h.speed], ["FLD", h.fielding]);
  return <>{items.map(([label, v]) => <span key={label} className="skill"><small>{label}</small><b className={tier(v)}>{v}</b></span>)}</>;
}

const tier = (v: number) => (v >= 90 ? "elite" : v >= 80 ? "great" : v >= 70 ? "good" : v >= 60 ? "ok" : "low");
const Ovr = ({ value }: { value: number }) => <span className={`ovr ${tier(value)}`}>{value}</span>;
