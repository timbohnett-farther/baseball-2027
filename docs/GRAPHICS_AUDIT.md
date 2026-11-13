# Graphics audit (W30, Work Order 0)

Report only. No feature code changed. Roadmap source: `ai-cinematic-graphics-roadmap.md` and `graphics-production-plan.md` (Kimi docs, outside the repo).

Measurement label: every measured number below is **desktop headless Chromium (Chrome channel, SwiftShader software GL), 844x390 CSS px at DPR 2 = 1688x780 canvas. Not device evidence.** No iPhone or Android number exists; device rows stay "missing".

Method: a throwaway local patch exposed the `WebGLRenderer` and scene on `window` (reverted, never committed); a Playwright script loaded the existing shot pages (`/?shot=<moment>`), waited for `__shotReady`, sampled `requestAnimationFrame` intervals for 4 s, then read `renderer.info`. Port 5207.

## 1. Renderer inventory

All rendering is one file: `apps/web/src/field.tsx` (908 lines). Three.js `^0.170.0` (`apps/web/package.json`; installed version not checked).

| Area | What exists | Ref |
|---|---|---|
| Renderer | `WebGLRenderer({antialias:true})`, pixel ratio `min(dpr,2)`, ACES filmic tone map, sRGB output | field.tsx:328-331 |
| Shadows | `shadowMap.enabled`, type left at default; one shadowed key light, 2048x2048 map | :332, :341 |
| Lights | 3 Directional (key 3.0, fill 0.9, rim 1.2 boosted on barrel/dust shots), 1 Point `pop` (cinematic hits), 1 Hemisphere | :338-350 |
| Atmosphere | background and `FogExp2` `#0B0D12` density 0.0028 | :334 |
| Post-processing | none (direct `renderer.render`) | frame loop ~:798 |
| Park | `buildPark`: grass sector (WALL_R 112), warning track, dirt, mound, chalk, bases, wall, 3 sign panels, two decks, scoreboard, 6 light towers + glow sprites, crowd Points | ~:381-475 |
| Figures | `makePlayer` (procedural groups), `dress` applies jersey texture | :156, :224 |
| Particles | `Dust` class: 400-point burst + 90-point drift, additive Points | :245 |
| Textures | all runtime `CanvasTexture`: grass (:54), signs (:69), jersey cache per team/player (:100), soft sprite (:41) | |
| Materials | `MeshStandardMaterial` almost everywhere (`std()` :88), `MeshBasicMaterial` for chalk/cap/scoreboard/light banks, `PointsMaterial`, `SpriteMaterial` | |
| Camera | `PerspectiveCamera(48, 16/9, 0.1, 400)`; views plate/field/runners/stadium from `cameraViewFor` (presentation.ts); shots barrel/dust/ride/drive/hero/dive (`ShotKind` :33); hand-held jitter via `Math.random` (:871) | |
| Loop | rAF, `real = min(0.05, dt)`, speed scale, hand-written tweens; no frame cap, no quality tier, no dynamic resolution | :798 |
| Loading | `FieldView` is `React.lazy` in `game.tsx:12` and `duel.tsx:20`; WebGL failure is caught silently | :885 |
| Assets | none loaded: no glTF, no image/audio files; geometry and audio are synthesized | |

Scene census (desktop headless Chromium, not device evidence; `pitch` moment, traversed scene):

| Item | Count |
|---|---|
| Meshes (all visible) | 301 (301 unique geometries) |
| Shadow-casting meshes / their triangles | 192 / 28,448 |
| Scene triangles (index-count sum) | 35,172 |
| Unique materials | 173 (114 Standard, 9 Basic, 4 Points, 46 Sprite) |
| Sprites | 46 |
| Points objects / vertices | 4 / 10,890 |
| Lights | 3 Directional, 1 Point, 1 Hemisphere |
| Skinned / instanced meshes | 0 / 0 |
| CanvasTextures | 20 (sizes 64^2 x3, 512^2 x2, 1024x160 x3, 1024x300, 1024x512 x11) |

