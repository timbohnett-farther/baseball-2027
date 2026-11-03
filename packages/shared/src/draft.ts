// Draft rules: pick any 12 players you want (9-man lineup + 3 pitchers). No salary cap:
// balance comes from team chemistry (see chemistry.ts).
// Shared so the draft screen shows exactly what the server enforces.

export const ROSTER_SIZE = 12;
export const LINEUP_SIZE = 9;
export const STAFF_SIZE = 3;

export type Slot = "C" | "1B" | "2B" | "3B" | "SS" | "OF" | "SP" | "RP" | "DH";

/** Minimum players at each spot for a team to be game-ready. */
// 9-man lineup: one at each infield spot, three outfielders, plus a DH (any hitter).
// Staff: one starter plus any two more pitchers (starters can relieve), enough for a 3-inning game.
export const REQUIREMENTS: { slot: Slot | "H" | "P"; label: string; min: number }[] = [
  { slot: "C", label: "Catcher", min: 1 },
  { slot: "1B", label: "First base", min: 1 },
  { slot: "2B", label: "Second base", min: 1 },
  { slot: "3B", label: "Third base", min: 1 },
  { slot: "SS", label: "Shortstop", min: 1 },
  { slot: "OF", label: "Outfielders", min: 3 },
  { slot: "H", label: "Hitters (lineup of 9)", min: 9 },
  { slot: "SP", label: "Starting pitcher", min: 1 },
  { slot: "P", label: "Pitchers (1 starter + 2 more)", min: 3 },
];

export interface DraftPick {
  playerId: number;
  position: string;
  role: "H" | "SP" | "RP" | "TWP";
}

/** Which slots a player fills. Two-way players count as a hitter and a starting pitcher. */
export function slotsFor(pick: Pick<DraftPick, "position" | "role">): Slot[] {
  if (pick.role === "TWP") return ["DH", "SP"];
  if (pick.role === "SP" || pick.role === "RP") return [pick.role];
  if (["LF", "CF", "RF", "OF"].includes(pick.position)) return ["OF"];
  if (["C", "1B", "2B", "3B", "SS"].includes(pick.position)) return [pick.position as Slot];
  return ["DH"];
}

export interface DraftStatus {
  size: number;
  counts: Record<string, number>;
  /** What still blocks finishing the draft, in plain words. Empty = ready to play. */
  problems: string[];
  ready: boolean;
}

export function draftStatus(picks: DraftPick[]): DraftStatus {
  const counts: Record<string, number> = {};
  for (const p of picks) {
    const slots = slotsFor(p);
    for (const s of slots) counts[s] = (counts[s] ?? 0) + 1;
    if (slots.some((s) => s !== "SP" && s !== "RP")) counts.H = (counts.H ?? 0) + 1;
    if (slots.some((s) => s === "SP" || s === "RP")) counts.P = (counts.P ?? 0) + 1;
  }
  const problems: string[] = [];
  if (picks.length !== ROSTER_SIZE) problems.push(`Pick ${ROSTER_SIZE} players (you have ${picks.length}).`);
  for (const r of REQUIREMENTS) {
    const have = counts[r.slot] ?? 0;
    if (have < r.min) problems.push(`${r.label}: need ${r.min}, have ${have}.`);
  }
  return { size: picks.length, counts, problems, ready: problems.length === 0 };
}

/** Can this player be added right now? Returns a reason if not. */
export function canAdd(picks: DraftPick[], pick: DraftPick): string | null {
  if (picks.some((p) => p.playerId === pick.playerId)) return "Already on your team.";
  if (picks.length >= ROSTER_SIZE) return `Your roster is full (${ROSTER_SIZE}).`;
  // Two-way players fit either group, so they're never blocked here.
  const isPitcher = (r: DraftPick["role"]) => r === "SP" || r === "RP";
  if (pick.role === "H" && picks.filter((p) => p.role === "H").length >= LINEUP_SIZE) return `Your lineup already has ${LINEUP_SIZE} hitters.`;
  if (isPitcher(pick.role) && picks.filter((p) => isPitcher(p.role)).length >= STAFF_SIZE) return `Your staff already has ${STAFF_SIZE} pitchers.`;
  return null;
}
