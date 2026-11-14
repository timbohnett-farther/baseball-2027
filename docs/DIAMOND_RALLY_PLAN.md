# Diamond Rally build (started 2026-11-13)

Source specs (Kimi, written 2026-11-12, not in the repo):
- `/Users/tim/Documents/kimi/tasks/2026-11-11/21-49-21-fe1e5e03/arcade-season-gameplay-prd.md` ("ARC", tap-only arcade + season)
- `/Users/tim/Documents/kimi/tasks/2026-11-11/21-49-21-fe1e5e03/powerups-prd.md` ("PUP", Heat economy + 11 MVP abilities)

Both PRDs say: reuse the existing deterministic core, don't build a parallel sim, and report conflicts instead of
rewriting. Read only the PRD sections a wave needs (headings: `grep -nE "^#{1,3} " <prd>`).

## Tim's decisions on PRD conflicts (2026-11-13)

1. **Rosters: keep the MLB draft.** Real players, real MLB opponents, generic art. Wherever the PRDs say "eight original
   teams", read "the user's drafted team + 7 MLB clubs". Team "styles" (ARC 12.2) can be derived from real ratings.
2. **Progression follows the PRD.** The Super swing becomes Heat-funded power-ups. Super Bats become cosmetic/normalized
   sidegrades (no net advantage). XP levels stay as a badge but no longer raise ratings. Coins, store and cosmetics stay.
3. **Season switches to the PRD format.** 7-game round-robin regular season (one game vs each of 7 clubs), top-4
   single-elimination semifinal + final, three-star objectives. Seasons already in progress finish under the old rules.
4. **Platform: stay web, add a PWA.** Installable to the iPhone home screen in landscape. A match in progress survives
   backgrounding through a local snapshot. The server still records results.

## Engine adaptation (the PRDs assume ball physics; ours rolls each at-bat from ratings)

PUP's "physics" effects (exit speed, launch angle, break, reach, throw speed, runner acceleration) become bounded
modifiers on the existing probability model in `packages/sim/src/game.ts`. Each ability declares its operations in one
place; the sim applies them in a fixed order and logs them, so replays stay deterministic. Document each adapter
next to the ability definition.

**Replay compatibility is a hard rule.** Saved games are re-simulated from seed + input log on read
(`apps/server/src/games.ts`). Every rules change must be gated by a ruleset version stored with the game (old rows =
version 1), and the old behavior must keep producing identical results. Add a golden test that replays a v1 log.

## Waves

- [x] W18 (42ecb22) Baseline + match rules (ARC WO0-1): write `docs/BASELINE.md` (current sim/input/replay/UI interfaces mapped
      to PRD contracts, adapters listed). Then `ruleset` versioning, match config 1/3/5 innings (season and playoff
      locked to 3), walk-off, ten-run rule (ARC 3.4), no ties (extra-inning tiebreaker per ARC 3.3, remove MAX_INNINGS tie).
- [x] W19 (ac1e4e2) Progression realignment + Heat/Rally economy (PUP 3): numeric Heat per athlete and team Rally meter with the PUP
      award tables and Rally Assist, replacing the current 1-3 heat and the hidden momentum chance boost. Super Bats become
      normalized sidegrades; XP stops raising ratings (keep the level badge).
- [x] W20 (8a5f878) Activation service + pitch/bat abilities (PUP 4-8): ability catalog, arm/cancel/commit/expire state machine,
      modifier pipeline, Comet, Laser, Gap Master, Second Swing, Mirage, Vortex. Unit + replay tests.
- [x] W21 (fb96d89) Tap-only batting/pitching UI (ARC 4-6, 9): four pitch buttons + 9-cell target grid, Contact/Power, power-up
      chips with plain-language disabled reasons, safe-area layout. Replaces the Super button.
- [x] W22 (631545c) Fielding + throwing (ARC 7, PUP 9): automatic fielder selection, contextual action button, base targets,
      recommended throw; Wall Reaper, Acrobat, Cannon Arm.
- [x] W23 (359ff62) Baserunning (ARC 8, PUP 10): fixed leads, steal/pickoff, tag-ups, selected-runner commands; Afterburner.
- [x] W24 (90fc65d) Rally Breaker + CPU (PUP 11, 14; ARC 11): Rally Breaker, three CPU difficulty profiles, CPU ability use, AI-vs-AI soak test.
- [x] W25 (b8f38ae) Rookie Rally tutorial + coach hints (ARC Appendix C): 1-inning fixed-seed game, server-verified completion + 100 coins once, one-time hints.
- [x] W26 (67fb470) Season in PRD format + objectives/unlocks (ARC 12-13): migration, 7-game round-robin with the rival in round 4,
      top-4 playoffs, three-star objectives, lifetime track.
