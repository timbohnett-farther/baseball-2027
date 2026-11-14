# Results form

All statuses start `EVIDENCE_MISSING`. Change a status only when the evidence field holds a real observation from a person or the phone. Allowed values: `EVIDENCE_MISSING`, `OBSERVED` (write what was seen), `NOT_OBSERVED` (the step was run and the thing did not occur), `BLOCKED` (could not run, say why). Never write "pass" for a human reaction.
ACCEPTANCE.md row names are quoted from docs/ACCEPTANCE.md. This form does not change ACCEPTANCE.md; a person decides that later.

| Row | Acceptance row | Script step | Question to settle | Evidence field | Status |
|---|---|---|---|---|---|
| R01 | ARC 17.8 first-time testers act unaided | A1, A2, A3-A6 | Did Tester A start and play Rookie Rally without help? | Help count and words, time to first pitch: | EVIDENCE_MISSING |
| R02 | ARC 17.8 no dead ends | A2-A12 | Any screen with no clear next action? | Screen and time: | EVIDENCE_MISSING |
| R03 | ARC 17.8 power-up reads as modifier | A7 | Did the tester treat the ability as a boost on top of normal play? | Their words: | EVIDENCE_MISSING |
| R04 | PUP 17.6 playtest explainability | A7, Questionnaire 3-4 | Could the tester say what the power does and call it fair? | Their words: | EVIDENCE_MISSING |
| R05 | ARC 17.8 no hidden gestures (shots), W32 skip | A8 | Did the tester find Skip on a shot? | Seen / found / waited: | EVIDENCE_MISSING |
| R06 | W37b phone legibility of home/scorebug/result; W37c phone legibility of hub/result | A1, A9 | Can a human read home, scorebug, result and hub on the phone? | Words and any too-small item: | EVIDENCE_MISSING |
| R07 | ARC 17.8 next objective / qualification clear | A10 | What does the tester say to do next? | Their words: | EVIDENCE_MISSING |
| R08 | W37c result screen after-line; hub next fixture | A9, A10 | Was the line after the result (what comes next, stars) seen and understood? | Words, line shown: | EVIDENCE_MISSING |
| R09 | ARC 17.8 rematch/next rate | A11, K | Did the tester choose rematch or next game? | Choice per game: | EVIDENCE_MISSING |
| R10 | ARC 17.8 no hidden gestures | A12 | Any gesture tried or guessed that the game does not use? | List: | EVIDENCE_MISSING |
| R11 | ARC 17.8 median 5-8 min | B, C | Stopwatch first pitch to result, 3 innings | Mins per run, shots mode: | EVIDENCE_MISSING |
| R12 | W32 shots per match | B, C | Shots seen and skipped, and the tester view | Counts, words: | EVIDENCE_MISSING |
| R13 | W36b real-player control friction | B, C, A | Taps that did nothing and where | Count, control: | EVIDENCE_MISSING |
| R14 | W32 action shots framing/no clipping; W32 device feel on phone | A8, B | Shots framed fully; felt smooth by eye | Words, hitches: | EVIDENCE_MISSING |
| R15 | ARC 17.3 touch contract (device); W36a left-handed layout | D | Lefty controls reachable and unclipped | Words, issues: | EVIDENCE_MISSING |
| R16 | W36a safe-area; W37a caption placement; W37b/W37c phone layout | E | Anything under notch/bar in either landscape | Per orientation: | EVIDENCE_MISSING |
| R17 | PUP 17.5 presentation/accessibility (reduced flash/motion) | F | Reduced flash/Reduce Motion honoured, still playable | Words: | EVIDENCE_MISSING |
| R18 | W37a caption placement; W37a captions with sound off | G | Captions readable, not blocking controls | Words: | EVIDENCE_MISSING |
| R19 | PUP 17.5 grayscale/colourblind not checked | H | Can team, main button, runners be told apart in grayscale | Words per item: | EVIDENCE_MISSING |
| R20 | W37a iPhone audio unlock, haptic feel, loudness | I | Sound starts after first tap; silent switch behaviour; loudness (words). Haptics is not offered on iPhone Safari: note it | Words: | EVIDENCE_MISSING |
| R21 | W36d real OS backgrounding (mid-pitch) | J | Pause dialog, pitch restarts, nothing lost | What was seen: | EVIDENCE_MISSING |
| R22 | W36d shot canvas timing after a visibility pause; service-worker update during a saved game | J | Screen on return mid-shot; any update bar mid-game | What was seen: | EVIDENCE_MISSING |
| R23 | W37b repeat-finish message | K | Exact text shown after a repeat finish | Verbatim text: | EVIDENCE_MISSING |
| R24 | W36d physical-device close/reopen | L, J | Force-quit and reopen resumed correctly | What was seen: | EVIDENCE_MISSING |
| R25 | W36d airplane mode at the last out | L | Offline finish saved, uploaded on reconnect | What was seen: | EVIDENCE_MISSING |
| R26 | W35b device frame rate, memory, thermal | B, C, K, DEVICE_CHECKLIST | Frame data only if taken via Mac Safari Timelines; heat and hitches by hand | Numbers or EVIDENCE_MISSING: | EVIDENCE_MISSING |
| R27 | W36a physical touch ergonomics; ARC 17.3 device | A5, A3-A6 | Thumb reach, missed taps, tiny targets | Words, count: | EVIDENCE_MISSING |
| R28 | W37a human playtest of commentary tone and mix | B, C, G | Tester reaction to captions and sound | Words: | EVIDENCE_MISSING |
| R29 | W36a / W37a screen-reader (VoiceOver) passes | none | Not covered by this kit's sessions | Add a session if wanted | EVIDENCE_MISSING |
| R30 | W37c legacy format-1 seasons | none | Needs an old-format season; not reproducible from a new account | Not covered | EVIDENCE_MISSING |

## Result-time notes
- Observer, date, build commit: 
- Known layout finding from the dry run to watch for on a phone: Rookie Rally coach bubble overlapped pitch target cells at 667x375 with insets (DRY_RUN.md). Record if seen.