Findings: 173 materials for 301 meshes and zero instancing is the draw-call driver. Each figure builds its own materials; nothing is shared or batched.

## 2. Scene cost (measured)

Desktop headless Chromium, SwiftShader, 1688x780 canvas. Not device evidence.

| Moment (shot) | Draw calls | Triangles | Points | Geometries | Textures | Programs |
|---|---|---|---|---|---|---|
| pitch | 328 | 34,828 | 10,890 | 298 | 21 | 10 |
| single (ball in play) | 295 | 31,704 | 10,890 | 319 | 22 | 10 |
| hr | 268 | 28,690 | 10,890 | 303 | 21 | 10 |
| bigplay (card) | 274 | 28,702 | 10,890 | 303 | 21 | 10 |

Frame time (rAF interval, 4 s window):

| Moment | Median ms | p95 ms | Samples |
|---|---|---|---|
| pitch | 50.0 | 50.1 | 83 |
| single | 50.0 | 50.1 | 84 |
| hr | 33.3 | 50.0 | 115 |
| bigplay | 33.3 | 50.1 | 106 |

Variants (same method, 3 s windows):

| Variant | pitch | single / hr / bigplay |
|---|---|---|
| Shadows off, median | 49.9 | 33.4 |
| Pixel ratio 1, median (shadows on) | 33.3 | 33.3 |
| Pixel ratio 1, p95 | 50.0 | 33.4 |

Caveats, read before using these numbers:
- Frame times are quantized to 16.7 ms multiples and SwiftShader is a CPU rasterizer. They show relative cost only. They say nothing about iPhone 12 or any GPU. A 60 fps claim is **not measured** and none is made.
- Pixel ratio 1 improved the median from 50 to 33 ms on pitch: consistent with fill-rate or raster cost dominating in software GL. Shadows off showed no clear gain here.
- Draw calls and triangles were identical with `shadowMap.enabled` toggled. Whether `renderer.info` counted the shadow pass was not verified, so **no shadow draw-call cost is claimed**. 192 meshes cast shadows, so a real-GPU shadow pass could add up to roughly that many calls: this is inference from the census, not measurement.
- Not measured: JS heap and GPU memory, texture residency in MB, thermal behavior, load time on a throttled CPU, first-frame shader compile stall.
- Budgets in `graphics-production-plan.md` 2.3: draw calls under 150 (lower tier) / 250 (higher tier), about 400-650k triangles, one shadowed light, 256/512 MB texture residency. Against those: draw calls are over budget in all four moments (268-328); triangles are far under (about 29-35k); one shadowed light is met.

## 3. Bundle

`npm run build --workspace @bb/web` (Vite). Sizes are gzip as reported by Vite.

| Chunk | Raw | Gzip | Loads |
|---|---|---|---|
| `index-*.js` | 351.81 kB | 111.71 kB | at app start |
| `index-*.css` | 42.22 kB | 9.15 kB | at app start |
| `index.html` | 1.30 kB | 0.60 kB | at app start |
| `duel-*.js` | 25.49 kB | 9.10 kB | lazy, `App.tsx:16` when a match opens |
| `field-*.js` (Three.js + `field.tsx`) | 524.40 kB | 135.20 kB | lazy, when `FieldView` mounts |

Before first pitch the page needs index + css + duel + field: about 265 kB gzip, JS about 256 kB. Three.js is the single largest cost and sits entirely in the field chunk (no `manualChunks`; Three.js not split from `field.tsx`, tree-shaking extent not examined). Field is requested only when a match view mounts, so the home screen does not pay for it, and the match view shows a `Suspense` placeholder while it loads (`duel.tsx:167`).

`vite.config.ts` has a custom plugin that emits `/sw.js` precaching every built asset (`sw.template.js`), so the field chunk is also fetched in the background after install. Cold-load time on a throttled network or device: not measured.

## 4. Athlete figures and glTF plug-in

