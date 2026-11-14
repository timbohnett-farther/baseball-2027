import { useEffect, useMemo, useState } from "react";
import { CURRENT_RULES, tutorialSetup, playInteractive, simulateGame, type GameEvent, type PlayedGame, type SimPlayer, type SimTeam, type UserInput, type InteractiveSetup } from "@bb/sim";
import { UNLOCKS, type ArcadeFixture, type ArcadeSeasonState, type ArcadeStanding, type BracketGame, type ClubStyle, type SuggestedDifficulty } from "@bb/shared";
import { ArcadeHub, ArcadeOver, StarSummary } from "./arcade.tsx";
import { FieldView } from "./field.tsx";
import { CATALOG, type ShotPlan } from "./actionshot.ts";
import { DuelView } from "./duel.tsx";
import { AbilityCue, GameView, PlayCard } from "./game.tsx";

// Dev-only art review: `/?shot=hr` renders the ballpark full-screen at a named moment of a fixture game
// (no server, no sign-in) so `scripts/shot.mjs` can screenshot it. Moments: pitch, swing, hr, k, single,
// double, final. `&t=<ms>` is how long after the moment lands the page declares itself ready.

const MOMENTS = ["pitch", "swing", "hr", "k", "single", "double", "final", "ability", "bigplay", "shot-contact", "shot-release", "shot-slide"] as const;
type Moment = typeof MOMENTS[number];

