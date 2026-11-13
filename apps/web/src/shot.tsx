import { useEffect, useMemo, useState } from "react";
import { CURRENT_RULES, playInteractive, simulateGame, type PlayedGame, type SimPlayer, type SimTeam, type UserInput, type InteractiveSetup } from "@bb/sim";
import { FieldView } from "./field.tsx";
import { DuelView } from "./duel.tsx";

// Dev-only art review: `/?shot=hr` renders the ballpark full-screen at a named moment of a fixture game
// (no server, no sign-in) so `scripts/shot.mjs` can screenshot it. Moments: pitch, swing, hr, k, single,
// double, final. `&t=<ms>` is how long after the moment lands the page declares itself ready.

const MOMENTS = ["pitch", "swing", "hr", "k", "single", "double", "final"] as const;
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

function fixture(seed: number): PlayedGame {
  nextId = 1;
  const away = team("Harbor City", "HAR", "#1d4e89", AWAY);
  const home = team("Ridgeback", "RDG", "#b3302a", HOME);
  const result = simulateGame({ away, home, seed });
  return { id: 0, createdAt: "", opponent: { id: 0, name: away.name, abbr: away.abbr }, userSide: "home", teams: { away, home }, result };
}

/** Index of the named moment in the event stream, or -1. */
function find(game: PlayedGame, m: Moment): number {
  const ev = game.result.events;
  const play = (o: string) => ev.findIndex((e) => e.type === "play" && e.outcome === o);
  switch (m) {
    case "pitch": return ev.findIndex((e) => e.type === "pitch");
    case "swing": return ev.findIndex((e) => e.type === "pitch" && (e.result === "foul" || e.result === "swinging_strike"));
    case "hr": return play("home_run");
    case "k": return play("strikeout");
    case "single": return play("single");
    case "double": { const i = play("double"); return i >= 0 ? i : play("triple"); }
    case "final": return ev.length - 1;
  }
}

/** Plays inputs (varied aim, since a close ball is rare; contact swings so runners get on) until `stop` says the awaiting is the wanted moment; that log is the starting point. */
function toMoment(setup: InteractiveSetup, stop: (a: NonNullable<ReturnType<typeof playInteractive>["awaiting"]>) => boolean): UserInput[] {
  const inputs: UserInput[] = [];
  for (let i = 0; i < 600; i++) {
    const g = playInteractive({ away: setup.teams.away, home: setup.teams.home, seed: setup.seed, innings: setup.innings, rules: setup.rules, userSide: setup.userSide, inputs });
    if (!g.awaiting || stop(g.awaiting)) return inputs;
    const a = g.awaiting;
    inputs.push(a.role === "swing" ? { kind: "swing", swing: i % 4 ? "contact" : "take", timing: 0 } : a.role === "run" ? { kind: "run", action: "advance", send: [] } : a.role === "field" ? { kind: "field", timing: 0 } : { kind: "pitch", type: "fastball", aim: { x: 0.15 * ((i % 5) - 2), y: 0.2 * ((i % 3) - 1) } });
  }
  return inputs;
}

/** `/?shot=duel-pitch` / `duel-swing` / `duel-field`: the real DuelView on a fixture setup, for checking the tap controls. */
function DuelShot({ side, wait, kind }: { side: "home" | "away"; wait: number; kind?: "field" | "run" | "steal" }) {
  const setup = useMemo(() => {
    nextId = 1;
    const away = team("Harbor City", "HAR", "#1d4e89", AWAY), home = team("Ridgeback", "RDG", "#b3302a", HOME);
    return { seed: kind === "field" ? 2 : kind ? 3 : 7, innings: 3, rules: CURRENT_RULES, userSide: side, opponent: { id: 0, name: away.name, abbr: away.abbr }, teams: { away, home } };
  }, [side, kind]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.querySelector(".tp") && document.querySelector(".field canvas")) { clearInterval(t); setTimeout(() => { (window as any).__shotReady = true; }, side === "away" ? Math.min(wait, 100) : wait); }
    }, 50);
    return () => clearInterval(t);
  }, [wait, side]);
  // Shot mode freezes the panels' auto-take, so the controls stay up however long the page takes to settle.
  const shotInputs = useMemo(() => kind === "field" ? toMoment(setup, (a) => a.role === "field")
    : kind === "run" ? toMoment(setup, (a) => a.role === "run")
    : kind === "steal" ? toMoment(setup, (a) => a.role === "swing" && !!a.run?.steal.length) : undefined, [setup, kind]);
  return <div className="shot-duel"><DuelView setup={setup} onDone={() => {}} shotInputs={shotInputs} /></div>;
}

export function ShotView() {
  const q = new URLSearchParams(location.search);
  const duel = q.get("shot");
  if (duel === "duel-pitch" || duel === "duel-swing" || duel === "duel-field" || duel === "duel-run" || duel === "duel-steal")
    return <DuelShot side={duel === "duel-pitch" || duel === "duel-field" ? "home" : "away"} wait={Number(q.get("t") ?? 600)} kind={duel === "duel-field" ? "field" : duel === "duel-run" ? "run" : duel === "duel-steal" ? "steal" : undefined} />;
  const moment = (MOMENTS as readonly string[]).includes(q.get("shot") ?? "") ? q.get("shot") as Moment : "pitch";
  const wait = Number(q.get("t") ?? 600);
  const want = Number(q.get("seed") ?? 0);

  // Walk seeds until the fixture game contains the moment, so every named shot exists.
  const { game, target } = useMemo(() => {
    for (let s = want || 1; s < (want || 1) + 60; s++) {
      const g = fixture(s), i = find(g, moment);
      if (i >= 0) return { game: g, target: i };
    }
    const g = fixture(1);
    return { game: g, target: 0 };
  }, [moment, want]);

  // Jump to just before the moment (runners resync), then step onto it so its camera sequence plays.
  const [index, setIndex] = useState(Math.max(0, target - 1));
  useEffect(() => {
    const a = setTimeout(() => setIndex(target), 150);
    const b = setTimeout(() => { (window as any).__shotReady = true; }, 150 + wait);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [target, wait]);

  const e = game.result.events[index];
  return (
    <div className="shot">
      <FieldView game={game} index={index} speed={1} />
      <div className="shot-tag">{moment} · seed {game.result.seed} · ev {index}/{game.result.events.length - 1} · {"text" in e ? e.text : e.type}</div>
    </div>
  );
}
