import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  canAdd, chemistry, slotsFor, ROSTER_SIZE, TEAM_COLORS,
  type ChemistryReport, type DraftPick, type MyTeam, type Player, type TeamSummary,
} from "@bb/shared";
import { api, ApiError } from "./api.ts";
import { Ovr, PlayerBoard } from "./players.tsx";

const toPick = (p: Player): DraftPick => ({ playerId: p.id, position: p.position, role: p.ratings.role });

/** Lineup card order. */
const CARD: { slot: string; label: string }[] = [
  { slot: "C", label: "C" }, { slot: "1B", label: "1B" }, { slot: "2B", label: "2B" }, { slot: "3B", label: "3B" },
  { slot: "SS", label: "SS" }, { slot: "OF", label: "OF" }, { slot: "OF", label: "OF" }, { slot: "OF", label: "OF" },
  { slot: "DH", label: "DH" }, { slot: "SP", label: "SP" }, { slot: "P", label: "P" }, { slot: "P", label: "P" },
];

/** Put each drafted player in a lineup-card slot for display. Leftover hitters go to DH, leftover pitchers to P. */
function fillCard(players: Player[]): (Player | null)[] {
  const left = [...players];
  const take = (fits: (p: Player) => boolean) => {
    const i = left.findIndex(fits);
    return i >= 0 ? left.splice(i, 1)[0] : null;
  };
  const isPitcher = (p: Player) => p.ratings.role === "SP" || p.ratings.role === "RP";
  const filled: (Player | null)[] = CARD.map(({ slot }) =>
    slot === "DH" || slot === "P" ? null : take((p) => p.ratings.role !== "TWP" && slotsFor(toPick(p)).includes(slot as never)));
  CARD.forEach((c, i) => { if (c.slot === "P") filled[i] = take(isPitcher); });
  // DH: any remaining hitter, two-way players first; two-way players also cover an empty SP slot.
  const dh = CARD.findIndex((c) => c.slot === "DH");
  filled[dh] = take((p) => p.ratings.role === "TWP") ?? take((p) => p.ratings.role === "H");
  const sp = CARD.findIndex((c) => c.slot === "SP");
  if (!filled[sp] && filled[dh]?.ratings.role === "TWP") filled[sp] = filled[dh];
  return filled;
}

/** Total effective rating: what a pick adds beyond his own rating is his chemistry impact. */
const totalEffective = (r: ChemistryReport) => r.players.reduce((s, p) => s + p.effective, 0);

const Delta = ({ value }: { value: number }) =>
  value === 0 ? null : <span className={`delta ${value > 0 ? "up" : "down"}`}>{value > 0 ? `+${value}` : value}</span>;

