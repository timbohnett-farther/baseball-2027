// Arcade season (ARC 12-13): seven games, one per club, rival in round 4, then a top-4 single-elimination
// bracket. Everything here is pure and seeded, so the server and tests agree on every CPU result.

export const ARCADE_FORMAT = 2;
export const ARCADE_GAMES = 7;
/** The rival is always the fourth game (index 3). */
export const RIVAL_GAME_INDEX = 3;
export const STARS_PER_GAME = 3;
/** 7 regular + semifinal + final, 3 stars each. */
export const MAX_SEASON_STARS = 27;

/** Season bonuses, paid by the server on top of per-game coins and star coins. */
export const ARCADE_REWARDS = { regular: 100, berth: 100, semi: 150, champion: 400, perStar: 10 } as const;

export type BaseStyle = "balanced" | "power" | "speed" | "defense" | "pitch" | "counter";
export type ClubStyle = BaseStyle | "rival";
export type SuggestedDifficulty = "rookie" | "pro" | "allstar";

export const STYLE_INFO: Record<ClubStyle, { label: string; scouting: string }> = {
  balanced: { label: "Balanced", scouting: "NO WEAK SPOTS" },
  power: { label: "Power", scouting: "LIVES ON THE LONG BALL" },
  speed: { label: "Speed", scouting: "RUNS AT EVERY CHANCE" },
  defense: { label: "Defense", scouting: "NOTHING FALLS IN" },
  pitch: { label: "Pitch craft", scouting: "LIVES ON LATE BREAK" },
  counter: { label: "Counter", scouting: "WAITS FOR YOUR MISTAKE" },
  rival: { label: "Rival", scouting: "A STAR WHO WANTS IT BACK" },
};

/** Averages of a club's best lineup, 0-100 rating scale, as the server reads them from real ratings. */
export interface ClubProfile {
  id: number; name: string; abbr: string; strength: number;
  power: number; speed: number; defense: number; pitching: number; contact: number;
  star: string;
}

export interface ArcadeClub {
  id: number; name: string; abbr: string; strength: number;
  style: ClubStyle; base: BaseStyle; star: string; rival: boolean;
}

/** The league as it stood when the season began; saved so standings never shift when ratings refresh. */
export interface ArcadeLeague {
  seed: number;
  /** The seven opponents in schedule order: index = regular-season game, rival at RIVAL_GAME_INDEX. */
  clubs: ArcadeClub[];
}

// --- Seeded randomness -------------------------------------------------------------------

function mix(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) { h ^= v >>> 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); }
  return (h ^ (h >>> 15)) >>> 0;
}

function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Styles and the league ---------------------------------------------------------------

const METRICS: { key: keyof Pick<ClubProfile, "power" | "speed" | "defense" | "pitching" | "contact">; style: BaseStyle }[] = [
  { key: "power", style: "power" }, { key: "speed", style: "speed" }, { key: "defense", style: "defense" },
  { key: "pitching", style: "pitch" }, { key: "contact", style: "counter" },
];

function zScores(profiles: ClubProfile[]): Map<number, number[]> {
  const cols = METRICS.map((m) => {
    const xs = profiles.map((p) => p[m.key]);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length) || 1;
    return { mean, sd };
  });
  return new Map(profiles.map((p) => [p.id, METRICS.map((m, i) => (p[m.key] - cols[i]!.mean) / cols[i]!.sd)]));
}

/** A club's style is the one rating group it leads the league in; with no clear lead it is balanced. */
export function deriveStyle(z: number[]): BaseStyle {
  let best = 0;
  for (let i = 1; i < z.length; i++) if (z[i]! > z[best]!) best = i;
  return z[best]! >= 0.5 ? METRICS[best]!.style : "balanced";
}

