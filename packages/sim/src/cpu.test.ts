import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CURRENT_RULES, playInteractive } from "./game.ts";
import { TEAM_RALLY_BREAKER } from "./ability.ts";
import { DIFFICULTIES, PROFILES, PROFILE_BOUNDS, makeBot, pitchTypeFor, sceneOf, zoneAim } from "./cpu.ts";
import type { Difficulty, GameEvent, Side, SimPlayer, SimTeam, UserInput } from "./types.ts";

let nextId = 9000;
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
const away = team(70, "Away"), home = team(70, "Home");
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const INNINGS = 5;

/** One game with a bot in the user seat and the engine's computer on the other side; returns the log so it can be replayed. */
function botGame(seed: number, bot: Difficulty, cpu: Difficulty, userSide: Side = "away", startHeat = 25) {
  const inputs: UserInput[] = [];
  const g = playInteractive({ away, home, seed, innings: INNINGS, rules: 7, difficulty: cpu, userSide, inputs, startHeat,
    auto: makeBot(bot, seed, userSide, { away, home }, INNINGS) });
  assert.ok(g.result, "game ended");
  return { g, inputs };
}
const replay = (seed: number, cpu: Difficulty, userSide: Side, inputs: UserInput[], startHeat = 25) =>
  playInteractive({ away, home, seed, innings: INNINGS, rules: 7, difficulty: cpu, userSide, inputs, startHeat });

test("rules 7 is current and the profiles sit inside their bounds", () => {
  assert.equal(CURRENT_RULES, 7);
  for (const d of DIFFICULTIES) for (const [k, [lo, hi]] of Object.entries(PROFILE_BOUNDS)) {
    const v = PROFILES[d][k as keyof typeof PROFILES.pro];
    const n = Array.isArray(v) ? v[0] : v; // mix is cumulative: its first cut is the fastball share
    assert.ok(n >= lo && n <= hi, `${d}.${k}=${n} outside ${lo}..${hi}`);
  }
});

test("profiles move the computer's pitch mix and aim in the documented direction", () => {
  assert.equal(pitchTypeFor(PROFILES.pro, 0.5), "fastball");
  assert.ok(PROFILES.rookie.mix[0] > PROFILES.pro.mix[0] && PROFILES.pro.mix[0] > PROFILES.allstar.mix[0]);
  assert.ok(Math.abs(zoneAim(PROFILES.rookie, 1, 1).x) < Math.abs(zoneAim(PROFILES.allstar, 1, 1).x));
  assert.ok(PROFILES.allstar.stealRate > PROFILES.pro.stealRate && PROFILES.pro.stealRate > PROFILES.rookie.stealRate);
});

test("CPU ability policy is deterministic: the same seed makes the same choices and spends the same Heat", () => {
  for (const d of DIFFICULTIES) {
    const a = botGame(41, "pro", d), b = botGame(41, "pro", d);
    assert.equal(hash(a.g.events), hash(b.g.events));
    assert.equal(hash(a.inputs), hash(b.inputs));
  }
});

test("difficulty is stored with the game and replays: the logged inputs alone reproduce every event", () => {
  for (const d of DIFFICULTIES) for (const side of ["away", "home"] as const) {
    const { g, inputs } = botGame(77, "allstar", d, side);
    const again = replay(77, d, side, inputs);
    assert.equal(hash(again.events), hash(g.events), d);
    assert.deepEqual(again.result?.final, g.result?.final);
  }
});

test("a missing difficulty plays as 'pro', and the three profiles play differently", () => {
  const inputs: UserInput[] = [];
  const run = (d?: Difficulty) => playInteractive({ away, home, seed: 5, innings: INNINGS, rules: 7, ...(d ? { difficulty: d } : {}), userSide: "away", inputs: [...botGame(5, "pro", "pro").inputs] });
  assert.equal(hash(run().events), hash(run("pro").events));
  assert.notEqual(hash(botGame(5, "pro", "rookie").g.events), hash(botGame(5, "pro", "allstar").g.events));
  void inputs;
});