- [x] W27 (1b69472) Save/resume + PWA (ARC 14): pitch-start local snapshot, resume after backgrounding, manifest + service worker,
      landscape.
- [x] W28 (d142ed9) Pace + presentation (ARC 10, PUP 12): camera rules, score bug, celebration budgets, haptics, ability VFX/audio.
- [x] W29 (4308676) Acceptance (ARC 17, PUP 17): golden replays, pace telemetry vs ARC 1.4 targets, balance report; see docs/ACCEPTANCE.md.
- [x] W29b (e023966) Balance (rules 9) + acceptance gaps

Each wave: verify `npm run typecheck && npm test && npm run build --workspace @bb/web`, commit, push
(`env -u GITHUB_TOKEN -u GH_TOKEN git push origin main`), then `scripts/deploy-check.sh`. Tick the wave here with its SHA.

## W30+ Graphics (Kimi docs added 2026-11-13)

Source: `ai-cinematic-graphics-roadmap.md` ("ROAD", wins on conflict) and `graphics-production-plan.md` ("GFX") in the
same Kimi folder, plus `reference-images/action-01..08.png` (mood only: lighting, framing, materials; never copy an
athlete or photo). Gameplay rules, touch controls, determinism and accessibility do not change. Visuals never decide
outcomes; cosmetic changes must not change replay hashes (GFX 17.2).

Two layers (ROAD 2-3): (A) live renderer with PBR materials/lighting and the same stable readable camera, no live
DOF/blur/cuts; (B) post-dead-ball action shots replaying the recorded play, 0.75-1.2s, skippable after 250ms,
1-3 per 3-inning match, hard cap 4, never adding RNG or breaking pace budgets.

Working defaults (Tim to confirm or change): oldest device iPhone 12, 60fps with labeled 30fps fallback; slightly
stylized realism, not full photoreal; stay on web Three.js; action shots default REDUCED with FULL/OFF settings;
free/royalty-free rigs and motion libraries, no paid mocap.

- [x] W30 ROAD Work Order 0: audit of the current renderer, asset pipeline, presentation events and measured frame
      cost. Report only, no feature code.
- [x] W31 ROAD WO1-2: quality harness (frame-time capture in the shot harness) + fidelity profiles/LOD tiers. Shipped 47ba7a7: __renderStats + shot.mjs --perf, seeded cosmetic RNG, mesh merge (pitch 321 to 174 calls), High/Standard/Battery tiers.
- [x] W32 ROAD WO6-7: action-shot catalog, scorer and director on the existing event log; replay cameras. Extends
      W28's celebration budgets. Shipped 5be30fe (commits 9bc48b4, 792a4e6, 5be30fe): CONTACT, MOUND_RELEASE, SLIDE_TAG; `actionShots` setting (full/reduced/off).
  W32b (fix): shots staged from the event's `shot` facts with fresh posed figures, hidden live actors and dust, cameras all looking -z so the park renders; one owner per eligible highlight (broadcast then action shot); server re-sim sets `facts`. Open: bat/swing-through read, Director begin/finish/skip not used by production (SkipPlay timer), shot-frequency retune dropped.
  W32c: articulated shot figures + presentation-only transform recorder (apps/web shotscene.ts/shotfigure.ts), one lifecycle (Director begin/finish/active/skip; parallel SkipPlay timer delegated), tested `canFrame`, ball at the one live world size (BALL_SCALE = 1, never per camera), early/mid/late fixtures. Sim untouched. Open: contact ball leaves frame late, release throwing arm hidden from the camera side, device feel EVIDENCE_MISSING.
  W32c review (captures, 3053049): contact reads as a swing; release pose hunched with the throwing arm hidden and the ball (live radius 0.15 m) reading head-sized at close range; slide readable, fielder reach weak. Railway build of 3053049 failed on infrastructure ("failed to download build driver"), redeployed by the next push.
- [x] W32d shot polish (apps/web only, sim untouched): release camera on the throwing-arm side with an upright stride pose; ball inside frame at the contact capture; close cameras pulled back/lengthened so the unscaled ball does not read oversized; fielder glove reach to the tag; real captures for early/mid/late fixtures and a lefty batter.
  Still open: ball:head size ratio is fixed by constants (BALL_RADIUS 0.15 vs head 0.115); pitcher throwing hand is a presentation default (R, lefty via SHOT_MODE-only ?throws=L) as the sim has none; contact ball display speed slowed (CONTACT_SLOW) with recorded direction; runner stray glove removed; device/frame-rate evidence missing.
  W32d review (36bcb56, tests 24/79/39/164): release pose and camera side fixed; contact ball in frame; glove reaches the tag.
  Open: the ball still reads head-sized in close shots (live BALL_RADIUS 0.15 m, kept unscaled by rule) — owner decision;
  fielder and runner overlap in the late slide frame; an extra figure stands behind the batter at contact (cause unknown);
  the sim has no pitcher throwing hand (R is a presentation default).