/** Pick the seven opponents, their styles and the rival, all from the season seed and real ratings. */
export function buildLeague(seed: number, profiles: ClubProfile[]): ArcadeLeague {
  if (profiles.length < ARCADE_GAMES) throw new Error("Not enough clubs for a season.");
  const z = zScores(profiles);
  const pool = [...profiles].sort((a, b) => a.id - b.id);
  const rnd = stream(mix(seed, 0xa11c));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  const seven = pool.slice(0, ARCADE_GAMES);
  // Rival: the most balanced of the stronger half, so it is a fair fight with a star to hang the story on.
  const spread = (p: ClubProfile) => { const v = z.get(p.id)!; const m = v.reduce((s, x) => s + x, 0) / v.length; return v.reduce((s, x) => s + (x - m) ** 2, 0); };
  const median = [...seven].map((p) => p.strength).sort((a, b) => a - b)[Math.floor(seven.length / 2)]!;
  const eligible = seven.filter((p) => p.strength >= median);
  const rival = [...eligible].sort((a, b) => spread(a) - spread(b) || b.strength - a.strength || a.id - b.id)[0]!;
  const toClub = (p: ClubProfile): ArcadeClub => {
    const base = deriveStyle(z.get(p.id)!);
    const isRival = p.id === rival.id;
    return { id: p.id, name: p.name, abbr: p.abbr, strength: p.strength, style: isRival ? "rival" : base, base, star: p.star, rival: isRival };
  };
  const others = seven.filter((p) => p.id !== rival.id).map(toClub);
  const clubs = [...others.slice(0, RIVAL_GAME_INDEX), toClub(rival), ...others.slice(RIVAL_GAME_INDEX)];
  return { seed, clubs };
}

/** Suggested difficulty ramp: warm up, find a rhythm, then the closing games and playoffs bite. */
export function suggestedDifficulty(gameIndex: number, playoff: boolean): SuggestedDifficulty {
  if (playoff || gameIndex >= 5) return "allstar";
  return gameIndex <= 1 ? "rookie" : "pro";
}

// --- CPU games -----------------------------------------------------------------------------

export interface GameRow { home: number; away: number; homeScore: number; awayScore: number }

function poisson(rnd: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > limit && k < 20);
  return k - 1;
}

/** A 3-inning game between two clubs, decided by their strength; ties play on, then break by a seeded coin. */
export function cpuGame(seed: number, stage: number, home: ArcadeClub, away: ArcadeClub): GameRow {
  const rnd = stream(mix(seed, stage, home.id, away.id));
  const lam = (a: ArcadeClub, b: ArcadeClub) => Math.min(6, Math.max(1, 3 * (1 + (a.strength - b.strength) * 0.03)));
  let hs = poisson(rnd, lam(home, away)), as = poisson(rnd, lam(away, home));
  for (let extra = 0; hs === as && extra < 3; extra++) { hs += poisson(rnd, lam(home, away) / 3); as += poisson(rnd, lam(away, home) / 3); }
  if (hs === as) {
    const pHome = 1 / (1 + Math.exp(-(home.strength - away.strength) * 0.1));
    if (rnd() < pHome) hs++; else as++;
  }
  return { home: home.id, away: away.id, homeScore: hs, awayScore: as };
}

/** Round r: the user plays clubs[r]; the other six pair off so every club meets every other exactly once. */
export function cpuRound(league: ArcadeLeague, r: number): GameRow[] {
  const n = league.clubs.length;
  const out: GameRow[] = [];
  for (let k = 1; k <= (n - 1) / 2; k++) {
    out.push(cpuGame(league.seed, r, league.clubs[(r + k) % n]!, league.clubs[(r - k + n) % n]!));
  }
  return out;
}

/** CPU-vs-CPU results for the first `rounds` rounds. */
export function cpuResults(league: ArcadeLeague, rounds: number): GameRow[] {
  const out: GameRow[] = [];
  for (let r = 0; r < Math.min(rounds, league.clubs.length); r++) out.push(...cpuRound(league, r));
  return out;
}

// --- Standings -----------------------------------------------------------------------------

export interface StandingRow {
  id: number; rank: number; w: number; l: number; t: number; rf: number; ra: number; diff: number;
  /** Games back of the leader. */
  gb: number;
  /** One line explaining why this club sits where it does ("WHY THIS SEED?"). */
  why: string;
}

