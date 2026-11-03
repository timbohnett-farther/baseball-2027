// Game engine. Pure functions only: same seed + same choices = same game,
// so the server and the browser always agree on what happened.

export { createRng, type Rng } from "./rng.ts";
