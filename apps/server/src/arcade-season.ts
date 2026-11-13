// Arcade season (format 2): seven games, a top-4 bracket and three stars a game. The pure rules live in
// @bb/shared (schedule, CPU games, standings) and @bb/sim (objectives); this file keeps them in the database.

import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  ARCADE_FORMAT, ARCADE_GAMES, ARCADE_REWARDS, MAX_SEASON_STARS, STYLE_INFO, UNLOCKS, buildLeague, computeStandings, cpuGame, cpuResults, finalSide, regularSide, semiPairs, semiSide,
  suggestedDifficulty, unlocksBetween,
  type ArcadeBracket, type ArcadeCareer, type ArcadeClub, type ArcadeFixture, type ArcadeLeague, type ArcadeOpponent, type ArcadeSeasonState, type ArcadeStanding,
  type BracketGame, type BracketSlot, type ClubProfile, type GameRow, type LifetimeTrack, type ObjectiveView, type SuggestedDifficulty, type Unlock,
} from "@bb/shared";
import { evaluateObjectives, objectiveDef, pickObjectives, type GameResult } from "@bb/sim";
import type { Db } from "./db/index.ts";
import { games, seasonGames, seasons, userItems, users, userTeams } from "./db/schema.ts";
import { teamPlayers, teamSummaries } from "./store.ts";
import type { SeasonRow } from "./season.ts";

const avg = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

/** Each club's real ratings boiled down to the five style measures. */
export function clubProfiles(): ClubProfile[] {
  return teamSummaries().map((t) => {
    const roster = teamPlayers(t.id).filter((p) => p.status === "Active");
    const hitters = roster.filter((p) => p.ratings.hitting).slice(0, 9);
    const arms = roster.filter((p) => p.ratings.pitching).slice(0, 4);
    const star = [...hitters].sort((a, b) => (b.ratings.hitting!.contact + b.ratings.hitting!.power + b.ratings.hitting!.speed) - (a.ratings.hitting!.contact + a.ratings.hitting!.power + a.ratings.hitting!.speed))[0];
    return {
      id: t.id, name: t.name, abbr: t.abbreviation, strength: t.strength,
      power: avg(hitters.map((p) => p.ratings.hitting!.power)), speed: avg(hitters.map((p) => p.ratings.hitting!.speed)),
      defense: avg(hitters.map((p) => p.ratings.hitting!.fielding)), contact: avg(hitters.map((p) => (p.ratings.hitting!.contact + p.ratings.hitting!.eye) / 2)),
      pitching: avg(arms.map((p) => (p.ratings.pitching!.stuff + p.ratings.pitching!.control + p.ratings.pitching!.movement) / 3)),
      star: star?.lastName ?? "Their ace",
    };
  });
}

/** Objective ids chain from the fixture before, so nothing repeats in consecutive games. */
function objectivesFor(seed: number, gameNo: number, style: string, previous: string[]): string[] {
  return pickObjectives(seed, gameNo, style, previous);
}

type Stars = { objectives: string[]; earned: string[] | null };

/** Start an arcade season: the seven-club league, the seven fixtures and their objectives. */
export async function startArcadeSeason(db: Db, userId: number, teamId: number, number: number): Promise<SeasonRow> {
  const seed = randomInt(0, 2 ** 31 - 1);
  const league = buildLeague(seed, clubProfiles());
  const [season] = await db.insert(seasons).values({ userId, teamId, number, seed, format: ARCADE_FORMAT, league }).returning();
  let previous: string[] = [];
  const rows = league.clubs.map((c, i) => {
    const objectives = objectivesFor(seed, i + 1, c.style, previous);
    previous = objectives;
    return { seasonId: season!.id, gameNo: i + 1, round: 0, opponentTeamId: c.id, userSide: regularSide(i + 1, number), stars: { objectives, earned: null } satisfies Stars };
  });
  await db.insert(seasonGames).values(rows);
  return season!;
}

interface UserGame { gameNo: number; round: number; opponentTeamId: number; gameId: number | null; result: "W" | "L" | "T" | null; userScore: number | null; opponentScore: number | null; difficulty: SuggestedDifficulty | null; stars: Stars | null }

async function userGames(db: Db, seasonId: number): Promise<UserGame[]> {
  const rows = await db.select({ sg: seasonGames, g: { userScore: games.userScore, opponentScore: games.opponentScore, difficulty: games.difficulty } }).from(seasonGames)
    .leftJoin(games, eq(games.id, seasonGames.gameId)).where(eq(seasonGames.seasonId, seasonId)).orderBy(seasonGames.gameNo);
  return rows.map(({ sg, g }) => ({ gameNo: sg.gameNo, round: sg.round, opponentTeamId: sg.opponentTeamId, gameId: sg.gameId, result: sg.result, userScore: g?.userScore ?? null, opponentScore: g?.opponentScore ?? null, difficulty: g?.difficulty ?? null, stars: sg.stars }));
}

