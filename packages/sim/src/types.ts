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
  /** Equipped Super Power Bat, snapshotted with the team so a replay sees the same gear. */
  gear?: { superBat: SuperBatGear | null; cosmetics?: Partial<Record<"helmet" | "cleats" | "gloves", string | null>> };
}

/** A Super Power Bat as the engine sees it: charges per game and the rating boost of a Super Swing. */
export interface SuperBatGear { id: string; name: string; charges: number; contact: number; power: number }

export type Side = "away" | "home";

/** Which rules a game is played under; stored with each saved game so old ones replay identically. */
export type RulesVersion = 1 | 2 | 3 | 4;

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
  /** Heat by player id. Rules v3: 0-100, everyone starts at 25. Rules 1-2: 1-3 (absent = cold), and it shifts hit odds. */
  heat: Record<number, number>;
  /** Rally meter per team, 0-100. Rules v3: grows by half of every positive Heat award, never drains. Rules 1-2: fills on hits, drains on outs. */
  rally: { away: number; home: number };
  /** Rules 1-2 only: the team whose Rally hit 100, On Fire until their half of the inning ends. Always null in v3. */
  fire: Side | null;
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
      /** The user spent a Super Power Bat charge on this at-bat. */
      superSwing?: boolean;
    }
  | { type: "pitching_change"; state: GameState; side: Side; pitcherId: number; text: string }
  | { type: "final"; state: GameState; text: string }
  /** Rules v4: an ability request was committed, took effect, fizzled, or was refused (and cost nothing). */
  | {
      type: "ability"; state: GameState; phase: "committed" | "triggered" | "expired" | "rejected";
      side: Side; playerId: number; ability: AbilityId; heat: number; reason?: DisabledReason; text: string;
    };

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
  /** The ruleset it was played under; absent on a live in-browser game, whose setup carries it. */
  rules?: RulesVersion;
  /** What the game paid out, on the response to a just-finished game only. */
  reward?: {
    total: number; coins: Record<string, number>; drop: { id: string; name: string } | null;
    /** Drafted players who reached a new development level in this game. */
    levelUps?: { id: number; name: string; level: number }[];
  };
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

export type AbilityId = "BAT_COMET" | "BAT_LASER" | "BAT_GAP_MASTER" | "BAT_SECOND_SWING" | "PITCH_MIRAGE" | "PITCH_VORTEX";
export type AbilityDirection = "left" | "right";
/** What the user committed with a pitch or swing (arming and cancelling happen client-side and are never logged). Rules v4 only. */
export interface AbilityRequest { id: AbilityId; direction?: AbilityDirection }
/** PUP 4.3: why an ability can't be used right now. */
export type DisabledReason = "WRONG_CONTEXT" | "INSUFFICIENT_HEAT" | "COOLDOWN" | "SELECT_DIRECTION" | "ALREADY_USED" | "WRONG_SWING" | "INELIGIBLE_ACTOR";
/** One ability chip for the UI. `reason`/`message` are set when `available` is false. */
export interface AbilityStatus {
  id: AbilityId; name: string; cost: number; summary: string; needsDirection: boolean; swings: ("contact" | "power")[];
  available: boolean; reason?: DisabledReason; message?: string;
}

export type UserInput =
  | { kind: "pitch"; type: PitchType; aim: Aim; ability?: AbilityRequest }
  /** timing: -1 = very early, 0 = perfect, 1 = very late. `super` spends a Super Power Bat charge (clutch spots only). */
  | { kind: "swing"; swing: "contact" | "power" | "take"; timing: number; super?: boolean; ability?: AbilityRequest }
  /** A close ball in play on the user's defense: the glove tap, timed the same way. */
  | { kind: "field"; timing: number };

/** What the game needs from the user next. */
export interface Awaiting {
  role: "pitch" | "swing" | "field";
  batterId: number;
  pitcherId: number;
  state: GameState;
  /** When batting: the pitch that is on its way. */
  incoming: { type: PitchType; mph: number; aim: Aim } | null;
  /** When fielding a close one: what's coming and who has to make the play. */
  ball: { kind: "grounder" | "liner" | "fly"; fielderId: number } | null;
  /** When batting with a Super Power Bat: charges left this game, and whether this is a clutch spot (the only time a charge can be spent). */
  super: { bat: string; charges: number; clutch: boolean } | null;
  /** Rules v4: the user's abilities for this role (batter's when swinging, pitcher's when pitching). Empty otherwise. */
  abilities: AbilityStatus[];
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
  rules: RulesVersion;
  userSide: Side;
  opponent: { id: number; name: string; abbr: string };
  teams: Record<Side, SimTeam>;
}