/** ARC 12.4: wins, head-to-head (two clubs, or one club that beat every other tied club), run differential, fewer runs allowed, seeded draw. */
export function computeStandings(ids: number[], results: GameRow[], seed: number): StandingRow[] {
  const rec = new Map(ids.map((id) => [id, { w: 0, l: 0, t: 0, rf: 0, ra: 0 }]));
  const wins = new Map<string, number>(), played = new Map<string, number>();
  const key = (a: number, b: number) => `${a}>${b}`;
  for (const g of results) {
    const h = rec.get(g.home), a = rec.get(g.away);
    if (!h || !a) continue;
    h.rf += g.homeScore; h.ra += g.awayScore; a.rf += g.awayScore; a.ra += g.homeScore;
    played.set(key(g.home, g.away), (played.get(key(g.home, g.away)) ?? 0) + 1);
    played.set(key(g.away, g.home), (played.get(key(g.away, g.home)) ?? 0) + 1);
    if (g.homeScore === g.awayScore) { h.t++; a.t++; continue; }
    const [win, lose] = g.homeScore > g.awayScore ? [g.home, g.away] : [g.away, g.home];
    rec.get(win)!.w++; rec.get(lose)!.l++;
    wins.set(key(win, lose), (wins.get(key(win, lose)) ?? 0) + 1);
  }
  const w = (id: number) => rec.get(id)!.w;
  const diff = (id: number) => rec.get(id)!.rf - rec.get(id)!.ra;
  const beat = (a: number, b: number) => (wins.get(key(a, b)) ?? 0) > (wins.get(key(b, a)) ?? 0);
  const draw = (id: number) => mix(seed, 0xd2a7, id);

  const order = (group: number[]): { id: number; why: string }[] => {
    if (group.length === 1) return [{ id: group[0]!, why: "" }];
    if (group.length === 2) {
      const [a, b] = group as [number, number];
      if (beat(a, b) || beat(b, a)) {
        const [win, lose] = beat(a, b) ? [a, b] : [b, a];
        return [{ id: win, why: "Won the head-to-head" }, { id: lose, why: "Lost the head-to-head" }];
      }
    } else {
      const sweeper = group.find((t) => group.every((o) => o === t || beat(t, o)));
      if (sweeper !== undefined) return [{ id: sweeper, why: "Beat every other tied club" }, ...order(group.filter((x) => x !== sweeper))];
    }
    const sorted = [...group].sort((a, b) => diff(b) - diff(a) || rec.get(a)!.ra - rec.get(b)!.ra || draw(a) - draw(b));
    const reason = (a: number, b: number) => diff(a) !== diff(b) ? "Run differential" : rec.get(a)!.ra !== rec.get(b)!.ra ? "Fewer runs allowed" : "Seeded draw";
    return sorted.map((id, i) => ({ id, why: reason(id, sorted[i + 1] ?? sorted[i - 1]!) }));
  };

  const byWins = new Map<number, number[]>();
  for (const id of ids) byWins.set(w(id), [...(byWins.get(w(id)) ?? []), id]);
  const ordered: { id: number; why: string }[] = [];
  for (const wk of [...byWins.keys()].sort((a, b) => b - a)) {
    const group = byWins.get(wk)!;
    const part = order(group);
    ordered.push(...part.map((p) => ({ id: p.id, why: group.length === 1 ? (ordered.length === 0 ? "Most wins" : "Wins") : p.why })));
  }
  const lead = rec.get(ordered[0]!.id)!;
  return ordered.map((o, i) => {
    const r = rec.get(o.id)!;
    return { id: o.id, rank: i + 1, w: r.w, l: r.l, t: r.t, rf: r.rf, ra: r.ra, diff: r.rf - r.ra, gb: ((lead.w - r.w) + (r.l - lead.l)) / 2, why: o.why };
  });
}

/** Seeds 1-4 and who plays whom (higher seed listed first, as home). */
export function semiPairs(topFour: number[]): [[number, number], [number, number]] {
  return [[topFour[0]!, topFour[3]!], [topFour[1]!, topFour[2]!]];
}

// --- The unlock track ----------------------------------------------------------------------

export interface Unlock {
  /** Lifetime stars needed. */
  stars: number;
  kind: "item" | "coins";
  label: string;
  itemId?: string;
  coins?: number;
}

