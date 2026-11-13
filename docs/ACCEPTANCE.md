# W29 acceptance (ARC 17, PUP 17)

Status key: PASS = a named test or script covers it and passes; GAP = built but not covered or not built; EVIDENCE_MISSING = needs a physical iPhone or a human playtest. Rows are per sub-section group (each ARC/PUP 17.x lists many bullets); a PASS means the group's main bullets are covered, any bullet not covered is named in the Note. Nothing here was measured on a device.

| Criterion | Status | Evidence / note |
|---|---|---|
| ARC 17.1 telemetry | GAP | No telemetry pipeline. The event log carries pitches, PAs, runs, HRs, steals, abilities (soak.ts reads them). Rejected-intent, tap-by-control and skip-rate counters are not recorded. |
| ARC 17.2 match rules | PASS | packages/sim rules.test.ts, game.test.ts, run.test.ts, golden.test.ts (rules 1-8). Not checked bullet by bullet: one-inning Quick Match vs second-inning rule, season rejects 1/5 innings. |
| ARC 17.3 touch contract | PASS (sizes) / GAP (rest) | `shot.mjs --phone --check` now asserts primary >=112x88, gameplay controls >=56x56, base targets >=64 (none exist), 8px gaps; all 14 moments ok. apps/web touch.test.ts covers input routing. Not verified: stale pitch/possession token tap, repeated tap in one frame, windup-tap hint, left-hand mirror, safe-area intersection. |
| ARC 17.4 fielding/runner | PASS (partial) | fielding.test.ts, run.test.ts. 2.0 s fallback, GO/BACK/STOP isolation not individually confirmed. |
| ARC 17.5 season/rewards | PASS | apps/server arcade-season.test.ts, packages/sim objectives.test.ts. |
| ARC 17.6 save/lifecycle | PASS (partial) | apps/web resume.test.ts, outbox.test.ts, app.test.ts (duplicate finish rejection). Background-at-each-phase matrix and atomic-write recovery not tested. |
| ARC 17.7 golden + presentation | PASS | golden.test.ts (rules 1-8 hashes), apps/web invariance.test.ts (speed/reduced/haptics do not change replay), presentation.test.ts, pace.test.ts. Aspect-ratio legibility only via 844x390 shots. |
| ARC 17.8 playtest: first-time testers act unaided | EVIDENCE_MISSING | no human playtest |
| ARC 17.8 playtest: power-up reads as modifier | EVIDENCE_MISSING | no human playtest |
| ARC 17.8 playtest: no dead ends | EVIDENCE_MISSING | soak ran 1000 games to completion with no stall (computer only) |
| ARC 17.8 playtest: median 5-8 min | EVIDENCE_MISSING | computed estimate 2.5-3.8 min median, see Soak; no timed human |
| ARC 17.8 playtest: next objective / qualification clear | EVIDENCE_MISSING | no human playtest |
| ARC 17.8 playtest: rematch/next rate | EVIDENCE_MISSING | no human playtest |
| ARC 17.8 playtest: no hidden gestures | EVIDENCE_MISSING | single-tap design, unverified with people |
| PUP 17.1 unit tests | PASS | ability.test.ts, heat.test.ts (Heat start/clamp, award, Rally Assist, windows, cancel/commit). |
| PUP 17.2 property/invariants | PASS (partial) | soak.ts: 1000 games, no stall or NaN reported by the sim. No dedicated property suite for 0.42 s / 42 m/s / 55 m/s caps. |
| PUP 17.3 golden replays | PASS (partial) | golden.test.ts covers ordinary play and interactive logs with abilities (Breaker, Mirage etc. via the CPU/user log). Per-ability named fixtures (Comet vs Wall Reaper, Anvil, Ricochet) not present. |
| PUP 17.4 integration | PASS (partial) | game.test.ts full games with and without abilities, soak AI-vs-AI 1000 games. Not covered: two-player local, pause-during-ability, low-perf render. |
| PUP 17.5 presentation/accessibility | PASS (partial) | invariance.test.ts (reduced motion identical hashes), shot.mjs checks. Grayscale/colourblind not checked. |
| PUP 17.6 MVP done | GAP | See Wall Reaper below; Anvil/Ricochet and others are candidates not built. Playtest explainability is EVIDENCE_MISSING. |

Counts: PASS 9 (incl. partials), GAP 3, EVIDENCE_MISSING 7 (ARC 17.8 rows).

## Wall Reaper scope (PUP 9.1)

Built: a Heat-60 fielding ability, offered on fly balls (`c.kind === "fly"`), that moves a close extra-base fly half a contest band toward the out (`reach: 0.5` in ability.ts); the glove tap still decides, and a homer is never undone.
Not built: the 2.0 m wall-distance test, 2.0-5.0 m height window, +1.25 m vertical reach, +-140 ms catch timing, 650 ms failure recovery, intercept marker, 8% zoom. The game has no 3D ball path to test those against. Status: GAP vs section 9.1, intentional simplification.

## Rules 8 (W29)

The throw-over limit (two) was documented per batter but never reset, so it was match-wide. Rules 8 resets it for every batter. Rules 1-7 replay unchanged (goldens). In-flight rules 7 season games are still accepted.

## Soak (soak.ts, rules 7, 3 innings, 1000 games, synthetic even 70/70 teams)

Run with `SOAK_N=200 node packages/sim/src/soak.ts`. Bot win rate by pairing 52-70%. Per game: pitches mean 80.7 (median 77, p90 110; ARC target ~45-70, over; extra innings in 29% of games inflate it), PAs 26.2, runs 2.96 combined (target 4-10; 29% of games in range), HRs 0.75, ability commits 3.5 (39% in the 4-10 range), Rally Breaker 0.95 (bot) / 0.79 (CPU) per game, 98% of games use at least one. Ten-run rule ended 0.2% of games.
Estimated match length (computed, not measured): blocking presentation median 65 s, p90 98 s; with 1.0/1.5/2.0 s per prompt and ~86 inputs, median 2.5/3.1/3.8 min, p90 3.6/4.5/5.5 min. Below the 5-8 min target. Half-inning transition budget 1300 ms (cap 1500).

Recommendations (not changed, judgment calls): Rally Breaker fires nearly every game, raise its cost or lower Rally gain if it should be rare; runs per game are low, consider a hit-rate nudge under a new rules version; CPU abilities fire only in interactive games and CPU fielding abilities never apply; Vortex and the field abilities never appear in bot play.

## Not done

- Home/away alternation for new seasons (ARC 12.3): not implemented; season games keep the current side assignment. Needs a format-gated change in the season fixture creation.
- Telemetry (ARC 17.1), per-ability golden fixtures, stale-token/windup-hint tap tests.
- RNG streams: sim gameplay uses the seeded rng, the computer uses `seed ^ 0x5bd1e995`, the bot `seed ^ 0x9e3779b9`; cosmetic effects use `Math.random` only in apps/web (audio.ts, field.tsx, resume.ts id) and never reach the sim, so they cannot change a replay.
