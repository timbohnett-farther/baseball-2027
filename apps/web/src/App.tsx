import { useEffect, useState } from "react";
import type { HealthStatus, Me, TeamDetail, TeamSummary } from "@bb/shared";
import { api } from "./api.ts";
import { AuthPanel } from "./auth.tsx";
import { MyTeamView } from "./draft.tsx";
import { Ovr, PlayerBoard, PlayerTable } from "./players.tsx";

const DIVISION_ORDER = [
  "American League East", "American League Central", "American League West",
  "National League East", "National League Central", "National League West",
];

type View = { kind: "teams" } | { kind: "team"; team: TeamDetail } | { kind: "players" } | { kind: "my-team" } | { kind: "sign-in" };

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [data, setData] = useState<{ season: number; teams: TeamSummary[] } | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [view, setView] = useState<View>({ kind: "teams" });

  useEffect(() => {
    fetch("/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    fetch("/api/teams").then((r) => r.json()).then(setData);
    api<Me>("/api/me").then((m) => { setMe(m); setView({ kind: "my-team" }); }).catch(() => setMe(null));
  }, []);

  const openTeam = (id: number) => api<TeamDetail>(`/api/teams/${id}`).then((team) => setView({ kind: "team", team }));
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }); setMe(null); setView({ kind: "teams" }); };
  const tab = (kind: View["kind"], label: string) => (
    <button className={view.kind === kind || (kind === "teams" && view.kind === "team") ? "on" : ""} onClick={() => setView({ kind } as View)}>{label}</button>
  );

  return (
    <div className="page">
      <header className="hero">
        <div className="userbar">
          {me ? <>Hi, <b>{me.displayName}</b> · <button className="link" onClick={signOut}>Sign out</button></>
            : me === null && <button className="link" onClick={() => setView({ kind: "sign-in" })}>Sign in</button>}
        </div>
        <div className="ball" aria-hidden>⚾</div>
        <h1>Baseball 2027</h1>
        <p className="tag">Draft real big-leaguers. Win games. Earn gear.</p>
        <div className="status">
          <span className={health?.ok ? "dot ok" : "dot"} /> Server {health?.ok ? "online" : "checking…"}
          {data && <><span className="sep">·</span> {data.season} stats</>}
        </div>
        <nav className="tabs">
          {tab("my-team", "My team")}
          {tab("players", "Player board")}
          {tab("teams", "MLB teams")}
        </nav>
      </header>

      {view.kind === "my-team" && (me ? <MyTeamView teams={data?.teams ?? []} /> : <AuthPanel onSignedIn={(m) => { setMe(m); setView({ kind: "my-team" }); }} />)}
      {view.kind === "sign-in" && <AuthPanel onSignedIn={(m) => { setMe(m); setView({ kind: "my-team" }); }} />}
      {view.kind === "players" && <PlayerBoard teams={data?.teams ?? []} />}

      {view.kind === "team" && (
        <section className="panel">
          <button className="back" onClick={() => setView({ kind: "teams" })}>← All teams</button>
          <h2>{view.team.name}</h2>
          <p className="muted">{view.team.division} · {view.team.players.length} players</p>
          <PlayerTable players={view.team.players} showTeam={false} />
        </section>
      )}

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
