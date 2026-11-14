# Athlete rig integration notes (read-only repo inspection, 2026-11-13)

Nothing in this file was implemented. Repo evidence is from `apps/web/src/field.tsx`, `shotfigure.ts`, `shotscene.ts`, `rigutil.ts`, `docs/GRAPHICS_AUDIT.md`.

## What the repo has today
- No `GLTFLoader`, no `SkinnedMesh`, no `AnimationMixer`, no Draco/KTX2 (GRAPHICS_AUDIT section 4). No asset in `apps/web/public` other than icons and manifest.
- Live figures: `makePlayer(color, bat, seed, ump)` (field.tsx:224) builds a procedural group named `rig` from capsule/cylinder/sphere limbs, then `mergeByMaterial`. Called for 9 fielders (:488), umpire (:494), on-deck (:497), batter (:820), runners (:839). Up to about 15 figures at once.
- Action-shot figures: `makeShotFigure(color, skinHex, hasBat, ump, glove)` (shotfigure.ts:22, used at field.tsx:993) is a joint hierarchy (pelvis, torso, head, thigh[2], shin[2], upper[2], fore[2], palm[2], bat) driven by `applyPose` with Euler angles; `reachTo` does two-bone arm IK to put a palm on a world target; `handWorld(fig, side)` reads the palm world position.
- Motion today is code: `releasePose`, contact pose, `pelvisHeight` (plants the lower foot), `throwIndex(hand)`, mirrored poses for left-handers (`mirrorPose`). Sim has no pitcher throwing hand; shot mode defaults right-handed.

