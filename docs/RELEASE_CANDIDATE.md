# Release candidate audit RC01

Audited build: f65d972 (main), production https://baseball-2027-production.up.railway.app. Date 2026-11-13.

This is an engineering audit. It is not a statement that the game is finished. Every physical-iPhone, OS-lifecycle, visual-approval, fun/fairness and human-playtest item is still EVIDENCE_MISSING (see docs/ACCEPTANCE.md and docs/playtest/).

Verified = a command was run in this audit. Inferred = concluded from reading code or from the verified runs.

## Environment

- macOS (Darwin 27.2.0), Node v26.8.1 (package engines field says 24.x; not tested on 24).
- Browser harness: playwright-core driving locally installed Google Chrome 157.0.8103.79, headless, software GL (SwiftShader). Desktop numbers are not phone evidence.
- No code, golden, dependency or content change was made in RC01. Only docs changed.

## Commands and results (all verified)

| Command | Result |
|---|---|
| `npm ci` in a fresh worktree of f65d972 | exit 0 (install-script warnings only) |
| `npm run typecheck` | 0 "error TS" (fresh worktree and main tree) |
| `npm test` | server 28, web 159, shared 40, sim 164 tests, 0 fail each (fresh worktree and main tree) |
| `npm run build` | ok, server dist/index.js 197.3 kb |
| `npm audit --json` | 4 moderate, 0 high, 0 critical: dev-only drizzle-kit chain, matches docs/DEPENDENCY_AUDIT.md |
| `SOAK_N=1000 node packages/sim/src/soak.ts` | exit 0, 5000 games, rules 9, no stall or NaN. Pitches/game mean 68.6 (median 66, p90 91), runs 4.38, HR 1.21, extra innings 18.3%, Rally Breaker 0.346 bot / 0.242 cpu |
| `apps/web/scripts/gameplay-report.mjs` (200 bot games) | 521 heat checks, 0 mismatches. Bot only |
| `apps/web/scripts/cadence.mjs --seed=11 --matrix=lean` | 15 runs, all start and end on hash b0f50b25, 1 distinct hash, shot selection identical across cadence and tier |
| `shot.mjs --phone --check` default, `--lefty`, `--calm`, `--reduced`, `--gray` | 17 moments ok each, 0 FAIL |
| `shot.mjs --phone --check --vp=667x375 --inset=0,44,21,44` | 16 ok, 1 FAIL (defect D1) |
| `scripts/deploy-check.sh` | serves f65d972, db connected, migrations 14/14 |
| Read-only GETs | /health 200, / /sw.js /manifest.webmanifest 200 no-cache, hashed asset `public, max-age=31536000, immutable` |

Goldens for rules 1-9 (packages/sim/src/golden.test.ts, ability-golden.test.ts) pass inside the 164 sim tests and no sim file changed.

## Implemented scope

Rally Duel and season arcade play, rulesets 1-9, abilities with per-ability goldens and CPU fairness checks, action shots with cadence and quality tiers, resume and outbox with idempotent finish, left-handed, calm and reduced-flash settings, captions and cues, season hub, result flow, PWA shell, and the external playtest kit. The athlete rig import (W34) is BLOCKED on a legal rig and W35 is still open in the plan; no third-party art is in the repo.

## Defects

| Id | Severity | Finding | Status |
|---|---|---|---|
| D1 | Low-medium | At 667x375 with insets 0,44,21,44 the tutorial coach bubble "Pick a pitch" [367,248,113x41] overlaps two EDGE target cells ([425,222,58x58] by about 32 px, [425,288,58x58] by about 1 px). Reproduces every run. The bubble has `pointer-events: none` (apps/web/src CSS `.coach`), so taps reach the cells (inferred from CSS, not tested on a device). Visual only, tutorial only, one small-phone landscape viewport. | Not fixed: not release-blocking. Proposed: narrow or shift the coach on short narrow viewports, then re-run the check at that viewport |
| D2 | Info | `--gray` bigplay "centre pixels are flat" does not reproduce unloaded (gray 4 of 4 pass, default 2 of 2 pass) and fails 3 of 4 in both gray and default under artificial CPU load. Inferred cause: the probe in shot.mjs `layoutCheck` samples after a fixed 1500 ms, before the software-GL canvas has painted. Harness artifact. | Not fixed. Proposed: poll until at least 6 colours or a render-frame counter |
| D3 | Low | `?shot=` is not DEV-gated in field.tsx and duel.tsx. Hand-editing it onto a production URL holds swing and glove panels (no auto-take timer) and fixes a cosmetic seed. Replay inputs stay logged; the sim is untouched. Self-inflicted. | Not fixed. Proposed: gate on `import.meta.env.DEV` |
| D4 | Low | A harness-only `ECONNREFUSED /api/games/interactive/finish` proxy line on duel-result (no server in the harness). | Known, not a product defect |

## Known risks (not defects of this audit)

- Match length: computed median 2.8 min (p90 3.9) at 1.5 s per prompt against the 5-8 min target. Computed only; no human timing exists.
- Shots per match (auto-sim, W32 row in ACCEPTANCE): full mean 1.40, reduced mean 0.80 against a 1-3 target; reduced is below it. Not re-measured in RC01.
- Finish idempotency lock is single-instance (inferred from code and the PGlite test).
- Google Fonts (Inter, Oswald) load from fonts.googleapis.com in index.html: an offline and privacy dependency.
- 441 px layout width on the home page at 390 px portrait emulation; nav tab wrap; legacy format-1 season hub keeps the old layout.
- Haptics control is hidden on iPhone Safari; there is no on-phone telemetry, frame readout or build label, so a tester counts by hand.
- Largest bundles: field chunk 551 KB, index 395 KB (not measured on a phone).
- 4 moderate dev-only audit advisories.

## Open external gates (EVIDENCE_MISSING)

Physical iPhone run (touch ergonomics, frame rate, memory, thermal, audio unlock, haptic feel), OS lifecycle (backgrounding, airplane mode at the last out, service-worker update mid-game), screen reader pass, visual approval of final art and the W34 rig, fun and fairness judgments, and the human playtest using docs/playtest/.

## Recommended next action

The automated engineering checks are green and the open defects are low severity. Run the external playtest with docs/playtest/ on a real iPhone (Facilitator and Tester A), and fix D1 first if it shows on the tester's phone. Do not read any result here as a playtest result.
