import { randomInt } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ARCADE_FORMAT, BAT_BY_ID, chemistry, cleanPace, coinsFor, DEFAULT_WOOD, LEGENDARY_MILESTONES, levelFor, slotsFor, teamAbbreviation, woodDeltas, XP_RULES, type Gear, type Player } from "@bb/shared";
import { ABILITIES, autoLineup, CURRENT_RULES, DEFAULT_INNINGS, INNINGS_OPTIONS, isDifficulty, playInteractive, simulateGame, type AbilityRequest, type Aim, type GameHistory, type GameResult, type InteractiveSetup, type PlayedGame, type RulesVersion, type SimPlayer, type SimTeam, type UserInput } from "@bb/sim";
import { requireUser } from "./auth.ts";
import { getDb, type Db } from "./db/index.ts";
import { games, mlbTeams, userItems, userTeamPlayers, userTeams, users } from "./db/schema.ts";
import { settleArcade } from "./arcade-season.ts";
import { seasonMatch, settleSeason, type SeasonRow } from "./season.ts";
import { pool } from "./store.ts";
import { teamPlayers } from "./team.ts";

const isPitcher = (p: Player) => p.ratings.role === "SP" || p.ratings.role === "RP";
const isHitter = (p: Player) => p.ratings.role === "H" || p.ratings.role === "TWP";

/** A player as the engine sees him, with chemistry-adjusted skills when given. */
function toSim(p: Player, skills: Record<string, number> = {}): SimPlayer {
  const h = p.ratings.hitting, pi = p.ratings.pitching;
  const v = (k: string, base: number) => skills[k] ?? base;
  return {
    id: p.id, name: p.name, lastName: p.lastName || p.name, position: p.position,
    bats: p.bats === "L" || p.bats === "S" ? p.bats : "R",
    batting: h && isHitter(p) ? { contact: v("contact", h.contact), power: v("power", h.power), eye: v("eye", h.eye), speed: v("speed", h.speed), fielding: v("fielding", h.fielding) } : null,
    pitching: pi && (isPitcher(p) || p.ratings.role === "TWP") ? { stuff: v("stuff", pi.stuff), control: v("control", pi.control), movement: v("movement", pi.movement), stamina: v("stamina", pi.stamina) } : null,
  };
}

/** Starter first (best starter, or a two-way player), then the rest best-first. */
function staff(pitchers: SimPlayer[], roles: Map<number, string>, overall: Map<number, number>): SimPlayer[] {
  const byOverall = [...pitchers].sort((a, b) => (overall.get(b.id) ?? 0) - (overall.get(a.id) ?? 0));
  const starter = byOverall.find((p) => roles.get(p.id) === "SP") ?? byOverall.find((p) => roles.get(p.id) === "TWP") ?? byOverall[0];
  return [starter, ...byOverall.filter((p) => p !== starter)];
}

/** The user's drafted team, with chemistry applied to every rating and their bat gear on top (wood is always on, ±2 at most). */
export function userSimTeam(name: string, color: string, players: Player[], season: number, gear: Gear | null = null): SimTeam {
  const chem = chemistry(players, season);
  const skills = new Map(chem.players.map((b) => [b.playerId, b.skills as Record<string, number>]));
  const wood = woodDeltas(gear?.wood ?? DEFAULT_WOOD);
  const sims = new Map(players.map((p) => {
    const s = toSim(p, skills.get(p.id));
    if (s.batting) s.batting = { ...s.batting, contact: s.batting.contact + wood.contact, power: s.batting.power + wood.power };
    return [p.id, s];
  }));
  const roles = new Map(players.map((p) => [p.id, p.ratings.role]));
  const overall = new Map(chem.players.map((b) => [b.playerId, b.effective]));
  const sb = gear?.superBat ? BAT_BY_ID[gear.superBat] : undefined;
  return {
    name, abbr: teamAbbreviation(name), color,
    lineup: autoLineup(players.filter(isHitter).map((p) => sims.get(p.id)!)),
    pitchers: staff(players.filter((p) => isPitcher(p) || p.ratings.role === "TWP").map((p) => sims.get(p.id)!), roles, overall),
    gear: {
      superBat: sb ? { id: sb.id, name: sb.name, charges: sb.charges, contact: sb.boost.contact, power: sb.boost.power } : null,
      cosmetics: gear?.cosmetics ?? {},
    },
  };
}