## Requirements a replacement rig must meet
- **Scale**: about 1.85 m standing, metres, feet on y = 0. Segment lengths the pose code assumes: thigh 0.45, shin 0.45, ankle 0.07, upper arm 0.32, forearm 0.30 (shotscene.ts:228). Ball radius 0.15 m (BALL_RADIUS); never scale the ball by camera. `PLAYER_SCALE = 1`.
- **Axes**: Y up; figure faces local +z; the figure's right is -x (index 0), left is +x (index 1). The batter's rig is turned `rotation.y = PI/2` so the chest faces +x across the plate. glTF is Y-up, +z forward-facing for most exports, so Quaternius/MakeHuman exports likely need only a bind-pose axis check (not verified).
- **Sockets** (must exist as bones or attach points): right and left palm/grip (bat two-hand grip, glove hand, ball release hand); bat attach with handle-to-tip direction (the pose code orients the bat from the palm via `setFromUnitVectors`); glove on the non-throwing hand; head top for cap/helmet; feet for ground contact and slide. A `bat` child must still animate separately (it is not merged).
- **Mirroring**: left-handed batters and pitchers are mirror images today. A skinned rig must support mirrored clips or a negative-x scale applied safely (watch winding and normals), or have separate left clips.
- **Team colour**: `dress()` (field.tsx:224 region) sets `bodyMat.map` to a per-team/player CanvasTexture jersey (1024x512 each, cached and disposed per park), `sleeveMat`, `capMat` (team colour times 0.8), `cleatMat`, `helmetMat`, `gloveMat`, plus `skin` for seeds. Cosmetic slots: cleats, helmet, gloves. A glTF needs named materials (or separate material slots) for: jersey body, sleeves, cap/helmet, pants, belt, socks/stirrups, cleats, gloves, glove (brown), skin, plus a UV layout where the jersey front/back/number area maps cleanly (the current torso texture draws the back number mirrored because the capsule u axis runs to the player's left). Cheapest approach: separate mask/ID regions or materials so colours stay uniform parameters, and keep the jersey texture only on the torso.
- **Material sharing**: each live figure allocates its own materials today. glTF materials should be cloned per team (not per player) and share textures.
- **userData keys**: `dress()` and cosmetics read `userData` keys `bodyMat, sleeveMat, capMat, cleatMat, helmetMat, gloveMat, skin, bat`. A glTF wrapper must publish the same keys or `dress()` must change.
- **Budgets** (GRAPHICS_AUDIT): draw calls are already over budget (268-328 measured vs under 150 low / 250 high tier); triangles are far under (about 29-35k vs 400-650k budget); one shadowed key light; 256/512 MB texture residency. So triangle count is cheap, draw calls are the limit: a skinned athlete should be 1 to 3 draw calls (merge sub-meshes by material, atlas the textures), and 15 figures must stay within the draw-call plan. Candidate 1's "about 13k triangles" (source) times 15 figures is about 195k, well inside the triangle budget but not inside the shadow-pass cost if every figure casts shadows; a LOD or a lower far-figure mesh is likely needed (unmeasured).
- **Determinism**: presentation only; replay/outcome code must not depend on animation timing. Keep sim events as the source and let clips follow them.
- **Action shots**: 0.75-1.2 s, skippable after 250 ms; clips must have stable key times (release frame, contact frame, tag frame) exposed as markers, since the pose code today keys on `RELEASE_Q`, `CONTACT_Q`, `SLIDER_*`.
- **Pipeline gaps to add before an asset could ship**: GLTFLoader plus optional Meshopt (Draco/KTX2 not in the bundle), an AnimationMixer wrapper, a bone-name map or retarget step, a texture and material strategy as above, loading and disposal of per-park resources, and lazy chunking so the field chunk (currently 135 kB gzip) is not inflated.

## What adapting the top candidate would involve
Top candidate: **Quaternius Universal Base Characters ("Regular" proportion) with Universal Animation Library clips** (all CC0 per the pages read), with MakeHuman as the realism fallback.
1. Download both, record hashes, archive the licence pages, then parse the GLBs offline: bone names/hierarchy, bind pose, skin weights per vertex (max 4), texture sizes, UV overlap, tangents, material list. None of these were measured here.
2. Check whether the "Regular" body reads as a generic realistic athlete. If it is too stylised, switch to a MakeHuman export (needs Blender cleanup, decimation, skeleton baking).
3. Build the baseball kit by hand: cap, batting helmet with ear flap, jersey and pants (as separate materials/regions), belt, stirrup socks, cleats, glove(s), bat, catcher's gear (mask, chest protector, shin guards), umpire. None is in the packs.
4. Add sockets: parent bones or `Object3D` anchors at both palms and head; map the shot code's palm[0]/palm[1] to them.
5. Bone map from the universal rig to the pose code's pelvis/torso/head/thigh/shin/upper/fore, so `applyPose`, `reachTo` and `handWorld` can drive the skinned rig by IK instead of the capsule twin, or drive them via the mixer.
6. Fix mirroring for left-handers (mirror the pose or clip).
7. Merge draw calls and share materials; compress with Meshopt.

## Motions: what free sources can and cannot supply
Per the sources actually read, only generic locomotion, combat, emote and parkour sets exist; the individual clip names are unpublished, so the following must be treated as unavailable until a downloaded set is inspected:
- **Idle (ready/stand)**: probably in UAL locomotion (unverified). Baseball-specific stances (batter stance, pitcher set, catcher crouch, fielder ready crouch) are not found: **hand-keyed or procedural** (the current code already does crouch via scale.y and stance poses).
- **Run / sprint / jog**: likely available (UAL1 lists jog and sprint, source). Base-running turn, lead-off and tag-up leans: procedural or keyed.
- **Pitch (windup, stride, release, follow-through)**: not found. Procedural from the existing `releasePose`/slider poses, or hand-keyed on the new rig. A throwing arm could be repurposed from a combat motion only as reference.
- **Swing**: not found. Melee swings in UAL2 are not baseball swings. Hand-key or keep the pose-driven `swing()`.
- **Throw (infield/outfield)**: not found. Procedural.
- **Slide**: not found. Procedural or hand-keyed (feet-first and head-first).
- **Catch / tag / dive**: not found. `reachTo` IK already handles reach-to-target; the dive and tag poses stay procedural.
- **Celebrate / emote**: UAL emotes may cover some (unverified).
- A CMU-derived set (candidate 7) might contain sports motions, unconfirmed, and is blocked on the primary licence text.

## Open items
- Download and measure the Quaternius and MakeHuman files (bone names, bone count, texture sizes, clip names).
- Read the primary CMU terms and the Mixamo FAQ if those routes are wanted.
- Human visual approval of any candidate body is required; this document does not give it.
