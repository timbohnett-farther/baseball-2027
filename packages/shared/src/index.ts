// Types shared by the browser, the server and the data refresh.

import type { PlayerRatings } from "./ratings.ts";

export interface MlbTeam {
  id: number;
  name: string;
  abbreviation: string;
  league: string;
  division: string;
}

/** A draftable player: real bio plus game ratings. */
export interface Player {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  jersey: string | null;
  position: string;
  bats: string | null;
  throws: string | null;
  age: number | null;
  birthDate: string | null;
  birthCountry: string | null;
  height: string | null;
  weight: number | null;
  mlbDebut: string | null;
  /** Null when the player isn't on any 40-man roster (free agent or released). */
  teamId: number | null;
  teamAbbr: string | null;
  /** "Active", "Injured 60-Day", "Free Agent", ... */
  status: string;
  ratings: Omit<PlayerRatings, "id">;
}

export interface TeamSummary extends MlbTeam {
  playerCount: number;
  pitchers: number;
  hitters: number;
  /** Average overall of the team's top 26 players. */
  strength: number;
}

export interface TeamDetail extends MlbTeam {
  players: Player[];
}

export interface HealthStatus {
  ok: boolean;
  /** "local" = embedded dev database (PGlite) instead of Railway Postgres. */
  database: "connected" | "local" | "error";
  version: string;
  /** When player data was last refreshed from MLB (ISO time), if known. */
  dataRefreshedAt: string | null;
}

export * from "./ratings.ts";
export * from "./draft.ts";
export * from "./api.ts";
