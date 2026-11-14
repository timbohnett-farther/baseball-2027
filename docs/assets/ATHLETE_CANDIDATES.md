# Athlete rig and motion candidates (research, 2026-11-13)

Scope: generic realistic humanoid rigs and motion sources for a Three.js (glTF/GLB) baseball game, all roles. Nothing here was integrated into the repo, no asset file was added, and final-art approval is a separate human decision.

Evidence labels: **measured** = I parsed the file myself; **source** = stated on the source page, not measured; **unknown** = not published or not checked. Scratch downloads (outside the repo) are in `/private/tmp/claude-501/-Users-tim/f82bf70c-2e50-47cf-9208-0b9e0376786f/scratchpad/w34a/`; the inspector is `tools/glbinfo.py` there (parse only, nothing executed from the files).

Licence reading status: a licence is "read" only where I fetched a page that states it. Where a primary page failed, the candidate is **blocked pending license evidence**.

## Matrix

| # | Candidate | Type | Author | Licence (as read) and URL | Format | Verdict |
|---|---|---|---|---|---|---|
| 1 | Quaternius Universal Base Characters | Rig + mesh | Quaternius | CC0 1.0, page states "Free to use in personal, educational and commercial projects" and links https://creativecommons.org/publicdomain/zero/1.0/ . Read at https://quaternius.com/packs/universalbasecharacters.html | FBX, glTF, OBJ, Blend (source tier) (source) | **Approved for integration audition** (rig/mesh track) |
| 2 | Quaternius Universal Animation Library (UAL1) | Motion | Quaternius | CC0 1.0, "Free to use in personal, educational and commercial projects". Read at https://quaternius.com/packs/universalanimationlibrary.html and https://store.godotengine.org/asset/quaternius/universal-animation-library/ (the latter says "CC0 1.0 Universal") | FBX, GLB, Blend (source) | **Approved for integration audition** (locomotion only; no baseball clips found) |
| 3 | Quaternius Universal Animation Library 2 (UAL2) | Motion | Quaternius | CC0, same wording. Read at https://quaternius.com/packs/universalanimationlibrary2.html | FBX, GLB, Blend (source) | **Approved for integration audition** (clip list unpublished, must be inspected after download) |
| 4 | MakeHuman 1.2 exports | Rig generator | MakeHuman community | Assets: "released under CC0 1.0 Universal"; code: AGPL. Read at https://raw.githubusercontent.com/makehumancommunity/makehuman/master/LICENSE.md and https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html (base mesh, targets, proxies CC0; "Exports only consist of things which were CC0 to start with"). Third-party add-on packs keep their own licences; one eye-material pack was reported CC-BY by a search result I did not open. | Exported via GUI: DAE/FBX/OBJ (source) | **Approved for integration audition, second choice** (fallback if #1 is too stylised; needs Blender cleanup and a baked skeleton) |
| 5 | Khronos glTF-Sample-Assets CesiumMan | Test rig | Cesium | "Creative Commons Attribution 4.0 International", credit "(c) 2017, Cesium". Read at https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/CesiumMan/README.md (page links, does not reproduce, the legal code). Page also flags a "non-Khronos mark" (Cesium logo). | GLB (measured) | **Rejected for production** (low-detail, logo, 19 joints, one walk clip). Fine only as a throwaway skinning smoke test. |
| 6 | Khronos RiggedFigure | Test rig | Cesium | CC BY 4.0, "(c) 2017, Cesium". Read at https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/RiggedFigure/README.md | GLB (measured) | **Rejected** (256-triangle figure, no texture). Test fixture only. |
| 7 | RancidMilk "Massive Library of Free 3D Character Animations" (CMU mocap retargeted to a Quaternius model) | Motion | RancidMilk; data CMU Graphics Lab | Itch page terms read: "Free to use/modify/redistribute, so long as you don't just sell them as animations"; CMU terms quoted there: "You may include this data in commercially-sold products ... you may not resell this data directly, even in converted form." https://rancidmilk.itch.io/free-character-animations . The primary CMU page (https://mocap.cs.cmu.edu/faqs.php) failed to load (certificate error), so the upstream terms are only second-hand. | FBX, glTF (anims only), Blend (source) | **Blocked pending license evidence** (need the primary CMU terms). Clip list unpublished on the page; the 2,000+ CMU clips include some sports, and a search result mentioned baseball, but I could not confirm any baseball clip. |
| 8 | Mixamo (Adobe) | Rig + motion | Adobe | Not read. https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html returned HTTP 403. Needs an Adobe ID to download. | FBX | **Blocked pending license evidence** |
| 9 | three.js example models Soldier.glb, Michelle.glb, Xbot.glb | Rig + motion | Unknown | No licence text on the repo directory listing (https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) or readme (404). These are commonly Mixamo-derived (not verified). | GLB | **Blocked pending license evidence** |
| 10 | VRM sample avatars (vrm-specification samples) | Rig | VRM Consortium | The samples README lists no licence terms. Anime-style, also off-brief. | VRM | **Blocked pending license evidence** (and likely off-style) |

Not considered: any paid mocap or marketplace pack (Unity Asset Store baseball motion packs, CGTrader baseball rigs, MoCap Online paid sets), research datasets with non-commercial terms, and anything extracted from other games.

## Technical detail per candidate

