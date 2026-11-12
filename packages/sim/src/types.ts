// What the engine needs to know about players and teams, and what it reports back.
// Ratings here are *effective* ratings (after chemistry and, later, gear and power-ups).

export interface Batting { contact: number; power: number; eye: number; speed: number; fielding: number }
export interface Pitching { stuff: number; control: number; movement: number; stamina: number }

export interface SimPlayer {
  id: number;
  name: string;
  lastName: string;
  position: string;
  bats: "L" | "R" | "S";
  batting: Batting | null;
  pitching: Pitching | null;
}

export interface SimTeam {
  name: string;
  abbr: string;
  color: string;
  /** Batting order, 9 hitters. */
  lineup: SimPlayer[];
  /** Starter first, then the bullpen in the order they'll be used. */
  pitchers: SimPlayer[];
}

export type Side = "away" | "home";

export type PitchResult = "ball" | "called_strike" | "swinging_strike" | "foul" | "in_play";

export type Outcome =
  | "strikeout" | "walk" | "single" | "double" | "triple" | "home_run"
  | "groundout" | "flyout" | "lineout" | "double_play" | "sac_fly";

/**
 * Presentation tier for big plays (docs/VISUAL_DESIGN.md 3.1):
 * 1 = signature cinematic, 2 = highlight, 3 = beat, 0 = routine.
 */
export type Tier = 0 | 1 | 2 | 3;

export interface Bases { first: number | null; second: number | null; third: number | null }

export interface GameState {
  inning: number;
  half: "top" | "bottom";
  outs: number;
  balls: number;
  strikes: number;
  bases: Bases;
  score: { away: number; home: number };
}

export type GameEvent =
  | { type: "half_start"; state: GameState; text: string }
  | { type: "pitch"; state: GameState; batterId: number; pitcherId: number; result: PitchResult; mph: number; zone: boolean }
  | {
      type: "play"; state: GameState; batterId: number; pitcherId: number; outcome: Outcome;
      runs: number; rbi: number; text: string; tier: Tier; call: string | null;
      /** Short big-play card title, e.g. "GRAND SLAM" (Tier 1-2 only). */
      card: string | null;
      /** Fun stat for the card, e.g. "431 ft" or "102 mph". */
      stat: string | null;
    }
  | { type: "pitching_change"; state: GameState; side: Side; pitcherId: number; text: string }
  | { type: "final"; state: GameState; text: string };

export interface BattingLine { playerId: number; name: string; pos: string; ab: number; r: number; h: number; hr: number; rbi: number; bb: number; k: number }
export interface PitchingLine { playerId: number; name: string; outs: number; h: number; r: number; bb: number; k: number; hr: number; pitches: number }

export interface BoxScore {
  linescore: { away: number[]; home: number[] };
  hits: { away: number; home: number };
  batting: { away: BattingLine[]; home: BattingLine[] };
  pitching: { away: PitchingLine[]; home: PitchingLine[] };
}

export interface GameResult {
  seed: number;
  innings: number;
  final: { away: number; home: number };
  winner: Side | null;
  events: GameEvent[];
  box: BoxScore;
}

/** A game as the API returns it. Events are re-created from the seed and team snapshot. */
export interface PlayedGame {
  id: number;
  createdAt: string;
  opponent: { id: number; name: string; abbr: string };
  userSide: Side;
  teams: Record<Side, SimTeam>;
  result: GameResult;
}

export interface GameSummary {
  id: number;
  createdAt: string;
  opponent: { id: number; name: string; abbr: string };
  userScore: number;
  opponentScore: number;
  result: "W" | "L" | "T";
}

export interface GameHistory {
  record: { w: number; l: number; t: number };
  games: GameSummary[];
}

// --- Interactive play ---------------------------------------------------------------------
// The user's choices are an ordered input log. Replaying the log against the same seed gives
// the same game, so the server can verify an interactive game later.

export type PitchType = "fastball" | "slider" | "change" | "curve";
/** Position over the plate: x, y in -1..1 is inside the strike zone, beyond that is a ball. */
export interface Aim { x: number; y: number }

export type UserInput =
  | { kind: "pitch"; type: PitchType; aim: Aim }
  /** timing: -1 = very early, 0 = perfect, 1 = very late. */
  | { kind: "swing"; swing: "contact" | "power" | "take"; timing: number };

/** What the game needs from the user next. */
export interface Awaiting {
  role: "pitch" | "swing";
  batterId: number;
  pitcherId: number;
  state: GameState;
  /** When batting: the pitch that is on its way. */
  incoming: { type: PitchType; mph: number; aim: Aim } | null;
}

export interface InteractiveGame {
  events: GameEvent[];
  awaiting: Awaiting | null;
  /** Set once the game is over. */
  result: GameResult | null;
}

/** Everything the browser needs to run a play-it-yourself game. */
export interface InteractiveSetup {
  seed: number;
  innings: number;
  userSide: Side;
  opponent: { id: number; name: string; abbr: string };
  teams: Record<Side, SimTeam>;
}
