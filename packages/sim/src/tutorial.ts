import { CURRENT_RULES } from "./game.ts";
import type { InteractiveSetup, SimPlayer, SimTeam } from "./types.ts";

// Rookie Rally: a real one-inning game against the Rookie CPU on a fixed seed with fixed fictional teams,
// so the guide and the server's completion check replay exactly the same game.

export const TUTORIAL_SEED = 2027;

const hitter = (id: number, name: string, r: number, pos: string, bats: "L" | "R"): SimPlayer => ({
  id, name, lastName: name.split(" ").pop()!, position: pos, bats,
  batting: { contact: r, power: r + 5, eye: r - 5, speed: r, fielding: r }, pitching: null,
});
const pitcher = (id: number, name: string, r: number): SimPlayer => ({
  id, name, lastName: name.split(" ").pop()!, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
const POSITIONS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH"];
const squad = (base: number, name: string, abbr: string, color: string, first: string[], rating: number): SimTeam => ({
  name, abbr, color,
  lineup: POSITIONS.map((pos, i) => hitter(base + i, `${first[i]} ${abbr}${i + 1}`, rating + (i % 3) * 4, pos, i % 2 ? "L" : "R")),
  pitchers: [pitcher(base + 20, `${first[0]} Arm`, rating), pitcher(base + 21, `${first[1]} Relief`, rating - 6)],
});

export function tutorialSetup(): InteractiveSetup {
  const away = squad(9001, "Rookie Rovers", "ROV", "#3a6fd8", ["Rowan", "Idris", "Mateo", "Kenji", "Dario", "Elias", "Theo", "Luca", "Nico"], 58);
  const home = squad(9101, "Your Club", "YOU", "#c8322f", ["Jonah", "Silas", "Amari", "Cole", "Bram", "Ezra", "Hugo", "Otis", "Reid"], 74);
  return {
    seed: TUTORIAL_SEED, innings: 1, rules: CURRENT_RULES, difficulty: "rookie", userSide: "home",
    opponent: { id: 0, name: away.name, abbr: away.abbr }, teams: { away, home },
  };
}
