# Ability golden fixtures and CPU/user fairness (W36c)

Scope: tests, one fixture and this note. No outcome, probability, cost or tuning value changed; `CURRENT_RULES` stays 9; rulesets 1-9 in `packages/sim/src/golden.test.ts` are untouched.

Files: `packages/sim/src/ability-golden.test.ts` (49 tests), `packages/sim/src/ability-golden.fixture.json`.
Regenerate the fixture only after a deliberate, versioned rules change: `UPDATE_ABILITY_GOLDEN=1 node --test --experimental-strip-types packages/sim/src/ability-golden.test.ts`.

## Per-ability coverage

Engine column: 40 seeds (900-939, rules 9, 3 innings, `startHeat` 100, user side alternating, `pro` CPU, even 70-rated synthetic clubs) driven through `playInteractive` by a scripted seat that asks for that one ability on every prompt of its role. "Free" asks only when the chip says available; "forced" asks even when it is not, so rejections run. Commits are totals over the 40 games, measured.

| Ability | Cost | Ledger test (arm/cancel/commit/expire, exact-cost, cost-1 refused) | Counterplay test (role, swing, take, direction, second ability) | Engine commits (free / forced) | Triggered / expired (free) | Rejected (forced) |
|---|---|---|---|---|---|---|
| BAT_COMET | 50 | yes | yes | 551 / 551 | 301 / 250 | 344 |
| BAT_LASER | 50 | yes | yes | 547 / 547 | 344 / 203 | 269 |
| BAT_GAP_MASTER | 40 | yes | yes | 600 / 600 | 385 / 215 | 165 |
| BAT_SECOND_SWING | 60 | yes | yes | 427 / 427 | 242 / 185 | 781 |
| PITCH_MIRAGE | 40 | yes | yes | 218 / 218 | 218 / 0 | 777 |
| PITCH_VORTEX | 50 | yes | yes | 130 / 130 | 130 / 0 | 838 |
| FIELD_WALL_REAPER | 60 | yes | yes | 16 / 16 | 0 / 16 | 32 |
| FIELD_ACROBAT | 50 | yes | yes | 24 / 24 | 0 / 24 | 24 |
| FIELD_CANNON_ARM | 45 | yes | yes | 3 / 3 | 1 / 2 | 43 |
| RUN_AFTERBURNER | 40 | yes | yes | 247 / 280 | 247 / 0 | 5 |

Every engine run asserts: Heat after a commit equals Heat before minus the cost (floored at 0); a rejected request changes no Heat; every commit settles as triggered or expired before the game ends; Heat and Rally stay in 0-100 in every event state. A pinned event-log hash per ability (first game that commits it) is in the fixture, and every ability game replays identically from seed plus input log.

Targeted fixtures: Comet vs Wall Reaper independence (Wall Reaper moves only `reach`, Comet never does, and the home-run nudge is unchanged when both apply); no committed Wall Reaper is followed by a `home_run`; the `fieldContextOk` matrix for the three fielding abilities; Mirage then Vortex is refused with `ALREADY_USED`, and Vortex `locShift` mirrors left/right; Second Swing touches only `rescueQ`.

## Probability-model adapters and caps

Each ability supplies a small `Effects` object; `combine()` multiplies the scale fields (`missScale`, `windowScale`, `fieldWindow`), takes the max of `rescueQ` and `popupBelowQ`, adds the rest, then clamps to `BOUNDS`. Pinned in tests:

| Ability | Effects | Cap that bounds it (BOUNDS) |
|---|---|---|
| BAT_COMET | windowScale 0.85, dHr +0.04, dGround -0.05, popupBelowQ 0.45 | windowScale [0.8,1], dHr [-0.03,0.05], dGround [-0.1,0.05], popupBelowQ [0,0.5] |
| BAT_LASER | dHr -0.02, dHit +0.05, dGround -0.08, dFly -0.1 | dHit [-0.08,0.08], dFly [-0.12,0.05] |
| BAT_GAP_MASTER | dHr -0.015, dDouble +0.08 | dDouble [0,0.1] |
| BAT_SECOND_SWING | rescueQ 0.25 | rescueQ [0,0.3] |
| PITCH_MIRAGE | none (hides pitch type from the user batter) | combine() equals NEUTRAL |
| PITCH_VORTEX | missScale 1.35, locShift +/-0.12, whiffAdd 0.03 | missScale [1,1.5], locShift [-0.2,0.2], whiffAdd [0,0.06] |
| FIELD_WALL_REAPER | reach 0.5 | reach [0,0.6] |
| FIELD_ACROBAT | fieldWindow 1.3, reach 0.15 | fieldWindow [1,1.4] |
| FIELD_CANNON_ARM | dDp 0.15, wildThrow 0.08 | dDp [0,0.2], wildThrow [0,0.1] |
| RUN_AFTERBURNER | run 0.1 | run [0,0.1] (steal and send chance are separately capped at 92% in game.ts) |

