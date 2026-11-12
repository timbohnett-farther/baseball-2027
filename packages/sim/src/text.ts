// Play-by-play text and announcer calls. Variety comes from the game's seeded RNG,
// so a replay of the same game reads exactly the same.

import type { Rng } from "./rng.ts";
import type { Outcome } from "./types.ts";

const pick = <T>(rng: Rng, xs: T[]): T => xs[Math.floor(rng.next() * xs.length)];

const FIELDS = ["left", "left-center", "center", "right-center", "right"];
const INFIELD = ["short", "second", "third", "first"];

export function describe(rng: Rng, outcome: Outcome, batter: string, count: string, runs: number): string {
  const field = pick(rng, FIELDS);
  const spot = pick(rng, INFIELD);
  const scored = runs === 1 ? " A run scores." : runs > 1 ? ` ${runs} runs score.` : "";
  switch (outcome) {
    case "strikeout": return pick(rng, [
      `${batter} strikes out swinging.`, `${batter} is caught looking at strike three.`, `${batter} goes down swinging on ${count}.`,
    ]);
    case "walk": return pick(rng, [`${batter} draws a walk.`, `${batter} works a walk on ${count}.`, `Ball four. ${batter} takes his base.`]) + scored;
    case "single": return pick(rng, [`${batter} lines a single to ${field}.`, `${batter} grounds one through the hole at ${spot}.`, `${batter} bloops a single into shallow ${field}.`]) + scored;
    case "double": return pick(rng, [`${batter} rips a double into the ${field} gap.`, `${batter} doubles off the wall in ${field}.`, `${batter} hustles into second with a double.`]) + scored;
    case "triple": return pick(rng, [`${batter} drives one into the corner and legs out a triple!`, `${batter} triples to deep ${field}!`]) + scored;
    case "home_run": {
      const kind = runs === 4 ? "a grand slam" : runs === 3 ? "a three-run homer" : runs === 2 ? "a two-run homer" : "a solo home run";
      return pick(rng, [`${batter} crushes ${kind} to ${field}!`, `${batter} launches ${kind} into the ${field} seats!`, `${batter} sends ${kind} deep to ${field}!`]);
    }
    case "groundout": return pick(rng, [`${batter} grounds out to ${spot}.`, `${batter} bounces out to ${spot}.`, `${batter} rolls one over to ${spot} for the out.`]) + scored;
    case "flyout": return pick(rng, [`${batter} flies out to ${field}.`, `${batter} lofts a fly ball to ${field}, caught.`, `${batter} skies one to shallow ${field}.`]);
    case "lineout": return pick(rng, [`${batter} lines out to ${spot}.`, `${batter} smokes a liner, right at the ${spot === "short" ? "shortstop" : `${spot} baseman`}.`]);
    case "double_play": return pick(rng, [`${batter} grounds into a double play.`, `Two for one! ${batter} hits into a double play.`]);
    case "sac_fly": return `${batter} lifts a sacrifice fly to ${field}.${scored}`;
  }
}

/** Our own announcer lines, tied to the moments players chase. */
export const CALLS = {
  walkOff: ["WALK-OFF! They win it!", "Ballgame! A walk-off winner!", "Mob scene at home plate!"],
  grandSlam: ["GRAND SLAM! Bases cleared!", "Four runs on one swing!"],
  homer: ["That one's GONE!", "Into the stratosphere!", "See ya!", "Way back... GONE!", "He got all of that one!"],
  longHomer: ["That ball has a frequent flyer number!", "Tape-measure shot!"],
  bigK: ["Sit down!", "Strike three! What a pitch!", "Got him!"],
  gameOverK: ["Strike three, ballgame!", "He slams the door!"],
  heatedUp: ["He's on FIRE!", "Nobody can cool him off!"],
  onFire: ["This team is ON FIRE!", "The dugout is rocking!", "Somebody call the fire department!"],
  triple: ["Look at him fly around the bases!"],
  doublePlay: ["Two for the price of one!", "Turn two! Inning over!"],
} as const;

export const call = (rng: Rng, kind: keyof typeof CALLS): string => pick(rng, [...CALLS[kind]]);