async function lifetimeStars(db: Db, userId: number): Promise<number> {
  const rows = await db.select({ stars: seasonGames.stars }).from(seasonGames)
    .innerJoin(seasons, eq(seasons.id, seasonGames.seasonId)).where(and(eq(seasons.userId, userId), eq(seasons.format, ARCADE_FORMAT)));
  return rows.reduce((n, r) => n + (r.stars?.earned?.length ?? 0), 0);
}

function track(stars: number): LifetimeTrack {
  return { stars, track: UNLOCKS.map((u) => ({ ...u, earned: stars >= u.stars })), next: UNLOCKS.find((u) => u.stars > stars) ?? null };
}

const gameRows = (userRows: UserGame[]): GameRow[] => userRows.filter((g) => g.gameId !== null && g.round === 0)
  .map((g) => ({ home: 0, away: g.opponentTeamId, homeScore: g.userScore!, awayScore: g.opponentScore! }));

/** Standings from what has been played: the user's real games plus the CPU games of every finished round. */
function leagueStandings(season: SeasonRow, league: ArcadeLeague, userRows: UserGame[]) {
  const played = userRows.filter((g) => g.round === 0 && g.gameId !== null).length;
  const ids = [0, ...league.clubs.map((c) => c.id)];
  return { played, rows: computeStandings(ids, [...gameRows(userRows), ...cpuResults(league, played)], season.seed) };
}

/** The user's club as the league sees it (never simulated, so strength is only a placeholder). */
const userClub = (name: string): ArcadeClub => ({ id: 0, name, abbr: "YOU", strength: 0, style: "balanced", base: "balanced", star: "", rival: false });

function opponentView(c: ArcadeClub): ArcadeOpponent {
  return { id: c.id, name: c.name, abbr: c.abbr, style: c.style, styleLabel: STYLE_INFO[c.style].label, scouting: STYLE_INFO[c.style].scouting, star: c.star, rival: c.rival };
}

function objectiveViews(s: Stars | null): ObjectiveView[] {
  return (s?.objectives ?? []).map((id) => ({ id, label: objectiveDef(id)?.label ?? id, kind: objectiveDef(id)?.kind ?? "arcade", earned: s!.earned ? s!.earned.includes(id) : null }));
}

/** Bracket from the final standings: the CPU semi is played the moment the regular season ends. */
function bracketFor(season: SeasonRow, league: ArcadeLeague, topFour: number[], userRows: UserGame[], userName: string): ArcadeBracket {
  const club = (id: number) => id === 0 ? userClub(userName) : league.clubs.find((c) => c.id === id)!;
  const slot = (id: number, score: number | null): BracketSlot => ({ id, name: club(id).name, abbr: club(id).abbr, you: id === 0, score });
  const decide = (home: number, away: number, stage: number, round: number, label: string): BracketGame => {
    if (home === 0 || away === 0) {
      const g = [...userRows].reverse().find((r) => r.round === round && r.result !== "T" && r.gameId !== null);
      if (!g) return { label, home: slot(home, null), away: slot(away, null), winner: null };
      return { label, home: slot(0, g.userScore), away: slot(g.opponentTeamId, g.opponentScore), winner: g.result === "W" ? 0 : g.opponentTeamId };
    }
    const r = cpuGame(season.seed, stage, club(home), club(away));
    return { label, home: slot(home, r.homeScore), away: slot(away, r.awayScore), winner: r.homeScore > r.awayScore ? home : away };
  };
  const pairs = semiPairs(topFour);
  const semis = pairs.map(([h, a], i) => decide(h, a, 10 + i, 1, `Semifinal ${i + 1}`));
  // The user always plays at home in this engine, so the user's game is shown with the user first.
  const [w1, w2] = [semis[0]!.winner, semis[1]!.winner];
  let final: BracketGame = { label: "Final", home: null, away: null, winner: null };
  if (w1 !== null && w2 !== null) final = decide(w1, w2, 20, 2, "Final");
  return { semis, final };
}

