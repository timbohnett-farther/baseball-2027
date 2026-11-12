import { useEffect, useMemo, useState } from "react";
import { simulateGame, type PlayedGame, type SimPlayer, type SimTeam } from "@bb/sim";
import { FieldView } from "./field.tsx";

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

export function ShotView() {
  const q = new URLSearchParams(location.search);
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
