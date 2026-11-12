// Bats, coins and the store catalog. Names are our own; real brand names are trademarks.
// Boosts are applied inside the sim on the server (see packages/sim gear), never by the client.

export type Wood = "maple" | "ash";
export type BatLength = 33 | 34;
export type BatWeight = 31 | 32;

/** The free wood bat every team swings. Always on, at most ±2 in any rating. */
export interface WoodSpec { wood: Wood; length: BatLength; weight: BatWeight }

export const DEFAULT_WOOD: WoodSpec = { wood: "ash", length: 33, weight: 31 };

/** Rating deltas for a wood spec: maple = +1 Power, ash = +1 Contact; 34" and 32 oz each trade 1 Contact for 1 Power. */
export function woodDeltas(w: WoodSpec): { contact: number; power: number } {
  let contact = w.wood === "ash" ? 1 : 0;
  let power = w.wood === "maple" ? 1 : 0;
  if (w.length === 34) { power += 1; contact -= 1; }
  if (w.weight === 32) { power += 1; contact -= 1; }
  return { contact, power };
}

export function isWoodSpec(x: unknown): x is WoodSpec {
  const w = x as WoodSpec;
  return !!w && (w.wood === "maple" || w.wood === "ash") && (w.length === 33 || w.length === 34) && (w.weight === 31 || w.weight === 32);
}

export type BatTier = "common" | "rare" | "legendary";
export type BatClass = "wood" | "bbcor" | "usssa";
export type SwingWeight = "balanced" | "mid" | "end";
export type BatBuild = "alloy" | "composite" | "hybrid";

/** A Super Power Bat: charges per game; each use makes the next swing a Super Swing. */
export interface SuperBat {
  id: string;
  name: string;
  maker: string;
  tier: BatTier;
  cls: BatClass;
  swingWeight: SwingWeight;
  build: BatBuild;
  /** Coins. Legendary bats are never sold (price 0, drop from milestones). */
  price: number;
  /** Super Swings per game. */
  charges: number;
  /** Rating boost while a Super Swing is armed (z-ish units added to contact/power ratings). */
  boost: { contact: number; power: number };
  blurb: string;
}

const BASE: Record<BatTier, { charges: number; contact: number; power: number }> = {
  common: { charges: 2, contact: 6, power: 10 },
  rare: { charges: 3, contact: 9, power: 15 },
  legendary: { charges: 4, contact: 14, power: 22 },
};

function bat(
  id: string, name: string, maker: string, tier: BatTier, cls: BatClass, swingWeight: SwingWeight, build: BatBuild, price: number, blurb: string,
): SuperBat {
  const b = BASE[tier];
  // Swing weight sets the shape: balanced favors contact, end-loaded favors power. One-piece alloy adds a charge.
  const shape = swingWeight === "balanced" ? { contact: 1.3, power: 0.7 } : swingWeight === "end" ? { contact: 0.6, power: 1.35 } : { contact: 1, power: 1 };
  return {
    id, name, maker, tier, cls, swingWeight, build, price, blurb,
    charges: b.charges + (build === "alloy" ? 1 : 0),
    boost: { contact: Math.round(b.contact * shape.contact), power: Math.round(b.power * shape.power) },
  };
}

export const SUPER_BATS: SuperBat[] = [
  // USSSA: the most pop.
  bat("thunderclap", "Thunderclap", "Northwind", "common", "usssa", "end", "alloy", 300, "One-piece alloy with a big end load. Stings a little, hits a lot."),
  bat("comet-tail", "Comet Tail", "Northwind", "common", "usssa", "balanced", "composite", 300, "Two-piece composite, huge sweet spot. Line drives for days."),
  bat("hornet", "Hornet", "Ridgeback", "rare", "usssa", "mid", "hybrid", 800, "Hybrid handle, hot barrel, balanced feel."),
  bat("skyhook", "Skyhook", "Ridgeback", "rare", "usssa", "end", "composite", 900, "End-loaded composite built to leave the yard."),
  bat("ninth-wave", "Ninth Wave", "Cascade", "legendary", "usssa", "end", "hybrid", 0, "The bat they talk about at the fence. Milestone drop only."),
  // BBCOR: steadier.
  bat("ironwood", "Ironwood", "Northwind", "common", "bbcor", "balanced", "alloy", 250, "Stiff one-piece alloy. Honest feedback, extra charge."),
  bat("quiet-storm", "Quiet Storm", "Cascade", "common", "bbcor", "mid", "composite", 300, "Soft on the hands, loud off the barrel."),
  bat("anvil", "Anvil", "Ridgeback", "rare", "bbcor", "end", "alloy", 850, "Heavy end, heavy results. Four charges."),
  bat("lantern", "Lantern", "Cascade", "rare", "bbcor", "balanced", "hybrid", 800, "Hybrid build that finds gaps late in games."),
  bat("midnight-sun", "Midnight Sun", "Northwind", "legendary", "bbcor", "mid", "composite", 0, "Never sold. Earned at 30 wins."),
];

