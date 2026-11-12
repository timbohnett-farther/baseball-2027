import { useEffect, useState, type ReactNode } from "react";
import type { Player, TeamSummary } from "@bb/shared";
import { Empty, toast } from "./ui.tsx";

export const POSITIONS = ["C", "1B", "2B", "3B", "SS", "OF", "DH", "P"];

/** Searchable, filterable list of the draft pool. `action` adds a button column (e.g. Draft). */
export function PlayerBoard({ teams, action, extraHeader }: {
  teams: TeamSummary[];
  action?: (p: Player) => ReactNode;
  extraHeader?: ReactNode;
}) {
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
    fetch(`/api/players?${params}`, { signal: ctrl.signal }).then((r) => r.json()).then(setResult)
      .catch((e: Error) => { if (e.name !== "AbortError") toast("Couldn't load players. Check your connection.", "bad"); });
    return () => ctrl.abort();
  }, [position, team, q]);

  return (
    <section className="panel">
      {extraHeader}
      <div className="filters">
        <input placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={position} onChange={(e) => setPosition(e.target.value)}>
          <option value="">All positions</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{p === "OF" ? "OF (LF/CF/RF)" : p}</option>)}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">All teams</option>
          <option value="FA">Free agents</option>
          {[...teams].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation)).map((t) => <option key={t.id} value={t.abbreviation}>{t.abbreviation}</option>)}
        </select>
      </div>
      <p className="muted" role="status">{result ? `${result.total} players${result.total > 150 ? ", showing top 150" : ""}` : "Loading…"}</p>
      {result && result.total === 0 && (
        <Empty title="No players match" hint="Try a shorter name, or clear the position and team filters.">
          <button onClick={() => { setQ(""); setPosition(""); setTeam(""); }}>Clear filters</button>
        </Empty>
      )}
      {result && result.total > 0 && <PlayerTable players={result.players} showTeam action={action} />}
    </section>
  );
}

export function PlayerTable({ players, showTeam, action }: {
  players: Player[];
  showTeam: boolean;
  action?: (p: Player) => ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {action && <th />}
            <th>OVR</th><th>Name</th><th>Pos</th>{showTeam && <th>Team</th>}
            <th title="Hitters: Contact · Power · Eye · Speed · Fielding. Pitchers: Stuff · Control · Movement · Stamina">Ratings</th>
            <th className="num">Age</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              {action && <td>{action(p)}</td>}
              <td><Ovr value={p.ratings.overall} /></td>
              <td>{p.name}</td>
              <td>{positionLabel(p)}</td>
              {showTeam && <td>{p.teamAbbr ?? "FA"}</td>}
              <td className="skills"><Skills player={p} /></td>
              <td className="num">{p.age}</td>
              <td className={p.status === "Active" ? "" : "muted"}>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const positionLabel = (p: Player) => (p.ratings.role === "SP" || p.ratings.role === "RP" ? p.ratings.role : p.position);

export function Skills({ player }: { player: Player }) {
  const { hitting: h, pitching: pi, role } = player.ratings;
  const items: [string, number][] = [];
  if (pi && role !== "H") items.push(["STF", pi.stuff], ["CTL", pi.control], ["MOV", pi.movement], ["STA", pi.stamina]);
  if (h && (role === "H" || role === "TWP")) items.push(["CON", h.contact], ["POW", h.power], ["EYE", h.eye], ["SPD", h.speed], ["FLD", h.fielding]);
  return <>{items.map(([label, v]) => <span key={label} className="skill"><small>{label}</small><b className={tier(v)}>{v}</b></span>)}</>;
}

export const tier = (v: number) => (v >= 90 ? "elite" : v >= 80 ? "great" : v >= 70 ? "good" : v >= 60 ? "ok" : "low");
export const Ovr = ({ value }: { value: number }) => <span className={`ovr ${tier(value)}`}>{value}</span>;
