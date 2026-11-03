// Manual refresh: `npm run refresh`.
// Always writes data/players.json (the fallback used when there's no database, e.g. local dev);
// also saves to Postgres when DATABASE_URL is set.

import { writeFileSync } from "node:fs";
import { buildPlayerPool } from "./mlb/pool.ts";
import { closeDb, db, migrateDb, recordRefresh } from "./db/index.ts";
import { snapshotFile } from "./paths.ts";

await migrateDb();
const pool = db ? await recordRefresh(() => buildPlayerPool(), (p) => p) : await buildPlayerPool();
writeFileSync(snapshotFile, JSON.stringify(pool));
console.log(`[refresh] wrote ${snapshotFile}${db ? " and saved to database" : ""}`);
await closeDb();
