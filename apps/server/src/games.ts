import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { chemistry, slotsFor, teamAbbreviation, type Player } from "@bb/shared";
import { autoLineup, DEFAULT_INNINGS, simulateGame, type GameHistory, type PlayedGame, type SimPlayer, type SimTeam } from "@bb/sim";
import { requireUser } from "./auth.ts";
import { getDb } from "./db/index.ts";
import { games, mlbTeams, userTeamPlayers, userTeams } from "./db/schema.ts";
import { findPlayer, pool } from "./store.ts";
import { playerFromDb } from "./team.ts";

const isPitcher = (p: Player) => p.ratings.role === "SP" || p.ratings.role === "RP";
const isHitter = (p: Player) => p.ratings.role === "H" || p.ratings.role === "TWP";

/** A player as the engine sees him, with chemistry-adjusted skills when given. */
function toSim(p: Player, skills: Record<string, number> = {}): SimPlayer {
  const h = p.ratings.hitting, pi = p.ratings.pitching;
  const v = (k: string, base: number) => skills[k] ?? base;
  return {
    id: p.id, name: p.name, lastName: p.lastName || p.name, position: p.position,
    bats: p.bats === "L" || p.bats === "S" ? p.bats : "R",
    batting: h && isHitter(p) ? { contact: v("contact", h.contact), power: v("power", h.power), eye: v("eye", h.eye), speed: v("speed", h.speed), fielding: v("fielding", h.fielding) } : null,
    pitching: pi && (isPitcher(p) || p.ratings.role === "TWP") ? { stuff: v("stuff", pi.stuff), control: v("control", pi.control), movement: v("movement", pi.movement), stamina: v("stamina", pi.stamina) } : null,
  };
}

/** Starter first (best starter, or a two-way player), then the rest best-first. */
function staff(pitchers: SimPlayer[], roles: Map<number, string>, overall: Map<number, number>): SimPlayer[] {
  const byOverall = [...pitchers].sort((a, b) => (overall.get(b.id) ?? 0) - (overall.get(a.id) ?? 0));
  const starter = byOverall.find((p) => roles.get(p.id) === "SP") ?? byOverall.find((p) => roles.get(p.id) === "TWP") ?? byOverall[0];
  return [starter, ...byOverall.filter((p) => p !== starter)];
}

/** The user's drafted team, with chemistry applied to every rating. */
export function userSimTeam(name: string, color: string, players: Player[], season: number): SimTeam {
  const chem = chemistry(players, season);
  const skills = new Map(chem.players.map((b) => [b.playerId, b.skills as Record<string, number>]));
  const sims = new Map(players.map((p) => [p.id, toSim(p, skills.get(p.id))]));
  const roles = new Map(players.map((p) => [p.id, p.ratings.role]));
  const overall = new Map(chem.players.map((b) => [b.playerId, b.effective]));
  return {
    name, abbr: teamAbbreviation(name), color,
    lineup: autoLineup(players.filter(isHitter).map((p) => sims.get(p.id)!)),
    pitchers: staff(players.filter((p) => isPitcher(p) || p.ratings.role === "TWP").map((p) => sims.get(p.id)!), roles, overall),
  };
}

/**
 * A real MLB team's best lineup: one at each infield spot, three outfielders, a DH, a starter and two more arms.
 * Players you drafted play for you now, so they're left off (`exclude`).
 */
export function mlbSimTeam(teamId: number, exclude: Set<number> = new Set()): SimTeam | null {
  const team = pool().teams.find((t) => t.id === teamId);
  if (!team) return null;
  const roster = pool().players.filter((p) => p.teamId === teamId && p.status === "Active" && !exclude.has(p.id)); // sorted best-first
  const chosen: Player[] = [];
  const take = (fits: (p: Player) => boolean, n = 1) => {
    for (const p of roster) {
      if (n === 0) break;
      if (!chosen.includes(p) && fits(p)) { chosen.push(p); n--; }
    }
  };
  for (const slot of ["C", "1B", "2B", "3B", "SS"]) take((p) => p.ratings.role === "H" && slotsFor({ position: p.position, role: p.ratings.role }).includes(slot as never));
  take((p) => p.ratings.role === "H" && slotsFor({ position: p.position, role: p.ratings.role })[0] === "OF", 3);
  take(isHitter, 9 - chosen.length); // DH and any spot a thin roster couldn't fill
  take((p) => p.ratings.role === "SP");
  take((p) => isPitcher(p), 2);
  const roles = new Map(chosen.map((p) => [p.id, p.ratings.role]));
  const overall = new Map(chosen.map((p) => [p.id, p.ratings.overall]));
  return {
    name: team.name, abbr: team.abbreviation, color: "#b8bcc6",
    lineup: autoLineup(chosen.filter((p) => p.ratings.role === "H" || p.ratings.role === "TWP").map((p) => toSim(p))),
    pitchers: staff(chosen.filter(isPitcher).map((p) => toSim(p)), roles, overall),
  };
}

