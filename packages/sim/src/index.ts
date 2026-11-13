// Game engine. Pure functions only: same seed + same choices = same game,
// so the server and the browser always agree on what happened.

export { createRng, type Rng } from "./rng.ts";
export { autoLineup, CURRENT_RULES, DEFAULT_INNINGS, INNINGS_OPTIONS, isClutch, MAX_EXTRA_INNINGS, playInteractive, rallyAssist, simulateGame } from "./game.ts";
export { CALLS } from "./text.ts";
export type * from "./types.ts";
