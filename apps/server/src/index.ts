import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { HealthStatus } from "@bb/shared";
import { databaseStatus } from "./db.ts";
import { season, teams, teamSummaries } from "./rosters.ts";

const app = Fastify({ logger: true });

app.get("/health", async (): Promise<HealthStatus> => ({
  ok: true,
  database: await databaseStatus(),
  version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
}));

app.get("/api/teams", async () => ({ season, teams: teamSummaries() }));

app.get<{ Params: { id: string } }>("/api/teams/:id", async (req, reply) => {
  const team = teams.find((t) => t.id === Number(req.params.id));
  return team ?? reply.code(404).send({ error: "Team not found" });
});

// Serve the built browser app; unknown non-API paths fall back to index.html for client routing.
const webDist = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "Not found" });
  });
}

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