Current figures: `makePlayer(color, bat, seed, ump)` returns a `THREE.Group` named `rig` built from cylinder limbs (`limb()` :142), a capsule torso, sphere head, cap, box cleats, sphere gloves, and a `bat` group. No skeleton, no `SkinnedMesh`, no `AnimationMixer`. Motion is hand-written: `swing()` rotates group and bat, pitcher `rotation.x` is a sine, runners lerp between bases, fielders scale out on fade. The catcher crouch is `scale.y`. Each figure allocates its own materials. At most about 15 figures at once (9 fielders, umpire, on-deck, batter, up to 3 runners).

What a rigged glTF plugs into:
- **Slot**: `makePlayer` call sites and the `dress(g, team, player)` jersey assignment (:224). A loader would return a group with the same named children the animation code touches (`rig`, `bat`) or replace that animation code.
- **Missing, in order**: (1) `GLTFLoader` and asset pipeline (none today; no Draco/KTX2 decoders in the bundle); (2) an `AnimationMixer` and a clip set (stance, windup, release, swing, run, throw, slide, tag, celebrate); (3) a retarget or bone-name convention; (4) team color/number as material parameters instead of a per-player CanvasTexture; (5) LOD0-3 and shared materials to hit the draw-call budget; (6) the rig itself.
- **Hard blocker**: there is no rigged athlete asset in the repo and no art-source decision. Roadmap Work Orders 3-5 depend on it.

## 5. Presentation event flow

`GameEvent` (`packages/sim/src/types.ts:70`) types: `half_start`, `pitch` (batterId, pitcherId, result, mph, zone), `play` (outcome, runs, rbi, text, tier, call, card, stat, superSwing), `pitching_change`, `final`, `run` (steal/caught/pickoff/advance/hold/thrown_out, runnerId), `team` (rally_breaker), `ability` (phase committed/triggered/expired/rejected). Each carries `state: GameState`.

Flow:
1. `duel.tsx` advances `shown` on a timer of `holdFor(event)/speed`; `game.tsx:162-166` does the same for replays. `presentation.ts` supplies `blockingBudgetMs` (pitch 450, half_start 1300, pitching_change 1400, ability 500, team 750, run 700, play 500; homer/tier 1-2 1200, strikeout 1000), `skipAfterMs` (200-250), `cardWindowMs`, `CAMERA_BLEND_MS` 250, `fitShots`, `cameraViewFor`.
2. An effect on the current event calls `playEvent` (audio.ts), `vibrate(hapticFor(...))` (haptics.ts), the pace tracker, and passes `fieldIndex` to `FieldView`, with `AbilityCue` (abilityfx.ts, `cueFor`) as a child overlay.
3. `FieldView` calls `Director.handle(event, jumped)` (~:540): sets the camera view and budget, then `syncHalf`, `syncPitcher`, `onPitch`/`onPlay`/resync for `run`. `flush()` completes tweens on skip.

**Where an ActionShotDirector attaches**: inside `Director.handle`/`onPlay`, after the play outcome is known and before the hold timer expires. It extends the existing `ShotKind` list and `fitShots`, and must extend `blockingBudgetMs`/`skipAfterMs` in presentation.ts, plus the two hold timers in `duel.tsx` and `game.tsx`. Reduced-motion handling already exists (cuts blends, removes jitter and cinematic shots) and is the hook for the REDUCED/OFF settings.

**What the log cannot re-stage today.** Ball flight, landing spot, fielder choice and pitch location are cosmetic inventions from `rnd(i,k)` (:22), a sine hash of score/outs/batter/pitcher. The log does not carry:

| Shot | Missing from the log |
|---|---|
| Contact | contact point, exit velocity, launch angle, spray direction, batted-ball type (only `stat` as a string like "431 ft") |
| Mound release | release point, pitch type, pitch location (only `mph`, `zone`, `result`) |
| Fielding/throw | landing point, responsible fielder, throw target, throw timing |
| Slide/tag | base, play type, tag/slide timing, safe/out geometry (only `run` action + runnerId) |

