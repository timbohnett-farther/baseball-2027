import { resolve } from "node:path";

// This file sits one level below apps/server in dev (src/) and is bundled into dist/ in production,
// so ".." is apps/server either way.
export const serverRoot = resolve(import.meta.dirname, "..");
export const repoRoot = resolve(serverRoot, "../..");
export const migrationsDir = resolve(serverRoot, "drizzle");
export const webDist = resolve(repoRoot, "apps/web/dist");
export const snapshotFile = resolve(repoRoot, "data/players.json");
