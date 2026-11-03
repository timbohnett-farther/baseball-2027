import { desc, eq, sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Player } from "@bb/shared";
import type { PlayerPool } from "../mlb/pool.ts";
import { migrationsDir } from "../paths.ts";
import * as schema from "./schema.ts";

// Railway injects DATABASE_URL from the Postgres service. Locally it's optional.
const client = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { max: 5, onnotice: () => {} }) : null;
export const db = client ? drizzle(client, { schema }) : null;

export async function databaseStatus(): Promise<"connected" | "not configured" | "error"> {
  if (!db) return "not configured";
  try {
    await db.execute(dsql`select 1`);
    return "connected";
  } catch {
    return "error";
  }
}

export async function migrateDb() {
  if (db) await migrate(db, { migrationsFolder: migrationsDir });
}

export async function closeDb() {
  await client?.end();
}

/** Replace the draft pool with a fresh one. Players who left the pool keep their rows. */
export async function savePool(pool: PlayerPool) {
  if (!db) return;
  await db.transaction(async (tx) => {
    for (const t of pool.teams) {
      await tx.insert(schema.mlbTeams).values({ ...t, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.mlbTeams.id, set: { ...t, updatedAt: new Date() } });
    }
    await tx.update(schema.players).set({ inPool: false });
    for (let i = 0; i < pool.players.length; i += 200) {
      const batch = pool.players.slice(i, i + 200);
      const rows = batch.map(({ ratings, teamAbbr, ...p }) => ({ ...p, inPool: true, updatedAt: new Date() }));
      await tx.insert(schema.players).values(rows).onConflictDoUpdate({
        target: schema.players.id,
        set: Object.fromEntries(Object.keys(rows[0]).filter((k) => k !== "id").map((k) => [k, dsql.raw(`excluded.${toSnake(k)}`)])),
      });
      const ratingRows = batch.map((p) => ({ playerId: p.id, season: pool.statsSeason, ...p.ratings, updatedAt: new Date() }));
      await tx.insert(schema.playerRatings).values(ratingRows).onConflictDoUpdate({
        target: [schema.playerRatings.playerId, schema.playerRatings.season],
        set: Object.fromEntries(["overall", "role", "hitting", "pitching", "sample", "updatedAt"].map((k) => [k, dsql.raw(`excluded.${toSnake(k)}`)])),
      });
    }
  });
}

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Load the current draft pool, or null if the database has none yet. */
export async function loadPool(): Promise<(PlayerPool & { refreshedAt: Date | null }) | null> {
  if (!db) return null;
  const last = await db.query.dataRefreshes.findFirst({ where: eq(schema.dataRefreshes.ok, true), orderBy: desc(schema.dataRefreshes.finishedAt) });
  if (!last?.statsSeason) return null;
  const teams = await db.select({
    id: schema.mlbTeams.id, name: schema.mlbTeams.name, abbreviation: schema.mlbTeams.abbreviation,
    league: schema.mlbTeams.league, division: schema.mlbTeams.division,
  }).from(schema.mlbTeams).orderBy(schema.mlbTeams.name);
  const rows = await db.select().from(schema.players)
    .innerJoin(schema.playerRatings, dsql`${schema.playerRatings.playerId} = ${schema.players.id} and ${schema.playerRatings.season} = ${last.statsSeason}`)
    .where(eq(schema.players.inPool, true));
  const abbr = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const players: Player[] = rows.map(({ players: p, player_ratings: r }) => ({
    id: p.id, name: p.name, firstName: p.firstName, lastName: p.lastName, jersey: p.jersey, position: p.position,
    bats: p.bats, throws: p.throws, age: p.age, birthDate: p.birthDate, birthCountry: p.birthCountry, height: p.height,
    weight: p.weight, mlbDebut: p.mlbDebut, teamId: p.teamId, teamAbbr: p.teamId ? abbr.get(p.teamId) ?? null : null,
    status: p.status,
    ratings: { overall: r.overall, role: r.role, hitting: r.hitting ?? null, pitching: r.pitching ?? null, sample: r.sample },
  }));
  players.sort((a, b) => b.ratings.overall - a.ratings.overall || a.lastName.localeCompare(b.lastName));
  return { statsSeason: last.statsSeason, rosterSeason: last.finishedAt!.getUTCFullYear(), teams, players, refreshedAt: last.finishedAt };
}

export async function lastSuccessfulRefresh(): Promise<Date | null> {
  if (!db) return null;
  const last = await db.query.dataRefreshes.findFirst({ where: eq(schema.dataRefreshes.ok, true), orderBy: desc(schema.dataRefreshes.finishedAt) });
  return last?.finishedAt ?? null;
}

export async function recordRefresh<T>(run: () => Promise<PlayerPool>, onDone: (pool: PlayerPool) => T) {
  const [row] = db ? await db.insert(schema.dataRefreshes).values({}).returning({ id: schema.dataRefreshes.id }) : [null];
  try {
    const pool = await run();
    await savePool(pool);
    if (db && row) {
      await db.update(schema.dataRefreshes).set({ finishedAt: new Date(), ok: true, statsSeason: pool.statsSeason, playerCount: pool.players.length })
        .where(eq(schema.dataRefreshes.id, row.id));
    }
    return onDone(pool);
  } catch (err) {
    if (db && row) {
      await db.update(schema.dataRefreshes).set({ finishedAt: new Date(), error: String((err as Error).stack ?? err) })
        .where(eq(schema.dataRefreshes.id, row.id));
    }
    throw err;
  }
}