Two options: keep deriving from the hash (stable but fake), or have the sim record the extra fields without changing outcomes. The second needs a replay-hash check. Staging must never feed back into the sim.

## 6. Determinism boundary

Sim and shared packages: no `Math.random`, `Date.now` or `performance.now` found in `packages/sim/src`; one wall-clock read in `packages/shared/src/chemistry.ts:92` (`season = new Date().getUTCFullYear()` as a default argument). That is a latent non-determinism if chemistry feeds outcomes: check callers pass `season` explicitly (not checked). Tests were excluded from the grep.

Web code, all cosmetic or non-sim:

| Use | Where | Feeds sim? |
|---|---|---|
| `Math.random` dust burst/ambient | field.tsx:253, 267-270 | no, visual |
| `Math.random` stadium flashes and crowd | field.tsx:452-455, 464-469 | no, visual |
| `Math.random` camera jitter | field.tsx:871 | no, visual |
| `performance.now` frame clock, drift shimmer | field.tsx:279, 323 | no, visual |
| `Math.random` noise buffer | audio.ts:41 | no, audio |
| `Date.now` pace tracker | duel.tsx:97-133 | sent as `pace`; server only logs it (`apps/server/src/games.ts:270-271`) |
| `performance.now` progress animations | duel.tsx:414-518 | no, UI |
| `crypto.randomUUID`/`Date.now`/`Math.random` id, `Date.now` restore age | resume.ts:27, 47 | no, persistence |
| `getUTCFullYear` | draft.tsx:66 | no, display (not examined further) |
| `toLocaleString` | game.tsx:145 | no, display |

Consequence: the visual layer is non-deterministic by design (crowd and dust differ per run). That breaks pixel-exact reference captures. Work Order 1 needs a seeded RNG (or fixed seed in shot mode) for those draws. `apps/web/src/invariance.test.ts` exists (47 lines); not read, so what it guards is unverified.

## 7. Gaps vs Work Orders 1-12

| WO | Scope | Status |
|---|---|---|
| 1 | Reference/quality harness | needs frame-time and `renderer.info` capture in `shot.mjs` (not exposed today), plus seeded cosmetic RNG; shot harness itself exists |
| 2 | Fidelity profiles, asset manifests (LOD0-3) | needs a quality tier switch in `Director` (none today) and a manifest format; manifest part blocked on assets |
| 3 | Character/material import validators | blocked on asset (no rig, no loader) |
| 4 | Animation alignment/debug tools | blocked on asset |
| 5 | Live PBR stadium/character renderer | stadium: needs materials/draw-call work first; character: blocked on asset |
| 6 | Action-shot catalog, scorer, director | needs extra sim event fields (section 5) or accept hash-driven staging; `ShotKind` and camera blend infrastructure ready |
| 7 | Replay cameras and safety | needs WO6; skip/budget plumbing and reduced-motion ready |
| 8 | Cinematic lighting/VFX/post | needs a post pipeline (none) and a tier switch; lights and dust exist |
| 9 | Preload/prewarm, memory | needs memory measurement (not measured) and shader prewarm; lazy chunk exists |
| 10 | Accessibility variants | partial: reduced-motion cuts blends/jitter/cinematic shots; needs FULL/REDUCED/OFF setting |
| 11 | Team/content variations (8 identities) | blocked on asset; jersey textures per team exist as canvas |
| 12 | Optimize and content-lock | needs WO1-2 first; no device numbers exist |

## 8. Recommendation

Next three waves, smallest first step each (aligned with `DIAMOND_RALLY_PLAN.md` W31-W33):

