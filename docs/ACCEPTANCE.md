# W29 acceptance (ARC 17, PUP 17)

Status key: PASS = a named test or script covers it and passes; GAP = built but not covered or not built; EVIDENCE_MISSING = needs a physical iPhone or a human playtest. Rows are per sub-section group (each ARC/PUP 17.x lists many bullets); a PASS means the group's main bullets are covered, any bullet not covered is named in the Note. Nothing here was measured on a device.

| Criterion | Status | Evidence / note |
|---|---|---|
| ARC 17.1 telemetry | GAP | No telemetry pipeline. The event log carries pitches, PAs, runs, HRs, steals, abilities (soak.ts reads them). Rejected-intent, tap-by-control and skip-rate counters are not recorded. |
| ARC 17.2 match rules | PASS | packages/sim rules.test.ts, game.test.ts, run.test.ts, golden.test.ts (rules 1-8). Not checked bullet by bullet: one-inning Quick Match vs second-inning rule, season rejects 1/5 innings. |
| ARC 17.3 touch contract | PASS (desktop headless Chromium) / EVIDENCE_MISSING (device) | `shot.mjs --phone --check` asserts primary >=112x88, gameplay controls >=56x56, base targets >=64, 8px gaps, no overlaps, controls inside the safe area, no clipped text, lefty primary in the left half. W36a: the only entry failure was a bigplay probe false positive (fixed); after fixes every moment passes default, `--lefty`, `--calm`, `--gray`, `--pseudo` at 844x390 and with simulated insets at 667x375, 844x390, 932x430. Windup swing tap is ignored (touch.test.ts). Physical-device touch ergonomics not measured. |
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
| W32 action shots: replay outcome unchanged | PASS | actionshot.test.ts replay-hash invariance across the setting and director playback; shotfacts.test.ts; goldens 1-9 unchanged |
| W32 action shots: budgets and skip | PASS | actionshot.test.ts: 0.75-1.2 s, skip after 250 ms, cap 4 (full) / 3 (reduced), no shot on routine plays or live ball; holdWithShot shared by duel.tsx and game.tsx |
| W32 action shots: framing, no clipping | PARTIAL (desktop) | W32c: jointed shot figures (same uniforms, colours, numbers, proportions), transform recorder (6 s ring, keyed by event id), real tested `canFrame` (subjects and ball in frame with margin, not occluded, else broadcast view; early/mid/late fixtures per family, desktop and portrait aspect), lefty mirroring, slide uses the actual runner and base. Phone captures shots-w32c: slide reads as a feet-first slide into the bag with the fielder reaching; contact shows the swing-through with bat across frame but the ball has already left the frame in the captured moment; release shows the pitcher with stride and the ball in flight, large because it is the true world ball size and the camera is close, throwing arm mostly hidden behind the torso. `--phone --check` duel-* 5/5 ok
| W32 action shots: draw calls < 250 | PASS (desktop headless Chromium) | W32c `shot.mjs --perf`: contact 89, release 69, slide 132; not device evidence |
| W32 action shots: device feel, frame time on phone | EVIDENCE_MISSING | no device run |
| W35b render rate / quality / accessibility do not change outcomes | PASS (desktop) | cadence.test.ts 540 cells (30/60/144 Hz, uneven, stall x 3 tiers x shot modes x reduced motion), one replay hash per seed; browser `cadence.mjs` 15 runs one hash (seed 11, precomputed result). Reduced flash added in W36a (see W36a rows). |
| W36b telemetry does not change outcomes | PASS (desktop) | gameplaytelemetry.test.ts: replay sha256 identical with and without the collector, seeds 1,2,3,17,4242,90210 x both sides; sim goldens untouched |
| W36b ignored controls carry a typed reason | PASS (desktop) | gameplaytelemetry.test.ts produces all 12 reasons (stale_phase, repeated_tap, wrong_ownership, invalid_possession, insufficient_heat, wrong_window, unavailable_target, windup_tap, insufficient_rally, cooldown, already_used, needs_direction); in-game chip/windup paths wired, DOM taps not driven in a browser |
| W36b Heat and ability accounting conserve | PASS (desktop, synthetic) | `node --experimental-strip-types apps/web/scripts/gameplay-report.mjs`, 200 bot games: reserved 11000 = spent 11000, outstanding 0, 521 Heat cross-checks 0 mismatches; 6 of 15045 prefix replays differ in the tail (bot lists a team extra after its pitch), so ability and Rally Breaker counts can be off by a few |
| W36b real-player control friction | EVIDENCE_MISSING | collector is local-only and no human session has been read from it; the report is bot-driven |
| W36d resume at every stop gives the identical game | PASS (desktop, synthetic) | lifecycle.test.ts: at every awaiting stop of a 3-inning bot game (save, JSON text round trip, restore, finish) the result hash and input log equal the uninterrupted game; includes a stop after half_start, pitch and play, across a half-inning turn, and 6 restores in a row |
| W36d old saves (rules 1-9) | PASS (desktop) | lifecycle.test.ts: each rules version resumes to its own uninterrupted hash; rules 0, 10 and 1.5 are refused with the readable older-version message |
| W36d damaged, stale or unreplayable saves | PASS (desktop) | truncated/non-JSON text now surfaces as a refusal (was silently null, the blob lingered); wrong schema, week-old, finished game and a bad recorded input are refused, never patched |
| W36d full or blocked storage | PASS (desktop, in-memory store) | a throwing setItem leaves the earlier save intact; a finished game that cannot be stored in the outbox keeps the resume save (enqueue returns false); a late upload clears only its own game's save |
| W36d duplicate uploads | PASS (PGlite, in-memory) | finish-idempotency.test.ts: repeat finish returns 200 with the same game and no reward block, coins/season/stars/unlocks/games count unchanged; clientGameId scoped per user; tampered score 409 with no pay. Concurrent test passes with and without the new per-game lock because PGlite serializes, so the race itself is not reproduced |
| W36d outbox in-flight guard | PASS (desktop) | sign-in, online event and mount asking at once share one pass (each game sent once) |
| W36d resume does not replay an already-shown action shot | PASS (logic only) | planAfterResume + test over a seed sweep; the React effect in field.tsx was not driven in a browser |
| W36d service-worker update during a saved game, real OS backgrounding, shot canvas timing after a visibility pause | EVIDENCE_MISSING | not exercised |
| W36d physical-device close/reopen, airplane mode at the last out | EVIDENCE_MISSING | no physical phone run, no human session |
| W35b sustained soak, no resource growth | PASS (desktop headless Chromium) | 15 min High + 7 x 3 min runs, leftover resources flat, heap 18-55 MB; GRAPHICS_AUDIT.md "W35b results" |
| W35b device frame rate, memory, thermal | EVIDENCE_MISSING | no physical iPhone run; desktop numbers are not phone evidence |
| W36a left-handed layout and reduced flash do not change outcomes | PASS (desktop) | cadence.test.ts: lefty x calm x seeds, one replay hash per seed; calm removes the contact pulse and cuts fx (shotTreatment) |
| W36a safe-area, left-handed, grayscale, pseudo-localized phone layouts | PASS with known gap | harness `--inset`, `--lefty`, `--gray`, `--pseudo`, `--vp`; open: pseudo+lefty at 667pt with insets (coach vs run button overlap, 0px chip gap) |
| W36a audio-only cues have text equivalents | INFERRED | ability-cue and call text already render as role=status; not verified with a screen reader |
| W36a physical-device touch ergonomics | EVIDENCE_MISSING | no physical phone run |
| W36a screen-reader (VoiceOver/TalkBack) pass | EVIDENCE_MISSING | not run |
| W32 action shots: shots per match | PARTIAL | auto-sim 30 seeds, no retune: full mean 1.40 (max 4), reduced mean 0.80 (max 2), below the 1-3 target. W32b: the server re-sim, immediate-finish and saved-replay all set `facts`, so Watch gets the same shots; tests show outcomes and hashes identical with `shot` removed |