/**
 * Pay out a finished game: coins by the rules in @bb/shared, plus a Legendary bat at win milestones.
 * The only place coins are ever added; the client never sends a coin amount.
 */
async function payout(db: Db, userId: number, result: GameResult, outcome: "W" | "L" | "T"): Promise<NonNullable<PlayedGame["reward"]>> {
  const history = await db.select({ result: games.result }).from(games).where(eq(games.userId, userId)).orderBy(desc(games.id));
  let streak = 0;
  for (const g of history) { if (g.result !== "W") break; streak++; }
  if (outcome === "W") streak++;
  const wins = history.filter((g) => g.result === "W").length + (outcome === "W" ? 1 : 0);
  const trailedBy = Math.max(0, ...result.events.map((e) => e.state.score.away - e.state.score.home));
  const c = coinsFor({
    result: outcome, shutout: result.final.away === 0, homers: result.box.batting.home.reduce((n, b) => n + b.hr, 0),
    comeback: trailedBy >= 2, streak,
  });
  await db.update(users).set({ coins: sql`${users.coins} + ${c.total}` }).where(eq(users.id, userId));

  let drop: NonNullable<PlayedGame["reward"]>["drop"] = null;
  const milestone = LEGENDARY_MILESTONES.find((m) => m.wins === wins);
  if (outcome === "W" && milestone) {
    const inserted = await db.insert(userItems).values({ userId, itemId: milestone.batId }).onConflictDoNothing().returning();
    if (inserted.length) drop = { id: milestone.batId, name: BAT_BY_ID[milestone.batId].name };
  }
  const { total, ...coins } = c;
  return { total, coins, drop };
}

/**
 * A real MLB team's best lineup: one at each infield spot, three outfielders, a DH, a starter and two more arms.
 * Players you drafted play for you now, so they're left off (`exclude`).
 */
export function mlbSimTeam(teamId: number, exclude: Set<number> = new Set()): SimTeam | null {
  const team = pool().teams.find((t) => t.id === teamId);
  if (!team) return null;
  const roster = pool().players.filter((p) => p.teamId === teamId && p.status === "Active" && !exclude.has(p.id)); // sorted best-first
  const chosen: Player[] = [];
  const take = (fits: (p: Player) => boolean, n = 1) => {
    for (const p of roster) {
      if (n === 0) break;
      if (!chosen.includes(p) && fits(p)) { chosen.push(p); n--; }
    }
  };
  for (const slot of ["C", "1B", "2B", "3B", "SS"]) take((p) => p.ratings.role === "H" && slotsFor({ position: p.position, role: p.ratings.role }).includes(slot as never));
  take((p) => p.ratings.role === "H" && slotsFor({ position: p.position, role: p.ratings.role })[0] === "OF", 3);
  take(isHitter, 9 - chosen.length); // DH and any spot a thin roster couldn't fill
  take((p) => p.ratings.role === "SP");
  take((p) => isPitcher(p), 2);
  const roles = new Map(chosen.map((p) => [p.id, p.ratings.role]));
  const overall = new Map(chosen.map((p) => [p.id, p.ratings.overall]));
  return {
    name: team.name, abbr: team.abbreviation, color: "#b8bcc6",
    lineup: autoLineup(chosen.filter((p) => p.ratings.role === "H" || p.ratings.role === "TWP").map((p) => toSim(p))),
    pitchers: staff(chosen.filter(isPitcher).map((p) => toSim(p)), roles, overall),
  };
}

