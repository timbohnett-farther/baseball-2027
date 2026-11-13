// AI-vs-AI soak for pace and balance numbers (W29). Not a test: `SOAK_N=200 node packages/sim/src/soak.ts`.
// A bot (same policy as the computer, see makeBot) sits in the user seat against the engine's computer; the numbers
// come from the event log. Teams are synthetic and even (rating 70) unless SOAK_REAL=1 (MLB clubs from data/players.json).
import { readFileSync } from "node:fs";
import { createRng } from "./rng.ts";
import { autoLineup, CURRENT_RULES, playInteractive } from "./game.ts";
import { DIFFICULTIES, makeBot } from "./cpu.ts";
import { blockingBudgetMs } from "../../../apps/web/src/presentation.ts";
import type { Difficulty, GameEvent, RulesVersion, Side, SimPlayer, SimTeam, UserInput } from "./types.ts";

let nextId = 1;
const hitter = (r: number, position = "LF"): SimPlayer => ({
  id: nextId++, name: `H${nextId}`, lastName: `H${nextId}`, position, bats: "R",
  batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null,
});
const pitcher = (r: number): SimPlayer => ({
  id: nextId++, name: `P${nextId}`, lastName: `P${nextId}`, position: "P", bats: "R",
  batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 },
});
const team = (r: number, name: string): SimTeam => ({
  name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458",
  lineup: [hitter(r, "C"), ...Array.from({ length: 8 }, () => hitter(r))], pitchers: [pitcher(r), pitcher(r)],
});
const synthAway = team(70, "Away"), synthHome = team(70, "Home");

// SOAK_REAL=1: two different MLB clubs per game from the committed snapshot (data/players.json), each its best nine hitters
// plus its best starter and two arms. Same shape as the server's mlbSimTeam, minus position slotting.
interface Snap { teams: { id: number; name: string; abbreviation: string }[]; players: { id: number; name: string; lastName: string; position: string; bats: string; teamId: number; status: string; ratings: { overall: number; role: string; hitting: SimPlayer["batting"]; pitching: SimPlayer["pitching"] } }[] }
const REAL = process.env.SOAK_REAL === "1";
const snap: Snap | null = REAL ? JSON.parse(readFileSync(new URL("../../../data/players.json", import.meta.url), "utf8")) : null;
function realTeam(teamId: number): SimTeam {
  const t = snap!.teams.find((x) => x.id === teamId)!;
  const roster = snap!.players.filter((p) => p.teamId === teamId && p.status === "Active").sort((a, b) => b.ratings.overall - a.ratings.overall);
  const sim = (p: Snap["players"][number]): SimPlayer => ({ id: p.id, name: p.name, lastName: p.lastName, position: p.position, bats: p.bats === "L" || p.bats === "S" ? p.bats : "R", batting: p.ratings.hitting, pitching: p.ratings.pitching });
  const hitters = roster.filter((p) => p.ratings.role === "H").slice(0, 9).map(sim);
  const arms = roster.filter((p) => p.ratings.role === "SP" || p.ratings.role === "RP");
  const sp = arms.find((p) => p.ratings.role === "SP") ?? arms[0];
  return { name: t.name, abbr: t.abbreviation, color: "#b8bcc6", lineup: autoLineup(hitters), pitchers: [sp, ...arms.filter((p) => p !== sp).slice(0, 2)].map(sim) };
}
function teamsFor(seed: number): { away: SimTeam; home: SimTeam } {
  if (!snap) return { away: synthAway, home: synthHome };
  const ids = snap.teams.map((t) => t.id), a = seed % ids.length, b = (a + 1 + (Math.floor(seed / ids.length) % (ids.length - 1))) % ids.length;
  return { away: realTeam(ids[a]), home: realTeam(ids[b]) };
}

