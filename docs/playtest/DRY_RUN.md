# Dry run (2026-11-13, desktop)

This is NOT a human playtest and NOT phone evidence. It is a mechanical check on a Mac in headless Chrome with no server, no phone and no person. It proves the kit's setting names exist and some layouts pass automated overlap checks. It proves nothing about how a child or an iPhone behaves.

Build at the time: a9f23e3 (production /health `version`, migrations 14).

## Checked mechanically
`SHOT_PORT=5217 node apps/web/scripts/shot.mjs --phone --check <flags> <outDir> <moments>` at 844x390 on the moments duel-pitch, duel-swing, duel-field, duel-run, duel-steal, duel-tutorial-pitch, duel-caption, season-hub, ability, bigplay.
| Flags | Result |
|---|---|
| default | all ok |
| `--lefty` | all ok |
| `--calm` (reduced flash) | all ok |
| `--reduced` | all ok (9 moments, no duel-steal) |
| `--gray` | all ok except bigplay: FAIL "centre pixels are flat (1 colours): ballpark not rendered" (reproduced twice; not fixed, see findings) |
| `--vp=667x375 --inset=0,44,21,44` | ok except duel-tutorial-pitch: FAIL overlap, Rookie Rally coach bubble over two pitch target cells |
| `--lefty --vp=844x390 --inset=0,0,21,47` | all ok |

Settings script (scratch, dev server, signed-out): the controls named in the script exist (Sound, Volume, Mix, Captions, Graphics quality, Action shots, Left-handed, Reduced flash); each writes its local key and persists across reload; clearing storage restores defaults; Haptics button is absent when the browser has no vibrate (as on iPhone Safari); dev telemetry hooks exist in dev only.
Production build: `grep` for `__gameplayTelemetry` and `__perfTelemetry` in `apps/web/dist/assets/*.js` found nothing, so no on-phone telemetry exists.
Production /health read: version a9f23e3, database connected.

## Could not check
| Not checked | Why |
|---|---|
| Sign-in, draft, real gameplay, finish upload, live season hub data, full Rookie Rally | needs the API server and a logged-in account |
| Resume bar with a real saved game, pause gate on a real background event | needs a running game and a device |
| Offline or airplane-mode finish, install to home screen, service-worker update | needs a phone |
| Audio unlock, silent switch, loudness, haptics | needs an iPhone |
| iOS grayscale filter, Reduce Motion | needs iOS (the harness `--gray` is a CSS stand-in) |
| VoiceOver | not run |
| Frame rate, memory, heat | no device, no on-phone readout |
| Any human reaction: fun, understanding, fairness, match length, shot frequency, readability | needs a person |

## Findings to carry (not fixed; no gameplay or visual changes allowed in T01)
1. `--gray` bigplay check: flat centre pixels. Likely the known bigplay-probe class; unresolved. Watch Session H on a phone.
2. Rookie Rally coach bubble overlaps the two pitch target cells at 667x375 with insets (small phone in landscape). Real layout finding. Watch Session E and A on a small phone.
3. No on-phone telemetry or frame readout exists; all numbers are hand-counted (README.md, DEVICE_CHECKLIST.md).
4. Haptics control is not shown on iPhone Safari, so haptic feel cannot be tested there.