function played(row: typeof games.$inferSelect, opponent: { id: number; name: string; abbr: string }): PlayedGame {
  // rules: a game replays under the ruleset it was played with, so later rule changes never rewrite history.
  const input = { away: row.teams.away, home: row.teams.home, seed: row.seed, innings: row.innings, rules: row.rules, difficulty: row.difficulty };
  // autoField: games saved before fielding taps existed have none in their log; the play stands as rolled.
  const result = row.inputs ? playInteractive({ ...input, userSide: row.userSide, inputs: row.inputs, autoField: true }).result! : simulateGame(input);
  return { id: row.id, createdAt: row.createdAt.toISOString(), opponent, userSide: row.userSide, teams: row.teams, result, rules: row.rules, difficulty: row.difficulty };
}

const isAim = (a: unknown): a is Aim => !!a && typeof a === "object" && Number.isFinite((a as Aim).x) && Number.isFinite((a as Aim).y);
/** An ability request is optional; when present it has to name a real ability (its fit to the swing is the sim's call). */
const isAbility = (a: unknown) => a === undefined || (!!a && typeof a === "object" && Object.hasOwn(ABILITIES, (a as AbilityRequest).id)
  && [undefined, "left", "right"].includes((a as AbilityRequest).direction));
export function isInput(i: unknown): i is UserInput {
  if (!i || typeof i !== "object") return false;
  const u = i as Record<string, unknown>;
  if (u.kind === "pitch") return ["fastball", "slider", "change", "curve"].includes(u.type as string) && isAim(u.aim) && isAbility(u.ability);
  if (u.kind === "swing") return ["contact", "power", "take"].includes(u.swing as string) && typeof u.timing === "number" && Math.abs(u.timing) <= 1 && isAbility(u.ability);
  if (u.kind === "run") {
    const bases = ["first", "second", "third"];
    if (u.action === "steal") return ["first", "second"].includes(u.from as string) && isAbility(u.ability);
    if (u.action === "pickoff") return bases.includes(u.at as string);
    if (u.action === "advance") return Array.isArray(u.send) && u.send.length <= 3 && u.send.every((b) => bases.includes(b as string)) && isAbility(u.ability);
    return false;
  }
  if (u.kind === "team") return u.action === "rally_breaker";
  if (u.kind === "field") return typeof u.timing === "number" && Math.abs(u.timing) <= 1 && (u.throwTo === undefined || ["first", "second", "third", "home"].includes(u.throwTo as string)) && isAbility(u.ability);
  return false;
}

/** Quick Match length (1, 3 or 5). Season and playoff games are always the default 3 (ARC 3.1). */
function matchInnings(raw: unknown, season: SeasonRow | null): { innings: number } | { error: string } {
  if (raw == null) return { innings: DEFAULT_INNINGS };
  if (season) return raw === DEFAULT_INNINGS ? { innings: DEFAULT_INNINGS } : { error: `Season games are ${DEFAULT_INNINGS} innings.` };
  if (!(INNINGS_OPTIONS as readonly unknown[]).includes(raw)) return { error: `Pick ${INNINGS_OPTIONS.join(", ")} innings.` };
  return { innings: raw as number };
}

/** Fold a season bonus (paid by settleSeason) into the game's reward line. */
async function addSeasonBonus(reward: NonNullable<PlayedGame["reward"]>, bonus: number) {
  if (bonus > 0) { reward.coins.season = bonus; reward.total += bonus; }
}

/** Settle a season game under whichever format the season uses and fold what it paid into the game's reward. */
async function settleSeasonGame(db: Db, season: SeasonRow, gameId: number, outcome: "W" | "L" | "T", result: GameResult, reward: NonNullable<PlayedGame["reward"]>) {
  if (season.format !== ARCADE_FORMAT) return addSeasonBonus(reward, await settleSeason(db, season, gameId, outcome));
  const s = await settleArcade(db, season, gameId, outcome, result);
  if (!s) return;
  await addSeasonBonus(reward, s.season);
  if (s.stars) reward.coins.stars = s.stars;
  if (s.unlockCoins) reward.coins.unlock = s.unlockCoins;
  reward.total += s.stars + s.unlockCoins;
  reward.arcade = { objectives: s.objectives.map((o) => ({ id: o.id, label: o.label, earned: o.earned })), stars: s.objectives.filter((o) => o.earned).length, unlocks: s.unlocks.map((u) => ({ stars: u.stars, label: u.label })), lifetimeStars: s.lifetimeStars };
}

