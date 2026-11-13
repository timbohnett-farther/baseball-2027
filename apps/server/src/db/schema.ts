import { boolean, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { Gear, HittingRatings, PitchingRatings, Role } from "@bb/shared";
import type { SimTeam, UserInput } from "@bb/sim";

export const mlbTeams = pgTable("mlb_teams", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull(),
  league: text("league").notNull(),
  division: text("division").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable("players", {
  id: integer("id").primaryKey(), // MLB person id
  name: text("name").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  jersey: text("jersey"),
  position: text("position").notNull(),
  bats: text("bats"),
  throws: text("throws"),
  age: integer("age"),
  birthDate: text("birth_date"),
  birthCountry: text("birth_country"),
  height: text("height"),
  weight: integer("weight"),
  mlbDebut: text("mlb_debut"),
  teamId: integer("team_id").references(() => mlbTeams.id),
  status: text("status").notNull(),
  // False once a player drops out of the draft pool; the row stays so drafted teams keep him.
  inPool: boolean("in_pool").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playerRatings = pgTable("player_ratings", {
  playerId: integer("player_id").notNull().references(() => players.id),
  season: integer("season").notNull(),
  overall: integer("overall").notNull(),
  role: text("role").$type<Role>().notNull(),
  hitting: jsonb("hitting").$type<HittingRatings | null>(),
  pitching: jsonb("pitching").$type<PitchingRatings | null>(),
  sample: jsonb("sample").$type<{ pa: number; bf: number }>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.playerId, t.season] })]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(), // stored lowercase
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  coins: integer("coins").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  // SHA-256 of the cookie token; the token itself is never stored.
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const userTeams = pgTable("user_teams", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }), // one team per user for now
  name: text("name").notNull(),
  color: text("color").notNull(),
  status: text("status").$type<"drafting" | "ready">().notNull().default("drafting"),
  /** Wood bat spec and the equipped Super Power Bat (null = defaults). */
  gear: jsonb("gear").$type<Gear>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Super Power Bats a user owns (bought or dropped). */
export const userItems = pgTable("user_items", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.itemId] })]);

export const userTeamPlayers = pgTable("user_team_players", {
  teamId: integer("team_id").notNull().references(() => userTeams.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => players.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  /** Development XP from games played for this team; the server is the only writer. */
  xp: integer("xp").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.teamId, t.playerId] })]);

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => userTeams.id, { onDelete: "cascade" }),
  opponentTeamId: integer("opponent_team_id").notNull().references(() => mlbTeams.id),
  // The game is fully determined by the seed and the team snapshot (ratings at first pitch),
  // so the play-by-play is re-created on demand instead of stored.
  seed: integer("seed").notNull(),
  innings: integer("innings").notNull(),
  /** Ruleset the game was played under (sim RulesVersion). Rows from before versioning are 1 and replay as they always did. */
  rules: integer("rules").$type<1 | 2 | 3>().notNull().default(1),
  userSide: text("user_side").$type<"home" | "away">().notNull(),
  teams: jsonb("teams").$type<Record<"home" | "away", SimTeam>>().notNull(),
  /** Set when the user played it pitch by pitch: their choices, replayed against the seed. */
  inputs: jsonb("inputs").$type<UserInput[]>(),
  userScore: integer("user_score").notNull(),
  opponentScore: integer("opponent_score").notNull(),
  result: text("result").$type<"W" | "L" | "T">().notNull(),
  /** Coins this game paid out (0 for games before the store existed). */
  coins: integer("coins").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A 20-game season vs real teams, then a three-round playoff if the record is winning. */
export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull().references(() => userTeams.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  seed: integer("seed").notNull(),
  status: text("status").$type<"regular" | "playoffs" | "done">().notNull().default("regular"),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  ties: integer("ties").notNull().default(0),
  /** 0 during the regular season, then 1–3. */
  playoffRound: integer("playoff_round").notNull().default(0),
  playoffWins: integer("playoff_wins").notNull().default(0),
  playoffLosses: integer("playoff_losses").notNull().default(0),
  /** Season bonuses paid so far (regular-season completion, berth, round wins, title). */
  rewardCoins: integer("reward_coins").notNull().default(0),
  champion: boolean("champion").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const seasonGames = pgTable("season_games", {
  seasonId: integer("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  gameNo: integer("game_no").notNull(),
  /** 0 = regular season, 1–3 = playoff round. */
  round: integer("round").notNull().default(0),
  opponentTeamId: integer("opponent_team_id").notNull().references(() => mlbTeams.id),
  gameId: integer("game_id").references(() => games.id, { onDelete: "set null" }),
  result: text("result").$type<"W" | "L" | "T">(),
}, (t) => [primaryKey({ columns: [t.seasonId, t.gameNo] })]);

export const dataRefreshes = pgTable("data_refreshes", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  statsSeason: integer("stats_season"),
  playerCount: integer("player_count"),
  ok: boolean("ok").notNull().default(false),
  error: text("error"),
});
