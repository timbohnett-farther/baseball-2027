import { eq, sql } from "drizzle-orm";
import type { CoinLedgerEntry } from "@bb/shared";
import type { Db } from "./db/index.ts";
import { coinLedger, users } from "./db/schema.ts";

export interface CoinLine { delta: number; kind: CoinLedgerEntry["kind"]; gameId?: number }

/**
 * Add coins and write one ledger row per line in the same transaction, so the wallet always equals the sum of the ledger.
 * Returns the balance afterwards. Lines of zero or less are skipped.
 */
export async function creditCoins(db: Db, userId: number, lines: CoinLine[]): Promise<number> {
  const paid = lines.filter((l) => l.delta > 0);
  return db.transaction(async (tx) => {
    const total = paid.reduce((n, l) => n + l.delta, 0);
    const [row] = await tx.update(users).set({ coins: sql`${users.coins} + ${total}` }).where(eq(users.id, userId)).returning({ coins: users.coins });
    await writeLines(tx, userId, paid, row.coins);
    return row.coins;
  });
}

/** Insert ledger rows for lines already added to the wallet; `balance` is the wallet after the last line. */
export async function writeLines(tx: Pick<Db, "insert">, userId: number, lines: CoinLine[], balance: number) {
  let left = balance - lines.reduce((n, l) => n + l.delta, 0);
  for (const l of lines) {
    left += l.delta;
    await tx.insert(coinLedger).values({ userId, delta: l.delta, kind: l.kind, gameId: l.gameId ?? null, balanceAfter: left });
  }
}