| Wave | Goal | Smallest first step |
|---|---|---|
| W31 | Harness and tiers (WO1-2) | Add `window.__renderStats` in shot mode only (calls, triangles, textures, programs, frame median/p95) and a `--perf` flag in `shot.mjs`. Same number set as section 2, committed and repeatable. Then seed the cosmetic RNG in shot mode. |
| W31b | Cut draw calls (WO2/5) | Share materials across the figures and merge static park meshes by material. Re-measure against the 250 target. No visual change expected, so it is checkable with the existing `--check` shots. |
| W32 | Action shots (WO6-7) | Add the missing sim fields (section 5) behind a log-version, prove replay hashes are unchanged, then build one shot (HR contact) end to end. Default REDUCED. |
| W33 | Tier switch and polish (WO5/8) | Single `quality` enum (high/standard/battery) read by `Director`; start with pixel ratio and crowd/dust counts. |

(W31b is a split of W31 if the draw-call work is too big for one wave; the plan lists three waves W31-W33.)

Quality tiers, derived from measured costs only. Numbers in the "scene cost" column come from section 2 (desktop headless Chromium, not device evidence). No tier is validated on a device.

| Tier | Resolution | Shadows | Crowd / dust | Scene cost today | Basis |
|---|---|---|---|---|---|
| High | pixel ratio up to 2 (today's behavior) | key light 2048 map | full (10,890 points) | 268-328 calls, 29-35k tris | measured, over the 250-call budget |
| Standard | pixel ratio 1.5 | key light, smaller map | reduced points | not measured | pixel ratio 1 gave 50 to 33 ms median in software GL; a 1.5 setting is untested |
| Battery | pixel ratio 1, 30 fps cap | off or blob shadows | minimal | not measured | roadmap 8.5 degradation order: crowd, dust, shadows, LOD, resolution, 30 fps |

The roadmap's degradation order (crowd, particles, shadows, background LOD, dynamic resolution, replay blur, 30 fps) stands. The one measured lever so far is pixel ratio. The shadow lever is unmeasured. Triangles are not a lever at current scale.

## What was not measured

iPhone or any real GPU frame times; memory and texture residency; shader compile time; cold-load time; whether `renderer.info` counted the shadow pass; the effect of the tier levers beyond pixel ratio 1 and shadows off; what `invariance.test.ts` covers; installed Three.js version.

## W31 results

All numbers: desktop headless Chromium (SwiftShader), phone viewport, not device evidence. Device frame rate stays EVIDENCE_MISSING. Measure with `node apps/web/scripts/shot.mjs --phone --perf [--quality=high|standard|battery]`.

Draw calls (`renderer.info.render.calls`, 60 frames, mid-shot so camera culling varies):

| Moment | Before | After (high) | Standard | Battery |
|---|---|---|---|---|
| pitch | 321 | 174 | 172 | 172 |
| single | 296 | 161 | 158 | 162 |
| hr | 173 | 106 | 113 | 105 |
| bigplay | 170 | 107 | 107 | 106 |

Cause of the cut: each figure (about 22 meshes) and the static park are merged by material and shadow flags (`mergeByMaterial`); sprites are untouched. Triangles are unchanged within culling noise. Points: 10890 (high), 5445 (standard), 2723 (battery). Median frame time fell from 33-50 ms to 17-33 ms on this software renderer, but it is noisy and says nothing about a phone GPU. Draw calls do not drop on the battery tier, so `renderer.info` does not appear to count the shadow pass.

Cosmetic randomness now comes from `cosmetic.ts` (seeded; fixed seed in `?shot=`), so two runs of a moment report identical calls, triangles and points. Pixels still vary where the camera is mid-move, because motion follows frame timing. Phone shots with merged meshes match the pre-merge shots for static moments (pitch, swing, k under 0.4% of pixels changed above a small threshold).

Tiers (`quality.ts`, stored as `bb.quality`, picked in the top bar, applied to the next game view): high = pixel ratio 2, 2048 shadows, full crowd and dust; standard = 1.5, 1024, half; battery = 1, no shadows, quarter, 30 fps cap. `quality.test.ts` replays the same game under every tier and checks the hash and saved recipe never see it. The tier values are starting points, not tuned against device evidence.
