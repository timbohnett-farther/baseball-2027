import { computeRatings, type HittingLine, type MlbTeam, type PitchingLine, type Player, type RatingInput } from "@bb/shared";
import {
  getOutsAboveAverage, getPeople, getPitcherVelo, getRoster, getSeasonStats, getSprintSpeed, getTeams,
  type ApiPerson, type ApiSplit,
} from "./sources.ts";

export interface PlayerPool {
  statsSeason: number;
  rosterSeason: number;
  teams: MlbTeam[];
  players: Player[];
}

// Players not on a 40-man roster are still draftable if they played this much in the latest season.
const FREE_AGENT_MIN_PA = 50;
const FREE_AGENT_MIN_OUTS = 45;

type HitStat = Record<string, number | string>;
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
/** "74.1" innings = 74 and one third. */
const innings = (v: unknown) => { const [whole, part] = String(v ?? "0").split("."); return n(whole) + n(part) / 3; };

const hittingLine = (s: HitStat): HittingLine => ({
  pa: n(s.plateAppearances), ab: n(s.atBats), h: n(s.hits), doubles: n(s.doubles), triples: n(s.triples),
  hr: n(s.homeRuns), bb: n(s.baseOnBalls), ibb: n(s.intentionalWalks), hbp: n(s.hitByPitch), so: n(s.strikeOuts),
  sb: n(s.stolenBases), cs: n(s.caughtStealing),
});

const pitchingLine = (s: HitStat): PitchingLine => ({
  bf: n(s.battersFaced), outs: n(s.outs), g: n(s.gamesPitched ?? s.gamesPlayed), gs: n(s.gamesStarted),
  so: n(s.strikeOuts), bb: n(s.baseOnBalls), hbp: n(s.hitByPitch), hr: n(s.homeRuns),
  groundOuts: n(s.groundOuts), airOuts: n(s.airOuts),
});

/** Run tasks with limited concurrency, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** Statcast is a nice-to-have: if Savant is down, ratings fall back to box-score stats. */
async function optional<T>(label: string, p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (err) { console.warn(`[refresh] ${label} unavailable: ${(err as Error).message}`); return []; }
}

