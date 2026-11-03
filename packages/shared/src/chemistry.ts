// Team chemistry: draft anyone you want, but who you put together changes how they play.
// Every effect is a set of rating changes on specific players, so the game engine can use
// them directly and the draft screen can explain them.

import type { Player } from "./index.ts";
import type { HittingRatings, PitchingRatings } from "./ratings.ts";

export type Skill = keyof HittingRatings | keyof PitchingRatings | "all";

export interface Mod { playerId: number; skill: Skill; amount: number }

export interface ChemistryEffect {
  id: string;
  name: string;
  good: boolean;
  /** One plain sentence a kid can read. */
  description: string;
  playerIds: number[];
  mods: Mod[];
}

export interface PlayerBoost {
  playerId: number;
  overall: number;     // base rating
  effective: number;   // after chemistry
  delta: number;
  skills: Partial<Record<Exclude<Skill, "all">, number>>; // effective skill values that changed
}

export interface ChemistryReport {
  effects: ChemistryEffect[];
  players: PlayerBoost[];
  /** Average effective overall: the one number to compare teams. */
  teamPower: number;
  basePower: number;
}

// --- Rivalries -----------------------------------------------------------------

export const RIVALRIES: { teams: [string, string]; name: string }[] = [
  { teams: ["NYY", "BOS"], name: "The Rivalry" },
  { teams: ["LAD", "SF"], name: "Dodgers vs. Giants" },
  { teams: ["CHC", "STL"], name: "Route 66 Rivalry" },
  { teams: ["NYY", "NYM"], name: "Subway Series" },
  { teams: ["CHC", "CWS"], name: "Crosstown Classic" },
  { teams: ["LAD", "LAA"], name: "Freeway Series" },
  { teams: ["HOU", "TEX"], name: "Lone Star Series" },
  { teams: ["ATH", "SF"], name: "Bay Bridge Series" },
  { teams: ["BAL", "WSH"], name: "Beltway Series" },
  { teams: ["KC", "STL"], name: "Show-Me Series" },
  { teams: ["CLE", "CIN"], name: "Ohio Cup" },
  { teams: ["MIA", "TB"], name: "Citrus Series" },
  { teams: ["NYM", "PHI"], name: "NL East Feud" },
  { teams: ["ATL", "NYM"], name: "NL East Feud" },
  { teams: ["ATL", "PHI"], name: "NL East Feud" },
  { teams: ["LAD", "SD"], name: "I-5 Feud" },
  { teams: ["PHI", "PIT"], name: "Keystone Cup" },
  { teams: ["CHC", "MIL"], name: "I-94 Rivalry" },
];

const rivalryOf = (a: string | null, b: string | null) =>
  a && b ? RIVALRIES.find((r) => (r.teams[0] === a && r.teams[1] === b) || (r.teams[0] === b && r.teams[1] === a)) : undefined;

// --- Tuning ----------------------------------------------------------------------

/** How much spotlight each star wants. Total room on a team: SPOTLIGHT_ROOM. */
// Only 90+ players are stars: 90-94 = 1, 95-98 = 2, 99 = 3. Room for 6 (two 99s, or a handful of stars).
export function starPower(overall: number): number {
  return overall >= 99 ? 3 : overall >= 95 ? 2 : overall >= 90 ? 1 : 0;
}
export const SPOTLIGHT_ROOM = 6;

const isPitcher = (p: Player) => p.ratings.role === "SP" || p.ratings.role === "RP";
const isHitter = (p: Player) => !isPitcher(p);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const nameList = (ps: Player[]) => ps.map((p) => p.lastName || p.name).join(", ");

// --- The effects -------------------------------------------------------------------

/** Rookies: debuted this season or last, or haven't debuted yet. */
export const isRookie = (p: Player, season: number) => !p.mlbDebut || Number(p.mlbDebut.slice(0, 4)) >= season - 1;
export const isVeteran = (p: Player) => (p.age ?? 0) >= 34;
/** Big personality: a slugger with elite power, or any 99. */
const isHitterRole = (p: Player) => p.ratings.role === "H" || p.ratings.role === "TWP";
export const isShowboat = (p: Player) => isHitterRole(p) && ((p.ratings.hitting?.power ?? 0) >= 95 || p.ratings.overall >= 99);
/** Glue guy: not a star, but makes contact and catches everything. */
export const isGlueGuy = (p: Player) => {
  const h = p.ratings.hitting;
  return !!h && isHitterRole(p) && p.ratings.overall >= 72 && p.ratings.overall < 85 && h.contact >= 80 && h.fielding >= 80;
};

