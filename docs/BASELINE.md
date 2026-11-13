# Baseline: what exists vs the ARC / PUP contracts (W18)

Written before the rules work in W18 so later waves (W19+) know which seams to use. PRDs live outside the repo:
`arcade-season-gameplay-prd.md` (ARC) and `powerups-prd.md` (PUP) in `~/Documents/kimi/tasks/2026-11-11/21-49-21-fe1e5e03/`.
Owner decisions are in `DIAMOND_RALLY_PLAN.md`. Hard rule from there: saved games are re-simulated from seed + input log
on read, so any rules change is gated by a ruleset version stored with the game.

## 1. Engine (`packages/sim/src/game.ts`, `types.ts`)

- Pure, deterministic, Node strip-only TypeScript (no enums, no parameter properties). One seeded RNG per game.
- `plateAppearance` rolls each at-bat outcome from batter/pitcher ratings, park-free. **There is no ball physics.**
  The field view animates an outcome that was already decided. Consequence for PUP: "physics" effects (bat speed,
  exit velocity, hang time, range) cannot be simulated; they become bounded probability modifiers on the roll
  (e.g. +x to hit weight, capped), applied inside the same RNG draw order so replay stays deterministic.
- `run(input, user?)` is the single loop. `simulateGame(input)` runs it with no user; `playInteractive({..., userSide,
  inputs, autoField?})` runs it and pauses (`awaiting`) whenever the user side needs a pitch, swing or field input.
- Input: `GameInput { away, home, seed, innings?, rules?, maxExtraInnings? }`. Output `GameResult` has events, box
  score, final, winner, `innings`. It deliberately has no `rules` field, to keep v1 output byte-identical.
- Events (`GameEvent`): `half_start`, `pitch`, `play`, `pitching_change`, `final`. Only `half_start`, `pitching_change`
  and `final` carry `text`.

## 2. Input log and replay verification

- Input log: array of `UserInput` = `{kind:"pitch", type, aim}`, `{kind:"swing", swing:"contact"|"power", timing}`,
  `{kind:"field", timing}`. Log order is consumption order; the engine reads the next entry each time it `awaiting`.
- `apps/server/src/games.ts`:
  - `POST /api/games/interactive` returns an `InteractiveSetup` (seed, innings, rules, userSide "home", both teams).
  - `POST /api/games/interactive/finish` takes `{opponentTeamId, seasonId?, seed, inputs, final, innings?, rules?}`,
    re-runs `playInteractive`, and 409s if the claimed score differs. Inputs are shape-checked and capped at 2000.
  - `POST /api/games` is the instant sim. `GET /api/games[/:id]` re-simulates from `seed, innings, rules, inputs, teams`
    stored on the row (`played(row)`), so history never depends on stored events.
  - Season/playoff games use the same routes plus `seasonId`, validated by `seasonMatch`.

## 3. Season

- `packages/shared/src/season.ts`: 20 regular games vs real clubs, 3 playoff rounds best-of-3 if over .500, coin bonuses.
  `SeasonGame.result` is `"W"|"L"|"T"|null`.
- `apps/server/src/season.ts`: schedule, standings, `settleSeason` (a "T" adds a game to a playoff series).
- ARC 12 asks for a different season format (owner decision: switch to the PRD format). Not touched in W18.

## 4. Web duel (`apps/web/src/duel.tsx`, `game.tsx`, `season.tsx`)

- `PlayView` (game.tsx) picks an opponent and posts to the two start routes. `DuelView` (duel.tsx) calls
  `playInteractive` in the browser with the server's setup and, on the last out, posts the log to `/finish`.
- Input today is pointer/keyboard timing, not the ARC 4 tap contract. The linescore renders from the box length,
  so extra innings already display.

## 5. Ruleset versioning (new in W18)

- `rules: 1 | 2` on `GameInput`; sim default and `CURRENT_RULES` = 2. The server always passes it explicitly.
- `games.rules` column (migration `0008_game_rules`), default 1 so every existing row replays under v1.
- A client that predates versioning sends no `rules`/`innings` to `/finish`; the server treats that as rules 1,
  3 innings, so an old cached bundle still verifies.
- `packages/sim/src/golden.test.ts` pins v1 output (hashes captured from the engine before the change):
  25 seeds x innings 1/3/5/9, a 9-inning tie, and a scripted interactive log.

## 6. Rules v2 (ARC 3)