function played(row: typeof games.$inferSelect, opponent: { id: number; name: string; abbr: string }): PlayedGame {
  const result = simulateGame({ away: row.teams.away, home: row.teams.home, seed: row.seed, innings: row.innings });
  return { id: row.id, createdAt: row.createdAt.toISOString(), opponent, userSide: row.userSide, teams: row.teams, result };
}

export async function gameRoutes(app: FastifyInstance) {
  app.post<{ Body: { opponentTeamId?: number } }>("/api/games", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const [team] = await db.select().from(userTeams).where(eq(userTeams.userId, req.user!.id));
    if (!team) return reply.code(400).send({ error: "Draft your team first." });
    if (team.status !== "ready") return reply.code(400).send({ error: "Finish your draft before playing." });

    const rows = await db.select({ playerId: userTeamPlayers.playerId }).from(userTeamPlayers).where(eq(userTeamPlayers.teamId, team.id));
    const opponent = mlbSimTeam(Number(req.body?.opponentTeamId), new Set(rows.map((r) => r.playerId)));
    if (!opponent) return reply.code(400).send({ error: "Pick an MLB team to play." });

    const players: Player[] = [];
    for (const r of rows) {
      const p = findPlayer(r.playerId) ?? (await playerFromDb(db, r.playerId));
      if (p) players.push(p);
    }
    const me = userSimTeam(team.name, team.color, players, pool().statsSeason || new Date().getUTCFullYear());
    // You're the home team: you always get the last at-bat.
    const teams = { away: opponent, home: me };
    const seed = randomInt(0, 2 ** 31 - 1);
    const result = simulateGame({ ...teams, seed, innings: DEFAULT_INNINGS });
    const outcome = result.winner === null ? "T" : result.winner === "home" ? "W" : "L";

    const [row] = await db.insert(games).values({
      userId: req.user!.id, teamId: team.id, opponentTeamId: Number(req.body!.opponentTeamId), seed, innings: DEFAULT_INNINGS,
      userSide: "home", teams, userScore: result.final.home, opponentScore: result.final.away, result: outcome,
    }).returning();
    const body: PlayedGame = { id: row.id, createdAt: row.createdAt.toISOString(), opponent: { id: Number(req.body!.opponentTeamId), name: opponent.name, abbr: opponent.abbr }, userSide: "home", teams, result };
    return reply.code(201).send(body);
  });

  app.get("/api/games", { preHandler: requireUser }, async (req): Promise<GameHistory> => {
    const db = getDb();
    const rows = await db.select({ g: games, t: mlbTeams }).from(games)
      .innerJoin(mlbTeams, eq(mlbTeams.id, games.opponentTeamId))
      .where(eq(games.userId, req.user!.id)).orderBy(desc(games.id));
    const record = { w: 0, l: 0, t: 0 };
    for (const { g } of rows) record[g.result === "W" ? "w" : g.result === "L" ? "l" : "t"]++;
    return {
      record,
      games: rows.slice(0, 20).map(({ g, t }) => ({
        id: g.id, createdAt: g.createdAt.toISOString(), opponent: { id: t.id, name: t.name, abbr: t.abbreviation },
        userScore: g.userScore, opponentScore: g.opponentScore, result: g.result,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/games/:id", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const [row] = await db.select({ g: games, t: mlbTeams }).from(games)
      .innerJoin(mlbTeams, eq(mlbTeams.id, games.opponentTeamId))
      .where(and(eq(games.id, Number(req.params.id)), eq(games.userId, req.user!.id)));
    if (!row) return reply.code(404).send({ error: "Game not found." });
    return played(row.g, { id: row.t.id, name: row.t.name, abbr: row.t.abbreviation });
  });
}