Stacking tests: additive nudges commute; two Vortex-sized `missScale` stack clamps at 1.5; two Comet-sized `windowScale` floors at 0.8; two `dHr` of +0.04 clamp at 0.05.

## CPU vs user equivalence

Same path: user and CPU both go through `useAbility` in `game.ts` (arm, commit, Heat write, event). Verified by test: over 80 allstar AI-vs-AI games every committed ability on either seat costs exactly its catalog cost. Rally Breaker over 60 allstar games (seeds 70000 + 17i): home 27 uses, away 36, never more than once per side per game, always exactly 100 Rally, target Heat lowered by at most 40 and floored at 0.

Information: the CPU scene (`Scene`) holds role, Heat, count, outs, runners in scoring position, bases loaded, late, margin, batting/pitching ratings and its own fastball share. It does not contain the incoming pitch type or aim (pinned key list). One RNG draw per decision, two when a direction is needed (tested). The CPU draws from its own stream (`seed ^ 0x5bd1e995`), so a log replays its choices exactly.

Findings, each pinned by a test that asserts current behaviour (no fix made):

1. The CPU never uses a fielding ability. `cpu.ts` `utility()` returns -1 (default branch) for FIELD_WALL_REAPER, FIELD_ACROBAT and FIELD_CANNON_ARM and `game.ts` never calls `cpuUse` for the field role. Test: "DOCUMENTED ASYMMETRY ... CPU never uses a fielding ability" (60 games: 0 commits on either AI seat; a human user can use all three). Smallest compatible fix: a new ruleset that adds CPU field utilities through the same `useAbility` path. Awaiting approval.
2. The scripted bot (`makeBot`) never attaches Afterburner to a steal (`cpu.ts` `pre()` emits a steal with no `ability`) while the CPU does (`game.ts` `cpuPrePitch`). Test: "DOCUMENTED ASYMMETRY (harness, not engine)" (60 allstar games: bot seat 0 Afterburner commits, CPU seat 80). The engine path is identical and a human steal input accepts `ability`; this only skews bot-vs-CPU soak numbers.
3. PITCH_VORTEX was committed 0 times by either AI seat in the soaks below (not listed in the soak per-ability table), although the scripted single-ability seat commits it 130 times in 40 games. Observed, not root-caused here; no test pins it.

## Soak method

Command: `SOAK_N=200 node packages/sim/src/soak.ts` (also `SOAK_N=100 SOAK_REAL=1 node packages/sim/src/soak.ts`).
Ruleset 9, 3 innings. Pairings (bot difficulty vs CPU difficulty): pro:pro, rookie:pro, allstar:pro, pro:rookie, pro:allstar. Seed RNG per pairing `createRng(0xC0FFEE + DIFFICULTIES.indexOf(bot)*7 + indexOf(cpu))`. Synthetic run: 200 games per pairing (1000 total), even 70/70 rosters. Real run: 100 per pairing (500 total), MLB clubs from `data/players.json`. The soak imports `blockingBudgetMs` from `apps/web/src/presentation.ts` read-only.

Measured, synthetic (N=1000):

| Pairing (bot vs cpu) | Bot win | Commits/game bot | Commits/game cpu |
|---|---|---|---|
| pro vs pro | 48% | 1.40 | 1.40 |
| rookie vs pro | 42% | 1.01 | 1.51 |
| allstar vs pro | 55% | 2.85 | 1.23 |
| pro vs rookie | 56% | 1.39 | 1.01 |
| pro vs allstar | 43% | 1.48 | 3.77 |

Mirror pairing (pro vs pro) is symmetric on commits (1.40 / 1.40) and the win rate is 48% for the bot seat. Commits scale with difficulty on both seats. Rally Breaker uses/game: bot seat 0.321, cpu seat 0.252; games with at least one 43%. Per-ability commits/game (bot / cpu): COMET 0.127/0.056, GAP_MASTER 0.111/0.097, LASER 0.107/0.043, SECOND_SWING 0.039/0.018, MIRAGE 1.240/1.246, AFTERBURNER 0.000/0.325 (finding 2). Runs/game 4.37, home runs/game 1.17, extra innings 18.3%, ten-run rule 0.3%.

Measured, real MLB clubs (N=500): pro vs pro bot win 58%, commits 1.98 / 1.95; allstar vs pro 63%; pro vs allstar 38%; Rally Breaker uses/game bot 0.358, cpu 0.272; AFTERBURNER bot 0.000, cpu 0.174; runs/game 4.79.

The bot-seat win rates move only a few points off 50% on the even mirror (48% at N=200; real clubs 58% at N=100, within the noise of a 100-game sample, not tested for significance).
