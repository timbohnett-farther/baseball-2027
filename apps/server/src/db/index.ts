import { mkdirSync } from "node:fs";
import { desc, eq, max, sql as dsql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Player } from "@bb/shared";
import type { PlayerPool } from "../mlb/pool.ts";
import { localDbDir, migrationsDir } from "../paths.ts";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let current: { db: Db; kind: "postgres" | "local"; migrate: () => Promise<void>; close: () => Promise<void> } | null = null;

/**
 * Connect once at startup. Railway sets DATABASE_URL (real Postgres); without it we use
 * PGlite, an embedded Postgres, stored in .data/pglite ("memory://" for tests).
 */
export async function initDb(opts: { url?: string; localDir?: string } = {}) {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: 5, onnotice: () => {} });
    const db = drizzle(client, { schema });
    current = { db: db as unknown as Db, kind: "postgres", migrate: () => migrate(db, { migrationsFolder: migrationsDir }), close: () => client.end() };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = opts.localDir ?? localDbDir;
    if (!dir.startsWith("memory://")) mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    const db = drizzle(client, { schema });
    current = { db: db as unknown as Db, kind: "local", migrate: () => migrate(db, { migrationsFolder: migrationsDir }), close: () => client.close() };
  }
  await current.migrate();
  return current.db;
}

export function getDb(): Db {
  if (!current) throw new Error("Database not initialised; call initDb() first");
  return current.db;
}

export const isProductionDb = () => current?.kind === "postgres";

export async function closeDb() {
  await current?.close();
  current = null;
}

export async function databaseStatus(): Promise<"connected" | "local" | "error"> {
  try {
    await getDb().execute(dsql`select 1`);
    return current!.kind === "postgres" ? "connected" : "local";
  } catch {
    return "error";
  }
}

/** How many migrations drizzle has applied (its own `__drizzle_migrations` ledger). 0 if unreadable. */
export async function migrationsApplied(): Promise<number> {
  try {
    const rows = await getDb().execute(dsql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const first = (Array.isArray(rows) ? rows[0] : (rows as { rows?: unknown[] }).rows?.[0]) as { n?: number } | undefined;
    return Number(first?.n ?? 0);
  } catch {
    return 0;
  }
}

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Replace the draft pool with a fresh one. Players who left the pool keep their rows (drafted teams may hold them). */
export async function savePool(pool: PlayerPool) {
  await getDb().transaction(async (tx) => {
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

/** Load the current draft pool, or null if the database has none yet. */
export async function loadPool(): Promise<(PlayerPool & { refreshedAt: Date | null }) | null> {
  const db = getDb();
  const [{ season }] = await db.select({ season: max(schema.playerRatings.season) }).from(schema.playerRatings);
  if (!season) return null;
  const teams = await db.select({
    id: schema.mlbTeams.id, name: schema.mlbTeams.name, abbreviation: schema.mlbTeams.abbreviation,
    league: schema.mlbTeams.league, division: schema.mlbTeams.division,
  }).from(schema.mlbTeams).orderBy(schema.mlbTeams.name);
  const rows = await db.select().from(schema.players)
    .innerJoin(schema.playerRatings, dsql`${schema.playerRatings.playerId} = ${schema.players.id} and ${schema.playerRatings.season} = ${season}`)
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
  const refreshedAt = await lastSuccessfulRefresh();
  return { statsSeason: season, rosterSeason: (refreshedAt ?? new Date()).getUTCFullYear(), teams, players, refreshedAt };
}

export async function lastSuccessfulRefresh(): Promise<Date | null> {
  const last = await getDb().query.dataRefreshes.findFirst({ where: eq(schema.dataRefreshes.ok, true), orderBy: desc(schema.dataRefreshes.finishedAt) });
  return last?.finishedAt ?? null;
}

/** Run a refresh, save it, and log the attempt (success or failure) in data_refreshes. */
export async function recordRefresh<T>(run: () => Promise<PlayerPool>, onDone: (pool: PlayerPool) => T) {
  const db = getDb();
  const [row] = await db.insert(schema.dataRefreshes).values({}).returning({ id: schema.dataRefreshes.id });
  try {
    const pool = await run();
    await savePool(pool);
    await db.update(schema.dataRefreshes).set({ finishedAt: new Date(), ok: true, statsSeason: pool.statsSeason, playerCount: pool.players.length })
      .where(eq(schema.dataRefreshes.id, row.id));
    return onDone(pool);
  } catch (err) {
    await db.update(schema.dataRefreshes).set({ finishedAt: new Date(), error: String((err as Error).stack ?? err) })
      .where(eq(schema.dataRefreshes.id, row.id));
    throw err;
  }
}
