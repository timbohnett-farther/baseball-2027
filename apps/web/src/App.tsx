import { useEffect, useMemo, useState } from "react";
import type { HealthStatus, Me, TeamDetail, TeamSummary } from "@bb/shared";
import { api } from "./api.ts";
import { useSound, useVolume } from "./audio.ts";
import { hapticsSupported, useHaptics } from "./haptics.ts";
import { AuthPanel } from "./auth.tsx";
import { MyTeamView } from "./draft.tsx";
import { PlayView } from "./game.tsx";
import { Ovr, PlayerBoard, PlayerTable } from "./players.tsx";
import { SeasonView } from "./season.tsx";
import { StoreView } from "./store.tsx";
import { Empty, Loading, Toaster, toast } from "./ui.tsx";

const DIVISION_ORDER = [
  "American League East", "American League Central", "American League West",
  "National League East", "National League Central", "National League West",
];

type View = { kind: "teams" } | { kind: "team"; team: TeamDetail } | { kind: "players" } | { kind: "my-team" } | { kind: "play" } | { kind: "store" } | { kind: "season" } | { kind: "sign-in" };

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [data, setData] = useState<{ season: number; teams: TeamSummary[] } | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [sound, toggleSound] = useSound();
  const [volume, setVolume] = useVolume();
  const [haptics, toggleHaptics] = useHaptics();
  const [view, setView] = useState<View>({ kind: "teams" });
  const [offline, setOffline] = useState(false);

  const loadTeams = () => {
    setOffline(false);
    return fetch("/api/teams").then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(setData)
      .catch(() => { setOffline(true); toast("Couldn't reach the server. Check your connection and try again.", "bad"); });
  };
  useEffect(() => {
    fetch("/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false } as HealthStatus));
    loadTeams();
    api<Me>("/api/me").then((m) => { setMe(m); setView({ kind: "my-team" }); }).catch(() => setMe(null));
  }, []);

  const openTeam = (id: number) => api<TeamDetail>(`/api/teams/${id}`).then((team) => setView({ kind: "team", team }));
  const signOut = async () => { await api("/api/auth/logout", { method: "POST" }); setMe(null); setView({ kind: "teams" }); };
  const tab = (kind: View["kind"], label: string) => (
    <button role="tab" aria-selected={view.kind === kind || (kind === "teams" && view.kind === "team")} className={view.kind === kind || (kind === "teams" && view.kind === "team") ? "on" : ""} onClick={() => setView({ kind } as View)}>{label}</button>
  );

  return (
    <>
    <a className="skip" href="#main">Skip to content</a>
    <Atmosphere />
    <Toaster />
    <div className="page">
      <header className="hero">
        <div className="userbar">
          <button className="link" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? "Mute ballpark sound" : "Turn ballpark sound on"} title={sound ? "Mute ballpark sound" : "Turn ballpark sound on"}>
            {sound ? "🔊 Sound" : "🔇 Muted"}
          </button>
          <input className="vol" type="range" min={0} max={1} step={0.1} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" />
          {hapticsSupported() && <button className="link" onClick={toggleHaptics} aria-pressed={haptics} title="Vibration on hits and abilities">{haptics ? "Haptics on" : "Haptics off"}</button>}
          <span className="sep">·</span>
          {me ? <>Hi, <b>{me.displayName}</b> · <button className="link" onClick={signOut}>Sign out</button></>
            : me === null && <button className="link" onClick={() => setView({ kind: "sign-in" })}>Sign in</button>}
        </div>
        <h1>Baseball 2027</h1>
        <p className="tag">Draft real big-leaguers. Win games. Earn gear.</p>
        <div className="status" role="status">
          <span className={health === null ? "dot" : health.ok ? "dot ok" : "dot off"} aria-hidden /> Server {health === null ? "checking…" : health.ok ? "online" : "offline"}
          {data && <><span className="sep">·</span> {data.season} stats</>}
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {tab("play", "Play")}
          {tab("season", "Season")}
          {tab("my-team", "My team")}
          {tab("store", "Store")}
          {tab("players", "Player board")}
          {tab("teams", "MLB teams")}
        </nav>
      </header>
      <div id="main" tabIndex={-1}>

      {view.kind === "my-team" && (me ? <MyTeamView teams={data?.teams ?? []} /> : <AuthPanel onSignedIn={(m) => { setMe(m); setView({ kind: "my-team" }); }} />)}
      {view.kind === "play" && (me ? <PlayView teams={data?.teams ?? []} onDraft={() => setView({ kind: "my-team" })} /> : <AuthPanel onSignedIn={(m) => { setMe(m); setView({ kind: "play" }); }} />)}
      {view.kind === "season" && (me ? <SeasonView onDraft={() => setView({ kind: "my-team" })} /> : <AuthPanel onSignedIn={(m) => { setMe(m); setView({ kind: "season" }); }} />)}
      {view.kind === "store" && (me ? <StoreView /> : <AuthPanel onSignedIn={(m) => { setMe(m); setView({ kind: "store" }); }} />)}
      {view.kind === "sign-in" &&<AuthPanel onSignedIn={(m) => { setMe(m); setView({ kind: "my-team" }); }} />}
      {view.kind === "players" && <PlayerBoard teams={data?.teams ?? []} />}

      {view.kind === "team" && (
        <section className="panel">
          <button className="back" onClick={() => setView({ kind: "teams" })}>← All teams</button>
          <h2>{view.team.name}</h2>
          <p className="muted">{view.team.division} · {view.team.players.length} players</p>
          <PlayerTable players={view.team.players} showTeam={false} />
        </section>
      )}

      {view.kind === "teams" && !data && (offline
        ? <section className="panel"><Empty title="The ballpark is closed" hint="The server didn't answer, so the league can't load yet."><button className="primary" onClick={loadTeams}>Try again</button></Empty></section>
        : <Loading label="Loading the league…" />)}
      {view.kind === "teams" && data && (
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
    </div>
    </>
  );
}

/** Slow dust drifting through the warm key light (quiet menu version of the big-play burst). */
function Atmosphere() {
  const motes = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    top: `${(i * 37) % 100}%`, size: 2 + ((i * 7) % 4), duration: 18 + ((i * 11) % 14), delay: -((i * 13) % 30), opacity: 0.25 + ((i * 3) % 5) / 10,
  })), []);
  return (
    <div className="atmosphere" aria-hidden>
      {motes.map((m, i) => (
        <span key={i} className="mote" style={{ top: m.top, width: m.size, height: m.size, opacity: m.opacity, animationDuration: `${m.duration}s`, animationDelay: `${m.delay}s` }} />
      ))}
    </div>
  );
}