- [x] W32e shot telemetry (Kimi phase 03): record shot triggers/skips/durations, no frequency or pacing retune.
- [x] W33 live PBR materials/lighting: tiered procedural grass/clay speckle + bump (`surface` in quality.ts), soft shadows on High, roughness/metalness pass on bases, poles, seats, uniforms. Draw calls unchanged within noise.
- [x] W33b cinematic lighting, VFX and post for action shots only. (9f75fdf + 3bdf905, live.) Review: typecheck/tests/build re-run clean (24/91/39/164); contact spark reads well; slide dust reads as glowing dots, not dirt (open); release chalk puff unconfirmed; Standard look and any real device unverified; `shot.mjs --check` `bigplay` fails before and after this wave (open).
- [ ] W34 ROAD WO3-4: athlete rig import validators + animation alignment (needs the art-source decision).
- [x] W35a preload/memory hitches (Kimi phase 09): shot-resource prewarm with fallback, dev `__perfTelemetry`, dispose leak fixes, 15-min desktop soak; results in GRAPHICS_AUDIT "W35a results". Device rows EVIDENCE_MISSING. (0c9c5f5, live.) Review: typecheck/tests/build re-run clean (24/97/39/164). Open: first frame 1.4–1.7 s at mount (pre-existing); soak script "growing" verdict too sensitive; all numbers desktop headless SwiftShader, device rows EVIDENCE_MISSING.
- [x] W35b render-rate invariance + soak (Kimi phase 10): FrameClock frame gate, 540-cell cadence/tier/shot/motion hash matrix, browser cadence matrix (15 runs, one hash), 8 desktop soaks all flat; results in GRAPHICS_AUDIT.md "W35b results". Desktop SwiftShader only; device rows EVIDENCE_MISSING. Open: no optimisation pass, no reduced-flash setting, browser matrix is one seed and precomputed result.
- [x] W36a touch, safe-area and accessibility completion (Kimi phase 11): entry audit (only failure was a bigplay probe false positive, `.big-play` covers the centre probe; fixed in shot.mjs), windup SWING tap ignored with "WAIT FOR THE PITCH" hint (web layer only), `env(safe-area-inset-*)` landscape controls + harness `--inset`/`--vp`, left-handed layout + reduced flash settings (comfort.ts, bb.lefty / bb.reducedFlash, also prefers-reduced-motion), non-colour cues and readable disabled reasons, harness `--lefty --calm --gray --pseudo`; hash-invariance tests. Desktop headless Chromium only; device touch and screen-reader rows EVIDENCE_MISSING. Open: pseudo+lefty at 667pt with insets still shows a coach/run-button overlap and a chip-to-pitch-type 0px gap; bigplay probe is flat there (card covers the view).
  - Review (394f017, live): typecheck 0, tests 24/110/39/164, build ok, deploy-check OK. Open: worst case `--pseudo --lefty --vp=667x375 --inset=0,44,21,44` still fails (pitch-type buttons 0px from chips; run-burn overlaps coach; bigplay probe); the `duel-windup` capture shows the dashed SWING button but no visible "WAIT FOR THE PITCH" text (hint may have expired before capture, unconfirmed); captures otherwise checked by harness geometry only; device touch and screen-reader rows EVIDENCE_MISSING.
- [ ] W35 ROAD WO9-12: preload/memory, accessibility variants, team content, optimization, gates G1-G6.

### Vertical-slice plan (Kimi, found 2026-11-13 13:57)

`vertical-slice-integration-plan.md` ("SLICE") + a Kimi-written `CLAUDE.md` in the Kimi folder. SLICE is one
three-inning CPU match with Comet/Vortex/Wall Reaper, realistic athletes and three action shots (Contact, Mound
Release, Slide/Tag), 15 work orders with a gate each. Our build is already past most of it:
SLICE WO0-8 = W18-W25, W28; WO11 = W27; WO12 = W26 (we shipped the full season, not a placeholder).
Still new: WO9 athlete/stadium fidelity (= W33/W34), WO10 three action shots (= W32), WO13 device/accessibility
hardening (= W35), WO14 external playtest (Tim + Micah on a real phone).

Tim confirmed 2026-11-13: adopt the Kimi CLAUDE.md engineering rules only. Where it conflicts with Tim's direct
instructions, Tim's stand:
continuous waves instead of stop-at-every-gate; commit and push to main; parallel wave agents in worktrees;
MLB draft rosters instead of two original teams; full season and all 11 abilities stay shipped.
Adopted from it: completion-report format, no invented evidence (device results stay "missing" until measured on
a phone), render rate/quality tier must not change replay hashes, no dead UI for deferred content.
W32 scope is the three SLICE shot families first; Wall Reaper is a flagship there, so its open scope question
gets settled in W29.
W29 also checks the Kimi CLAUDE.md sections 3-6 against the build: touch sizes (primary 112x88pt, other controls
56x56pt, base targets 64x64pt, 8pt gaps), stale/repeated taps spend nothing, windup taps ignored with a hint,
separate seeded streams for gameplay, CPU and cosmetic RNG. Report gaps; fix the cheap ones.

