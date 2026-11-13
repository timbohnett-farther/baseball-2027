import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { TUTORIAL_REWARD, type TutorialCompleteRequest, type TutorialCompleteResponse } from "@bb/shared";
import { playInteractive, tutorialSetup } from "@bb/sim";
import { requireUser } from "./auth.ts";
import { getDb } from "./db/index.ts";
import { users } from "./db/schema.ts";
import { isInput } from "./games.ts";

/** Rookie Rally: a fixed-seed game that is never stored as a game; only the player's completion is. */
export async function tutorialRoutes(app: FastifyInstance) {
  app.post<{ Body: TutorialCompleteRequest }>("/api/tutorial/complete", { preHandler: requireUser }, async (req, reply) => {
    const inputs = req.body?.inputs;
    if (!Array.isArray(inputs) || inputs.length > 2000 || !inputs.every(isInput)) return reply.code(400).send({ error: "That tutorial can't be saved." });
    const s = tutorialSetup();
    let finished = false;
    try { finished = !playInteractive({ away: s.teams.away, home: s.teams.home, seed: s.seed, innings: s.innings, rules: s.rules, difficulty: s.difficulty, userSide: s.userSide, inputs }).awaiting; } catch { /* a log that doesn't fit throws mid-replay */ }
    if (!finished) return reply.code(400).send({ error: "Finish the practice game first." });
    const db = getDb();
    // The status flip and the coins are one statement, so a double submit pays once.
    const paid = await db.update(users).set({ tutorialStatus: "done", coins: sql`${users.coins} + ${TUTORIAL_REWARD}` })
      .where(and(eq(users.id, req.user!.id), or(isNull(users.tutorialStatus), ne(users.tutorialStatus, "done")))).returning({ coins: users.coins });
    if (paid.length) return { tutorial: "done", coins: paid[0].coins, reward: TUTORIAL_REWARD } satisfies TutorialCompleteResponse;
    const [row] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, req.user!.id));
    return { tutorial: "done", coins: row.coins, reward: 0 } satisfies TutorialCompleteResponse;
  });

  app.post("/api/tutorial/skip", { preHandler: requireUser }, async (req) => {
    // Skipping never downgrades a finished tutorial.
    await getDb().update(users).set({ tutorialStatus: "skipped" }).where(and(eq(users.id, req.user!.id), isNull(users.tutorialStatus)));
    const [row] = await getDb().select({ status: users.tutorialStatus }).from(users).where(eq(users.id, req.user!.id));
    return { tutorial: row.status };
  });
}
