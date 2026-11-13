// Cosmetic randomness for the visual layer only (crowd colours, dust, camera shake). It is its own stream: it never
// shares state with the sim or the CPU's draws, and nothing it returns may reach a game outcome.

/** mulberry32: small, fast, and the same sequence for the same seed on every machine. */
export function cosmeticRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed used by the `?shot=` art-review pages, so a capture can be repeated. */
export const SHOT_SEED = 0x5b07;