export async function arcadeState(db: Db, season: SeasonRow): Promise<ArcadeSeasonState> {
  const league = season.league!;
  const userRows = await userGames(db, season.id);
  const [team] = await db.select({ name: userTeams.name }).from(userTeams).where(eq(userTeams.id, season.teamId));
  const userName = team?.name ?? "You";
  const club = (id: number) => league.clubs.find((c) => c.id === id)!;
  const { played, rows } = leagueStandings(season, league, userRows);
  const locked = played >= ARCADE_GAMES;
  const topFour = locked ? rows.slice(0, 4).map((r) => r.id) : [];
  const bracket = locked && topFour.includes(0) ? bracketFor(season, league, topFour, userRows, userName) : null;

  const standings: ArcadeStanding[] = rows.map((r) => ({
    ...r, name: r.id === 0 ? userName : club(r.id).name, abbr: r.id === 0 ? "YOU" : club(r.id).abbr, you: r.id === 0, rival: r.id !== 0 && club(r.id).rival,
    seed: locked && r.rank <= 4 ? r.rank : null, inPlayoffs: locked && r.rank <= 4,
  }));

  const schedule: ArcadeFixture[] = userRows.map((g) => ({
    gameNo: g.gameNo, round: g.round, label: g.round === 0 ? `Game ${g.gameNo}` : g.round === 1 ? "Semifinal" : "Final",
    opponent: opponentView(club(g.opponentTeamId)), gameId: g.gameId, result: g.result, userScore: g.userScore, opponentScore: g.opponentScore,
    objectives: objectiveViews(g.stars), stars: g.stars?.earned?.length ?? 0, difficulty: g.difficulty, suggested: suggestedDifficulty(g.gameNo - 1, g.round > 0),
  }));
  const next = season.status === "done" ? null : schedule.find((g) => g.gameId === null) ?? null;

  const me = rows.find((r) => r.id === 0)!;
  let placement: ArcadeSeasonState["placement"] = null;
  if (season.status === "done") {
    const lastRound = Math.max(...userRows.filter((g) => g.gameId !== null).map((g) => g.round));
    placement = season.champion ? { place: 1, label: "Champion" }
      : lastRound === 2 ? { place: 2, label: "Runner-up" }
      : lastRound === 1 ? { place: 3, label: "Semifinalist" }
      : { place: me.rank, label: "Missed the playoffs" };
  }
  const order: SuggestedDifficulty[] = ["rookie", "pro", "allstar"];
  const used = userRows.map((g) => g.difficulty).filter((d): d is SuggestedDifficulty => !!d);
  const highest = used.length ? order[Math.max(...used.map((d) => order.indexOf(d)))]! : null;
  const seasonStars = userRows.reduce((n, g) => n + (g.stars?.earned?.length ?? 0), 0);
  return {
    format: 2, id: season.id, number: season.number, status: season.status,
    record: { w: season.wins, l: season.losses, t: season.ties }, played, schedule, next, standings, bracket,
    champion: season.champion, placement, rewardCoins: season.rewardCoins,
    stars: { season: seasonStars, max: MAX_SEASON_STARS }, highestDifficulty: highest, lifetime: track(await lifetimeStars(db, season.userId)),
  };
}

export interface ArcadeSettled {
  /** Coins from season milestones (finishing, berth, bracket wins, title). */
  season: number;
  stars: number;
  unlockCoins: number;
  objectives: ObjectiveView[];
  unlocks: Unlock[];
  lifetimeStars: number;
}

