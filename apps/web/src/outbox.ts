// Finished games that couldn't reach the server (no signal at the final out). Each carries the browser's
// game id, which the server uses to refuse a second payout if an earlier try actually landed.

const KEY = "bb.outbox";

export interface Pending {
  gameId: string;
  /** Body for POST /api/games/interactive/finish, clientGameId included. */
  body: Record<string, unknown>;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const defaultStore = (): Store | null => { try { return localStorage; } catch { return null; } };

export function readOutbox(store: Store | null = defaultStore()): Pending[] {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p): p is Pending => !!p && typeof p.gameId === "string" && !!p.body) : [];
  } catch { return []; }
}

function write(items: Pending[], store: Store | null) {
  try { if (items.length) store?.setItem(KEY, JSON.stringify(items)); else store?.removeItem(KEY); } catch { /* ignore */ }
}

export function enqueue(p: Pending, store: Store | null = defaultStore()): void {
  write([...readOutbox(store).filter((q) => q.gameId !== p.gameId), p], store);
}

export function dequeue(gameId: string, store: Store | null = defaultStore()): void {
  write(readOutbox(store).filter((q) => q.gameId !== gameId), store);
}

/** HTTP statuses that mean "retrying will never help": the server understood and refused (bad data, lineup changed). */
export const isFinal = (status: number | undefined): boolean => status === 400 || status === 409 || status === 404;

/**
 * Try to upload every queued game once. `send` resolves on success and rejects with an error carrying an optional
 * `status`. Success and final refusals leave the queue; network errors, 5xx and 401 (signed out) stay for next time.
 */
export async function flush(send: (body: Pending["body"]) => Promise<unknown>, store: Store | null = defaultStore()): Promise<{ sent: number; dropped: number; left: number }> {
  let sent = 0, dropped = 0;
  for (const p of readOutbox(store)) {
    try { await send(p.body); dequeue(p.gameId, store); sent++; }
    catch (e) {
      if (isFinal((e as { status?: number }).status)) { dequeue(p.gameId, store); dropped++; }
    }
  }
  return { sent, dropped, left: readOutbox(store).length };
}