/** ARC 13: cosmetic rewards every three lifetime stars, mapped onto the items the store already has. */
export const UNLOCKS: Unlock[] = [
  { stars: 3, kind: "item", label: "Glacier White helmet", itemId: "helmet-glacier" },
  { stars: 6, kind: "item", label: "Volt cleats", itemId: "cleats-volt" },
  { stars: 9, kind: "item", label: "Red Line gloves", itemId: "gloves-red" },
  { stars: 12, kind: "coins", label: "Clubhouse fund", coins: 150 },
  { stars: 15, kind: "item", label: "Chrome Flake helmet", itemId: "helmet-chrome" },
  { stars: 18, kind: "item", label: "Comet Tail bat", itemId: "comet-tail" },
  { stars: 21, kind: "item", label: "Ice Blue cleats", itemId: "cleats-ice" },
  { stars: 24, kind: "item", label: "Hot Pink gloves", itemId: "gloves-pink" },
  { stars: 27, kind: "item", label: "Champion crown helmet", itemId: "helmet-sunburst" },
];
/** Past the last unlock, every three more stars pays this. */
export const UNLOCK_REPEAT_COINS = 100;

/** Unlocks crossed when lifetime stars go from `before` to `after`. */
export function unlocksBetween(before: number, after: number): Unlock[] {
  const out = UNLOCKS.filter((u) => u.stars > before && u.stars <= after);
  const top = UNLOCKS[UNLOCKS.length - 1]!.stars;
  for (let s = Math.max(top + 3, Math.floor(before / 3) * 3 + 3); s <= after; s += 3) out.push({ stars: s, kind: "coins", label: "Veteran bonus", coins: UNLOCK_REPEAT_COINS });
  return out;
}

// --- API shapes ------------------------------------------------------------------------------

export interface ObjectiveView { id: string; label: string; kind: "result" | "scout" | "arcade"; earned: boolean | null }

export interface ArcadeOpponent {
  id: number; name: string; abbr: string; style: ClubStyle; styleLabel: string; scouting: string; star: string; rival: boolean;
}

export interface ArcadeFixture {
  gameNo: number;
  /** 0 regular season, 1 semifinal, 2 final. */
  round: number;
  label: string;
  opponent: ArcadeOpponent;
  gameId: number | null;
  result: "W" | "L" | "T" | null;
  userScore: number | null;
  opponentScore: number | null;
  objectives: ObjectiveView[];
  stars: number;
  difficulty: SuggestedDifficulty | null;
  suggested: SuggestedDifficulty;
}

export interface ArcadeStanding extends StandingRow {
  name: string; abbr: string; you: boolean; rival: boolean;
  /** Seed 1-4 once the regular season is over; null otherwise. */
  seed: number | null;
  inPlayoffs: boolean;
}

export interface BracketSlot { id: number; name: string; abbr: string; you: boolean; score: number | null }
export interface BracketGame { label: string; home: BracketSlot | null; away: BracketSlot | null; winner: number | null }
export interface ArcadeBracket { semis: BracketGame[]; final: BracketGame }

export interface LifetimeTrack {
  stars: number;
  /** Unlocks with whether each has been earned. */
  track: (Unlock & { earned: boolean })[];
  next: Unlock | null;
}

export interface ArcadeSeasonState {
  format: 2;
  id: number;
  number: number;
  status: "regular" | "playoffs" | "done";
  record: { w: number; l: number; t: number };
  /** Regular-season games played, 0-7. */
  played: number;
  schedule: ArcadeFixture[];
  next: ArcadeFixture | null;
  standings: ArcadeStanding[];
  bracket: ArcadeBracket | null;
  champion: boolean;
  /** Final placement once the season is over (1 = champion). */
  placement: { place: number; label: string } | null;
  rewardCoins: number;
  stars: { season: number; max: number };
  highestDifficulty: SuggestedDifficulty | null;
  lifetime: LifetimeTrack;
}

/** What the career endpoint returns: lifetime stars and the unlock track, plus how past seasons went. */
export interface ArcadeCareer {
  lifetime: LifetimeTrack;
  seasons: { number: number; place: number | null; champion: boolean; stars: number; record: { w: number; l: number; t: number }; format: number }[];
}
