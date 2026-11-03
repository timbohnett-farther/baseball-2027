import { readFileSync } from "node:fs";
import type { MlbTeam, Player, TeamSummary } from "@bb/shared";
import { db, lastSuccessfulRefresh, loadPool, recordRefresh } from "./db/index.ts";
import { buildPlayerPool, type PlayerPool } from "./mlb/pool.ts";
import { snapshotFile } from "./paths.ts";

// The whole draft pool (~1,300 players) lives in memory; Postgres is the source of truth.

const REFRESH_EVERY_MS = 20 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

let current: PlayerPool = { statsSeason: 0, rosterSeason: 0, teams: [], players: [] };
let refreshedAt: Date | null = null;
let refreshing: Promise<void> | null = null;

export const pool = () => current;
export const dataRefreshedAt = () => refreshedAt;

export function teamSummaries(): TeamSummary[] {
  return current.teams.map((t: MlbTeam) => {
    const roster = current.players.filter((p) => p.teamId === t.id);
    const top = roster.slice(0, 26); // players are sorted best-first
    return {
      ...t,
      playerCount: roster.length,
      pitchers: roster.filter((p) => p.position === "P").length,
      hitters: roster.filter((p) => p.position !== "P").length,
      strength: top.length ? Math.round(top.reduce((s, p) => s + p.ratings.overall, 0) / top.length) : 0,
    };
  });
}

export const teamPlayers = (teamId: number): Player[] => current.players.filter((p) => p.teamId === teamId);

/** Fetch fresh rosters and stats from MLB, re-rate everyone, save, and swap into memory. */
export function refresh(log: (msg: string) => void): Promise<void> {
  refreshing ??= recordRefresh(() => buildPlayerPool(log), (p) => {
    current = p;
    refreshedAt = new Date();
    log(`[refresh] done: ${p.players.length} players, ${p.statsSeason} stats`);
  }).finally(() => { refreshing = null; });
  return refreshing;
}

/** Load from the database; fall back to the committed snapshot and refresh in the background. */
export async function startStore(log: (msg: string) => void) {
  const fromDb = await loadPool();
  if (fromDb && fromDb.players.length) {
    current = fromDb;
    refreshedAt = fromDb.refreshedAt;
    log(`[store] loaded ${current.players.length} players from database`);
  } else {
    current = JSON.parse(readFileSync(snapshotFile, "utf8")) as PlayerPool;
    log(`[store] loaded ${current.players.length} players from snapshot`);
  }

  if (!db) return; // local dev without Postgres: snapshot only, refresh manually with `npm run refresh`
  const check = async () => {
    const last = await lastSuccessfulRefresh();
    if (!last || Date.now() - last.getTime() > REFRESH_EVERY_MS) {
      await refresh(log).catch((err) => log(`[refresh] failed: ${(err as Error).message}`));
    }
  };
  void check();
  setInterval(() => void check(), CHECK_EVERY_MS).unref();
}