test("rules 6 ignores difficulty entirely", () => {
  const run = (d: Difficulty) => playInteractive({ away, home, seed: 5, innings: INNINGS, rules: 6, difficulty: d, userSide: "away", inputs: [] });
  assert.equal(hash(run("rookie").events), hash(run("allstar").events));
});

/** Walk a bot game until the user's side first holds a full Rally meter, returning the inputs so far. */
function untilRally(side: Side, seed: number): { seed: number; inputs: UserInput[] } | null {
  for (let s = seed; s < seed + 400; s++) {
    const inputs: UserInput[] = [];
    for (let guard = 0; guard < 500; guard++) {
      const g = playInteractive({ away, home, seed: s, innings: INNINGS, rules: 7, userSide: side, inputs, startHeat: 100 });
      const a = g.awaiting;
      if (!a) break;
      if (a.team?.available && a.state.rally[side] >= 100) return { seed: s, inputs };
      inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } } : a.role === "swing" ? { kind: "swing", swing: "power", timing: 0 } : a.role === "field" ? { kind: "field", timing: 0 } : { kind: "run", action: "advance", send: [] });
    }
  }
  return null;
}

test("Rally Breaker: costs all 100 Rally, drains 40 Heat from the pitcher and the batter, once per match", () => {
  const found = untilRally("away", 1);
  assert.ok(found, "found a moment with a full meter");
  const { seed, inputs } = found;
  const before = playInteractive({ away, home, seed, innings: INNINGS, rules: 7, userSide: "away", inputs, startHeat: 100 }).awaiting!;
  assert.equal(before.team!.cost, TEAM_RALLY_BREAKER.cost);
  assert.equal(before.team!.needsConfirm, false);
  const used = [{ kind: "team", action: "rally_breaker" } as UserInput, ...[]];
  const after = playInteractive({ away, home, seed, innings: INNINGS, rules: 7, userSide: "away", inputs: [...inputs, ...used], startHeat: 100 });
  const ev = after.events.find((e): e is Extract<GameEvent, { type: "team" }> => e.type === "team")!;
  assert.ok(ev, "team event logged");
  assert.equal(ev.state.rally.away, 0, "all Rally spent");
  const [pitcherId, batterId] = [before.pitcherId, before.batterId];
  const opp = before.role === "pitch" ? { p: before.pitcherId, b: before.batterId } : { p: pitcherId, b: batterId };
  for (const id of before.team!.targets.map((t) => t.id)) {
    const was = before.team!.targets.find((t) => t.id === id)!;
    assert.equal(ev.state.heat[id], Math.max(0, was.heat - 40));
    assert.equal(was.loses, Math.min(40, was.heat));
  }
  void opp;
  // Once per match: the next prompt says so, and a second use changes nothing.
  assert.equal(after.awaiting?.team?.available, false);
  assert.equal(after.awaiting?.team?.reason, "ALREADY_USED");
  const twice = playInteractive({ away, home, seed, innings: INNINGS, rules: 7, userSide: "away", inputs: [...inputs, ...used, ...used], startHeat: 100 });
  assert.equal(twice.events.filter((e) => e.type === "team").length, 1);
});

test("Rally Breaker is refused below 100 Rally and below rules 7", () => {
  const g = playInteractive({ away, home, seed: 3, innings: INNINGS, rules: 7, userSide: "away", inputs: [{ kind: "team", action: "rally_breaker" }] });
  assert.equal(g.events.filter((e) => e.type === "team").length, 0);
  assert.equal(g.awaiting?.team?.reason, "INSUFFICIENT_RALLY");
  const old = playInteractive({ away, home, seed: 3, innings: INNINGS, rules: 6, userSide: "away", inputs: [] });
  assert.equal(old.awaiting?.team, undefined);
});