export async function buildPlayerPool(log: (msg: string) => void = console.log, now = new Date()): Promise<PlayerPool> {
  const rosterSeason = now.getUTCFullYear();
  // Before April the newest full season is last year's.
  const statsSeason = now.getUTCMonth() < 3 ? rosterSeason - 1 : rosterSeason;
  const mlbYears = [statsSeason, statsSeason - 1, statsSeason - 2];
  const aaaYears = [statsSeason, statsSeason - 1];
  const statcastYears = [statsSeason, statsSeason - 1];

  const apiTeams = (await getTeams(rosterSeason)).sort((a, b) => a.name.localeCompare(b.name));
  const teams: MlbTeam[] = apiTeams.map((t) => ({ id: t.id, name: t.name, abbreviation: t.abbreviation, league: t.league.name, division: t.division.name }));
  const rosters = await mapLimit(apiTeams, 6, (t) => getRoster(t.id, rosterSeason));
  log(`[refresh] ${teams.length} teams, ${rosters.flat().length} players on 40-man rosters`);

  const [mlbHit, mlbPit, mlbFld, aaaHit, aaaPit, sprint, oaa, velo] = await Promise.all([
    Promise.all(mlbYears.map((y) => getSeasonStats<HitStat>("hitting", y, 1))),
    Promise.all(mlbYears.map((y) => getSeasonStats<HitStat>("pitching", y, 1))),
    Promise.all(mlbYears.map((y) => getSeasonStats<HitStat>("fielding", y, 1))),
    Promise.all(aaaYears.map((y) => getSeasonStats<HitStat>("hitting", y, 11))),
    Promise.all(aaaYears.map((y) => getSeasonStats<HitStat>("pitching", y, 11))),
    Promise.all(statcastYears.map((y) => optional(`sprint speed ${y}`, getSprintSpeed(y)))),
    Promise.all(statcastYears.map((y) => optional(`outs above average ${y}`, getOutsAboveAverage(y)))),
    Promise.all(statcastYears.map((y) => optional(`pitch velocity ${y}`, getPitcherVelo(y)))),
  ]);
  log(`[refresh] stats: ${mlbHit[0].length} MLB hitters, ${mlbPit[0].length} MLB pitchers in ${statsSeason}`);

  // Who is in the pool: everyone on a 40-man, plus unsigned players who played real innings.
  const onRoster = new Map<number, { teamId: number; jersey: string | null; position: string; status: string; person: ApiPerson }>();
  rosters.forEach((roster, i) => {
    for (const e of roster) {
      onRoster.set(e.person.id, {
        teamId: apiTeams[i].id, jersey: e.jerseyNumber ?? e.person.primaryNumber ?? null,
        position: e.position?.abbreviation ?? e.person.primaryPosition?.abbreviation ?? "UT",
        status: e.status?.description ?? "Active", person: e.person,
      });
    }
  });
  const freeAgentIds = new Set<number>();
  for (const s of mlbHit[0]) if (!onRoster.has(s.player.id) && n(s.stat.plateAppearances) >= FREE_AGENT_MIN_PA) freeAgentIds.add(s.player.id);
  for (const s of mlbPit[0]) if (!onRoster.has(s.player.id) && n(s.stat.outs) >= FREE_AGENT_MIN_OUTS) freeAgentIds.add(s.player.id);
  const freeAgents = (await getPeople([...freeAgentIds])).filter((p) => p.primaryPosition);
  log(`[refresh] ${freeAgents.length} free agents added`);

  // Index every stat source by player id.
  const byId = <S>(splits: ApiSplit<S>[]) => new Map(splits.map((s) => [s.player.id, s.stat]));
  const hitIdx = [...mlbHit.map((s, i) => ({ year: mlbYears[i], level: "MLB" as const, m: byId(s) })),
    ...aaaHit.map((s, i) => ({ year: aaaYears[i], level: "AAA" as const, m: byId(s) }))];
  const pitIdx = [...mlbPit.map((s, i) => ({ year: mlbYears[i], level: "MLB" as const, m: byId(s) })),
    ...aaaPit.map((s, i) => ({ year: aaaYears[i], level: "AAA" as const, m: byId(s) }))];
  const fieldRows = new Map<number, RatingInput["fielding"]>();
  mlbFld.forEach((splits, i) => {
    for (const s of splits) {
      const list = fieldRows.get(s.player.id) ?? [];
      list.push({
        year: mlbYears[i], oaa: null, innings: innings(s.stat.innings), position: s.position?.abbreviation ?? "",
        caughtStealing: n(s.stat.caughtStealing), stolenBases: n(s.stat.stolenBases),
      });
      fieldRows.set(s.player.id, list);
    }
  });
  oaa.forEach((rows, i) => {
    for (const r of rows) {
      const id = n(r.player_id);
      const list = fieldRows.get(id) ?? [];
      list.push({ year: statcastYears[i], oaa: n(r.outs_above_average), innings: 0, position: r.primary_pos_formatted ?? "" });
      fieldRows.set(id, list);
    }
  });
  const sprintRows = new Map<number, RatingInput["sprint"]>();
  sprint.forEach((rows, i) => {
    for (const r of rows) {
      if (!r.sprint_speed) continue;
      const id = n(r.player_id);
      sprintRows.set(id, [...(sprintRows.get(id) ?? []), { year: statcastYears[i], speed: n(r.sprint_speed), runs: n(r.competitive_runs) }]);
    }
  });
  const veloRows = new Map<number, RatingInput["velo"]>();
  velo.forEach((rows, i) => {
    for (const r of rows) {
      if (!r.fastball_avg_speed) continue;
      const id = n(r.player_id);
      veloRows.set(id, [...(veloRows.get(id) ?? []), { year: statcastYears[i], mph: n(r.fastball_avg_speed), ip: innings(r.p_formatted_ip) }]);
    }
  });

  const entries = [
    ...[...onRoster.entries()].map(([id, r]) => ({ id, ...r })),
    ...freeAgents.map((p) => ({ id: p.id, teamId: null, jersey: null, position: p.primaryPosition!.abbreviation, status: "Free Agent", person: p })),
  ];

  const inputs: RatingInput[] = entries.map(({ id, position }) => ({
    id,
    position,
    hitting: hitIdx.flatMap(({ year, level, m }) => (m.has(id) ? [{ year, level, line: hittingLine(m.get(id)!) }] : [])),
    pitching: pitIdx.flatMap(({ year, level, m }) => (m.has(id) ? [{ year, level, line: pitchingLine(m.get(id)!) }] : [])),
    sprint: sprintRows.get(id) ?? [],
    fielding: fieldRows.get(id) ?? [],
    velo: veloRows.get(id) ?? [],
  }));
  const ratings = new Map(computeRatings(inputs, statsSeason).map(({ id, ...r }) => [id, r]));
  const teamAbbr = new Map(teams.map((t) => [t.id, t.abbreviation]));

  const players: Player[] = entries.map(({ id, teamId, jersey, position, status, person: p }) => ({
    id,
    name: p.fullName,
    firstName: p.useName ?? p.firstName ?? "",
    lastName: p.useLastName ?? p.lastName ?? "",
    jersey,
    position,
    bats: p.batSide?.code ?? null,
    throws: p.pitchHand?.code ?? null,
    age: p.currentAge ?? null,
    birthDate: p.birthDate ?? null,
    birthCountry: p.birthCountry ?? null,
    height: p.height ?? null,
    weight: p.weight ?? null,
    mlbDebut: p.mlbDebutDate ?? null,
    teamId,
    teamAbbr: teamId ? teamAbbr.get(teamId) ?? null : null,
    status,
    ratings: ratings.get(id)!,
  }));
  players.sort((a, b) => b.ratings.overall - a.ratings.overall || a.lastName.localeCompare(b.lastName));
  log(`[refresh] rated ${players.length} players`);
  return { statsSeason, rosterSeason, teams, players };
}
