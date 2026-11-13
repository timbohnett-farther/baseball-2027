// Game engine. Pure functions only: same seed + same choices = same game,
// so the server and the browser always agree on what happened.

export { createRng, type Rng } from "./rng.ts";
export { autoLineup, CURRENT_RULES, DEFAULT_INNINGS, INNINGS_OPTIONS, isClutch, MAX_EXTRA_INNINGS, playInteractive, rallyAssist, simulateGame } from "./game.ts";
export { ABILITIES, BOUNDS, arm, cancel, check, combine, commit, expire, newLedger, statuses } from "./ability.ts";
export type { AbilityDef, Actor, Effects, Ledger, Verdict } from "./ability.ts";
export { CALLS } from "./text.ts";
export type * from "./types.ts";
