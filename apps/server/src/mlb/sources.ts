// Raw data from the public MLB Stats API and Baseball Savant (Statcast). No keys needed.

const STATS_API = "https://statsapi.mlb.com/api/v1";
const SAVANT = "https://baseballsavant.mlb.com/leaderboard";

async function fetchText(url: string, tries = 3): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "baseball-2027 (family game)" }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.text();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const getJson = async <T>(path: string): Promise<T> => JSON.parse(await fetchText(`${STATS_API}${path}`)) as T;

/** Minimal CSV parser (handles quoted fields with commas). Strips a leading BOM. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// --- MLB Stats API ---------------------------------------------------------

export interface ApiPerson {
  id: number; fullName: string; firstName?: string; lastName?: string; useName?: string; useLastName?: string;
  primaryNumber?: string; birthDate?: string; currentAge?: number; birthCountry?: string; height?: string; weight?: number;
  mlbDebutDate?: string; active?: boolean;
  primaryPosition?: { abbreviation: string; type: string };
  batSide?: { code: string }; pitchHand?: { code: string };
}

export interface ApiTeam { id: number; name: string; abbreviation: string; league: { name: string }; division: { name: string } }

export interface ApiRosterEntry {
  person: ApiPerson; jerseyNumber?: string; position?: { abbreviation: string; type: string }; status?: { description: string };
}

export interface ApiSplit<S> { player: { id: number; fullName: string }; position?: { abbreviation: string }; team?: { id: number }; stat: S }

export const getTeams = (season: number) => getJson<{ teams: ApiTeam[] }>(`/teams?sportId=1&season=${season}`).then((d) => d.teams);

export const getRoster = (teamId: number, season: number) =>
  getJson<{ roster?: ApiRosterEntry[] }>(`/teams/${teamId}/roster?rosterType=40Man&season=${season}&hydrate=person`).then((d) => d.roster ?? []);

export async function getPeople(ids: number[]): Promise<ApiPerson[]> {
  const out: ApiPerson[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const batch = ids.slice(i, i + 150).join(",");
    out.push(...(await getJson<{ people: ApiPerson[] }>(`/people?personIds=${batch}`)).people);
  }
  return out;
}

/** sportId 1 = MLB, 11 = Triple-A. */
export const getSeasonStats = <S>(group: "hitting" | "pitching" | "fielding", season: number, sportId: 1 | 11) =>
  getJson<{ stats: { splits: ApiSplit<S>[] }[] }>(
    `/stats?stats=season&group=${group}&season=${season}&sportId=${sportId}&playerPool=ALL&limit=5000`,
  ).then((d) => d.stats[0]?.splits ?? []);

// --- Baseball Savant (Statcast) ---------------------------------------------

export const getSprintSpeed = async (year: number) =>
  parseCsv(await fetchText(`${SAVANT}/sprint_speed?year=${year}&position=&team=&min=0&csv=true`));

export const getOutsAboveAverage = async (year: number) =>
  parseCsv(await fetchText(`${SAVANT}/outs_above_average?type=Fielder&year=${year}&min=0&csv=true`));

export const getPitcherVelo = async (year: number) =>
  parseCsv(await fetchText(`${SAVANT}/custom?year=${year}&type=pitcher&min=1&selections=p_formatted_ip,fastball_avg_speed&csv=true`));