export function MyTeamView({ teams }: { teams: TeamSummary[] }) {
  const [team, setTeam] = useState<MyTeam | null | undefined>(undefined); // undefined = loading, null = none yet
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    api<MyTeam>("/api/my-team").then(setTeam).catch((e) => (e instanceof ApiError && e.status === 404 ? setTeam(null) : setError(e.message)));
  }, []);

  const season = new Date().getUTCFullYear();
  const currentTotal = useMemo(() => (team ? totalEffective(chemistry(team.players, season)) : 0), [team, season]);

  async function act(playerId: number | null, run: () => Promise<MyTeam>) {
    setBusy(playerId ?? -1);
    setError(null);
    try { setTeam(await run()); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  const add = (p: Player) => act(p.id, () => api<MyTeam>(`/api/my-team/players/${p.id}`, { method: "POST" }));
  const drop = (p: Player) => act(p.id, () => api<MyTeam>(`/api/my-team/players/${p.id}`, { method: "DELETE" }));
  const finish = () => act(null, () => api<MyTeam>("/api/my-team/finish", { method: "POST" }));

  if (team === undefined) return <section className="panel">{error ?? "Loading your team…"}</section>;
  if (team === null) return <CreateTeam onCreated={setTeam} />;

  const picks = team.players.map(toPick);
  const onTeam = new Set(team.players.map((p) => p.id));
  const card = fillCard(team.players);
  const boost = new Map(team.chemistry.players.map((b) => [b.playerId, b]));
  const { teamPower, basePower, effects } = team.chemistry;

  return (
    <>
      <section className="panel team-head" style={{ ["--team" as string]: team.color }}>
        <div className="team-title">
          <h2>{team.name}</h2>
          <span className={`chip ${team.status}`}>{team.status === "ready" ? "Ready to play" : "Drafting"}</span>
          <span className="muted small">{team.draft.size}/{ROSTER_SIZE} players</span>
        </div>
        <div className="power">
          <span className="power-num">{team.players.length ? teamPower.toFixed(1) : "–"}</span>
          <span className="power-label">Team power</span>
          {team.players.length > 0 && (
            <span className="muted small">
              Ratings {basePower.toFixed(1)}, chemistry <Delta value={Math.round((teamPower - basePower) * 10) / 10} />
            </span>
          )}
        </div>
        {error && <p className="error">{error}</p>}

        <div className="layout">
          <div>
            <div className="lineup">
              {CARD.map((c, i) => {
                const p = card[i];
                const b = p ? boost.get(p.id) : undefined;
                const twoWayEcho = p?.ratings.role === "TWP" && c.slot === "SP";
                return (
                  <div key={i} className={`slot ${p ? "filled" : ""}`}>
                    <span className="slot-pos">{c.label}</span>
                    {p ? (
                      <>
                        <Ovr value={b?.effective ?? p.ratings.overall} />
                        <Delta value={b?.delta ?? 0} />
                        <span className="slot-name" title={`${p.name} · ${p.teamAbbr ?? "Free agent"}`}>
                          {p.lastName || p.name}{twoWayEcho ? " (two-way)" : ""}
                        </span>
                        <span className="muted small">{p.teamAbbr ?? "FA"}</span>
                        {!twoWayEcho && <button className="x" title="Remove" aria-label={`Remove ${p.name}`} disabled={busy === p.id} onClick={() => drop(p)}>×</button>}
                      </>
                    ) : <span className="muted small">empty</span>}
                  </div>
                );
              })}
            </div>
            {team.draft.ready ? (
              team.status === "ready"
                ? <p className="ok">Your team is set. Games are coming next!</p>
                : <p><button className="primary" disabled={busy !== null} onClick={finish}>Finish draft</button></p>
            ) : (
              <ul className="needs">{team.draft.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
          </div>

          <div>
            <h3>Team chemistry</h3>
            {effects.length === 0 ? (
              <p className="muted small">
                Draft anyone you want, but who you put together matters. Rivals feud, too many stars fight for the spotlight,
                veterans calm the clubhouse, and real teammates play better together.
              </p>
            ) : (
              <ul className="effects">
                {effects.map((e) => (
                  <li key={e.id} className={`effect ${e.good ? "good" : "bad"}`}>
                    <div className="effect-name">{e.good ? "▲" : "▼"} {e.name}</div>
                    <p>{e.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <PlayerBoard
        teams={teams}
        extraHeader={<h3>Draft players</h3>}
        action={(p) => {
          if (onTeam.has(p.id)) return <span className="chip ready">On team</span>;
          const why = canAdd(picks, toPick(p));
          if (why) return <button className="draft-btn" disabled title={why}>Draft</button>;
          // Preview: how much would this pick change everyone's ratings (beyond his own)?
          const impact = Math.round(totalEffective(chemistry([...team.players, p], season)) - currentTotal - p.ratings.overall);
          return (
            <span>
              <button className="draft-btn" disabled={busy !== null} onClick={() => add(p)}
                title={impact ? `Chemistry ${impact > 0 ? "+" : ""}${impact} total rating points` : "No chemistry change"}>Draft</button>
              {impact !== 0 && <span className={`chem ${impact > 0 ? "up" : "down"}`}>{impact > 0 ? `+${impact}` : impact}</span>}
            </span>
          );
        }}
      />
    </>
  );
}

function CreateTeam({ onCreated }: { onCreated: (t: MyTeam) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TEAM_COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try { onCreated(await api<MyTeam>("/api/my-team", { body: { name, color } })); } catch (err) { setError((err as Error).message); }
  }

  return (
    <section className="panel narrow">
      <h2>Create your team</h2>
      <p className="muted">Pick any 9 hitters and 3 pitchers you want. No salary cap, but watch your team chemistry.</p>
      <form className="form" onSubmit={submit}>
        <label>Team name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Thunder Sluggers" required minLength={2} maxLength={30} />
        </label>
        <div>
          <span className="label">Team color</span>
          <div className="colors">
            {TEAM_COLORS.map((c) => (
              <button type="button" key={c} className={`color ${c === color ? "on" : ""}`} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary">Create team</button>
      </form>
    </section>
  );
}
