import { randomInt } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { PLAYOFF_ROUNDS, ROUND_WINS, SEASON_LENGTH, SEASON_REWARDS, type SeasonGame, type SeasonState, type Standing } from "@bb/shared";
import { createRng } from "@bb/sim";
import { requireUser } from "./auth.ts";
import { getDb, type Db } from "./db/index.ts";
import { games, mlbTeams, seasonGames, seasons, users, userTeams } from "./db/schema.ts";
import { teamSummaries } from "./store.ts";

export type SeasonRow = typeof seasons.$inferSelect;

/** The user's latest season, if any. */
async function latest(db: Db, userId: number): Promise<SeasonRow | undefined> {
  const [row] = await db.select().from(seasons).where(eq(seasons.userId, userId)).orderBy(desc(seasons.id)).limit(1);
  return row;
}

/** The next unplayed game of a season, in schedule order. */
async function nextGame(db: Db, seasonId: number) {
  const [row] = await db.select().from(seasonGames)
    .where(and(eq(seasonGames.seasonId, seasonId), isNull(seasonGames.gameId)))
    .orderBy(seasonGames.gameNo).limit(1);
  return row;
}

/**
 * Before a game is played: the season must be the user's, still running, and its next game must be
 * against this opponent. Returns the season or the reason it can't be played.
 */
export async function seasonMatch(db: Db, userId: number, seasonId: unknown, opponentTeamId: number): Promise<{ error: string } | { season: SeasonRow }> {
  const [season] = await db.select().from(seasons).where(and(eq(seasons.id, Number(seasonId)), eq(seasons.userId, userId)));
  if (!season || season.status === "done") return { error: "That season is over." };
  const next = await nextGame(db, season.id);
  if (!next || next.opponentTeamId !== opponentTeamId) return { error: "That's not your next season game." };
  return { season };
}

/** Playoff opponents by round: the 3rd, 2nd, then strongest club. */
function playoffOpponent(round: number): number {
  const ranked = teamSummaries().sort((a, b) => b.strength - a.strength);
  return ranked[Math.max(0, PLAYOFF_ROUNDS - round)]!.id;
}

/**
 * After a game is recorded: link it into the season, advance the season, and pay season bonuses.
 * Bonuses are the only coins this file adds; returns what was paid (0 most games).
 */
export async function settleSeason(db: Db, season: SeasonRow, gameId: number, outcome: "W" | "L" | "T"): Promise<number> {
  const next = await nextGame(db, season.id);
  if (!next) return 0;
  await db.update(seasonGames).set({ gameId, result: outcome })
    .where(and(eq(seasonGames.seasonId, season.id), eq(seasonGames.gameNo, next.gameNo)));

  let bonus = 0;
  const patch: Partial<SeasonRow> = {};
  if (season.status === "regular") {
    const wins = season.wins + (outcome === "W" ? 1 : 0), losses = season.losses + (outcome === "L" ? 1 : 0), ties = season.ties + (outcome === "T" ? 1 : 0);
    Object.assign(patch, { wins, losses, ties });
    if (wins + losses + ties >= SEASON_LENGTH) {
      bonus += SEASON_REWARDS.regular;
      if (wins > losses) {
        bonus += SEASON_REWARDS.berth;
        Object.assign(patch, { status: "playoffs", playoffRound: 1 });
        await scheduleRound(db, season.id, 1, next.gameNo);
      } else {
        Object.assign(patch, { status: "done", finishedAt: new Date() });
      }
    }
  } else if (season.status === "playoffs") {
    // A tie doesn't count in a series: add another game to the end of it.
    if (outcome === "T") {
      const [{ last }] = await db.select({ last: sql<number>`max(${seasonGames.gameNo})` }).from(seasonGames).where(eq(seasonGames.seasonId, season.id));
      await db.insert(seasonGames).values({ seasonId: season.id, gameNo: Number(last) + 1, round: season.playoffRound, opponentTeamId: next.opponentTeamId });
    } else {
      const pw = season.playoffWins + (outcome === "W" ? 1 : 0), pl = season.playoffLosses + (outcome === "L" ? 1 : 0);
      Object.assign(patch, { playoffWins: pw, playoffLosses: pl });
      if (pw >= ROUND_WINS) {
        // Round won: drop the unplayed games of this series.
        await db.delete(seasonGames).where(and(eq(seasonGames.seasonId, season.id), isNull(seasonGames.gameId)));
        bonus += SEASON_REWARDS.round[season.playoffRound - 1] ?? 0;
        if (season.playoffRound >= PLAYOFF_ROUNDS) {
          bonus += SEASON_REWARDS.champion;
          Object.assign(patch, { status: "done", champion: true, finishedAt: new Date() });
        } else {
          Object.assign(patch, { playoffRound: season.playoffRound + 1, playoffWins: 0, playoffLosses: 0 });
          await scheduleRound(db, season.id, season.playoffRound + 1, next.gameNo);
        }
      } else if (pl >= ROUND_WINS) {
        await db.delete(seasonGames).where(and(eq(seasonGames.seasonId, season.id), isNull(seasonGames.gameId)));
        Object.assign(patch, { status: "done", finishedAt: new Date() });
      }
    }
  }
  if (bonus > 0) {
    patch.rewardCoins = season.rewardCoins + bonus;
    await db.update(users).set({ coins: sql`${users.coins} + ${bonus}` }).where(eq(users.id, season.userId));
  }
  if (Object.keys(patch).length) await db.update(seasons).set(patch).where(eq(seasons.id, season.id));
  return bonus;
}