Counts: PASS 9 (incl. partials), GAP 3, EVIDENCE_MISSING 7 (ARC 17.8 rows). W29b changed no row status; the 17.3 row stays partial.

## Wall Reaper scope (PUP 9.1)

Built: a Heat-60 fielding ability, offered on fly balls (`c.kind === "fly"`), that moves a close extra-base fly half a contest band toward the out (`reach: 0.5` in ability.ts); the glove tap still decides, and a homer is never undone.
Not built: the 2.0 m wall-distance test, 2.0-5.0 m height window, +1.25 m vertical reach, +-140 ms catch timing, 650 ms failure recovery, intercept marker, 8% zoom. The game has no 3D ball path to test those against. Status: GAP vs section 9.1, intentional simplification.

## Rules 8 (W29)

The throw-over limit (two) was documented per batter but never reset, so it was match-wide. Rules 8 resets it for every batter. Rules 1-7 replay unchanged (goldens). In-flight rules 7 season games are still accepted.

## Rules 9 (W29b)

Outcome-changing balance, gated on ruleset 9 (CURRENT_RULES=9); rules 1-8 goldens unchanged, two new rules 9 goldens. TUNE9 in packages/sim/src/game.ts: `{ foulZone: 0.25, foulOff: 0.32, foulScale: 0.65, contactAdd: 0.04, zoneAdd: 0.10, swingAdd: 0.08, hit: 0.35, hr: 0.06, rallyGain: 0.34 }` (shorter at-bats, more contact, slower Rally fill). rallyGain 0.38 gave Breaker in 58%/62% of games (too common); 0.30 gave 14%/18% (too rare). Server accepts rules 9 (whitelist, `games.rules` column type). Season fixtures alternate home/away (ARC 12.3): `user_side` column (migration 0013), `regularSide`/`semiSide`/`finalSide` in packages/shared; legacy null side means home; replay, score, win, payout and objectives follow the user's side.

