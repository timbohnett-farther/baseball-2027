// Types shared by the browser, the server and the data jobs.

export type PositionType = "Pitcher" | "Catcher" | "Infielder" | "Outfielder" | "Hitter" | "Two-Way Player";

export interface MlbPlayer {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  jersey: string | null;
  position: string;
  positionType: PositionType;
  bats: "L" | "R" | "S" | null;
  throws: "L" | "R" | "S" | null;
  age: number | null;
  birthDate: string | null;
  birthCountry: string | null;
  height: string | null;
  weight: number | null;
  mlbDebut: string | null;
  status: string | null;
  teamId: number;
  team: string;
  teamAbbr: string;
}

export interface MlbTeam {
  id: number;
  name: string;
  abbreviation: string;
  league: string;
  division: string;
}

export interface MlbTeamWithPlayers extends MlbTeam {
  players: MlbPlayer[];
}

export interface TeamSummary extends MlbTeam {
  playerCount: number;
  pitchers: number;
  hitters: number;
}

export interface HealthStatus {
  ok: boolean;
  database: "connected" | "not configured" | "error";
  version: string;
}
