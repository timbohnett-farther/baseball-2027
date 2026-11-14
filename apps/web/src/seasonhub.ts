// Plain-text "now / next" lines for the season hub and the result screen. Pure: everything comes from the server's season state,
// so what the page says is what the server has already decided. Nothing here changes a rule, a reward or an outcome.
import { ARCADE_GAMES, qualification, type ArcadeFixture, type ArcadeSeasonState } from "@bb/shared";
import type { PlayedGame } from "@bb/sim";

/** The message the duel shows when the finish call could not reach the server and the game is queued on the device. */
export const SAVED_ON_DEVICE = "Saved on this device. It will upload when you're back online.";

export interface HubNow {
  /** Where the season is: "Regular season, game 3 of 7", "Semifinal", "Season complete". */
  stage: string;
  /** Top-4 state in words. */
  standing: { tone: "good" | "warn" | "bad" | "info"; label: string; detail: string };
  /** The next fixture in one line, or null when there is none. */
  next: string | null;
  /** True when the next fixture is a rematch of a tied playoff game. */
  rematch: boolean;
  /** Season stars and the next unlock, in words. */
  progress: string;
}

export const sideWord = (f: Pick<ArcadeFixture, "userSide">) => (f.userSide === "home" ? "Home" : "Away");

/** A playoff game that ended level is replayed: the new fixture follows a tied one in the same round. */
export function isRematch(season: ArcadeSeasonState, f: ArcadeFixture | null): boolean {
  return !!f && f.round > 0 && season.schedule.some((g) => g.round === f.round && g.gameNo < f.gameNo && g.result === "T");
}

export function fixtureLine(season: ArcadeSeasonState, f: ArcadeFixture): string {
  const where = `${sideWord(f)} vs ${f.opponent.name}`;
  if (isRematch(season, f)) return `Rematch: ${f.label}, ${where}. The last game was tied, so this one decides it.`;
  return f.round > 0 ? `${f.label}, ${where}. One game decides it.` : `Game ${f.gameNo} of ${ARCADE_GAMES}, ${where}.`;
}

export function progressLine(season: ArcadeSeasonState): string {
  const { lifetime } = season;
  const stars = `${season.stars.season} of ${season.stars.max} season stars`;
  if (!lifetime.next) return `${stars}. Every unlock is earned.`;
  const gap = lifetime.next.stars - lifetime.stars;
  return `${stars}. ${gap} more lifetime ${gap === 1 ? "star" : "stars"} to ${lifetime.next.label}${gap <= 3 ? ": all three here would unlock it" : ""}.`;
}

export function hubNow(season: ArcadeSeasonState): HubNow {
  const next = season.next;
  const q = qualification(season.standings, season.played);
  let stage: string, standing: HubNow["standing"];
  if (season.status === "done") {
    stage = "Season complete";
    standing = { tone: season.champion ? "good" : "info", label: season.placement?.label ?? "Season complete", detail: season.placement?.place === 1 ? "You won the title." : season.placement && season.placement.place <= 3 ? "Your playoff run is over." : "The top four reached the playoffs." };
  } else if (season.status === "playoffs") {
    stage = next?.label ?? "Playoffs";
    standing = { tone: "good", label: "In the playoffs", detail: next?.round === 2 ? "Win the final for the title." : "Win to reach the final." };
  } else {
    stage = `Regular season, game ${Math.min(season.played + 1, ARCADE_GAMES)} of ${ARCADE_GAMES}`;
    standing = q === "clinched" ? { tone: "good", label: "Playoff spot clinched", detail: "Top four is locked in. Keep earning stars." }
      : q === "eliminated" ? { tone: "bad", label: "Eliminated from the playoffs", detail: "The remaining games still earn stars and unlocks." }
      : { tone: "warn", label: "Still in the race", detail: `Top 4 reach the playoffs. ${ARCADE_GAMES - season.played} ${ARCADE_GAMES - season.played === 1 ? "game" : "games"} left.` };
  }
  return { stage, standing, next: next ? fixtureLine(season, next) : null, rematch: isRematch(season, next), progress: progressLine(season) };
}

/** What the result screen should say about this game's stars while the server has or has not confirmed them. null = nothing extra. */
export function starsNote(o: { seasonGame: boolean; saved: "saving" | "saved" | string | null; reward: PlayedGame["reward"]; repeat: boolean }): { tone: "info" | "bad"; text: string } | null {
  if (!o.seasonGame || o.reward?.arcade) return null;
  if (o.repeat) return { tone: "info", text: "This game was already counted. Its stars and coins were paid the first time." };
  if (o.saved === null || o.saved === "saving") return { tone: "info", text: "Stars pending: they are counted when the server confirms this game." };
  if (o.saved === SAVED_ON_DEVICE) return { tone: "info", text: "Stars pending: this game is saved on your device and counts when it uploads." };
  if (o.saved === "saved") return null;
  return { tone: "bad", text: "Stars not counted: the server did not accept this game." };
}

/** One line for the result screen: what happens after Continue. Format-2 seasons only. */
export function afterGameLine(season: ArcadeSeasonState): string {
  if (season.status === "done") return `Season ${season.number} is complete: ${season.placement?.label ?? "finished"}. Continue to see the summary and start Season ${season.number + 1}.`;
  const f = season.next;
  return f ? `Next: ${fixtureLine(season, f)}` : "Continue to the season hub.";
}
