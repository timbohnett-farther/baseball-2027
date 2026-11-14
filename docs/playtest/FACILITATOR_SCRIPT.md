# Facilitator script

Read the quoted lines aloud, exactly. Do not add hints, name gestures, or point at the screen. Stopwatch lines are marked [T]. Record in RESULTS_FORM.md (row ids R01..R24) and DEVICE_CHECKLIST.md.

Settings reach: Play tab > settings row on the top card. Controls: Sound, Volume, Mix, Captions, Haptics (not shown on iPhone, normal), Graphics quality, Action shots, Left-handed, Reduced flash.

## Session A: unaided first run (target 20 min)
Opening line: "This is a baseball game. I want to see how it works for you, not test you. You can stop any time. I will not help unless you ask, and I will write down where it was hard, which tells me about the game."

A1 Install/launch [R01]. Phone on the home screen or in Safari tab as set in the checklist. "Open the game and tell me what you think you can do here." Note time to reach the Play tab; note taps that did nothing.
A2 Rookie Rally tutorial [R01, R02]. Say only: "Start whenever you like." The tester finds "Start Rookie Rally" alone. Do not say "tutorial".
A3 Pitch. When it is the tester's turn to pitch, say nothing. Record: what they tried first, how long until a pitch left their hand, ignored taps.
A4 Swing. Same. Record the first swing: time, tried more than once, whether they said they understood timing or location.
A5 Field and throw [R27]. Record: which control they used (FIELD, CATCH, DIVE, throw target), correct or wrong first try, stuck point.
A6 Run. Record: SEND/HOLD, HOLD ALL, Tag up, AFTERBURNER: used, ignored, or confused.
A7 Use an ability [R03, R04]. Say nothing until an ability chip is lit or the tester asks. Then: "Try anything you want." Record whether they used it, what they said it does (their words, if offered).
A8 Skip an action shot [R05, R14]. When a short camera shot plays, do not say it can be skipped. Record: seen, tried to skip, found "Skip", or waited it out.
A9 Finish [R06, R08]. Let the tester reach the result screen ("Victory", "Defeat" or "Tie game"). Record: found "Continue" alone or not.
A10 Next objective [R07, R08]. After Continue, on the Season tab: "What would you do next in this game?" Record the answer in their words, and whether they found the "Next up" block and the stars list.
A11 Rematch [R09]. "Do you want to play again or stop?" Record the choice and which button they pressed ("Play it yourself", "Play the rematch", "Watch the sim").
A12 Close. "What was the hardest part?" and "What would you change?" (QUESTIONNAIRE.md). Record verbatim.
Hidden gestures [R10]: at the end, ask: "Was there anything you had to guess how to do?" Record each item, plus every moment you saw a long press, swipe, double tap or pinch that the tester tried.

## Session B and C: three-inning matches [R11, R12, R13, R14, R26, R28]
Setup: Play tab, innings chip 3, difficulty Pro (the default), any opponent. Note which opponent and the settings.
B (Shots: Full): set "Action shots" to "Shots: Full". C (Shots: Reduced): set it to "Shots: Reduced".
Say: "Play a whole game. Tell me if you want to stop." Do not mention length.
[T] Start the stopwatch at the first pitch and stop at the result screen. Do not count pauses or breaks you caused; note them.
Tally during play: shots seen, shots skipped, ignored taps (tap and nothing happened), spots of confusion, big moments the tester reacted to (words only).
Afterwards: QUESTIONNAIRE.md sections 4, 5, 6, 7.

## Session D: left-handed layout [R15]
Set "Left-handed: on". Play one inning. Record: controls where expected, anything unreachable with the thumb, the "LEFTY LAYOUT" tag seen, clipped or overlapping controls (describe, and take a screen recording per EVIDENCE_RULES.md if you choose).
Turn it back off at the end.

## Session E: safe area and notch, both landscape orientations [R16]
Play a pitch and open the Season tab in landscape with the notch on the left, then rotate the phone so the notch is on the right. Record for each orientation: any text or button under the notch or home bar, clipped scorebug, anything not tappable.

## Session F: reduced flash and motion [R17]
Set "Reduced flash: on". Then, in iOS Settings > Accessibility > Motion, turn on Reduce Motion and return to the game. Play one inning with Shots: Full (shots should be reduced by the OS setting). Record: flashes or fast motion the tester still notices (their words), and whether it still plays fine. Restore both settings.

## Session G: captions on, sound off [R18, R28]
Captions on, then "Sound" off ("Muted" shows). Play one inning. Ask only: "Could you tell what was happening?" Record: caption readable, caption in the way of a control, events missed. Restore sound.

## Session H: grayscale [R19]
iOS Settings > Accessibility > Display and Text Size > Color Filters > Grayscale on. Play one inning. Record: can the tester tell which team bats, which button is the main one, strikes from balls, runners from fielders. Turn the filter off afterwards.

## Session I: audio unlock after the silent switch [R20]
Ringer on, volume up. Quit the game completely and reopen it. Before touching the screen, ask if sound is on. Tap once, then record if sound starts and when. Then flip the silent switch on and off and record what is heard. Record loudness in words only.

## Session J: background and resume [R21, R22] (also covers the service-worker update note in R22 only if an update bar appears)
During a pitch (before the pitch is thrown), press the Home gesture, wait 20 s, return. Record: "Game paused" dialog seen ("Welcome back", "Ready"), the pitch begins fresh, nothing lost.
During an action shot, do the same. Record what the screen showed on return (frozen frame, blank canvas, continued shot, or skipped).
Also: force-quit mid-game, reopen. Record "Game in progress" bar, "Resume game", and whether it resumed at the right place.

## Session K: repeated rematches [R09, R23, R26]
Finish a game, "Continue", then play the rematch three times in a row. Record per rematch: the choice, time to start, whether the "Next up" kicker is correct (it should read "Rematch: ..." when the playoff game was tied), and the message after a repeat finish, if shown, in exact words (expected "No new coins: this game was already saved and paid.").

## Session L: install to home screen and offline finish [R24, R25]
Install: Safari Share > Add to Home Screen. Open the home-screen icon. Record: full screen, landscape, name shown.
Offline: play online until a game is well in progress, then turn on airplane mode before the last out and finish. Record: finishing worked, the result showed, and after turning airplane mode off the game uploaded (Season tab shows the finished game). Note anything lost. Do not use this session for the very first run (the app needs an online load once so its files are cached).