## Soak before/after (soak.ts, 3 innings, 1000 games each; est. minutes assume 1.5 s/prompt, not device-measured)

| Roster | Rules | Pitches mean (med / p90) | Runs (in 4-10) | HR | Extra inn. | Ten-run | Breaker/game bot / cpu | Games with Breaker | Est. min |
|---|---|---|---|---|---|---|---|---|---|
| Synthetic | 8 | 80.8 (77 / 108) | 2.93 (28%) | 0.76 | 29.8% | 0.1% | 0.95 / 0.79 | 98% | 3.2 |
| Synthetic | 9 | 68.6 (66 / 90) | 4.37 (48%) | 1.17 | 18.3% | 0.3% | 0.321 / 0.252 | 43% | 2.8 (p90 3.9) |
| Real (data/players.json, `SOAK_REAL=1`) | 8 | 79.4 (76 / 104) | 3.09 (31%) | 1.04 | 25.0% | 0.0% | 0.94 / 0.83 | 98% | 3.1 |
| Real | 9 | 69.0 (67 / 89) | 4.68 (55%) | 1.49 | 16.1% | 0.0% | 0.357 / 0.260 | 47% | 2.8 (p90 3.8) |

The 5-8 min median is NOT met (estimate 2.8 min, computed only; a human timing is EVIDENCE_MISSING). The rules 7 section below is the original baseline.

## Soak (soak.ts, rules 7 baseline, 3 innings, 1000 games, synthetic even 70/70 teams)

Run with `SOAK_N=200 node packages/sim/src/soak.ts`. Bot win rate by pairing 52-70%. Per game: pitches mean 80.7 (median 77, p90 110; ARC target ~45-70, over; extra innings in 29% of games inflate it), PAs 26.2, runs 2.96 combined (target 4-10; 29% of games in range), HRs 0.75, ability commits 3.5 (39% in the 4-10 range), Rally Breaker 0.95 (bot) / 0.79 (CPU) per game, 98% of games use at least one. Ten-run rule ended 0.2% of games.
Estimated match length (computed, not measured): blocking presentation median 65 s, p90 98 s; with 1.0/1.5/2.0 s per prompt and ~86 inputs, median 2.5/3.1/3.8 min, p90 3.6/4.5/5.5 min. Below the 5-8 min target. Half-inning transition budget 1300 ms (cap 1500).

Recommendations (not changed, judgment calls): Rally Breaker fires nearly every game, raise its cost or lower Rally gain if it should be rare; runs per game are low, consider a hit-rate nudge under a new rules version; CPU abilities fire only in interactive games and CPU fielding abilities never apply; Vortex and the field abilities never appear in bot play.

## Not done

- Home/away alternation is implemented. The playoff final site is treated as higher seed home, not neutral (not modeled).
- Telemetry (ARC 17.1), per-ability golden fixtures, windup-hint, left-hand mirror and safe-area checks, investigation of the 2 shot.mjs layout failures.
- RNG streams: sim gameplay uses the seeded rng, the computer uses `seed ^ 0x5bd1e995`, the bot `seed ^ 0x9e3779b9`; cosmetic effects use `Math.random` only in apps/web (audio.ts, field.tsx, resume.ts id) and never reach the sim, so they cannot change a replay. Confirmed separate in W29b: no Math.random in packages/sim.
