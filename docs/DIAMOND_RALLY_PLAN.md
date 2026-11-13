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
- [ ] W27 Save/resume + PWA (ARC 14): pitch-start local snapshot, resume after backgrounding, manifest + service worker,
      landscape.
- [ ] W28 Pace + presentation (ARC 10, PUP 12): camera rules, score bug, celebration budgets, haptics, ability VFX/audio.
- [ ] W29 Acceptance (ARC 17, PUP 17): golden replays, pace telemetry vs ARC 1.4 targets, balance report.

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

- [ ] W30 ROAD Work Order 0: audit of the current renderer, asset pipeline, presentation events and measured frame
      cost. Report only, no feature code.
- [ ] W31 ROAD WO1-2: quality harness (frame-time capture in the shot harness) + fidelity profiles/LOD tiers.
- [ ] W32 ROAD WO6-7: action-shot catalog, scorer and director on the existing event log; replay cameras. Extends
      W28's celebration budgets.
- [ ] W33 ROAD WO5, 8: live PBR materials/lighting; cinematic lighting, VFX and post for action shots only.
- [ ] W34 ROAD WO3-4: athlete rig import validators + animation alignment (needs the art-source decision).
- [ ] W35 ROAD WO9-12: preload/memory, accessibility variants, team content, optimization, gates G1-G6.
