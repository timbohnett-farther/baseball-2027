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
export type RulesVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Rules v7: how the computer plays, chosen per game and stored with it. Absent = "pro". Ignored below v7. */
export type Difficulty = "rookie" | "pro" | "allstar";

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
  /** Rules v6: a baserunning decision played out (steal, pickoff, send or hold on contact, tag-up). `runnerId` is the runner it was about. */
  | { type: "run"; state: GameState; action: "steal" | "caught" | "pickoff" | "advance" | "hold" | "thrown_out"; side: Side; runnerId: number; text: string }
  /** Rules v7: a team ability (Rally Breaker) was used. */
  | { type: "team"; state: GameState; side: Side; action: "rally_breaker"; text: string }
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
  /** Rules v7: the computer's difficulty. Absent on older games, which play as "pro". */
  difficulty?: Difficulty;
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

export type AbilityId = "BAT_COMET" | "BAT_LASER" | "BAT_GAP_MASTER" | "BAT_SECOND_SWING" | "PITCH_MIRAGE" | "PITCH_VORTEX" | "FIELD_WALL_REAPER" | "FIELD_ACROBAT" | "FIELD_CANNON_ARM" | "RUN_AFTERBURNER";
export type AbilityDirection = "left" | "right";
/** What the user committed with a pitch or swing (arming and cancelling happen client-side and are never logged). Rules v4 only. */
export interface AbilityRequest { id: AbilityId; direction?: AbilityDirection }
/** PUP 4.3: why an ability can't be used right now. */
export type DisabledReason = "WRONG_CONTEXT" | "INSUFFICIENT_HEAT" | "COOLDOWN" | "SELECT_DIRECTION" | "ALREADY_USED" | "WRONG_SWING" | "INELIGIBLE_ACTOR" | "INSUFFICIENT_RALLY";
/** One ability chip for the UI. `reason`/`message` are set when `available` is false. */
export interface AbilityStatus {
  id: AbilityId; name: string; cost: number; summary: string; needsDirection: boolean; swings: ("contact" | "power")[];
  available: boolean; reason?: DisabledReason; message?: string;
}

export type UserInput =
  | { kind: "pitch"; type: PitchType; aim: Aim; ability?: AbilityRequest }
  /** timing: -1 = very early, 0 = perfect, 1 = very late. `super` spends a Super Power Bat charge (clutch spots only). */
  | { kind: "swing"; swing: "contact" | "power" | "take"; timing: number; super?: boolean; ability?: AbilityRequest }
  /**
   * A close ball in play on the user's defense: the glove tap, timed the same way.
   * Rules v5: `throwTo` is the base chosen when a force play is on (absent = the recommended throw), and `ability` rides on the play like a swing's.
   */
  | { kind: "field"; timing: number; throwTo?: Base; ability?: AbilityRequest }
  /**
   * Rules v6 baserunning. `steal` and `pickoff` are optional extras logged just before the pitch they happen on;
   * `advance` answers the awaiting "run" role (which runners to send on a hit or tag up on a fly out; the rest hold).
   */
  | { kind: "run"; action: "steal"; from: "first" | "second"; ability?: AbilityRequest }
  | { kind: "run"; action: "pickoff"; at: "first" | "second" | "third" }
  | { kind: "run"; action: "advance"; send: ("first" | "second" | "third")[]; ability?: AbilityRequest }
  /** Rules v7: a team ability, logged just before the pitch it happens on. Costs 100 Rally, once per match. */
  | { kind: "team"; action: "rally_breaker" };

export type Base = "first" | "second" | "third" | "home";

/** What the game needs from the user next. */
export interface Awaiting {
  role: "pitch" | "swing" | "field" | "run";
  batterId: number;
  pitcherId: number;
  state: GameState;
  /** When batting: the pitch that is on its way. */
  incoming: { type: PitchType | null; mph: number; aim: Aim } | null;
  /** When fielding a close one: what's coming and who has to make the play. */
  ball: { kind: "grounder" | "liner" | "fly"; fielderId: number; /** Rules v5: the force-play throw choices, when there is one. */ throws?: { recommended: Base; options: Base[] } } | null;
  /** When batting with a Super Power Bat: charges left this game, and whether this is a clutch spot (the only time a charge can be spent). */
  super: { bat: string; charges: number; clutch: boolean } | null;
  /** Rules v4: the user's abilities for this role (batter's when swinging, pitcher's when pitching, the fielder's on a close ball in v5). Empty otherwise. */
  abilities: AbilityStatus[];
  /** Rules v6: the baserunning options at this moment. Absent before v6. */
  run?: RunOptions;
  /** Rules v7: Rally Breaker, offered on pitch and swing only. */
  team?: TeamStatus;
}

/** Rules v7: Rally Breaker as the UI shows it. `targets` are the Heat the opposing pitcher and batter would lose it from. */
export interface TeamStatus {
  id: "TEAM_RALLY_BREAKER"; name: string; cost: number; summary: string; rally: number;
  available: boolean; reason?: DisabledReason; message?: string;
  /** Heat removed from each target (never below 0), and how much each has now. */
  targets: { id: number; heat: number; loses: number }[];
  /** Both targets are already at 0: confirm before spending Rally for nothing. */
  needsConfirm: boolean;
}

/** A runner the user can act on, with the Afterburner chip as it stands for that runner (null when the runner has no Heat to spend or v6 is off). */
/** `chance` is the base success odds; `boost` the odds with Afterburner (same when it does not apply). */
export interface RunnerOption { base: "first" | "second" | "third"; runnerId: number; chance: number; boost: number; afterburner: AbilityStatus | null }

/**
 * Rules v6. While batting: `steal` lists runners who can go on the next pitch. While pitching: `pickoff`
 * lists bases to throw to (`pickoffsLeft` more this batter). On the "run" role: `advance` is the send/hold choice.
 */
export interface RunOptions {
  steal: RunnerOption[];
  pickoff: RunnerOption[];
  pickoffsLeft: number;
  advance: { kind: "hit" | "fly"; outcome: Outcome; runners: RunnerOption[] } | null;
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
  /** Rules v7: the computer's difficulty. Absent = "pro". */
  difficulty?: Difficulty;
  userSide: Side;
  opponent: { id: number; name: string; abbr: string };
  teams: Record<Side, SimTeam>;
}
