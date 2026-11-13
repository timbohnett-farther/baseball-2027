// Season mode: 20 games vs real clubs, then a three-round playoff (best of 3) if you finish over .500.

export const SEASON_LENGTH = 20;
export const PLAYOFF_ROUNDS = 3;
/** Wins needed to take a playoff round. */
export const ROUND_WINS = 2;

/** Season bonuses, paid only by the server on top of per-game coins. */
export const SEASON_REWARDS = {
  /** Finishing all 20 regular-season games, winning record or not. */
  regular: 100,
  /** Making the playoffs. */
  berth: 100,
  /** Winning round 1, 2, 3. */
  round: [100, 150, 300] as const,
  champion: 500,
} as const;

export type SeasonStatus = "regular" | "playoffs" | "done";

export interface SeasonGame {
  gameNo: number;
  /** 0 = regular season, 1–3 = playoff round. */
  round: number;
  opponent: { id: number; name: string; abbr: string };
  gameId: number | null;
  result: "W" | "L" | "T" | null;
  userScore: number | null;
  opponentScore: number | null;
}

export interface Standing {
  id: number;
  name: string;
  abbr: string;
  w: number;
  l: number;
  /** True for the user's own row. */
  you: boolean;
}

export interface SeasonState {
  /** 1 = the original 20-game season. */
  format: 1;
  id: number;
  number: number;
  status: SeasonStatus;
  record: { w: number; l: number; t: number };
  playoffRound: number;
  playoffWins: number;
  playoffLosses: number;
  champion: boolean;
  /** Season bonuses paid so far. */
  rewardCoins: number;
  /** True once the season ended without a title (missed the playoffs or lost a round). */
  eliminated: boolean;
  schedule: SeasonGame[];
  next: SeasonGame | null;
  standings: Standing[];
}
