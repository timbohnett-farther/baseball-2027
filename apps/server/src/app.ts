import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { HealthStatus } from "@bb/shared";
import { attachUser, authRoutes } from "./auth.ts";
import { databaseStatus, migrationsApplied } from "./db/index.ts";
import { webDist } from "./paths.ts";
import { dataRefreshedAt, pool, teamPlayers, teamSummaries } from "./store.ts";
import { gameRoutes } from "./games.ts";
import { seasonRoutes } from "./season.ts";
import { shopRoutes } from "./shop.ts";
import { teamRoutes } from "./team.ts";
import { tutorialRoutes } from "./tutorial.ts";

/** Build the HTTP app. The database and player store must already be started. */
export async function buildApp(opts: { logger?: boolean; webRoot?: string } = {}) {
  const root = opts.webRoot ?? webDist;
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  await app.register(fastifyCookie);
  attachUser(app);

  app.get("/health", async (): Promise<HealthStatus> => ({
    ok: true,
    database: await databaseStatus(),
    migrations: await migrationsApplied(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    dataRefreshedAt: dataRefreshedAt()?.toISOString() ?? null,
  }));

  app.get("/api/teams", async () => ({ season: pool().statsSeason, teams: teamSummaries() }));

  app.get<{ Params: { id: string } }>("/api/teams/:id", async (req, reply) => {
    const team = pool().teams.find((t) => t.id === Number(req.params.id));
    if (!team) return reply.code(404).send({ error: "Team not found" });
    return { ...team, players: teamPlayers(team.id) };
  });

  /** The draft pool. Filters: ?position=SS&team=NYY&role=SP&q=judge&limit=50 */
  app.get<{ Querystring: { position?: string; team?: string; role?: string; q?: string; limit?: string } }>("/api/players", async (req) => {
    const { position, team, role, q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 2000);
    const needle = q?.toLowerCase();
    const outfield = ["LF", "CF", "RF", "OF"];
    const players = pool().players.filter((p) =>
      (!position || (position === "OF" ? outfield.includes(p.position) : p.position === position)) &&
      (!team || (team === "FA" ? p.teamId === null : p.teamAbbr === team)) &&
      (!role || p.ratings.role === role) &&
      (!needle || p.name.toLowerCase().includes(needle)));
    return { season: pool().statsSeason, total: players.length, players: players.slice(0, limit) };
  });

  app.get<{ Params: { id: string } }>("/api/players/:id", async (req, reply) =>
    pool().players.find((p) => p.id === Number(req.params.id)) ?? reply.code(404).send({ error: "Player not found" }));

  await app.register(authRoutes);
  await app.register(teamRoutes);
  await app.register(gameRoutes);
  await app.register(shopRoutes);
  await app.register(seasonRoutes);
  await app.register(tutorialRoutes);

  // Serve the built browser app; unknown non-API paths fall back to index.html for client routing.
  if (existsSync(root)) {
    await app.register(fastifyStatic, {
      root,
      cacheControl: false,
      // The worker, the shell page and the manifest must revalidate every time or a deploy never reaches installed copies;
      // /assets/* is content-hashed, so it can be cached for good; everything else (icons, shell) revalidates.
      setHeaders(res, path) {
        if (/[\\/]assets[\\/]/.test(path)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else res.setHeader("Cache-Control", "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  }
  return app;
}
