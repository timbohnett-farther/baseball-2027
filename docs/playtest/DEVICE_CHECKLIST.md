# Device checklist

Print one copy for the day, one session block per session. Use "Tester A". No names, no account details. Unknown or not done: write `EVIDENCE_MISSING`, never a guess.

## Once per day
| Field | Value |
|---|---|
| Date | |
| Phone model | |
| iOS version (Settings > General > About) | |
| Browser | Safari / other (name it) |
| Mode | Safari tab / installed home-screen app (record per session if it changes) |
| Battery at start, percent | |
| Low Power Mode (yellow battery) | on / off |
| Build commit from /health `version` (read in Safari before the first session) | |
| Build commit at end of day (re-read) | |
| Silent switch at start | on / off |
| Screen brightness, auto-lock | |
| Connection | Wi-Fi / airplane (per session) |

## Per session (copy this block)
| Field | Value |
|---|---|
| Session id (A..L) and run number | |
| Start time and end time | |
| Settings used (Shots, Graphics, Left-handed, Reduced flash, Captions, Sound) | |
| Mode: tab / installed | |
| Battery start / end, percent | |
| Heat to touch (cool / warm / hot, where on the phone) at start, mid, end | |
| Hitches seen (stutter, freeze, late tap, blank frame): time and what was happening | |
| Frame or resource numbers | EVIDENCE_MISSING unless taken as below |
| Anything unexpected (alert, crash, reload, update bar "A new version is ready. Update") | |

## Frame and resource numbers: the app cannot show them on a phone
The performance and gameplay readouts exist only in the dev build. The production build on the phone has no overlay, no export and no key to press. Do not write numbers from memory or from desktop runs.
Options, both optional:
1. Mac with Safari: iPhone Settings > Safari > Advanced > Web Inspector on; connect by cable; Mac Safari > Develop > the iPhone > the game page > Timelines (record Frames and JavaScript). Save a screenshot of the timeline and write the frame rate and any dropped-frame spans in the session block.
2. No Mac: leave the field `EVIDENCE_MISSING` and record only hitches and heat by eye and hand.
Memory: Timelines "Memory" in the same view, same rules.

## Hand-counted values per match (use for sessions B, C, K)
| Item | Value |
|---|---|
| Stopwatch, first pitch to result screen (min:sec) | |
| Action shots seen (count) | |
| Action shots skipped by the tester (count) | |
| Taps that did nothing (count, with the control if known) | |
| Pauses or breaks you caused (what and how long) | |
