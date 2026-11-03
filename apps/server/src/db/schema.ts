import { boolean, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { HittingRatings, PitchingRatings, Role } from "@bb/shared";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userTeamPlayers = pgTable("user_team_players", {
  teamId: integer("team_id").notNull().references(() => userTeams.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => players.id),
  // Locked when drafted (tenths of $M), so later rating changes don't break your budget.
  salary: integer("salary").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.teamId, t.playerId] })]);

export const dataRefreshes = pgTable("data_refreshes", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  statsSeason: integer("stats_season"),
  playerCount: integer("player_count"),
  ok: boolean("ok").notNull().default(false),
  error: text("error"),
});
