// Shapes of the JSON the API sends and receives.

import type { Player } from "./index.ts";
import type { DraftStatus } from "./draft.ts";
import type { ChemistryReport } from "./chemistry.ts";

export interface Me {
  id: number;
  username: string;
  displayName: string;
  coins: number;
  /** Rookie Rally tutorial: null = not yet played. */
  tutorial: "done" | "skipped" | null;
}

/** Body of POST /api/tutorial/complete: the input log of the fixed tutorial game. */
export interface TutorialCompleteRequest { inputs: unknown[] }
export interface TutorialCompleteResponse { tutorial: "done"; coins: number; reward: number }

export interface SignupRequest { username: string; password: string; displayName?: string }
export interface LoginRequest { username: string; password: string }

/** Team accent colors: bright enough to read as a stripe on the dark UI (never a panel fill). */
export const TEAM_COLORS = ["#c8322f", "#3a6fd8", "#2e9e5b", "#fd5a1e", "#8a5cd6", "#d4af37", "#00a3e0", "#b8bcc6"] as const;

export interface CreateTeamRequest { name: string; color: string }

export interface MyTeam {
  id: number;
  name: string;
  color: string;
  status: "drafting" | "ready";
  players: Player[];
  draft: DraftStatus;
  /** How the players affect each other: effects, per-player boosts, team power. */
  chemistry: ChemistryReport;
}

export interface ApiError { error: string }
