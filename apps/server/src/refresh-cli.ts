// Manual refresh: `npm run refresh`.
// Saves to the database (Railway Postgres if DATABASE_URL is set, otherwise the local one)
// and rewrites data/players.json, the snapshot used to seed empty databases.

import { writeFileSync } from "node:fs";
import { buildPlayerPool } from "./mlb/pool.ts";
import { closeDb, initDb, recordRefresh } from "./db/index.ts";
import { snapshotFile } from "./paths.ts";

await initDb();
const pool = await recordRefresh(() => buildPlayerPool(), (p) => p);
writeFileSync(snapshotFile, JSON.stringify(pool));
console.log(`[refresh] saved to database and wrote ${snapshotFile}`);
await closeDb();
