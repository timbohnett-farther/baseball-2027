# Evidence rules

## Privacy
- Use "Tester A" and "Facilitator". No real names, ages, school, address or photos in any file name or note.
- No account username or password in any file, note or capture. Cover or crop them if a capture shows the sign-in form (do not capture the sign-in form).
- No face or voice recording is required. Do not film the child. If you want visuals, screen recording of the phone (iOS Control Centre screen recording) is the choice of the facilitator; microphone off.
- No private messages, notifications or unrelated personal data in captures: turn on Do Not Disturb before recording.
- Nothing is uploaded or sent from this kit. Keep captures on your own device or a private folder.
- The child may stop at any time. Stopping is a valid result: write the time and `BLOCKED`.

## Where files go
Folder (outside the repo, never committed): `playtest-YYYY-MM-DD/` on your own storage. Do not put captures under the project folder.

## File names
`YYYYMMDD_<session>_<what>_<n>.<ext>`, lowercase, no spaces, e.g. `20261120_c_shotsreduced_screen_1.mov`, `20261120_a_notes.md`. Session is a letter A-L from README.md. `what` is one of notes, screen, photo (of the screen only, no face), timeline (Safari Timelines screenshot), form. Notes and forms are copies of DEVICE_CHECKLIST.md and RESULTS_FORM.md, filled in.
Write the build commit and time at the top of each notes file.

## What counts as evidence
Real observations by the facilitator, the child's own words, stopwatch times, hand counts, Mac Safari Timelines screenshots. Not evidence: a guess, a desktop number, the dry run, a remembered feeling. If a field has none, leave `EVIDENCE_MISSING`.

## Telemetry export and reset
There is no telemetry export on the phone. Production has no `__gameplayTelemetry` or `__perfTelemetry` (dev build only), and the data is in memory only, so there is nothing to export or to carry between sessions. Hand-count instead (DEVICE_CHECKLIST.md).
Between sessions:
1. In-memory data (counts, timing): cleared by force-quitting the app (installed app) or closing the tab and reopening it (Safari).
2. Saved game, resume and unsent results: `bb.resume` (pitch-start save, up to 7 days) and `bb.outbox` (finished games waiting to upload) live in browser storage. To start a session from a fresh app: finish or leave the game ("Start over" on the "Game in progress" bar), and make sure the outbox is empty by being online for a minute.
3. Settings reset to defaults: iOS Settings > Safari > Advanced > Website Data > find the game site > remove (this also signs you out, so you will sign in again, off camera), or delete the home-screen app and re-add it. Do not use this between sessions that depend on each other (K, L).
4. After a reset, confirm Shots: Reduced, Captions on, Left-handed off, Reduced flash off, Graphics High, Sound on.
Developer-only desktop route, not for the phone: run the dev server and call `window.__gameplayTelemetry()` in the console. `node --experimental-strip-types apps/web/scripts/gameplay-report.mjs` is a bot-driven synthetic report, not a human result.
