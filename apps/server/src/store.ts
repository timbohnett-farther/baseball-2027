import { readFileSync } from "node:fs";
import type { MlbTeam, Player, TeamSummary } from "@bb/shared";
import { isProductionDb, lastSuccessfulRefresh, loadPool, recordRefresh, savePool } from "./db/index.ts";
import { buildPlayerPool, type PlayerPool } from "./mlb/pool.ts";
import { snapshotFile } from "./paths.ts";

// The whole draft pool (~1,400 players) lives in memory; the database is the source of truth.

const REFRESH_EVERY_MS = 20 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

let current: PlayerPool = { statsSeason: 0, rosterSeason: 0, teams: [], players: [] };
let byId = new Map<number, Player>();
let refreshedAt: Date | null = null;
let refreshing: Promise<void> | null = null;

export const pool = () => current;
export const dataRefreshedAt = () => refreshedAt;
export const findPlayer = (id: number) => byId.get(id);

function setPool(p: PlayerPool) {
  current = p;
  byId = new Map(p.players.map((x) => [x.id, x]));
}

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
    setPool(p);
    refreshedAt = new Date();
    log(`[refresh] done: ${p.players.length} players, ${p.statsSeason} stats`);
  }).finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * Load the pool from the database. An empty database (first deploy, fresh dev setup, tests)
 * is seeded from the committed snapshot so the game works immediately.
 * On Railway, a daily refresh from MLB keeps it current.
 */
export async function startStore(log: (msg: string) => void, opts: { autoRefresh?: boolean } = {}) {
  let loaded = await loadPool();
  if (!loaded?.players.length) {
    await savePool(JSON.parse(readFileSync(snapshotFile, "utf8")) as PlayerPool);
    loaded = (await loadPool())!;
    log(`[store] seeded database from snapshot`);
  }
  setPool(loaded);
  refreshedAt = loaded.refreshedAt;
  log(`[store] loaded ${current.players.length} players (${current.statsSeason} stats)`);

  if (!(opts.autoRefresh ?? isProductionDb())) return; // locally: `npm run refresh` by hand
  const check = async () => {
    const last = await lastSuccessfulRefresh();
    if (!last || Date.now() - last.getTime() > REFRESH_EVERY_MS) {
      await refresh(log).catch((err) => log(`[refresh] failed: ${(err as Error).message}`));
    }
  };
  void check();
  setInterval(() => void check(), CHECK_EVERY_MS).unref();
}
