// Shapes of the JSON the API sends and receives.

import type { Player } from "./index.ts";
import type { DraftStatus } from "./draft.ts";

export interface Me {
  id: number;
  username: string;
  displayName: string;
  coins: number;
}

export interface SignupRequest { username: string; password: string; displayName?: string }
export interface LoginRequest { username: string; password: string }

export const TEAM_COLORS = ["#c8102e", "#0c2340", "#1f6f43", "#fd5a1e", "#4b2e83", "#b8860b", "#00a3e0", "#111111"] as const;

export interface CreateTeamRequest { name: string; color: string }

export interface DraftedPlayer extends Player {
  /** Salary locked when drafted, in tenths of $M. */
  salary: number;
}

export interface MyTeam {
  id: number;
  name: string;
  color: string;
  status: "drafting" | "ready";
  players: DraftedPlayer[];
  draft: DraftStatus;
}

export interface ApiError { error: string }
