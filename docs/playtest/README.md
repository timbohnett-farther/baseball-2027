# Playtest kit (T01)

Status: kit ready. No playtest has been run. Every result is `EVIDENCE_MISSING` until a person and a real iPhone fill it in. See DRY_RUN.md for the only checks done so far (desktop, mechanical, not human, not phone).

## Files
| File | Use |
|---|---|
| FACILITATOR_SCRIPT.md | What to say and do, step by step |
| DEVICE_CHECKLIST.md | Phone and build facts, per-session fields |
| QUESTIONNAIRE.md | Tester questions (child wording) and facilitator version |
| RESULTS_FORM.md | One row per open acceptance question |
| EVIDENCE_RULES.md | File names, privacy, telemetry reset |
| DRY_RUN.md | What was and was not checked mechanically |

## Needed
- One iPhone (iOS Safari), charged above 50 percent, Low Power Mode off unless a row says otherwise.
- A parent-facilitator (you) and one first-time child tester, called "Tester A" everywhere.
- A stopwatch (phone timer on a second device is fine) and pen or the printed forms.
- Wi-Fi for the first half, and the ability to toggle airplane mode.
- A second screen (Mac) is optional: only for the build check and for Safari Web Inspector frame numbers.
- Game: https://baseball-2027-production.up.railway.app

## Which build
There is no build label inside the app. Before each session open `https://baseball-2027-production.up.railway.app/health` in Safari and copy the `version` value (7-character commit, e.g. a9f23e3 when this kit was written). Write it in DEVICE_CHECKLIST.md. If it changes mid-session, note the time and the new value.

## Before the tester arrives (facilitator only, about 10 min)
The Play, Season and My team screens need an account and a drafted team. Do this yourself, off camera. Never write the username or password into any kit file.
1. Open the game, tab "New player", fill the form, "Create account".
2. Create a team and finish the draft (9 hitters and 3 pitchers, "Finish draft").
3. Do NOT play the tutorial. The tester must see "New here? Try Rookie Rally" fresh.
4. Settings must be at defaults (Shots: Reduced, Captions on, Left-handed off, Reduced flash off, Graphics High, Sound on). Per-session changes are in the script.
5. Phone: ringer ON for Session A, silent switch used in Session H.

## Session order and time (about 90 min with breaks; stop any time the child tires)
| ID | Session | Min |
|---|---|---|
| A | Unaided first run: install/launch, Rookie Rally, pitch, swing, field/throw, run, ability, skip a shot, finish, season hub, rematch | 20 |
| B | Three-inning match, Shots: Full | 8 |
| C | Three-inning match, Shots: Reduced | 8 |
| D | Left-handed layout | 5 |
| E | Safe area, both landscape orientations | 5 |
| F | Reduced flash/motion | 5 |
| G | Captions on, sound off | 5 |
| H | Grayscale (iOS colour filter) | 5 |
| I | Audio unlock after the silent switch | 3 |
| J | Background/resume mid-pitch and mid-shot | 5 |
| K | Repeated rematches (3 in a row) | 12 |
| L | Install to home screen, offline finish | 10 |

Order A, B, C first (the tester has not learned the game yet in A). D to L can be reordered. Take a break after any 30 minutes. Skip a session rather than push a tired child.

## Rules for the facilitator
- Do not teach, point, or hint during A. If stuck for 30 s, write "stuck at <step>" and the time, then give the least help and record what you said.
- Do not tell Tester A the target match length, or that anything is being measured against a target.
- Do not write what the tester "probably" felt. Write what was said or done, or leave the field `EVIDENCE_MISSING`.
- Nothing is sent anywhere. No account details in files. See EVIDENCE_RULES.md.

## Known limitation: no on-phone telemetry or frame numbers
`window.__gameplayTelemetry()` and `__perfTelemetry()` exist only in the dev build, not in the production build the phone loads. Production has no overlay of frame or resource numbers. So match time, shots seen/skipped, ignored taps and confusion points are hand-counted. Optional frame data: Mac Safari, Develop menu, the iPhone, Timelines (needs cable). See DEVICE_CHECKLIST.md.
