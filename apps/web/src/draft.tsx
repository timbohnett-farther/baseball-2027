import { useEffect, useState, type FormEvent } from "react";
import {
  canAdd, formatSalary, salaryFor, slotsFor, SALARY_CAP, ROSTER_SIZE, TEAM_COLORS,
  type DraftedPlayer, type DraftPick, type MyTeam, type Player, type TeamSummary,
} from "@bb/shared";
import { api, ApiError } from "./api.ts";
import { Ovr, PlayerBoard } from "./players.tsx";

const toPick = (p: Player, salary = salaryFor(p.ratings.overall)): DraftPick =>
  ({ playerId: p.id, position: p.position, role: p.ratings.role, salary });

/** Lineup card order. */
const CARD: { slot: string; label: string }[] = [
  { slot: "C", label: "C" }, { slot: "1B", label: "1B" }, { slot: "2B", label: "2B" }, { slot: "3B", label: "3B" },
  { slot: "SS", label: "SS" }, { slot: "OF", label: "OF" }, { slot: "OF", label: "OF" }, { slot: "OF", label: "OF" },
  { slot: "DH", label: "DH" }, { slot: "SP", label: "SP" }, { slot: "RP", label: "RP" }, { slot: "RP", label: "RP" },
];

/** Put each drafted player in a lineup-card slot for display. Leftover hitters go to DH. */
function fillCard(players: DraftedPlayer[]): (DraftedPlayer | null)[] {
  const left = [...players];
  const take = (fits: (p: DraftedPlayer) => boolean) => {
    const i = left.findIndex(fits);
    return i >= 0 ? left.splice(i, 1)[0] : null;
  };
  const filled: (DraftedPlayer | null)[] = CARD.map(({ slot }) =>
    slot === "DH" ? null : take((p) => p.ratings.role !== "TWP" && slotsFor(toPick(p, p.salary)).includes(slot as never)));
  // DH: any remaining hitter, two-way players first; two-way players also cover an empty SP slot.
  const dh = CARD.findIndex((c) => c.slot === "DH");
  filled[dh] = take((p) => p.ratings.role === "TWP") ?? take((p) => p.ratings.role === "H");
  const sp = CARD.findIndex((c) => c.slot === "SP");
  if (!filled[sp] && filled[dh]?.ratings.role === "TWP") filled[sp] = filled[dh];
  return filled;
}

export function MyTeamView({ teams }: { teams: TeamSummary[] }) {
  const [team, setTeam] = useState<MyTeam | null | undefined>(undefined); // undefined = loading, null = none yet
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    api<MyTeam>("/api/my-team").then(setTeam).catch((e) => (e instanceof ApiError && e.status === 404 ? setTeam(null) : setError(e.message)));
  }, []);

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

  const picks = team.players.map((p) => toPick(p, p.salary));
  const onTeam = new Set(team.players.map((p) => p.id));
  const card = fillCard(team.players);
  const pct = Math.min(100, (team.draft.payroll / SALARY_CAP) * 100);

  return (
    <>
      <section className="panel team-head" style={{ borderTopColor: team.color }}>
        <div className="team-title">
          <span className="swatch" style={{ background: team.color }} />
          <h2>{team.name}</h2>
          <span className={`chip ${team.status}`}>{team.status === "ready" ? "Ready to play" : "Drafting"}</span>
        </div>
        <div className="budget">
          <div className="budget-bar"><div style={{ width: `${pct}%`, background: team.draft.budgetLeft < 0 ? "var(--red)" : team.color }} /></div>
          <span><b>{formatSalary(team.draft.budgetLeft)}</b> left of {formatSalary(SALARY_CAP)} · {team.draft.size}/{ROSTER_SIZE} players</span>
        </div>
        {error && <p className="error">{error}</p>}

        <div className="lineup">
          {CARD.map((c, i) => {
            const p = card[i];
            return (
              <div key={i} className={`slot ${p ? "filled" : ""}`}>
                <span className="slot-pos">{c.label}</span>
                {p ? (
                  <>
                    <Ovr value={p.ratings.overall} />
                    <span className="slot-name">{p.name}{p.ratings.role === "TWP" && c.slot === "SP" ? " (two-way)" : ""}</span>
                    <span className="muted small">{formatSalary(p.salary)}</span>
                    {!(p.ratings.role === "TWP" && c.slot === "SP") && (
                      <button className="x" title="Remove" disabled={busy === p.id} onClick={() => drop(p)}>×</button>
                    )}
                  </>
                ) : <span className="muted small">empty</span>}
              </div>
            );
          })}
        </div>

        {team.draft.ready ? (
          team.status === "ready"
            ? <p className="ok">Your team is set. Games are coming next!</p>
            : <button className="primary" disabled={busy !== null} onClick={finish}>Finish draft</button>
        ) : (
          <ul className="needs">{team.draft.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </section>

      <PlayerBoard
        teams={teams}
        extraHeader={<h3 className="board-title">Draft players</h3>}
        salary={(p) => formatSalary(salaryFor(p.ratings.overall))}
        action={(p) => {
          if (onTeam.has(p.id)) return <span className="chip ready">On team</span>;
          const why = canAdd(picks, toPick(p));
          return <button className="draft-btn" disabled={!!why || busy !== null} title={why ?? `Draft for ${formatSalary(salaryFor(p.ratings.overall))}`} onClick={() => add(p)}>Draft</button>;
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
      <p className="muted">You'll draft a 9-man lineup and 3 pitchers with {formatSalary(SALARY_CAP)} to spend.</p>
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

