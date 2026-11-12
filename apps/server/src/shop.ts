import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  BAT_BY_ID, DEFAULT_WOOD, isWoodSpec, SUPER_BATS,
  type BuyRequest, type Gear, type GearRequest, type StoreState,
} from "@bb/shared";
import { requireUser } from "./auth.ts";
import { getDb } from "./db/index.ts";
import { games, userItems, userTeams, users } from "./db/schema.ts";

const DEFAULT_GEAR: Gear = { wood: DEFAULT_WOOD, superBat: null };

export async function shopRoutes(app: FastifyInstance) {
  app.get("/api/store", { preHandler: requireUser }, async (req): Promise<StoreState> => {
    const db = getDb();
    const userId = req.user!.id;
    const [me] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId));
    const owned = (await db.select({ id: userItems.itemId }).from(userItems).where(eq(userItems.userId, userId))).map((r) => r.id);
    const [team] = await db.select({ gear: userTeams.gear }).from(userTeams).where(eq(userTeams.userId, userId));
    const [{ wins }] = await db.select({ wins: sql<number>`count(*)::int` }).from(games)
      .where(and(eq(games.userId, userId), eq(games.result, "W")));
    return { coins: me?.coins ?? 0, owned, gear: team?.gear ?? DEFAULT_GEAR, bats: SUPER_BATS, wins };
  });

  app.post<{ Body: BuyRequest }>("/api/store/buy", { preHandler: requireUser }, async (req, reply) => {
    const bat = BAT_BY_ID[String(req.body?.batId)];
    if (!bat) return reply.code(400).send({ error: "No such bat." });
    if (bat.tier === "legendary") return reply.code(400).send({ error: "Legendary bats can't be bought. Win games to earn one." });
    const userId = req.user!.id;
    // Deduct and grant together so a double-click can't buy twice or go negative.
    const result = await getDb().transaction(async (tx) => {
      const [has] = await tx.select().from(userItems).where(and(eq(userItems.userId, userId), eq(userItems.itemId, bat.id)));
      if (has) return "owned" as const;
      const [paid] = await tx.update(users).set({ coins: sql`${users.coins} - ${bat.price}` })
        .where(and(eq(users.id, userId), sql`${users.coins} >= ${bat.price}`)).returning({ coins: users.coins });
      if (!paid) return "poor" as const;
      await tx.insert(userItems).values({ userId, itemId: bat.id });
      return paid.coins;
    });
    if (result === "owned") return reply.code(400).send({ error: "You already own that bat." });
    if (result === "poor") return reply.code(400).send({ error: `Not enough coins. ${bat.name} costs ${bat.price}.` });
    return { coins: result, batId: bat.id };
  });

  app.post<{ Body: GearRequest }>("/api/my-team/gear", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const userId = req.user!.id;
    const [team] = await db.select({ id: userTeams.id, gear: userTeams.gear }).from(userTeams).where(eq(userTeams.userId, userId));
    if (!team) return reply.code(404).send({ error: "No team yet." });
    const gear: Gear = { ...(team.gear ?? DEFAULT_GEAR) };
    const body = req.body ?? {};
    if (body.wood !== undefined) {
      if (!isWoodSpec(body.wood)) return reply.code(400).send({ error: "That's not a bat we make." });
      gear.wood = body.wood;
    }
    if (body.superBat !== undefined) {
      if (body.superBat !== null) {
        const id = String(body.superBat);
        const [has] = await db.select().from(userItems).where(and(eq(userItems.userId, userId), eq(userItems.itemId, id)));
        if (!has) return reply.code(400).send({ error: "You don't own that bat." });
        gear.superBat = id;
      } else gear.superBat = null;
    }
    await db.update(userTeams).set({ gear, updatedAt: new Date() }).where(eq(userTeams.id, team.id));
    return gear;
  });
}