test("Mirage hides the pitch type from the user's batter but not its speed or aim", () => {
  let hidden = 0, shown = 0;
  for (let seed = 1; seed <= 60 && !hidden; seed++) {
    const inputs: UserInput[] = [];
    for (let guard = 0; guard < 300; guard++) {
      const g = playInteractive({ away, home, seed, innings: INNINGS, rules: 7, difficulty: "allstar", userSide: "away", inputs, startHeat: 100 });
      const a = g.awaiting;
      if (!a) break;
      if (a.role === "swing") {
        if (a.incoming!.type === null) { hidden++; assert.ok(a.incoming!.mph > 0); assert.ok(g.events.some((e) => e.type === "ability" && e.ability === "PITCH_MIRAGE" && e.phase === "committed")); }
        else shown++;
      }
      inputs.push(a.role === "pitch" ? { kind: "pitch", type: "fastball", aim: { x: 0, y: 0 } } : a.role === "swing" ? { kind: "swing", swing: "take", timing: 0 } : a.role === "field" ? { kind: "field", timing: 0 } : { kind: "run", action: "advance", send: [] });
    }
  }
  assert.ok(hidden > 0, "the computer used Mirage at least once");
  assert.ok(shown > 0);
});

test("scene is built from the situation only", () => {
  const g = playInteractive({ away, home, seed: 1, innings: INNINGS, rules: 7, userSide: "away", inputs: [] });
  const sc = sceneOf(g.awaiting!.state, INNINGS, "bat", "away", 50, undefined, undefined, PROFILES.pro);
  assert.equal(sc.margin, 0);
});

// --- Soak ---------------------------------------------------------------------------------------------

const SOAK_N = Number(process.env.SOAK_N ?? 6);

test(`soak: ${SOAK_N} seeded bot-vs-CPU games per difficulty pairing end cleanly with sound invariants`, { timeout: 3_600_000 }, () => {
  const rows: string[] = [];
  for (const bot of DIFFICULTIES) for (const cpu of DIFFICULTIES) {
    let runs = 0, wins = 0, commits = 0, breakers = 0, cpuCommits = 0, botCommits = 0, steals = 0, picks = 0, games = 0;
    const perGame: number[] = [];
    for (let i = 0; i < SOAK_N; i++) {
      const seed = 100_000 + i * 7919 + DIFFICULTIES.indexOf(bot) * 31 + DIFFICULTIES.indexOf(cpu);
      const userSide: Side = i % 2 ? "home" : "away";
      const { g, inputs } = botGame(seed, bot, cpu, userSide);
      games++;
      const r = g.result!;
      assert.ok(r.winner === "home" || r.winner === "away", "has a winner");
      runs += r.final.home + r.final.away;
      if (r.winner === userSide) wins++;
      let n = 0;
      for (const e of g.events) {
        assert.ok(e.state.outs <= 3 && e.state.outs >= 0, "outs");
        for (const h of Object.values(e.state.heat)) assert.ok(h >= 0 && h <= 100, `heat ${h}`);
        assert.ok(e.state.rally.away >= 0 && e.state.rally.away <= 100 && e.state.rally.home >= 0 && e.state.rally.home <= 100, "rally");
        if (e.type === "ability" && e.phase === "committed") { n++; if (e.side === userSide) botCommits++; else cpuCommits++; }
        if (e.type === "team") breakers++;
        if (e.type === "run" && e.action === "steal") steals++;
        if (e.type === "run" && (e.action === "pickoff" || e.action === "hold")) picks++;
      }
      commits += n; perGame.push(n);
      if (i < 2) assert.equal(hash(replay(seed, cpu, userSide, inputs).events), hash(g.events), "soak game replays");
    }
    perGame.sort((a, b) => a - b);
    rows.push(`bot ${bot.padEnd(7)} vs cpu ${cpu.padEnd(7)} n=${games} runs/game=${(runs / games).toFixed(2)} botWin=${(100 * wins / games).toFixed(0)}% commits/game=${(commits / games).toFixed(2)} (median ${perGame[perGame.length >> 1]}) cpu=${(cpuCommits / games).toFixed(2)} bot=${(botCommits / games).toFixed(2)} breaker/game=${(breakers / games).toFixed(2)} steals/game=${(steals / games).toFixed(2)} throws/game=${(picks / games).toFixed(2)}`);
  }
  console.log(rows.join("\n"));
});
