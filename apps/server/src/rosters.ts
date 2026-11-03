import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MlbTeamWithPlayers, TeamSummary } from "@bb/shared";

// Snapshot from scripts/fetch_rosters.py. Moves into Postgres once the refresh job exists.
// src/ and dist/ sit at the same depth, so this path works in dev and production.
const file = resolve(import.meta.dirname, "../../../data/mlb_rosters.json");
const snapshot = JSON.parse(readFileSync(file, "utf8")) as { season: number; teams: MlbTeamWithPlayers[] };

export const season = snapshot.season;
export const teams = snapshot.teams;

export function teamSummaries(): TeamSummary[] {
  return teams.map(({ players, ...team }) => ({
    ...team,
    playerCount: players.length,
    pitchers: players.filter((p) => p.positionType === "Pitcher").length,
    hitters: players.filter((p) => p.positionType !== "Pitcher").length,
  }));
}