export const BAT_BY_ID: Record<string, SuperBat> = Object.fromEntries(SUPER_BATS.map((b) => [b.id, b]));

/** Win milestones that drop a Legendary bat (first unowned, in order). */
export const LEGENDARY_MILESTONES: { wins: number; batId: string }[] = [
  { wins: 15, batId: "ninth-wave" },
  { wins: 30, batId: "midnight-sun" },
];

// --- Coins ---------------------------------------------------------------------------

export interface CoinBreakdown {
  result: number;
  shutout: number;
  homers: number;
  comeback: number;
  streak: number;
  total: number;
}

export const COIN_RULES = {
  win: 100, loss: 20, tie: 40,
  shutout: 50,
  perHomer: 15,
  comeback: 40,
  /** +10 per consecutive win beyond the first, capped. */
  streakStep: 10, streakCap: 50,
} as const;

/** Coins for one finished game. `streak` = consecutive wins including this one (0 if not a win). */
export function coinsFor(g: { result: "W" | "L" | "T"; shutout: boolean; homers: number; comeback: boolean; streak: number }): CoinBreakdown {
  const result = g.result === "W" ? COIN_RULES.win : g.result === "T" ? COIN_RULES.tie : COIN_RULES.loss;
  const shutout = g.result === "W" && g.shutout ? COIN_RULES.shutout : 0;
  const homers = g.homers * COIN_RULES.perHomer;
  const comeback = g.result === "W" && g.comeback ? COIN_RULES.comeback : 0;
  const streak = g.result === "W" ? Math.min(COIN_RULES.streakCap, Math.max(0, g.streak - 1) * COIN_RULES.streakStep) : 0;
  return { result, shutout, homers, comeback, streak, total: result + shutout + homers + comeback + streak };
}

// --- API shapes ------------------------------------------------------------------------

export interface Gear {
  wood: WoodSpec;
  /** Equipped Super Power Bat id, if any. Must be owned. */
  superBat: string | null;
  /** Cosmetic colourways (W14); each must be owned. */
  cosmetics?: Cosmetics;
}

export interface StoreState {
  coins: number;
  owned: string[];
  gear: Gear;
  bats: SuperBat[];
  cosmetics: Cosmetic[];
  wins: number;
}

export interface BuyRequest { batId?: string; cosmeticId?: string }
export interface GearRequest { wood?: WoodSpec; superBat?: string | null; cosmetics?: Cosmetics }

// --- Cosmetic gear (W14) ----------------------------------------------------------------
// Pure looks: helmet, cleat and batting-glove colourways on your players' rigs. Zero rating effect,
// so the sim never reads them. Names are the game's own (no real brands). Rare colourways cost more;
// Legendary stays bats-only and milestone-only (see LEGENDARY_MILESTONES).

export type CosmeticSlot = "helmet" | "cleats" | "gloves";
export const COSMETIC_SLOTS: CosmeticSlot[] = ["helmet", "cleats", "gloves"];

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  name: string;
  /** CSS hex colour painted on the rig. */
  color: string;
  tier: "common" | "rare";
  price: number;
}

const cos = (slot: CosmeticSlot, id: string, name: string, color: string, tier: Cosmetic["tier"] = "common"): Cosmetic =>
  ({ id: `${slot}-${id}`, slot, name, color, tier, price: tier === "rare" ? 350 : 120 });

export const COSMETICS: Cosmetic[] = [
  cos("helmet", "matte-black", "Matte Black", "#1c1c20"),
  cos("helmet", "glacier", "Glacier White", "#eef0f2"),
  cos("helmet", "cardinal", "Cardinal", "#b4232a"),
  cos("helmet", "royal", "Royal", "#1f4fb6"),
  cos("helmet", "chrome", "Chrome Flake", "#c9ced6", "rare"),
  cos("helmet", "sunburst", "Sunburst", "#f0a62b", "rare"),
  cos("cleats", "blackout", "Blackout", "#111114"),
  cos("cleats", "whiteout", "Whiteout", "#f4f4f1"),
  cos("cleats", "volt", "Volt", "#c8f03c"),
  cos("cleats", "crimson", "Crimson", "#c72838"),
  cos("cleats", "ice", "Ice Blue", "#8fd3f4", "rare"),
  cos("cleats", "gold", "Gold Rush", "#d9a826", "rare"),
  cos("gloves", "white", "Classic White", "#f1f1ee"),
  cos("gloves", "black", "Night", "#1b1b1f"),
  cos("gloves", "red", "Red Line", "#d1343c"),
  cos("gloves", "navy", "Deep Navy", "#1d2a55"),
  cos("gloves", "teal", "Tidewater", "#2aa9a1", "rare"),
  cos("gloves", "pink", "Hot Pink", "#f04f9d", "rare"),
];
export const COSMETIC_BY_ID: Record<string, Cosmetic> = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));

/** Equipped colourway per slot; a missing or null slot means the team's stock look. */
export type Cosmetics = Partial<Record<CosmeticSlot, string | null>>;
