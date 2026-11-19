import { customOverall, isPitcherPosition, progressFor, type CustomPlayerInput, type Player } from "@bb/shared";
import type { userCustomPlayers } from "./db/schema.ts";

type Row = typeof userCustomPlayers.$inferSelect;

/** The virtual id of a team's custom player: negative, so it can never collide with a real MLB player id. */
export const customPlayerId = (teamId: number) => -teamId;

/** A custom player as an ordinary roster Player: the sim, chemistry-free staff sort and lineup treat him like any other. */
export function customToPlayer(row: Pick<Row, "teamId" | "name" | "number" | "position" | "bats" | "look" | "ratings">): Player {
  const pitcher = isPitcherPosition(row.position);
  const r = row.ratings;
  const overall = customOverall(r, row.position);
  return {
    id: customPlayerId(row.teamId), name: row.name, firstName: row.name, lastName: row.name,
    jersey: String(row.number), position: pitcher ? "P" : row.position, bats: row.bats, throws: row.bats === "L" ? "L" : "R",
    age: null, birthDate: null, birthCountry: null, height: null, weight: null, mlbDebut: null,
    teamId: null, teamAbbr: null, status: "Custom",
    ratings: {
      overall, role: pitcher ? (row.position as "SP" | "RP") : "H",
      hitting: pitcher ? null : { contact: r.contact, power: r.power, eye: r.eye, speed: r.speed, fielding: r.fielding },
      pitching: pitcher ? { stuff: r.stuff, control: r.control, movement: r.movement, stamina: r.stamina } : null,
      sample: { pa: 0, bf: 0 },
    },
    progress: progressFor(0),
    custom: { number: row.number, bats: row.bats, look: row.look },
  };
}

export const customInputOf = (row: Row): CustomPlayerInput => ({
  name: row.name, number: row.number, position: row.position as CustomPlayerInput["position"], bats: row.bats as CustomPlayerInput["bats"],
  look: row.look as CustomPlayerInput["look"], ratings: row.ratings,
});
