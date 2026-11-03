import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  canAdd, draftStatus, salaryFor, TEAM_COLORS,
  type CreateTeamRequest, type DraftedPlayer, type DraftPick, type Me, type MyTeam, type Player,
} from "@bb/shared";
import { requireUser } from "./auth.ts";
import { getDb, type Db } from "./db/index.ts";
import { playerRatings, players, userTeamPlayers, userTeams } from "./db/schema.ts";
import { findPlayer } from "./store.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A drafted player who has since left the draft pool is still on your team: read him from the database. */
async function playerFromDb(db: Db | Tx, id: number): Promise<Player | null> {
  const [row] = await db.select().from(players)
    .innerJoin(playerRatings, eq(playerRatings.playerId, players.id))
    .where(eq(players.id, id)).orderBy(desc(playerRatings.season)).limit(1);
  if (!row) return null;
  const { players: p, player_ratings: r } = row;
  return {
    ...p, teamAbbr: null, status: p.inPool ? p.status : "Retired / not in pool",
    ratings: { overall: r.overall, role: r.role, hitting: r.hitting ?? null, pitching: r.pitching ?? null, sample: r.sample },
  };
}

async function teamPlayers(db: Db | Tx, teamId: number): Promise<DraftedPlayer[]> {
  const rows = await db.select().from(userTeamPlayers).where(eq(userTeamPlayers.teamId, teamId)).orderBy(userTeamPlayers.addedAt);
  const out: DraftedPlayer[] = [];
  for (const r of rows) {
    const p = findPlayer(r.playerId) ?? (await playerFromDb(db, r.playerId));
    if (p) out.push({ ...p, salary: r.salary });
  }
  return out;
}

const toPick = (p: DraftedPlayer): DraftPick => ({ playerId: p.id, position: p.position, role: p.ratings.role, salary: p.salary });

async function myTeam(db: Db | Tx, user: Me): Promise<MyTeam | null> {
  const [team] = await db.select().from(userTeams).where(eq(userTeams.userId, user.id));
  if (!team) return null;
  const roster = await teamPlayers(db, team.id);
  return { id: team.id, name: team.name, color: team.color, status: team.status, players: roster, draft: draftStatus(roster.map(toPick)) };
}

function cleanTeam(body: Partial<CreateTeamRequest> | undefined): { name?: string; color?: string; error?: string } {
  const name = body?.name === undefined ? undefined : String(body.name).trim().slice(0, 30);
  const color = body?.color === undefined ? undefined : String(body.color);
  if (name !== undefined && name.length < 2) return { error: "Team name: at least 2 characters." };
  if (color !== undefined && !(TEAM_COLORS as readonly string[]).includes(color)) return { error: "Pick one of the team colors." };
  return { name, color };
}

export async function teamRoutes(app: FastifyInstance) {
  app.get("/api/my-team", { preHandler: requireUser }, async (req, reply) =>
    (await myTeam(getDb(), req.user!)) ?? reply.code(404).send({ error: "No team yet." }));

  app.post<{ Body: CreateTeamRequest }>("/api/my-team", { preHandler: requireUser }, async (req, reply) => {
    const { name, color, error } = cleanTeam(req.body);
    if (error || !name || !color) return reply.code(400).send({ error: error ?? "Team name and color are required." });
    const db = getDb();
    if (await myTeam(db, req.user!)) return reply.code(409).send({ error: "You already have a team." });
    await db.insert(userTeams).values({ userId: req.user!.id, name, color });
    return reply.code(201).send(await myTeam(db, req.user!));
  });

  app.patch<{ Body: Partial<CreateTeamRequest> }>("/api/my-team", { preHandler: requireUser }, async (req, reply) => {
    const { name, color, error } = cleanTeam(req.body);
    if (error) return reply.code(400).send({ error });
    const db = getDb();
    await db.update(userTeams).set({ ...(name && { name }), ...(color && { color }), updatedAt: new Date() }).where(eq(userTeams.userId, req.user!.id));
    return (await myTeam(db, req.user!)) ?? reply.code(404).send({ error: "No team yet." });
  });

  app.post<{ Params: { playerId: string } }>("/api/my-team/players/:playerId", { preHandler: requireUser }, async (req, reply) => {
    const player = findPlayer(Number(req.params.playerId));
    if (!player) return reply.code(404).send({ error: "Player not found in the draft pool." });
    return getDb().transaction(async (tx) => {
      // Lock the team row so two quick clicks can't both spend the same budget.
      const [team] = await tx.select().from(userTeams).where(eq(userTeams.userId, req.user!.id)).for("update");
      if (!team) return reply.code(404).send({ error: "Create your team first." });
      const roster = await teamPlayers(tx, team.id);
      const salary = salaryFor(player.ratings.overall);
      const problem = canAdd(roster.map(toPick), { playerId: player.id, position: player.position, role: player.ratings.role, salary });
      if (problem) return reply.code(400).send({ error: problem });
      await tx.insert(userTeamPlayers).values({ teamId: team.id, playerId: player.id, salary });
      await tx.update(userTeams).set({ status: "drafting", updatedAt: new Date() }).where(eq(userTeams.id, team.id));
      return myTeam(tx, req.user!);
    });
  });

  app.delete<{ Params: { playerId: string } }>("/api/my-team/players/:playerId", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const [team] = await db.select().from(userTeams).where(eq(userTeams.userId, req.user!.id));
    if (!team) return reply.code(404).send({ error: "No team yet." });
    await db.delete(userTeamPlayers).where(and(eq(userTeamPlayers.teamId, team.id), eq(userTeamPlayers.playerId, Number(req.params.playerId))));
    await db.update(userTeams).set({ status: "drafting", updatedAt: new Date() }).where(eq(userTeams.id, team.id));
    return myTeam(db, req.user!);
  });

  app.post("/api/my-team/finish", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const team = await myTeam(db, req.user!);
    if (!team) return reply.code(404).send({ error: "No team yet." });
    if (!team.draft.ready) return reply.code(400).send({ error: team.draft.problems.join(" ") });
    await db.update(userTeams).set({ status: "ready", updatedAt: new Date() }).where(eq(userTeams.id, team.id));
    return { ...team, status: "ready" };
  });
}