/** After a season game is recorded: credit its stars, advance the season, pay bonuses and grant unlocks. */
export async function settleArcade(db: Db, season: SeasonRow, gameId: number, outcome: "W" | "L" | "T", result: GameResult, side: "home" | "away" = "home"): Promise<ArcadeSettled | null> {
  const league = season.league!;
  const [next] = await db.select().from(seasonGames).where(and(eq(seasonGames.seasonId, season.id), isNull(seasonGames.gameId))).orderBy(seasonGames.gameNo).limit(1);
  if (!next) return null;
  const objectives = next.stars?.objectives ?? ["win"];
  // A tied playoff game is replayed, so only the game that decides a fixture pays stars.
  const earned = outcome === "T" && next.round > 0 ? [] : evaluateObjectives(objectives, result, side);
  const stars: Stars = { objectives, earned };
  const before = await lifetimeStars(db, season.userId);
  await db.update(seasonGames).set({ gameId, result: outcome, stars }).where(and(eq(seasonGames.seasonId, season.id), eq(seasonGames.gameNo, next.gameNo)));

  let bonus = 0;
  const patch: Partial<SeasonRow> = {};
  const addRow = (gameNo: number, round: number, opponentTeamId: number, userSide: "home" | "away") => {
    const prev = objectives.filter((o) => o !== "win");
    const style = league.clubs.find((c) => c.id === opponentTeamId)!.style;
    return db.insert(seasonGames).values({ seasonId: season.id, gameNo, round, opponentTeamId, userSide, stars: { objectives: round === next.round && outcome === "T" ? objectives : ["win", ...pickObjectives(season.seed, gameNo, style, prev).slice(1)], earned: null } });
  };

  if (next.round === 0) {
    const wins = season.wins + (outcome === "W" ? 1 : 0), losses = season.losses + (outcome === "L" ? 1 : 0), ties = season.ties + (outcome === "T" ? 1 : 0);
    Object.assign(patch, { wins, losses, ties });
    if (wins + losses + ties >= ARCADE_GAMES) {
      bonus += ARCADE_REWARDS.regular;
      const rows = await userGames(db, season.id);
      const ids = [0, ...league.clubs.map((c) => c.id)];
      const table = computeStandings(ids, [...gameRows(rows), ...cpuResults(league, ARCADE_GAMES)], season.seed);
      const top = table.slice(0, 4).map((r) => r.id);
      if (top.includes(0)) {
        bonus += ARCADE_REWARDS.berth;
        const [home, away] = semiPairs(top).find((p) => p.includes(0))!;
        await addRow(ARCADE_GAMES + 1, 1, home === 0 ? away : home, semiSide(top.indexOf(0), top.indexOf(home === 0 ? away : home)));
        Object.assign(patch, { status: "playoffs", playoffRound: 1 });
      } else {
        Object.assign(patch, { status: "done", finishedAt: new Date() });
      }
    }
  } else {
    if (outcome === "T") {
      const [{ last }] = await db.select({ last: sql<number>`max(${seasonGames.gameNo})` }).from(seasonGames).where(eq(seasonGames.seasonId, season.id));
      await addRow(Number(last) + 1, next.round, next.opponentTeamId, side);
    } else if (outcome === "L") {
      Object.assign(patch, { status: "done", playoffLosses: season.playoffLosses + 1, finishedAt: new Date() });
    } else if (next.round === 1) {
      bonus += ARCADE_REWARDS.semi;
      const rows = await userGames(db, season.id);
      const ids = [0, ...league.clubs.map((c) => c.id)];
      const top = computeStandings(ids, [...gameRows(rows), ...cpuResults(league, ARCADE_GAMES)], season.seed).slice(0, 4).map((r) => r.id);
      const pairs = semiPairs(top);
      const otherIdx = pairs.findIndex((p) => !p.includes(0));
      const [h, a] = pairs[otherIdx]!;
      const clubOf = (id: number) => league.clubs.find((c) => c.id === id)!;
      const r = cpuGame(season.seed, 10 + otherIdx, clubOf(h), clubOf(a));
      const rival = r.homeScore > r.awayScore ? h : a;
      await addRow(next.gameNo + 1, 2, rival, finalSide(side, rival === h ? "home" : "away", top.indexOf(0), top.indexOf(rival)));
      Object.assign(patch, { playoffRound: 2, playoffWins: 1 });
    } else {
      bonus += ARCADE_REWARDS.champion;
      Object.assign(patch, { status: "done", champion: true, playoffWins: season.playoffWins + 1, finishedAt: new Date() });
    }
  }

  const starCoins = earned.length * ARCADE_REWARDS.perStar;
  const after = before + earned.length;
  const unlocks = unlocksBetween(before, after);
  let unlockCoins = 0;
  for (const u of unlocks) {
    if (u.kind === "item") await db.insert(userItems).values({ userId: season.userId, itemId: u.itemId! }).onConflictDoNothing();
    else unlockCoins += u.coins ?? 0;
  }
  const coins = bonus + starCoins + unlockCoins;
  if (bonus > 0) patch.rewardCoins = season.rewardCoins + bonus;
  if (coins > 0) await db.update(users).set({ coins: sql`${users.coins} + ${coins}` }).where(eq(users.id, season.userId));
  if (Object.keys(patch).length) await db.update(seasons).set(patch).where(eq(seasons.id, season.id));
  return { season: bonus, stars: starCoins, unlockCoins, objectives: objectiveViews(stars), unlocks, lifetimeStars: after };
}

/** Lifetime stars, the unlock track and how past arcade seasons ended. */
export async function arcadeCareer(db: Db, userId: number): Promise<ArcadeCareer> {
  const mine = await db.select().from(seasons).where(eq(seasons.userId, userId)).orderBy(seasons.id);
  const out: ArcadeCareer["seasons"] = [];
  for (const s of mine) {
    if (s.format !== ARCADE_FORMAT) { out.push({ number: s.number, place: null, champion: s.champion, stars: 0, record: { w: s.wins, l: s.losses, t: s.ties }, format: s.format }); continue; }
    const rows = await userGames(db, s.id);
    const lastRound = Math.max(-1, ...rows.filter((g) => g.gameId !== null).map((g) => g.round));
    let place: number | null = null;
    if (s.status === "done") {
      if (s.champion) place = 1; else if (lastRound === 2) place = 2; else if (lastRound === 1) place = 3;
      else place = leagueStandings(s, s.league!, rows).rows.find((r) => r.id === 0)!.rank;
    }
    out.push({ number: s.number, place, champion: s.champion, stars: rows.reduce((n, g) => n + (g.stars?.earned?.length ?? 0), 0), record: { w: s.wins, l: s.losses, t: s.ties }, format: s.format });
  }
  return { lifetime: track(await lifetimeStars(db, userId)), seasons: out };
}
