// Pitch-start snapshots: just enough to rebuild a game after a reload, a backgrounded tab or a killed app.
// The snapshot is only a recipe (setup + the player's choices). The game itself is always rebuilt by
// replaying that log against the seed, so nothing saved here can disagree with the rules.

import { CURRENT_RULES, playInteractive, type InteractiveSetup, type UserInput } from "@bb/sim";

export const SNAPSHOT_SCHEMA = 1;
const KEY = "bb.resume";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export interface Snapshot {
  schema: number;
  /** Idempotency key for the finish upload; one per game, kept across resumes. */
  gameId: string;
  seasonId?: number;
  setup: InteractiveSetup;
  inputs: UserInput[];
  /** Epoch ms of the pitch this was taken at. */
  at: number;
}

export type Restored =
  | { ok: true; snapshot: Snapshot; balls: number; strikes: number; outs: number; inning: number; half: "top" | "bottom"; score: { away: number; home: number } }
  | { ok: false; message: string };

export const newGameId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const defaultStore = (): Store | null => { try { return localStorage; } catch { return null; } };

export function saveSnapshot(s: Snapshot, store: Store | null = defaultStore()): void {
  try { store?.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: resume just won't be offered */ }
}

export function clearSnapshot(store: Store | null = defaultStore()): void {
  try { store?.removeItem(KEY); } catch { /* ignore */ }
}

export function loadSnapshot(store: Store | null = defaultStore()): unknown {
  try { const raw = store?.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

const KID_MSG = "That game was saved by an older version, so we can't pick it up. Start a fresh one!";

/** Check a saved snapshot and prove it by replaying it. Anything that doesn't replay cleanly is discarded, never patched. */
export function restore(raw: unknown, now = Date.now()): Restored {
  if (!raw || typeof raw !== "object") return { ok: false, message: KID_MSG };
  const s = raw as Partial<Snapshot>;
  if (s.schema !== SNAPSHOT_SCHEMA || typeof s.gameId !== "string" || typeof s.at !== "number" || !Array.isArray(s.inputs) || !s.setup || typeof s.setup !== "object") {
    return { ok: false, message: KID_MSG };
  }
  const setup = s.setup;
  if (!Number.isInteger(setup.rules) || setup.rules < 1 || setup.rules > CURRENT_RULES) return { ok: false, message: KID_MSG };
  if (!setup.teams?.away || !setup.teams?.home || !Number.isInteger(setup.seed) || !Number.isInteger(setup.innings)) return { ok: false, message: KID_MSG };
  if (now - s.at > MAX_AGE_MS) return { ok: false, message: "That game is too old to pick up. Start a fresh one!" };
  try {
    const out = playInteractive({ away: setup.teams.away, home: setup.teams.home, seed: setup.seed, innings: setup.innings, rules: setup.rules, difficulty: setup.difficulty, userSide: setup.userSide, inputs: s.inputs, facts: true });
    if (out.result || !out.awaiting) return { ok: false, message: "That game was already finished." };
    const st = out.awaiting.state;
    return { ok: true, snapshot: s as Snapshot, balls: st.balls, strikes: st.strikes, outs: st.outs, inning: st.inning, half: st.half, score: st.score };
  } catch {
    return { ok: false, message: KID_MSG };
  }
}