/**
 * Player development: everyone who appeared for the user earns XP (appearance, hits, homers,
 * strikeouts thrown, a win bonus). Levels come from XP alone, so a level-up is just a threshold crossed.
 */
async function awardXp(db: Db, teamId: number, result: GameResult, outcome: "W" | "L" | "T"): Promise<NonNullable<NonNullable<PlayedGame["reward"]>["levelUps"]>> {
  const gained = new Map<number, { name: string; xp: number }>();
  const add = (id: number, name: string, xp: number) => {
    const g = gained.get(id) ?? { name, xp: 0 };
    g.xp += xp;
    gained.set(id, g);
  };
  for (const b of result.box.batting.home) add(b.playerId, b.name, XP_RULES.appearance + b.h * XP_RULES.hit + b.hr * XP_RULES.homer);
  for (const p of result.box.pitching.home) add(p.playerId, p.name, (gained.has(p.playerId) ? 0 : XP_RULES.appearance) + p.k * XP_RULES.strikeout);
  if (outcome === "W") for (const g of gained.values()) g.xp += XP_RULES.win;

  const rows = await db.select({ playerId: userTeamPlayers.playerId, xp: userTeamPlayers.xp })
    .from(userTeamPlayers).where(eq(userTeamPlayers.teamId, teamId));
  const levelUps: { id: number; name: string; level: number }[] = [];
  for (const r of rows) {
    const g = gained.get(r.playerId);
    if (!g) continue;
    const xp = r.xp + g.xp;
    await db.update(userTeamPlayers).set({ xp }).where(and(eq(userTeamPlayers.teamId, teamId), eq(userTeamPlayers.playerId, r.playerId)));
    if (levelFor(xp) > levelFor(r.xp)) levelUps.push({ id: r.playerId, name: g.name, level: levelFor(xp) });
  }
  return levelUps;
}