export function chemistry(team: Player[], season = new Date().getUTCFullYear()): ChemistryReport {
  const effects: ChemistryEffect[] = [];
  const add = (e: Omit<ChemistryEffect, "playerIds"> & { playerIds?: number[] }) =>
    effects.push({ ...e, playerIds: e.playerIds ?? [...new Set(e.mods.map((m) => m.playerId))] });
  const hitters = team.filter(isHitter);
  const pitchers = team.filter(isPitcher);
  const vets = team.filter(isVeteran);
  const rookies = team.filter((p) => isRookie(p, season));

  // Bad Blood: rivals in the same dugout. -3 to everything per rival teammate (max -9).
  const rivalCount = new Map<number, number>();
  const feuds = new Map<string, Player[]>();
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const r = rivalryOf(team[i].teamAbbr, team[j].teamAbbr);
      if (!r) continue;
      rivalCount.set(team[i].id, (rivalCount.get(team[i].id) ?? 0) + 1);
      rivalCount.set(team[j].id, (rivalCount.get(team[j].id) ?? 0) + 1);
      const key = `${r.name}:${[...r.teams].sort().join("-")}`;
      const list = feuds.get(key) ?? [];
      for (const p of [team[i], team[j]]) if (!list.includes(p)) list.push(p);
      feuds.set(key, list);
    }
  }
  // A veteran leader who isn't in the feud keeps the peace: Bad Blood hurts half as much.
  const peacemaker = vets.find((v) => !rivalCount.has(v.id));
  const per = peacemaker ? 1.5 : 3;
  for (const [key, ps] of feuds) {
    const name = key.split(":")[0];
    add({
      id: `bad-blood-${key}`, name: `Bad Blood: ${name}`, good: false,
      description: `${nameList(ps)} can't stand sharing a dugout. Rivals lose focus (-${per} per rival teammate${peacemaker ? `, halved by ${peacemaker.lastName}` : ""}).`,
      mods: ps.map((p) => ({ playerId: p.id, skill: "all", amount: -Math.round(clamp(per * (rivalCount.get(p.id) ?? 1), per, 3 * per)) })),
    });
  }
  if (peacemaker && feuds.size) {
    add({
      id: "veteran-presence", name: "Veteran Presence", good: true,
      description: `${peacemaker.lastName} has seen it all and keeps the clubhouse calm. Bad Blood is cut in half.`,
      mods: [], playerIds: [peacemaker.id],
    });
  }

  // Crossed Signals: catcher and a pitcher from rival teams.
  for (const c of hitters.filter((h) => h.position === "C")) {
    for (const p of pitchers) {
      if (rivalryOf(c.teamAbbr, p.teamAbbr)) {
        add({
          id: `crossed-${c.id}-${p.id}`, name: "Crossed Signals", good: false,
          description: `${p.lastName} won't take signs from rival catcher ${c.lastName}. -6 Control.`,
          mods: [{ playerId: p.id, skill: "control", amount: -6 }],
        });
      }
    }
  }

  // Clubhouse Chemistry: 3+ teammates from the same real team.
  const byTeam = new Map<string, Player[]>();
  for (const p of team) if (p.teamAbbr) byTeam.set(p.teamAbbr, [...(byTeam.get(p.teamAbbr) ?? []), p]);
  for (const [abbr, ps] of byTeam) {
    if (ps.length < 3) continue;
    const amount = ps.length >= 5 ? 4 : 2;
    add({
      id: `clubhouse-${abbr}`, name: `Clubhouse Chemistry (${abbr})`, good: true,
      description: `${ps.length} ${abbr} teammates already know each other's game. +${amount} to all.`,
      mods: ps.map((p) => ({ playerId: p.id, skill: "all", amount })),
    });
  }

  // Battery Mates: a pitcher throwing to his real-life catcher.
  for (const c of hitters.filter((h) => h.position === "C" && h.teamAbbr)) {
    const mates = pitchers.filter((p) => p.teamAbbr === c.teamAbbr);
    if (mates.length) {
      add({
        id: `battery-${c.id}`, name: "Battery Mates", good: true,
        description: `${c.lastName} already knows how ${nameList(mates)} likes to pitch. +3 Control, +2 Movement.`,
        mods: mates.flatMap((p) => [{ playerId: p.id, skill: "control" as Skill, amount: 3 }, { playerId: p.id, skill: "movement" as Skill, amount: 2 }]),
        playerIds: [c.id, ...mates.map((p) => p.id)],
      });
    }
  }

  // Spotlight: stars share one spotlight. Over the room, every star's ego costs them.
  const stars = team.filter((p) => starPower(p.ratings.overall) > 0);
  const totalStar = stars.reduce((s, p) => s + starPower(p.ratings.overall), 0);
  if (totalStar > SPOTLIGHT_ROOM) {
    const over = totalStar - SPOTLIGHT_ROOM;
    const amount = -clamp(2 * over, 2, 16);
    add({
      id: "spotlight", name: "Spotlight Overload", good: false,
      description: `Too many stars (${totalStar} star power, room for ${SPOTLIGHT_ROOM}). Everyone wants to be the hero: ${amount} to every star.`,
      mods: stars.map((p) => ({ playerId: p.id, skill: "all", amount })),
    });
  }

  // Overshadowed / Forgotten Arms: the spotlight leans toward pitchers or hitters.
  const hitStar = hitters.reduce((s, p) => s + starPower(p.ratings.overall), 0);
  const pitStar = pitchers.reduce((s, p) => s + starPower(p.ratings.overall), 0);
  const starHitters = hitters.filter((p) => starPower(p.ratings.overall) > 0);
  if (pitStar > hitStar && starHitters.length) {
    const amount = -clamp(2 * (pitStar - hitStar), 2, 12);
    add({
      id: "overshadowed", name: "Overshadowed", good: false,
      description: `Your ace pitchers steal the headlines, and your star hitters press too hard. ${amount} Power.`,
      mods: starHitters.map((p) => ({ playerId: p.id, skill: "power", amount })),
    });
  }
  if (hitStar >= pitStar + 5 && pitchers.length) {
    const amount = -clamp(2 * (hitStar - pitStar - 4), 2, 8);
    add({
      id: "forgotten-arms", name: "Forgotten Arms", good: false,
      description: `All eyes are on your sluggers, so your pitchers lose focus. ${amount} Control and Stamina.`,
      mods: pitchers.flatMap((p) => [{ playerId: p.id, skill: "control" as Skill, amount }, { playerId: p.id, skill: "stamina" as Skill, amount }]),
    });
  }

  // Hungry Free Agents: playing for their next contract.
  const fas = team.filter((p) => p.teamId === null);
  if (fas.length) {
    add({
      id: "hungry", name: "Hungry Free Agents", good: true,
      description: `${nameList(fas)} ${fas.length === 1 ? "is" : "are"} playing for a new contract. +2 to all.`,
      mods: fas.map((p) => ({ playerId: p.id, skill: "all", amount: 2 })),
    });
  }

  // Home Country Pride: 3+ players from the same country (outside the USA).
  const byCountry = new Map<string, Player[]>();
  for (const p of team) if (p.birthCountry && p.birthCountry !== "USA") byCountry.set(p.birthCountry, [...(byCountry.get(p.birthCountry) ?? []), p]);
  for (const [country, ps] of byCountry) {
    if (ps.length < 3) continue;
    add({
      id: `country-${country}`, name: `${country} Pride`, good: true,
      description: `${ps.length} players from ${country} play like it's the World Baseball Classic. +2 Contact or Control.`,
      mods: ps.map((p) => ({ playerId: p.id, skill: isPitcher(p) ? "control" : "contact", amount: 2 })),
    });
  }

  // Rookies: mentored by a veteran (+3), or jittery without one (-3).
  if (rookies.length && vets.length) {
    add({
      id: "mentor", name: "Mentors", good: true,
      description: `${nameList(vets.slice(0, 2))} show${vets.length === 1 ? "s" : ""} the rookies (${nameList(rookies)}) the ropes. +3 to all for the rookies.`,
      mods: rookies.map((p) => ({ playerId: p.id, skill: "all", amount: 3 })),
      playerIds: [...vets.map((p) => p.id), ...rookies.map((p) => p.id)],
    });
  } else if (rookies.length) {
    add({
      id: "rookie-jitters", name: "Rookie Jitters", good: false,
      description: `${nameList(rookies)} ${rookies.length === 1 ? "has" : "have"} nobody to calm the nerves. -3 to all. (A veteran 34+ would mentor them.)`,
      mods: rookies.map((p) => ({ playerId: p.id, skill: "all", amount: -3 })),
    });
  }

  // Big personalities: one showboat lights up the crowd; two or more fight over cleanup.
  const showboats = team.filter(isShowboat);
  if (showboats.length === 1) {
    add({
      id: "showtime", name: "Showtime", good: true,
      description: `${showboats[0].lastName} loves the big stage and has it all to himself. +3 Power.`,
      mods: [{ playerId: showboats[0].id, skill: "power", amount: 3 }],
    });
  } else if (showboats.length >= 2) {
    const amount = -clamp(3 * (showboats.length - 1), 3, 9);
    add({
      id: "clash", name: "Clash of Personalities", good: false,
      description: `${nameList(showboats)} all want to bat cleanup. Big egos press too hard: ${amount} Contact.`,
      mods: showboats.map((p) => ({ playerId: p.id, skill: "contact", amount })),
    });
  }

  // Glue guy: one steady non-star lifts everybody a little.
  const glue = team.find(isGlueGuy);
  if (glue) {
    add({
      id: "glue", name: "Glue Guy", good: true,
      description: `${glue.lastName} does the little things: puts the ball in play and catches everything. +1 to all teammates.`,
      mods: team.filter((p) => p.id !== glue.id).map((p) => ({ playerId: p.id, skill: "all", amount: 1 })),
      playerIds: [glue.id],
    });
  }

  // Old Legs: 4+ players aged 33+ slow everyone down.
  const olds = team.filter((p) => (p.age ?? 0) >= 33);
  if (olds.length >= 4 && hitters.length) {
    add({
      id: "old-legs", name: "Old Legs", good: false,
      description: `${olds.length} players are 33 or older. The whole lineup runs slower: -4 Speed.`,
      mods: hitters.map((p) => ({ playerId: p.id, skill: "speed", amount: -4 })),
    });
  }

  // Lineup handedness: all one side is predictable; a real mix is hard to pitch to.
  if (hitters.length >= 6) {
    const lefty = hitters.filter((p) => p.bats === "L" || p.bats === "S").length;
    const righty = hitters.filter((p) => p.bats === "R" || p.bats === "S").length;
    const sameSide = Math.max(hitters.filter((p) => p.bats === "L").length, hitters.filter((p) => p.bats === "R").length);
    if (sameSide >= 7) {
      add({
        id: "predictable", name: "Predictable Lineup", good: false,
        description: `${sameSide} hitters bat from the same side, so pitchers know exactly what's coming. -2 Contact.`,
        mods: hitters.map((p) => ({ playerId: p.id, skill: "contact", amount: -2 })),
      });
    } else if (lefty >= 3 && righty >= 3) {
      add({
        id: "balanced", name: "Lefty-Righty Mix", good: true,
        description: "Lefties, righties and switch-hitters keep pitchers guessing. +1 Contact.",
        mods: hitters.map((p) => ({ playerId: p.id, skill: "contact", amount: 1 })),
      });
    }
  }

  // Strength Up the Middle: great gloves at C, SS and CF help every pitcher.
  const glove = (pos: string) => hitters.some((p) => p.position === pos && (p.ratings.hitting?.fielding ?? 0) >= 80);
  if (glove("C") && glove("SS") && glove("CF") && pitchers.length) {
    add({
      id: "up-the-middle", name: "Strength Up the Middle", good: true,
      description: "Gold-glove defense at catcher, shortstop and center field. Pitchers can attack: +3 Movement.",
      mods: pitchers.map((p) => ({ playerId: p.id, skill: "movement", amount: 3 })),
    });
  }

  return report(team, effects);
}