| Rule | Behavior |
|---|---|
| Match length (3.1) | 1, 3 or 5 innings for Quick Match (`INNINGS_OPTIONS`). Season and playoff games are 3; the server 400s anything else with `seasonId`. |
| Walk-off | Bottom of the last regulation inning or later, home takes the lead: game ends on that play. (Same as v1.) |
| Ten-run (3.4) | Eligible from inning 2, actual runs only. Home lead >= 10 during a bottom half ends it at once. Away lead >= 10 after a top half still gets the bottom half; away wins if it holds. A lead >= 10 at the end of any completed inning ends it. 1-inning games have no shortcut. Final text says "Run-ahead rule." |
| No ties (3.3) | Extra half-innings start with the previous batter on second, 0 outs, count reset. Repeats until someone leads after a full inning. v1's 9-inning cap and tie are gone in v2. |
| Loop guard | ARC says "no arbitrary cap", but an unbounded loop is a liveness bug. After regulation + `MAX_EXTRA_INNINGS` (20) a seeded coin flip picks the winner, who gets +1 run so the score is consistent. Final text: "Decided by a coin flip after N innings." Never reached in 600 x 3 seeded tests with real rolls; `maxExtraInnings` is a test hook. |

## 7. ARC / PUP contract gaps and smallest adapter

| Area | Exists | Missing | Smallest adapter |
|---|---|---|---|
| ARC 3 match rules | v2 rules above | Pitch-ready timer (3.5), `BONUS BASEBALL` banner | Timer is client-only presentation; banner from `half_start` text when inning > innings. |
| ARC 4-7 touch controls | Timing input, `UserInput` log | `TouchIntent` union, context state machine, 9-cell pitch target | Map intents to existing `UserInput` in the web layer; extend `aim` to cell centres. No sim change needed first. |
| ARC 8 baserunning | Runners advance by outcome roll | Live commands, steals, tag-ups | New `UserInput` kinds gated by rules 3; outcome roll consults them. |
| ARC 9 / PUP abilities | W19 (rules 3): Heat 0-100, Rally meter, no hidden boost (rules 1-2 keep Heat 1-3) | Ability catalog, arm/commit/expire; Heat numeric, Rally meter done in W19 | ability catalog, arm/commit/expire | Ability state in the interactive loop as extra log entries; effects as capped probability modifiers (see section 1). |
| ARC 11 CPU difficulty | `autoLineup`, fixed AI | Difficulty profiles | Parameter bundle on the CPU side's choices; RNG order unchanged. |
| ARC 12-13 season/objectives | 20 games + 3 rounds, coins | PRD format, objectives, unlocks | Replace `shared/season.ts` constants and `settleSeason`; new rows gated by season version. |
| ARC 14 save/resume | Log is the save (replayable) | Mid-game persistence | Persist the in-progress log server-side; replay to resume. |
| ARC 16.5 telemetry events | None | Event stream | Derive from `GameEvent` after the fact; do not emit from the sim. |
| PUP economy / progression | Rules 3: XP is a level badge only (rules 1-2 still +1 per level on replay) | Normalized sidegrades | W19: Super Bats are cosmetic under rules 3. |

Every row that changes outcomes needs a new `rules` value and a golden test against the previous version.

## 8. Rules v3 (W19: PUP Heat / Rally economy)

- Heat 0-100 per player, everyone starts at 25. Awards (per pitch and per play) are visible only; no outcome reads Heat.
  Pitch: taken ball +3 batter, called strike +5 pitcher, swinging strike +7 pitcher / -5 batter, foul +2 pitcher / +4 batter on solid contact.
  Play: HR +25 / -20 pitcher, hit +15 / -8, walk +8 / -12, strikeout -20 batter / +10 pitcher (plus the strike award), ball-in-play out +6 / +8, hard contact +5, run scored +8, user fielding robbed +12 / held-out contested out +6.
- Rally 0-100 per side: each positive Heat award also adds floor(award / 2). Negatives never drain it.
- Rally Assist: a side trailing by 3+ runs gets x1.25 on positive Heat awards (HUD label). No physics change (PUP 1.2(5)).
- Super Bats do nothing under rules 3 (store copy says looks only). XP still levels; levels no longer raise ratings. Wood-bat +-2 is unchanged.
- Skipped awards (the engine has no such event): HBP, steals, pickoffs, caught stealing, manual extra-base advances, error and double-play fielder credits, batter GIDP penalty, spectacular and HR-robbery catches, uncontested or CPU-side fielder credits. Booted balls score as hits, not errors.
- Open: strikeout gives the pitcher the strike award plus +10 (PUP ambiguous); Rally has no spend or effect yet; Super Bats stay in the catalog as cosmetics only.