export async function gameRoutes(app: FastifyInstance) {
  /** Both lineups for a game against an MLB team, or the reason it can't be played yet. */
  async function matchup(userId: number, opponentTeamId: unknown, seasonId?: unknown, develop = false): Promise<{ error: string } | { team: typeof userTeams.$inferSelect; opponent: SimTeam; me: SimTeam; season: SeasonRow | null }> {
    const db = getDb();
    // A season game must be the season's next scheduled one.
    let season: SeasonRow | null = null;
    if (seasonId != null) {
      const sm = await seasonMatch(db, userId, seasonId, Number(opponentTeamId));
      if ("error" in sm) return sm;
      season = sm.season;
    }
    const [team] = await db.select().from(userTeams).where(eq(userTeams.userId, userId));
    if (!team) return { error: "Draft your team first." };
    if (team.status !== "ready") return { error: "Finish your draft before playing." };

    const players = await teamPlayers(db, team.id, develop);
    const opponent = mlbSimTeam(Number(opponentTeamId), new Set(players.map((p) => p.id)));
    if (!opponent) return { error: "Pick an MLB team to play." };
    return { team, opponent, me: userSimTeam(team.name, team.color, players, pool().statsSeason || new Date().getUTCFullYear(), team.gear), season };
  }

  // Play it yourself: the browser runs the game pitch by pitch (the engine is pure TypeScript),
  // so all it needs from us is the two lineups and a seed.
  app.post<{ Body: { opponentTeamId?: number; seasonId?: number; innings?: number; difficulty?: string } }>("/api/games/interactive", { preHandler: requireUser }, async (req, reply) => {
    const m = await matchup(req.user!.id, req.body?.opponentTeamId, req.body?.seasonId);
    if ("error" in m) return reply.code(400).send({ error: m.error });
    const len = matchInnings(req.body?.innings, m.season);
    if ("error" in len) return reply.code(400).send({ error: len.error });
    const difficulty = req.body?.difficulty ?? "pro";
    if (!isDifficulty(difficulty)) return reply.code(400).send({ error: "Pick Rookie, Pro or All-Star." });
    const id = Number(req.body!.opponentTeamId);
    const body: InteractiveSetup = {
      seed: randomInt(0, 2 ** 31 - 1), innings: len.innings, rules: CURRENT_RULES, difficulty, userSide: "home",
      opponent: { id, name: m.opponent.name, abbr: m.opponent.abbr }, teams: { away: m.opponent, home: m.me },
    };
    return reply.code(201).send(body);
  });

  // The game is over: replay the user's choices against the seed with today's lineups, and record
  // what that gives. The browser sends the score it saw so a lineup edited mid-game is caught.
  app.post<{ Body: { opponentTeamId?: number; seasonId?: number; seed?: number; inputs?: unknown[]; final?: { away: number; home: number }; innings?: number; rules?: number; difficulty?: string; pace?: unknown; clientGameId?: string } }>(
    "/api/games/interactive/finish", { preHandler: requireUser }, async (req, reply) => {
      const db = getDb();
      const { seed, inputs, final } = req.body ?? {};
      // A browser that loaded before rules versioning sends neither field and played rules 1.
      const rules = req.body?.rules ?? 1;
      const difficulty = req.body?.difficulty ?? "pro";
      if (!Number.isInteger(seed) || !Array.isArray(inputs) || inputs.length > 2000 || !inputs.every(isInput) || !final || (rules !== 1 && rules !== 2 && rules !== 3 && rules !== 4 && rules !== 5 && rules !== 6 && rules !== 7) || !isDifficulty(difficulty)) {
        return reply.code(400).send({ error: "That game can't be saved." });
      }
      const clientGameId = req.body?.clientGameId;
      if (clientGameId !== undefined && (typeof clientGameId !== "string" || !/^[\w-]{8,64}$/.test(clientGameId))) return reply.code(400).send({ error: "That game can't be saved." });
      // A retry of an upload that already landed: hand back the saved game, pay nothing again.
      if (clientGameId) {
        const [dup] = await db.select({ g: games, t: mlbTeams }).from(games).innerJoin(mlbTeams, eq(mlbTeams.id, games.opponentTeamId))
          .where(and(eq(games.userId, req.user!.id), eq(games.clientGameId, clientGameId)));
        if (dup) return reply.code(200).send(played(dup.g, { id: dup.t.id, name: dup.t.name, abbr: dup.t.abbreviation }));
      }
      // Rules 1-2 games were played with level-boosted ratings; rules 3 ignores levels.
      const m = await matchup(req.user!.id, req.body?.opponentTeamId, req.body?.seasonId, rules < 3);
      if ("error" in m) return reply.code(400).send({ error: m.error });
      const { team, opponent, me, season } = m;
      const len = matchInnings(req.body?.innings, season);
      if ("error" in len) return reply.code(400).send({ error: len.error });
      if (season?.format === ARCADE_FORMAT && rules !== CURRENT_RULES) return reply.code(400).send({ error: "Update the game to play this season." });
      const teams = { away: opponent, home: me };
      // A log that doesn't fit this seed, lineup or length throws mid-replay; that is a refusal, not a server fault.
      let result: GameResult | null = null;
      try { result = playInteractive({ ...teams, seed: seed!, innings: len.innings, rules: rules as RulesVersion, difficulty, userSide: "home", inputs }).result; } catch { /* handled below */ }
      if (!result || result.final.away !== final.away || result.final.home !== final.home) {
        return reply.code(409).send({ error: "Your lineup changed during the game, so it couldn't be saved." });
      }
      const pace = cleanPace(req.body?.pace);
      if (pace) req.log.info({ pace, seed }, "match pace");
      const outcome = result.winner === null ? "T" : result.winner === "home" ? "W" : "L";
      const reward = await payout(db, req.user!.id, result, outcome);
      const [row] = await db.insert(games).values({
        userId: req.user!.id, teamId: team.id, opponentTeamId: Number(req.body!.opponentTeamId), seed: seed!, innings: len.innings, rules, difficulty,
        userSide: "home", teams, inputs, clientGameId, userScore: result.final.home, opponentScore: result.final.away, result: outcome, coins: reward.total,
      }).returning();
      if (season) await settleSeasonGame(db, season, row.id, outcome, result, reward);
      reward.levelUps = await awardXp(db, team.id, result, outcome);
      const body: PlayedGame = { id: row.id, createdAt: row.createdAt.toISOString(), opponent: { id: Number(req.body!.opponentTeamId), name: opponent.name, abbr: opponent.abbr }, userSide: "home", teams, result, reward, rules: row.rules, difficulty: row.difficulty };
      return reply.code(201).send(body);
    },
  );

  app.post<{ Body: { opponentTeamId?: number; seasonId?: number; innings?: number } }>("/api/games", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const m = await matchup(req.user!.id, req.body?.opponentTeamId, req.body?.seasonId);
    if ("error" in m) return reply.code(400).send({ error: m.error });
    const { team, opponent, me, season } = m;
    const len = matchInnings(req.body?.innings, season);
    if ("error" in len) return reply.code(400).send({ error: len.error });
    // You're the home team: you always get the last at-bat.
    const teams = { away: opponent, home: me };
    const seed = randomInt(0, 2 ** 31 - 1);
    const result = simulateGame({ ...teams, seed, innings: len.innings, rules: CURRENT_RULES });
    const outcome = result.winner === null ? "T" : result.winner === "home" ? "W" : "L";
    const reward = await payout(db, req.user!.id, result, outcome);

    const [row] = await db.insert(games).values({
      userId: req.user!.id, teamId: team.id, opponentTeamId: Number(req.body!.opponentTeamId), seed, innings: len.innings, rules: CURRENT_RULES,
      userSide: "home", teams, userScore: result.final.home, opponentScore: result.final.away, result: outcome, coins: reward.total,
    }).returning();
    if (season) await settleSeasonGame(db, season, row.id, outcome, result, reward);
    reward.levelUps = await awardXp(db, team.id, result, outcome);
    const body: PlayedGame = { id: row.id, createdAt: row.createdAt.toISOString(), opponent: { id: Number(req.body!.opponentTeamId), name: opponent.name, abbr: opponent.abbr }, userSide: "home", teams, result, reward, rules: row.rules };
    return reply.code(201).send(body);
  });

  app.get("/api/games", { preHandler: requireUser }, async (req): Promise<GameHistory> => {
    const db = getDb();
    const rows = await db.select({ g: games, t: mlbTeams }).from(games)
      .innerJoin(mlbTeams, eq(mlbTeams.id, games.opponentTeamId))
      .where(eq(games.userId, req.user!.id)).orderBy(desc(games.id));
    const record = { w: 0, l: 0, t: 0 };
    for (const { g } of rows) record[g.result === "W" ? "w" : g.result === "L" ? "l" : "t"]++;
    return {
      record,
      games: rows.slice(0, 20).map(({ g, t }) => ({
        id: g.id, createdAt: g.createdAt.toISOString(), opponent: { id: t.id, name: t.name, abbr: t.abbreviation },
        userScore: g.userScore, opponentScore: g.opponentScore, result: g.result,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/games/:id", { preHandler: requireUser }, async (req, reply) => {
    const db = getDb();
    const [row] = await db.select({ g: games, t: mlbTeams }).from(games)
      .innerJoin(mlbTeams, eq(mlbTeams.id, games.opponentTeamId))
      .where(and(eq(games.id, Number(req.params.id)), eq(games.userId, req.user!.id)));
    if (!row) return reply.code(404).send({ error: "Game not found." });
    return played(row.g, { id: row.t.id, name: row.t.name, abbr: row.t.abbreviation });
  });
}