const N = Number(process.env.SOAK_N ?? 200);
const INNINGS = Number(process.env.SOAK_INNINGS ?? 3);
const RULES = Number(process.env.SOAK_RULES ?? CURRENT_RULES) as RulesVersion;
const PROFILE = (process.env.SOAK_PAIRS ?? "pro:pro,rookie:pro,allstar:pro,pro:rookie,pro:allstar").split(",").map((p) => p.split(":") as [Difficulty, Difficulty]);

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const p90 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(0.9 * s.length))] : 0; };
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const f = (n: number, d = 2) => n.toFixed(d);

interface Row {
  pitches: number; pa: number; runs: number; hr: number; presentationMs: number; inputs: number; half: number;
  breakerBot: number; breakerCpu: number; runAhead: boolean; extra: boolean; fillBot: boolean; fillCpu: boolean; botWon: boolean;
  steals: number; pickoffs: number; abilities: Record<string, [number, number]>; commits: [number, number];
}
const all: Row[] = [];

function game(seed: number, bot: Difficulty, cpu: Difficulty, userSide: Side): Row {
  const { away, home } = teamsFor(seed);
  const inputs: UserInput[] = [];
  const g = playInteractive({ away, home, seed, innings: INNINGS, rules: RULES, difficulty: cpu, userSide, inputs, auto: makeBot(bot, seed, userSide, { away, home }, INNINGS) });
  const r = g.result!;
  const row: Row = { pitches: 0, pa: 0, runs: r.final.home + r.final.away, hr: 0, presentationMs: 0, inputs: inputs.length, half: 0,
    breakerBot: 0, breakerCpu: 0, runAhead: /Run-ahead/.test(r.events.at(-1)!.type === "final" ? (r.events.at(-1) as { text: string }).text : ""),
    extra: r.box.linescore.away.length > INNINGS || r.box.linescore.home.length > INNINGS, fillBot: false, fillCpu: false, botWon: r.winner === userSide,
    steals: 0, pickoffs: 0, abilities: {}, commits: [0, 0] };
  for (const e of r.events as GameEvent[]) {
    row.presentationMs += blockingBudgetMs(e);
    if (e.state.rally[userSide] >= 100) row.fillBot = true;
    if (e.state.rally[userSide === "home" ? "away" : "home"] >= 100) row.fillCpu = true;
    if (e.type === "pitch") row.pitches++;
    else if (e.type === "play") { row.pa++; if (e.outcome === "home_run") row.hr++; }
    else if (e.type === "half_start") row.half++;
    else if (e.type === "team") { if (e.side === userSide) row.breakerBot++; else row.breakerCpu++; }
    else if (e.type === "run") { if (e.action === "steal") row.steals++; if (e.action === "pickoff") row.pickoffs++; }
    else if (e.type === "ability" && e.phase === "committed") {
      const k = (row.abilities[e.ability] ??= [0, 0]); const i = e.side === userSide ? 0 : 1; k[i]++; row.commits[i]++;
    }
  }
  return row;
}

const out: string[] = [`soak: rules ${RULES}, ${INNINGS} innings, N=${N} per pairing, ${REAL ? "real MLB clubs (data/players.json)" : "synthetic even teams (70/70)"}`];
for (const [bot, cpu] of PROFILE) {
  const rows: Row[] = [];
  const seedRng = createRng(0xC0FFEE + DIFFICULTIES.indexOf(bot) * 7 + DIFFICULTIES.indexOf(cpu));
  for (let i = 0; i < N; i++) rows.push(game(Math.floor(seedRng.next() * 2 ** 31), bot, cpu, i % 2 ? "home" : "away"));
  all.push(...rows);
  out.push(`bot ${bot.padEnd(7)} vs cpu ${cpu.padEnd(7)} botWin=${f(100 * mean(rows.map((r) => +r.botWon)), 0)}% pitches/game=${f(mean(rows.map((r) => r.pitches)), 1)} runs/game=${f(mean(rows.map((r) => r.runs)))} commits/game bot=${f(mean(rows.map((r) => r.commits[0])))} cpu=${f(mean(rows.map((r) => r.commits[1])))}`);
}