function report(team: Player[], effects: ChemistryEffect[]): ChemistryReport {
  const players: PlayerBoost[] = team.map((p) => {
    const mods = effects.flatMap((e) => e.mods).filter((m) => m.playerId === p.id);
    const all = mods.filter((m) => m.skill === "all").reduce((s, m) => s + m.amount, 0);
    const base = { ...(p.ratings.hitting ?? {}), ...(p.ratings.pitching ?? {}) } as Record<string, number>;
    const skills: PlayerBoost["skills"] = {};
    const relevant = Object.keys(base);
    for (const k of relevant) {
      const specific = mods.filter((m) => m.skill === k).reduce((s, m) => s + m.amount, 0);
      if (all || specific) (skills as Record<string, number>)[k] = clamp(base[k] + all + specific, 30, 99);
    }
    // A single-skill change moves the overall less than an across-the-board change.
    const specificTotal = mods.filter((m) => m.skill !== "all" && relevant.includes(m.skill)).reduce((s, m) => s + m.amount, 0);
    const effective = clamp(Math.round(p.ratings.overall + all + 0.4 * specificTotal), 30, 99);
    return { playerId: p.id, overall: p.ratings.overall, effective, delta: effective - p.ratings.overall, skills };
  });
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0);
  return {
    effects: effects.sort((a, b) => Number(b.good) - Number(a.good)),
    players,
    teamPower: avg(players.map((p) => p.effective)),
    basePower: avg(players.map((p) => p.overall)),
  };
}
