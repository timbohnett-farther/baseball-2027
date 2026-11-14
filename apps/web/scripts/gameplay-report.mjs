#!/usr/bin/env node
// W36b: gameplay telemetry over AI-vs-AI matches. A bot (same policy as the computer) sits in the user seat against the
// engine's computer; its logged inputs go through the collector as accepted user intents and the sim's events through
// the same observer the live game uses. Local only: reads nothing from the network, writes one JSON file.
//   node --experimental-strip-types apps/web/scripts/gameplay-report.mjs [--from=1] [--to=200] [--innings=3] [--bot=pro] [--cpu=pro] [--out=FILE]
// Synthetic even teams (rating 70). Node/desktop numbers: they say how the controls are used by the bot, not how a person plays on a phone.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { autoLineup, CURRENT_RULES, makeBot, playInteractive } from "@bb/sim";
import { GameplayTelemetry, mergeSnapshots, TELEMETRY_SCHEMA } from "../src/gameplaytelemetry.ts";
import { blockingBudgetMs } from "../src/presentation.ts";

const opt = (k, d) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const from = Number(opt("from", 1)), to = Number(opt("to", 200)), innings = Number(opt("innings", 3)), bot = opt("bot", "pro"), cpu = opt("cpu", "pro"), out = opt("out");

let id = 1;
const hitter = (r) => ({ id: id++, name: `H${id}`, lastName: `H${id}`, position: "LF", bats: "R", batting: { contact: r, power: r, eye: r, speed: r, fielding: r }, pitching: null });
const arm = (r) => ({ id: id++, name: `P${id}`, lastName: `P${id}`, position: "P", bats: "R", batting: null, pitching: { stuff: r, control: r, movement: r, stamina: 90 } });
const team = (name) => ({ name, abbr: name.slice(0, 3).toUpperCase(), color: "#e0a458", lineup: autoLineup(Array.from({ length: 9 }, () => hitter(70))), pitchers: [arm(70), arm(70)] });
const away = team("Away"), home = team("Home");

const snaps = [], presentation = [], pitchesPer = [], inputsPer = [];
let heatChecks = 0, heatMismatches = 0;
let nonPrefix = 0; // prefix replays whose tail differs from the full run (bot lists a team/run extra after its pitch)
const rejectedBot = {}; // inputs the bot logged that the classifier would not accept: should stay empty
for (let seed = from; seed <= to; seed++) {
  const userSide = seed % 2 ? "away" : "home";
  const inputs = [];
  const g = playInteractive({ away, home, seed, innings, rules: CURRENT_RULES, difficulty: cpu, userSide, inputs, auto: makeBot(bot, seed, userSide, { away, home }, innings) });
  // Replay the way the live game does: after each commit the match is re-simulated from the seed, the collector sees the
  // new events, then the next input is classified against the Awaiting it was answering.
  const t = new GameplayTelemetry(() => 0);
  t.startMatch(userSide);
  for (let k = 0; k <= inputs.length; k++) {
    const live = playInteractive({ away, home, seed, innings, rules: CURRENT_RULES, difficulty: cpu, userSide, inputs: inputs.slice(0, k) });
    if (live.events.length <= g.events.length && live.events.slice(-3).some((e, i, a) => JSON.stringify(e) !== JSON.stringify(g.events[live.events.length - a.length + i]))) nonPrefix++;
    t.observeEvents(live.events);
    if (k < inputs.length) {
      if (inputs[k].ability) t.arm(inputs[k].ability.id);
      const o = t.submit(inputs[k], live.awaiting, k, k);
      if (o !== "accepted") rejectedBot[o] = (rejectedBot[o] ?? 0) + 1;
    }
  }
  const s = t.snapshot();
  s.durationEstimateMs = { wall: g.events.reduce((n, e) => n + blockingBudgetMs(e), 0), basis: "presentation_budget_sum" };
  snaps.push(s); presentation.push(s.durationEstimateMs.wall);
  pitchesPer.push(g.events.filter((e) => e.type === "pitch").length); inputsPer.push(inputs.length);
  heatChecks += s.heat.user.heatChecks; heatMismatches += s.heat.user.heatMismatches;
}
const agg = mergeSnapshots(snaps);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sha = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const report = {
  schema: TELEMETRY_SCHEMA, build: sha, ruleset: CURRENT_RULES, seeds: { from, to }, innings, pairing: { bot, cpu }, teams: "synthetic even (70/70)",
  samples: { matches: snaps.length, pitchEvents: pitchesPer.reduce((a, b) => a + b, 0), userInputs: inputsPer.reduce((a, b) => a + b, 0) },
  perMatch: { pitches: mean(pitchesPer), userInputs: mean(inputsPer), innings: agg.innings / snaps.length, durationEstimateMs: mean(presentation), durationBasis: "sum of presentation blocking budgets (not wall clock, not a device)" },
  botInputsNotAccepted: rejectedBot,
  nonPrefixReplays: nonPrefix,
  aggregate: agg,
  note: "user = the bot seat, cpu = the engine computer. Arm/cancel are client-only: here the bot arms every ability it submits, and never cancels.",
};
const text = JSON.stringify(report, null, 2);
if (out) writeFileSync(out, text + "\n");
console.log(JSON.stringify({ build: sha, matches: snaps.length, userCommands: agg.commands.user, cpuCommands: agg.commands.cpu, conservation: agg.conservation, botInputsNotAccepted: rejectedBot, ledger: agg.heat.user, abilitiesUser: agg.abilities.user, heatChecks, heatMismatches, rallyBreaker: agg.rallyBreaker, perMatch: report.perMatch }, null, 1));