const A = (k: (r: Row) => number) => all.map(k);
const T = (a: number[]) => `mean ${f(mean(a), 1)} median ${f(med(a), 0)} p90 ${f(p90(a), 0)} max ${Math.max(...a)} min ${Math.min(...a)}`;
out.push("", `ALL GAMES n=${all.length}`);
out.push(`pitches/game: ${T(A((r) => r.pitches))}`);
out.push(`plate appearances/game: mean ${f(mean(A((r) => r.pa)), 1)}`);
out.push(`runs/game (combined): mean ${f(mean(A((r) => r.runs)))} median ${med(A((r) => r.runs))} p90 ${p90(A((r) => r.runs))}; games >12 runs ${f(100 * mean(A((r) => +(r.runs > 12))), 1)}%; in 4-10 ${f(100 * mean(A((r) => +(r.runs >= 4 && r.runs <= 10))), 0)}%`);
out.push(`home runs/game: mean ${f(mean(A((r) => r.hr)))}; in 1-4 ${f(100 * mean(A((r) => +(r.hr >= 1 && r.hr <= 4))), 0)}%`);
out.push(`ten-run rule ended game: ${f(100 * mean(A((r) => +r.runAhead)), 1)}%; extra innings: ${f(100 * mean(A((r) => +r.extra)), 1)}%`);
out.push(`ability commits/game (both sides): mean ${f(mean(A((r) => r.commits[0] + r.commits[1])))} median ${med(A((r) => r.commits[0] + r.commits[1]))}; in 4-10 ${f(100 * mean(A((r) => +(r.commits[0] + r.commits[1] >= 4 && r.commits[0] + r.commits[1] <= 10))), 0)}%`);
out.push(`Rally Breaker uses/game: bot seat ${f(mean(A((r) => r.breakerBot)), 3)}, cpu seat ${f(mean(A((r) => r.breakerCpu)), 3)}; games with at least one: ${f(100 * mean(A((r) => +(r.breakerBot + r.breakerCpu > 0))), 0)}%`);
out.push(`Rally reached 100 at some point (per side-game): bot seat ${f(100 * mean(A((r) => +r.fillBot)), 0)}%, cpu seat ${f(100 * mean(A((r) => +r.fillCpu)), 0)}%`);
out.push(`steals/game ${f(mean(A((r) => r.steals)))}, successful pickoffs/game ${f(mean(A((r) => r.pickoffs)))}`);
const ids = [...new Set(all.flatMap((r) => Object.keys(r.abilities)))].sort();
out.push("ability commits per game (bot seat / cpu seat):");
for (const id of ids) out.push(`  ${id.padEnd(16)} ${f(mean(A((r) => r.abilities[id]?.[0] ?? 0)), 3)} / ${f(mean(A((r) => r.abilities[id]?.[1] ?? 0)), 3)}`);

// Estimated length: blocking presentation (W28 budgets, 1x) plus time the player spends on prompts. The prompt time is an
// ASSUMPTION (inputs x seconds per prompt), not a measurement; no real device or person was timed.
out.push("", "ESTIMATED MATCH LENGTH (computed, not device evidence)");
const pres = A((r) => r.presentationMs / 1000);
out.push(`blocking presentation, W28 budgets at 1x: mean ${f(mean(pres), 0)}s median ${f(med(pres), 0)}s p90 ${f(p90(pres), 0)}s`);
for (const sec of [1.0, 1.5, 2.0]) {
  const mins = all.map((r) => (r.presentationMs / 1000 + r.inputs * sec) / 60);
  const share = all.map((r) => r.presentationMs / 1000 / (r.presentationMs / 1000 + r.inputs * sec));
  out.push(`  at ${sec}s per prompt: median ${f(med(mins), 1)} min, p90 ${f(p90(mins), 1)} min, presentation share ${f(100 * mean(share), 0)}%; inputs/game mean ${f(mean(A((r) => r.inputs)), 0)}`);
}
out.push(`half-inning transition budget: ${blockingBudgetMs({ type: "half_start" } as GameEvent)} ms (cap 1500); result actions cap 2000 ms`);
console.log(out.join("\n"));