let nextId = 1;
const hitter = (name: string, r: number, pos: string, bats: "L" | "R" = "R"): SimPlayer => ({
  id: nextId++, name, lastName: name.split(" ").pop()!, position: pos, bats,
  batting: { contact: r, power: r + 5, eye: r - 5, speed: r, fielding: r }, pitching: null,
});
const pitcher = (name: string, r: number): SimPlayer => ({
  id: nextId++, name, lastName: name.split(" ").pop()!, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
// Fictional names on purpose (docs/ARCHITECTURE.md: generic art, no real likenesses in the fixture).
const team = (name: string, abbr: string, color: string, first: string[]): SimTeam => ({
  name, abbr, color,
  lineup: ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH"].map((pos, i) => hitter(`${first[i]} ${abbr}${i + 1}`, 70 + (i % 3) * 6, pos, i % 2 ? "L" : "R")),
  pitchers: [pitcher(`${first[0]} Arm`, 72), pitcher(`${first[1]} Relief`, 64)],
});
const AWAY = ["Rowan", "Idris", "Mateo", "Kenji", "Dario", "Elias", "Theo", "Luca", "Nico"];
const HOME = ["Jonah", "Silas", "Amari", "Cole", "Bram", "Ezra", "Hugo", "Otis", "Reid"];

function fixture(seed: number, awayAbbr = "HAR"): PlayedGame {
  nextId = 1;
  const away = team("Harbor City", awayAbbr, "#1d4e89", AWAY);
  const home = team("Ridgeback", "RDG", "#b3302a", HOME);
  const result = simulateGame({ away, home, seed, facts: true });
  return { id: 0, createdAt: "", opponent: { id: 0, name: away.name, abbr: away.abbr }, userSide: "home", teams: { away, home }, result };
}

/** Index of the named moment in the event stream, or -1. */
function find(game: PlayedGame, m: Moment): number {
  const ev = game.result.events;
  const play = (o: string) => ev.findIndex((e) => e.type === "play" && e.outcome === o);
  switch (m) {
    case "pitch": return ev.findIndex((e) => e.type === "pitch");
    case "swing": return ev.findIndex((e) => e.type === "pitch" && (e.result === "foul" || e.result === "swinging_strike"));
    case "hr": case "bigplay": return play("home_run");
    case "ability": return ev.findIndex((e) => e.type === "pitch");
    case "k": return play("strikeout");
    case "single": return play("single");
    case "double": { const i = play("double"); return i >= 0 ? i : play("triple"); }
    case "final": return ev.length - 1;
    case "shot-contact": return play("home_run");
    case "shot-release": return play("strikeout");
    case "shot-slide": return play("single");
  }
}

/** Plays inputs (varied aim, since a close ball is rare; contact swings so runners get on) until `stop` says the awaiting is the wanted moment; that log is the starting point. */
function toMoment(setup: InteractiveSetup, stop: (a: NonNullable<ReturnType<typeof playInteractive>["awaiting"]>) => boolean): UserInput[] {
  const inputs: UserInput[] = [];
  for (let i = 0; i < 600; i++) {
    const g = playInteractive({ away: setup.teams.away, home: setup.teams.home, seed: setup.seed, innings: setup.innings, rules: setup.rules, userSide: setup.userSide, inputs, facts: true });
    if (!g.awaiting || stop(g.awaiting)) return inputs;
    const a = g.awaiting;
    inputs.push(a.role === "swing" ? { kind: "swing", swing: i % 4 ? "contact" : "take", timing: 0 } : a.role === "run" ? { kind: "run", action: "advance", send: [] } : a.role === "field" ? { kind: "field", timing: 0 } : { kind: "pitch", type: "fastball", aim: { x: 0.15 * ((i % 5) - 2), y: 0.2 * ((i % 3) - 1) } });
  }
  return inputs;
}

/** `/?shot=duel-pitch` / `duel-swing` / `duel-field`: the real DuelView on a fixture setup, for checking the tap controls. */
function DuelShot({ side, wait, kind, coach }: { side: "home" | "away"; wait: number; kind?: "field" | "run" | "steal" | "resume"; coach?: "tutorial" | "hints" }) {
  const setup = useMemo(() => {
    if (coach === "tutorial") return tutorialSetup();
    nextId = 1;
    const away = team("Harbor City", "HAR", "#1d4e89", AWAY), home = team("Ridgeback", "RDG", "#b3302a", HOME);
    return { seed: kind === "field" ? 2 : kind ? 3 : 7, innings: 3, rules: CURRENT_RULES, userSide: side, opponent: { id: 0, name: away.name, abbr: away.abbr }, teams: { away, home } };
  }, [side, kind, coach]);
  useEffect(() => {
    const t = setInterval(() => {
      if ((document.querySelector(kind === "resume" ? ".pause-gate" : ".tp")) && document.querySelector(".field canvas")) { clearInterval(t); setTimeout(() => { (window as any).__shotReady = true; }, side === "away" ? Math.min(wait, 100) : wait); }
    }, 50);
    return () => clearInterval(t);
  }, [wait, side]);
  // Shot mode freezes the panels' auto-take, so the controls stay up however long the page takes to settle.
  const shotInputs = useMemo(() => coach === "tutorial" && side === "away" ? toMoment(setup, (a) => a.role === "swing")
    : coach === "hints" ? toMoment(setup, (a) => a.role === "swing" && a.state.strikes === 2)
    : kind === "field" ? toMoment(setup, (a) => a.role === "field")
    : kind === "run" ? toMoment(setup, (a) => a.role === "run")
    : kind === "resume" ? toMoment(setup, (a) => a.role === "swing" && a.state.strikes === 1)
    : kind === "steal" ? toMoment(setup, (a) => a.role === "swing" && !!a.run?.steal.length) : undefined, [setup, kind, coach, side]);
  return <div className="shot-duel"><DuelView setup={setup} onDone={() => {}} onSkip={() => {}} shotInputs={shotInputs} coach={coach} shotPaused={kind === "resume"} /></div>;
}

const CLUBS: { name: string; abbr: string; style: ClubStyle; star: string }[] = [
  { name: "Ridgeback", abbr: "RDG", style: "balanced", star: "your drafted lineup" },
  { name: "Harbor City", abbr: "HAR", style: "power", star: "Rowan Hale" },
  { name: "Lakeshore", abbr: "LKS", style: "speed", star: "Idris Cole" },
  { name: "Iron Valley", abbr: "IRV", style: "defense", star: "Mateo Reyes" },
  { name: "Summit", abbr: "SUM", style: "pitch", star: "Kenji Ito" },
  { name: "Redwood", abbr: "RWD", style: "counter", star: "Dario Vance" },
  { name: "Bayfront", abbr: "BAY", style: "rival", star: "Elias Ward" },
  { name: "Prairie", abbr: "PRA", style: "balanced", star: "Theo Marsh" },
];
const STYLE_TEXT: Record<string, [string, string]> = {
  balanced: ["Balanced", "No weak spots. Win the small things."], power: ["Power", "Mistakes leave the park. Keep the ball down."],
  speed: ["Speed", "They run on anything. Hold runners close."], defense: ["Defense", "Gloves everywhere. Hit it where they are not."],
  pitch: ["Pitching", "Arms over bats. Be patient at the plate."], counter: ["Counter-puncher", "They adjust late. Score early."], rival: ["Rival", "Same division, same grudge."],
};
const opp = (i: number) => { const c = CLUBS[i + 1]!; const [styleLabel, scouting] = STYLE_TEXT[c.style]!; return { id: i + 2, name: c.name, abbr: c.abbr, style: c.style, styleLabel, scouting, star: c.star, rival: i === 3 }; };
const OBJ = [["win", "Win the game"], ["scout", "Allow 1 home run or fewer"], ["arc", "Score in the 1st inning"]] as const;
const SUGGEST: SuggestedDifficulty[] = ["rookie", "rookie", "pro", "pro", "pro", "allstar", "allstar"];
function fixtureRow(i: number, played: number, got: number[]): ArcadeFixture {
  const done = i < played;
  return {
    gameNo: i + 1, round: 0, label: `Game ${i + 1}`, opponent: opp(i), gameId: done ? i + 1 : null, result: done ? (i % 3 === 1 ? "L" : "W") : null,
    userScore: done ? 5 - (i % 3) : null, opponentScore: done ? 2 + (i % 3) : null,
    objectives: OBJ.map(([id, label], k) => ({ id: `${id}-${i}`, label, kind: k === 0 ? "result" : k === 1 ? "scout" : "arcade", earned: done ? k < (got[i] ?? 0) : null })),
    stars: done ? got[i] ?? 0 : 0, difficulty: done ? SUGGEST[i]! : null, suggested: SUGGEST[i]!,
  };
}
const standingRows = (playoffs: boolean): ArcadeStanding[] => CLUBS.map((c, i) => ({
  id: i + 1, rank: i + 1, w: 6 - i + (i > 5 ? 0 : 0), l: i + 1, t: 0, rf: 40 - i * 3, ra: 20 + i * 2, diff: 20 - i * 5, gb: i * 0.5,
  why: i === 1 ? "Won the head-to-head" : i === 2 ? "Lost the head-to-head" : "", name: c.name, abbr: c.abbr, you: i === 0, rival: c.style === "rival",
  seed: playoffs && i < 4 ? i + 1 : null, inPlayoffs: i < 4,
}));
const lifetime = (stars: number) => ({ stars, track: UNLOCKS.map((u) => ({ ...u, earned: u.stars <= stars })), next: UNLOCKS.find((u) => u.stars > stars) ?? null });
const slot = (i: number, score: number | null) => ({ id: i + 1, name: CLUBS[i]!.name, abbr: CLUBS[i]!.abbr, you: i === 0, score });
function arcadeFixture(kind: "hub" | "bracket"): ArcadeSeasonState {
  const got = [3, 2, 3, 1, 2, 3, 2];
  const playoffs = kind === "bracket";
  const played = playoffs ? 7 : 3;
  const schedule = Array.from({ length: 7 }, (_, i) => fixtureRow(i, played, got));
  const semis: BracketGame[] = [
    { label: "Semifinal 1", home: slot(0, playoffs ? 4 : null), away: slot(3, playoffs ? 2 : null), winner: playoffs ? 1 : null },
    { label: "Semifinal 2", home: slot(1, playoffs ? 3 : null), away: slot(2, playoffs ? 5 : null), winner: playoffs ? 3 : null },
  ];
  const next: ArcadeFixture | null = playoffs
    ? { ...fixtureRow(0, 0, []), gameNo: 9, round: 2, label: "Final", opponent: opp(1), suggested: "allstar" }
    : schedule[3]!;
  if (playoffs) schedule.push({ ...fixtureRow(0, 1, [3]), gameNo: 8, round: 1, label: "Semifinal", opponent: opp(3) }, next!);
  return {
    format: 2, id: 1, number: 2, status: playoffs ? "playoffs" : "regular", record: playoffs ? { w: 5, l: 2, t: 0 } : { w: 2, l: 1, t: 0 }, played,
    schedule, next, standings: standingRows(playoffs), bracket: playoffs ? { semis, final: { label: "Final", home: slot(0, null), away: slot(2, null), winner: null } } : null,
    champion: false, placement: null, rewardCoins: 0, stars: { season: playoffs ? 14 : 8, max: 27 }, highestDifficulty: "pro", lifetime: lifetime(playoffs ? 14 : 8),
  };
}

function HubShot({ moment }: { moment: string }) {
  useEffect(() => { const t = setTimeout(() => { (window as any).__shotReady = true; }, 300); return () => clearTimeout(t); }, []);
  const noop = () => {};
  if (moment === "season-stars") {
    return (
      <div className="page">
        <section className="panel final-band win"><span className="display">W 5-2</span></section>
        <div className="reward">
          <span className="reward-total"><span className="coin" aria-hidden /> +230 coins</span>
          <StarSummary arcade={{ objectives: [{ id: "win", label: "Win the game", earned: true }, { id: "s", label: "Allow 1 home run or fewer", earned: true }, { id: "a", label: "Score in the 1st inning", earned: false }], stars: 2, unlocks: [{ stars: 9, label: "Red Line gloves" }], lifetimeStars: 9 }} />
        </div>
        <ArcadeOver season={{ ...arcadeFixture("bracket"), status: "done", next: null, champion: true, placement: { place: 1, label: "Champions!" }, rewardCoins: 650 }} />
      </div>
    );
  }
  return <div className="page"><ArcadeHub season={arcadeFixture(moment === "season-bracket" ? "bracket" : "hub")} busy={false} error={null} onPlay={noop} /></div>;
}

/**
 * W35a `/?shot=perf-soak`: mounts the real ballpark for a fixture match, plays one forced action shot of each family
 * (contact, release, slide) plus plain pitches, unmounts it (menu return), and starts the next match against a different
 * club, forever. `window.__soak` counts rounds so scripts/perf.mjs can sample `__perfTelemetry()` while it runs. Dev only.
 */
const SOAK_CLUBS = ["HAR", "BAY", "CRK", "DLT", "EMB", "FOR", "GLN", "HVN"];
function SoakView() {
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState(0); // 0..2 shots, 3 = unmounted gap
  const g = useMemo(() => {
    for (let s = round * 7 + 1; s < round * 7 + 60; s++) {
      const game = fixture(s, SOAK_CLUBS[round % SOAK_CLUBS.length]);
      const at = (["home_run", "strikeout", "single"] as const).map((o) => game.result.events.findIndex((e) => e.type === "play" && e.outcome === o));
      if (at.every((i) => i > 0)) return { game, at };
    }
    return { game: fixture(1), at: [1, 1, 1] };
  }, [round]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    (window as any).__soak = { round, phase };
    if (phase === 3) { const t = setTimeout(() => { setRound((r) => r + 1); setPhase(0); setIndex(0); }, 300); return () => clearTimeout(t); }
    // Phase 0 first walks the first innings quickly (a new batter and runners every few events: the churn a real match has), then the shot.
    const walk = phase === 0 ? Math.min(g.at[0]! - 2, 60) : 0, step = 60, lead = phase === 0 ? 1200 + walk * step : 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (phase === 0) for (let i = 1; i <= walk; i++) timers.push(setTimeout(() => setIndex(i), 1000 + i * step));
    timers.push(setTimeout(() => setIndex(Math.max(0, g.at[phase]! - 1)), lead + 150));
    timers.push(setTimeout(() => setIndex(g.at[phase]!), lead + 300));
    timers.push(setTimeout(() => setPhase((p) => p + 1), lead + 300 + 1800));
    return () => timers.forEach(clearTimeout);
  }, [round, phase, g]);
  if (phase === 3) return <div className="shot" />;
  const fam = (["CONTACT", "MOUND_RELEASE", "SLIDE_TAG"] as const)[phase]!;
  const d = CATALOG[fam];
  const plan: ShotPlan | null = index === g.at[phase] ? { index, family: fam, camera: d.camera, durMs: d.fullMs, score: 100, reasons: ["soak"], still: false } : null;
  return <div className="shot"><FieldView key={round} game={g.game} index={index} speed={1} plan={plan} /></div>;
}


/**
 * W35b `/?shot=cadence-match&seed=N`: the real GameView (real FieldView, shot director, hold timers) over a fixture match, for
 * scripts/cadence.mjs. It exposes `window.__cadence` = authoritative hash of the replayed result at mount and again after the
 * presentation finished (the sim re-run from the same seed), so a renderer cadence that changed an outcome would show as a mismatch.
 */
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
const resultHash = (seed: number) => { const g = fixture(seed); return fnv(JSON.stringify(g.result)); };
function CadenceView({ seed }: { seed: number }) {
  const game = useMemo(() => fixture(seed), [seed]);
  const [done, setDone] = useState(false);
  useEffect(() => { (window as any).__cadence = { seed, hashStart: fnv(JSON.stringify(game.result)), hashEnd: null, events: game.result.events.length, done: false }; }, [game, seed]);
  useEffect(() => { if (done) (window as any).__cadence = { ...(window as any).__cadence, hashEnd: resultHash(seed), done: true }; }, [done, seed]);
  return <GameView game={game} onDone={() => setDone(true)} />;
}

export function ShotView() {
  const q = new URLSearchParams(location.search);
  const duel = q.get("shot");
  if (duel === "perf-soak") return <SoakView />;
  if (duel === "cadence-match") return <CadenceView seed={Number(q.get("seed") ?? 11)} />;
  if (duel === "season-hub" || duel === "season-bracket" || duel === "season-stars") return <HubShot moment={duel} />;
  if (duel === "duel-tutorial-pitch" || duel === "duel-tutorial-swing" || duel === "duel-hint") {
    if (duel === "duel-hint") { try { localStorage.removeItem("bb.coach"); } catch { /* shot runs clean */ } }
    return <DuelShot side={duel === "duel-tutorial-swing" || duel === "duel-hint" ? "away" : "home"} wait={Number(q.get("t") ?? 600)} coach={duel === "duel-hint" ? "hints" : "tutorial"} />;
  }
  if (duel === "duel-pitch" || duel === "duel-swing" || duel === "duel-field" || duel === "duel-run" || duel === "duel-steal" || duel === "duel-resume")
    return <DuelShot side={duel === "duel-pitch" || duel === "duel-field" ? "home" : "away"} wait={Number(q.get("t") ?? 600)} kind={duel === "duel-resume" ? "resume" : duel === "duel-field" ? "field" : duel === "duel-run" ? "run" : duel === "duel-steal" ? "steal" : undefined} />;
  const moment = (MOMENTS as readonly string[]).includes(q.get("shot") ?? "") ? q.get("shot") as Moment : "pitch";
  const wait = Number(q.get("t") ?? 600);
  const want = Number(q.get("seed") ?? 0);
  const hand = q.get("hand"); // art review: L or R, the batter's hand at the moment (a left-hander is the mirrored stance)

  // Walk seeds until the fixture game contains the moment, so every named shot exists.
  const { game, target } = useMemo(() => {
    for (let s = want || 1; s < (want || 1) + 60; s++) {
      const g = fixture(s), i = find(g, moment);
      const e = g.result.events[i];
      const bats = e && e.type === "play" ? [...g.teams.away.lineup, ...g.teams.home.lineup].find((p) => p.id === e.batterId)?.bats : undefined;
      if (i >= 0 && (!hand || bats === hand)) return { game: g, target: i };
    }
    const g = fixture(1);
    return { game: g, target: 0 };
  }, [moment, want, hand]);

  // Jump to just before the moment (runners resync), then step onto it so its camera sequence plays.
  const [index, setIndex] = useState(Math.max(0, target - 1));
  useEffect(() => {
    const a = setTimeout(() => setIndex(target), 150);
    const b = setTimeout(() => { (window as any).__shotReady = true; }, 150 + wait);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [target, wait]);

  const e = game.result.events[index];
  // W32 art review: a plan on the moment itself, so the camera can be captured without waiting for a match to earn one.
  const plan: ShotPlan | null = moment === "shot-contact" || moment === "shot-release" || moment === "shot-slide"
    ? (() => { const family = moment === "shot-contact" ? "CONTACT" : moment === "shot-release" ? "MOUND_RELEASE" : "SLIDE_TAG"; const d = CATALOG[family]; return { index: target, family, camera: d.camera, durMs: d.fullMs, score: 100, reasons: ["art review"], still: false }; })()
    : null;
  return (
    <div className="shot">
      <FieldView game={game} index={index} speed={1} plan={index === target ? plan : null}>
        {moment === "ability" && <AbilityCue speed={1} e={{ ...e, type: "ability", phase: "triggered", side: "home", playerId: 0, ability: "RUN_AFTERBURNER", heat: 0, text: "" } as GameEvent} />}
      </FieldView>
      {moment === "bigplay" && e.type === "play" && <PlayCard card={e.card ? e : { ...e, card: "HOME RUN", tier: 1 }} players={new Map(Object.values(game.teams).flatMap((t) => [...t.lineup, ...t.pitchers]).map((p) => [p.id, p]))} />}
      <div className="shot-tag">{moment} · seed {game.result.seed} · ev {index}/{game.result.events.length - 1} · {"text" in e ? e.text : e.type}</div>
    </div>
  );
}