SLICE details folded into the waves (read 2026-11-13; prompts at SLICE 571-720, contracts at SLICE 163-246):
- W29 adds SLICE 7.2 pace targets: match 5-8 min, half-inning transition <= 1.5s, no reward animation blocking
  result/rematch > 2s; evidence per SLICE 5.4 (device gates with no device = EVIDENCE_MISSING, never PASS).
- W32 = SLICE WO10: ActionShotDefinition/Catalog/Scorer/Director; CONTACT, MOUND_RELEASE, SLIDE_TAG from recorded
  events; result + dead-ball guard; broadcast fallback; reduced-motion/off; never load heavy assets at the trigger.
  Tests: live-ball suppression, continuing runners, duplicate events, skip/resume, camera clearance, replay hash
  stable. Routine plays never trigger a shot. Runs on current figures first, re-pointed at the realistic rig later.
- W33/W34 = SLICE WO9: needs an approved realistic athlete rig (art asset we do not have). Up to 13 active athletes,
  LODs, PBR uniforms with team masks, baked stadium lighting, import validators. BLOCKED on the rig source.
- W35 = SLICE WO13: worst-case stress, repeated rematches, accessibility matrix (left-handed controls, subtitles,
  grayscale), golden replays across render rates. Device numbers need a real iPhone.
- SLICE WO14: real playtest (Tim + Micah). Not something an agent can pass.
- Not adopted: the slice manifest that disables the season, Rally Breaker and the other 8 abilities (Tim keeps them).

### Kimi audit of the W32 build (found 2026-11-13 15:25)

`NEXT-BUILD-INSTRUCTIONS.md` and `evidence/work-orders/wo0-current-build/audit-and-next-plan.md` in the Kimi folder.
Kimi audited a copy of this repo taken mid-W32 (before 5be30fe), so each finding needs checking against HEAD.
It keeps Tim's decisions (MLB draft, all 11 abilities, Rally Breaker, full season, web/PWA, probability-model sim).
Six packages, mapped to our waves:
- A (green repo, one immediate-finish vs saved-replay response contract for `shot` facts, docs authority note) = W32b.
- B/C (presentation-only transform recorder so a shot replays the recorded play; one lifecycle owner shared by
  production and tests; no double cinematic with the older barrel/dust/ride/hero chain; no camera-dependent ball
  scaling; scene-aware `canFrame`; early/mid/late capture fixtures per family) = W32b where small, rest W32c.
- D (realistic rig + stadium) = W33/W34, still blocked on the rig source. E = W35. F = SLICE WO14 playtest.
- Shot frequency (full 1.40, reduced 0.80 per match) and the 2.8-minute match estimate: no retuning and no added
  delays until a real playtest.
- Separate maintenance item: `npm ci` reports 8 dependency vulnerabilities (6 moderate, 2 high); no force upgrade.

## Kimi weekend queue (2026-11-13, WEEKEND-BUILD-QUEUE.md + weekend-phases/00–21)

Kimi's 22-phase queue replaces its Package-A-only note and accepts continuous waves, the MLB draft, all eleven
abilities, Rally Breaker, full season and web/PWA. Phase files live in the Kimi task folder; each is a work order.
Mapping and status (project records are the evidence, not this list):

- 00 green baseline: COMPLETE at 3053049 (web 75/75; Kimi's 2 failures were from a mid-edit copy).
- 01 contact readability, 02 release + slide/tag: DONE as W32d (36bcb56).
- 03 shot telemetry (no retune) → W32e. 04 live PBR → W33. 05 cinematic post/VFX → W33b.
- 06 athlete asset audition (offline, provenance) → W34a; 07/08 rig import + integration BLOCKED until a legal rig is approved.
- 09 preload/hitch/memory, 10 render-rate invariance + soak → W35a/b (desktop only; device rows EVIDENCE_MISSING).
- 11 touch/safe-area/a11y → W36a. 12 gameplay telemetry → W36b. 14 per-ability goldens + CPU fairness → W36c (IN_PROGRESS, worktree, sim/server tests only, no retune).
- 13 save/resume fault injection (after 03, 12). 15 audio/haptics (after 02, 11). 16 result flow (after 12). 17 season hub clarity (after 13, 16).
- 18 content scale BLOCKED on 08/10. 19 dependency maintenance (separate worktree). 20 playtest kit. 21 RC audit last.
- Serialization points: field.tsx, shotscene.ts, shared CSS, telemetry schemas, sim files — one wave at a time on each.