/** Best-of-3 series slots, numbered after the last game played. */
async function scheduleRound(db: Db, seasonId: number, round: number, afterGameNo: number) {
  const opponentTeamId = playoffOpponent(round);
  await db.insert(seasonGames).values(Array.from({ length: ROUND_WINS * 2 - 1 }, (_, i) => ({ seasonId, gameNo: afterGameNo + 1 + i, round, opponentTeamId })));
}

/**
 * League standings. The other clubs' records come from the season seed and their strength, filled
 * in at the same pace as the user's own games, so the table reads like a real race (cosmetic only).
 */
function standings(season: SeasonRow, played: number, meName: string): Standing[] {
  const clubs = teamSummaries();
  const lo = Math.min(...clubs.map((c) => c.strength)), hi = Math.max(...clubs.map((c) => c.strength)) || 1;
  const rng = createRng(season.seed ^ 0x5ea50);
  const rows: Standing[] = clubs.map((c) => {
    const p = 0.32 + 0.36 * ((c.strength - lo) / Math.max(1, hi - lo)) + (rng.next() - 0.5) * 0.12;
    const w = Math.round(played * Math.min(0.85, Math.max(0.15, p)));
    return { id: c.id, name: c.name, abbr: c.abbreviation, w, l: played - w, you: false };
  });
  rows.push({ id: 0, name: meName, abbr: "YOU", w: season.wins, l: season.losses, you: true });
  return rows.sort((a, b) => b.w - a.w || a.l - b.l || a.name.localeCompare(b.name));
}

async function state(db: Db, season: SeasonRow): Promise<SeasonState> {
  const rows = await db.select({ sg: seasonGames, t: mlbTeams, g: { userScore: games.userScore, opponentScore: games.opponentScore } }).from(seasonGames)
    .innerJoin(mlbTeams, eq(mlbTeams.id, seasonGames.opponentTeamId))
    .leftJoin(games, eq(games.id, seasonGames.gameId))
    .where(eq(seasonGames.seasonId, season.id)).orderBy(seasonGames.gameNo);
  const schedule: SeasonGame[] = rows.map(({ sg, t, g }) => ({
    gameNo: sg.gameNo, round: sg.round, opponent: { id: t.id, name: t.name, abbr: t.abbreviation },
    gameId: sg.gameId, result: sg.result, userScore: g?.userScore ?? null, opponentScore: g?.opponentScore ?? null,
  }));
  const [team] = await db.select({ name: userTeams.name }).from(userTeams).where(eq(userTeams.id, season.teamId));
  const regularPlayed = schedule.filter((g) => g.round === 0 && g.gameId !== null).length;
  return {
    id: season.id, number: season.number, status: season.status,
    record: { w: season.wins, l: season.losses, t: season.ties },
    playoffRound: season.playoffRound, playoffWins: season.playoffWins, playoffLosses: season.playoffLosses,
    champion: season.champion, rewardCoins: season.rewardCoins,
    eliminated: season.status === "done" && !season.champion,
    schedule, next: season.status === "done" ? null : schedule.find((g) => g.gameId === null) ?? null,
    standings: standings(season, regularPlayed, team?.name ?? "You"),
  };
}

export async function seasonRoutes(app: FastifyInstance) {
  app.get("/api/season", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const season = await latest(db, req.user!.id);
    if (!season) return reply.code(404).send({ error: "No season yet." });
    return state(db, season);
  });

  // Start a season: 20 clubs drawn from the league by the season seed.
  app.post("/api/season", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const [team] = await db.select().from(userTeams).where(eq(userTeams.userId, req.user!.id));
    if (!team) return reply.code(400).send({ error: "Draft your team first." });
    if (team.status !== "ready") return reply.code(400).send({ error: "Finish your draft before starting a season." });
    const current = await latest(db, req.user!.id);
    if (current && current.status !== "done") return reply.code(400).send({ error: "Finish your current season first." });

    const seed = randomInt(0, 2 ** 31 - 1);
    const rng = createRng(seed);
    const ids = teamSummaries().map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = rng.int(0, i); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
    const [season] = await db.insert(seasons).values({ userId: req.user!.id, teamId: team.id, number: (current?.number ?? 0) + 1, seed }).returning();
    await db.insert(seasonGames).values(ids.slice(0, SEASON_LENGTH).map((opponentTeamId, i) => ({ seasonId: season!.id, gameNo: i + 1, round: 0, opponentTeamId })));
    return reply.code(201).send(await state(db, season!));
  });
}
