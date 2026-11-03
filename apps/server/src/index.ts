import { buildApp } from "./app.ts";
import { initDb } from "./db/index.ts";
import { startStore } from "./store.ts";

await initDb();
const app = await buildApp({ logger: true });
await startStore((msg) => app.log.info(msg));

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