### 1. Universal Base Characters (Quaternius)
- Source page figures (not measured): about 13k triangles average; 6 base models (Superhero, Regular, Teen proportions, male and female); 20 hairstyles; "Humanoid rig that supports retargeting"; Source tier adds rigged .blend and eye/skin shaders; "compatible with the Universal Animation Library". Bone count, texture size, face and hand detail: **unknown** (not stated).
- Skeleton naming: unknown until downloaded (UAL and UBC share one "universal humanoid rig"; the Godot listing says it is compatible with other common rigs such as Mixamo). I did not download it; the files are behind itch.io / Quaternius download flows.
- Style: described as "game-ready", three proportion families; realism not stated. The "Regular" proportion is the only plausible fit for a Pro-proportioned 1.85 m athlete. Needs a human visual check.
- Baseball kit (cap, helmet, glove, bat, cleats, jersey): none in the pack. Must be modelled, or built from CC0 parts. Outfits not mentioned on the page.
- Unresolved: no downloaded licence file read, only the page statement; record the download date and archive the page when integrating. Attribution not required by CC0 (page states none), courtesy credit recommended.

### 2 and 3. Universal Animation Library 1 and 2
- UAL1 (source): "120+" clips, locomotion in 8 directions, jog, sprint, push, crawl, swim, sit, death, combat and gun, emotes. Standard download is a portion of the full set (Godot listing: "only a portion of the models"; 14.54 MB).
- UAL2 (source): "130+" clips; categories melee and armed combos (3 and 4 hit), parkour, farming, fishing, zombie locomotion; Standard has about 70 percent of the set per a trade article (https://digitalproduction.com/2026/02/10/130-animations-one-rig-zero-drama/).
- Individual clip names are not published on any page I read, so idle, run, throw, swing, slide, catch are **unknown**. Idle and sprint/jog almost certainly exist in the locomotion set but I have not seen the names. A melee swing could be repurposed only as a rough bat-swing reference, not as a finished baseball swing.
- Bone count and naming: unknown.

### 4. MakeHuman
- Produces a realistic-proportion, customisable human (the generic athlete the brief wants) with default skeleton; exports require Blender cleanup, a decimated body, baked skin weights, and a game-ready skeleton. No motions included. Triangle and texture counts depend on the export (unknown, not measured).
- Legal point to carry forward: the licence text says exports consist of CC0 things, with AGPL covering only the software. Keep a record of exactly which system assets and clothes went into the export, because a few add-on packs carry other licences.

### 5 and 6. CesiumMan and RiggedFigure (measured)
| | CesiumMan | RiggedFigure |
|---|---|---|
| File size | 438,044 bytes | 50,116 bytes |
| SHA-256 | b7001eaeea8254bd44773bcd247e78696d94169388fbb2a1800fc69434e777d9 | d6be85417d3e256861ee733eea6916093a7af7c79c16366181fd8abcaeb38cf5 |
| Triangles / vertices | 4,672 / 3,273 | 256 / 370 |
| Skin joints | 19 | 19 |
| Joint names | `Skeleton_torso_joint_1`, `leg_joint_L_1`, ... (custom, not Mixamo/VRM) | `torso_joint_1`, `arm_joint_L_1`, ... |
| Materials / images | 1 material, 1 embedded JPEG (dimensions not measured) | 1 material, no image |
| Vertex attributes | POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0 (no tangents) | POSITION, NORMAL, JOINTS_0, WEIGHTS_0 |
| Animations | 1 clip, 57 channels (a walk; clip unnamed) | 1 clip, 57 channels |
| Generator | COLLADA2GLTF 2.0 | COLLADA2GLTF 2.0 |
Both are useful only to exercise a skinning/AnimationMixer code path. No fingers, no face, 19 bones, no baseball motions.

### 7. CMU-derived retarget pack
- If CMU primary terms confirm commercial inclusion in a product, this is the only free route to real captured athletic motion, but nothing about baseball clips is confirmed. It is retargeted to a Quaternius model, so it would pair with candidate 1 after a bone-name map. Retarget quality from Auto-Rig Pro output is unmeasured. Author warns that the glTF files "may carry leftover data and grow slightly with each conversion".
- Terms to resolve: confirm CMU text from the primary page; the pack's own "don't just sell them as animations" clause is fine for a game but must be preserved; attribution to mocap.cs.cmu.edu is requested for redistributors.

## Recommendation summary
- Approved for integration audition: Universal Base Characters (rig/mesh), UAL1 and UAL2 (locomotion/idle motion), MakeHuman exports (fallback rig).
- Rejected: CesiumMan, RiggedFigure (as production athletes).
- Blocked pending license evidence: RancidMilk/CMU pack (primary CMU terms unread), Mixamo (FAQ 403), three.js Soldier/Michelle/Xbot (no licence text), VRM samples (no licence text).
- No source found with a license-clear free baseball pitch, swing, slide, catch or tag motion set. The one baseball lead (CMU, via #7) is unconfirmed. All baseball-specific motion should be assumed procedural or hand-keyed (see ATHLETE_INTEGRATION_NOTES.md).
- Final-art approval: not given by this document. Nothing was integrated or added to the repo.

## Not done
- No Quaternius or MakeHuman file was downloaded, so bone names, bone count, texture sizes, clip names, hand/face detail are unmeasured for #1 to #4.
- Primary CMU terms and the Mixamo FAQ could not be read.
- No rendering or neutral audition captures were produced.
- No Sketchfab per-asset search was done.
