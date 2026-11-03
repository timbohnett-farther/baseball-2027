// Draft rules: build a 12-player arcade team (9-man lineup + 3 pitchers) under a salary cap.
// Shared so the draft screen shows exactly what the server enforces.

/** Salaries are whole tenths of a million ($M) so they stay exact integers. */
export const SALARY_CAP = 600; // $60.0M
export const ROSTER_SIZE = 12;
export const LINEUP_SIZE = 9;
export const STAFF_SIZE = 3;
export const MIN_SALARY = 5; // $0.5M

/** Salary in tenths of $M. Grows ~9% per rating point: 60 ≈ $1.3M, 70 ≈ $3M, 80 ≈ $7M, 90 ≈ $17M, 99 ≈ $37M. */
export function salaryFor(overall: number): number {
  return Math.max(MIN_SALARY, Math.round(30 * 1.09 ** (overall - 70)));
}

export const formatSalary = (tenths: number) => `$${(tenths / 10).toFixed(1)}M`;

export type Slot = "C" | "1B" | "2B" | "3B" | "SS" | "OF" | "SP" | "RP" | "DH";

/** Minimum players at each spot for a team to be game-ready. */
// 9-man lineup: one at each infield spot, three outfielders, plus a DH (any hitter).
// Staff: one starter and two relievers, enough for a 3-inning game.
export const REQUIREMENTS: { slot: Slot | "H" | "P"; label: string; min: number }[] = [
  { slot: "C", label: "Catcher", min: 1 },
  { slot: "1B", label: "First base", min: 1 },
  { slot: "2B", label: "Second base", min: 1 },
  { slot: "3B", label: "Third base", min: 1 },
  { slot: "SS", label: "Shortstop", min: 1 },
  { slot: "OF", label: "Outfielders", min: 3 },
  { slot: "H", label: "Hitters (lineup of 9)", min: 9 },
  { slot: "SP", label: "Starting pitcher", min: 1 },
  { slot: "RP", label: "Relief pitchers", min: 2 },
  { slot: "P", label: "Pitchers (any)", min: 3 },
];

export interface DraftPick {
  playerId: number;
  position: string;
  role: "H" | "SP" | "RP" | "TWP";
  salary: number;
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
  payroll: number;
  budgetLeft: number;
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
  const payroll = picks.reduce((s, p) => s + p.salary, 0);
  const problems: string[] = [];
  if (picks.length !== ROSTER_SIZE) problems.push(`Pick ${ROSTER_SIZE} players (you have ${picks.length}).`);
  if (payroll > SALARY_CAP) problems.push(`Over the salary cap by ${formatSalary(payroll - SALARY_CAP)}.`);
  for (const r of REQUIREMENTS) {
    const have = counts[r.slot] ?? 0;
    if (have < r.min) problems.push(`${r.label}: need ${r.min}, have ${have}.`);
  }
  return { size: picks.length, payroll, budgetLeft: SALARY_CAP - payroll, counts, problems, ready: problems.length === 0 };
}

/** Can this player be added right now? Returns a reason if not. */
export function canAdd(picks: DraftPick[], pick: DraftPick): string | null {
  if (picks.some((p) => p.playerId === pick.playerId)) return "Already on your team.";
  if (picks.length >= ROSTER_SIZE) return `Your roster is full (${ROSTER_SIZE}).`;
  // Two-way players fit either group, so they're never blocked here.
  const isPitcher = (r: DraftPick["role"]) => r === "SP" || r === "RP";
  if (pick.role === "H" && picks.filter((p) => p.role === "H").length >= LINEUP_SIZE) return `Your lineup already has ${LINEUP_SIZE} hitters.`;
  if (isPitcher(pick.role) && picks.filter((p) => isPitcher(p.role)).length >= STAFF_SIZE) return `Your staff already has ${STAFF_SIZE} pitchers.`;
  const payroll = picks.reduce((s, p) => s + p.salary, 0);
  if (payroll + pick.salary > SALARY_CAP) return `Not enough budget: ${formatSalary(SALARY_CAP - payroll)} left.`;
  // Keep enough money to fill the remaining spots at the minimum salary.
  const spotsAfter = ROSTER_SIZE - picks.length - 1;
  if (payroll + pick.salary + spotsAfter * MIN_SALARY > SALARY_CAP) {
    return `You'd need ${formatSalary(spotsAfter * MIN_SALARY)} left to fill your other ${spotsAfter} spots.`;
  }
  return null;
}
