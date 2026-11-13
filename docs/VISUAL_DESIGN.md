# Baseball Game Visual Design PRD

> **Authority.** Older examples in this document (any-contact home runs, nearly unhittable pitches, 4-6 s and 8-12 s cinematics) are historical.
> Current rules live in `docs/DIAMOND_RALLY_PLAN.md` and `docs/ACCEPTANCE.md`: action shots run 0.75-1.2 s, are skippable after 250 ms, target 1-3 per match with a hard cap of 4; the probability-model sim stays.

Nov 2, 2026 · Tim Bohnett

This document tells the graphic designer what to build so that every screen in the game, from the home page to the box score to the walk-off replay, looks and feels like the four reference photos: a frozen instant of contact, shallow depth of field, dirt and chalk in the air, dark cinematic backgrounds with warm light on the player. Big plays get a dedicated close-up presentation system. Everything else borrows the same light, palette, and type so the game reads as one world.

## 1. The visual standard

The four reference photos are the brief. Every screen in the game is measured against them, not just the replays. Here is what they have in common, written as rules the designer can apply to a menu or a stat table as easily as to a cutscene.

| What the photos do | The rule for the game |
|---|---|
| Freeze the instant of contact (bat on ball, ball an inch off the barrel) | Hero art and big-play cameras always land on a decisive frame. Never a generic pose. |
| Shallow depth of field, crowd and stadium melted into bokeh | Backgrounds are always softened. Sharpness is reserved for the subject and the UI text in front of it. |
| Dark, near-black surroundings with one warm light source on the player | Base palette is deep navy-black. Light is warm (amber to white) and comes from one direction. No flat, evenly lit scenes. |
| Dirt, chalk, and sweat particles catching the light | Particle atmosphere is part of the brand. Menus and stat pages get a quiet version of it (slow drifting dust, soft grain), big plays get the full burst. |
| Motion blur on the bat, crisp ball | Motion is directional and selective. UI transitions slide and blur the way the bat does; the thing you need to read stays crisp. |
| Rim light on helmet, shoulders, and bat edge | Every player render and every card gets an edge light. It is the single most recognizable signature across the four images. |
| Slight low camera angle, player fills most of the frame | Cameras sit at or below the waist and get close. Wide establishing shots are the exception, not the default. |
| Muted, desaturated uniforms with one or two saturated accents (red stitching, red helmet) | Team colors appear as accents on a muted base, never as full-screen fills. |

The short version for the designer: **dark, warm, close, frozen, dusty, rim-lit.** If a screen does not have at least four of those six, it is not on brand yet.

## 2. Design principles

These are the calls that settle most arguments during the build.

- **The broadcast is the model, the photos are the mood.** MLB The Show has spent fifteen years making its presentation mimic a TV broadcast, with cut timing and camera angles lifted from real games, and its recent releases lean harder into cinematic replay cameras that follow a home run ball out of the park. We do the same job but push the look toward the four photos: darker, closer, more photographic. Players should feel like they are watching a prestige sports documentary, not a daytime regional broadcast.
- **Motion first.** Professional broadcast packages are now designed around motion rather than static frames; the Gameday Creative team that built the Braves regional package called it a motion-first philosophy. Every element in this game should be designed with its entrance and exit animation at the same time as its resting state.
- **Modular and durable.** The same designers warned that the more disruptive a graphics package is, the shorter its shelf life, and that is why they avoided trendy touches like echoing type. We want a system that still looks right in year three. Simple geometry, strong type, restraint on effects.
- **The scorebug is the signature.** Broadcast graphics leads describe the scorebug as the single element viewers see most, and the current trend is toward cleaner, more minimal bugs where the typography and the numbers carry the brand. Ours gets the most design time of any HUD element.
- **Real data from day one.** Game UI designers are blunt about this: you cannot make good layout decisions with placeholder text. Every stat page mockup is built with real box score data, real names, and worst-case long values.
- **Readable before beautiful.** Dark UI and glassmorphism both fail when text sits on busy, translucent backgrounds. Nielsen Norman Group's guidance is to use glass sparingly and always meet contrast requirements. We will use blur panels, but text always has a solid or near-solid scrim behind it.

## 3. Big play cinematics

This is the system that makes a home run feel like the second and fourth photos. It has four parts: what triggers it, what the camera does, how long it runs, and what the overlay says.

### 3.1 Trigger tiers

Not every play earns the full treatment. Over-presenting cheap plays is the fastest way to make the big ones feel ordinary.

| Tier | Plays | Treatment |
|---|---|---|
| Tier 1, Signature | Walk-off hit, grand slam, game-ending strikeout, no-hitter final out, home run in extra innings | Full sequence: contact freeze, particle burst, slow-motion follow, crowd reaction, player close-up, overlay card. 8 to 12 seconds. Skippable after 3 seconds. |
| Tier 2, Highlight | Any home run, diving or wall catch, triple, double play, inning-ending strikeout with runners on | Contact freeze, slow-motion follow, one close-up, overlay card. 4 to 6 seconds. Skippable after 1.5 seconds. |
| Tier 3, Beat | Double, stolen base, strikeout, nice routine play | A single 1 to 2 second camera cut with a stinger overlay. Never interrupts the rhythm of the game. |
| Tier 0, Routine | Ground outs, fly outs, walks, singles | Standard gameplay camera only. |

Tier escalates with context. A Tier 2 home run in the 9th inning of a one-run game becomes Tier 1. A Tier 3 strikeout that ends a no-hitter becomes Tier 1. The designer should assume the engine will pass a tier and a context flag (late, close, postseason, milestone).

### 3.2 The signature sequence, shot by shot

This is the Tier 1 storyboard. The designer owns the look of each shot; the engineering team owns the timing engine.

1. **Approach.** Standard gameplay camera through the pitch. Nothing changes until contact, so the player never sees it coming.
2. **Contact freeze.** On the frame of bat-on-ball, freeze for 300 to 400 milliseconds. Camera snaps to a low, tight angle on the barrel and the ball, like photo one. Background crowd drops to heavy bokeh. Dirt and chalk particles are already in the air from the stride.
3. **Rim light pop.** A warm edge light intensifies on the batter's helmet, shoulders, and bat during the freeze. This is the one moment we allow a visual cue that is not strictly physical.
4. **Slow release.** Time resumes at 25 percent speed. The camera orbits a quarter turn around the batter as the bat finishes its arc with directional motion blur. Particle burst reaches full density here, matching photo two and photo four.
5. **Ball follow.** Cut to a tracking shot that follows the ball. For a home run, this shot rides behind the ball toward the seats, which is the shot MLB The Show uses for towering home runs. For a catch, it rides the ball into the glove.
6. **Reaction.** One or two quick cuts: dugout, a crowd section, the pitcher. Real time, handheld feel, subtle shake.
7. **Hero close-up.** Low angle, below the waist, player rounding first or celebrating. Dark background, warm key light, rim light. This is the frame we would use as the game's box art.
8. **Overlay card.** The big-play card (section 3.4) slides in over the hero close-up with the play name, player, and a single stat.
9. **Return.** Hard cut back to the gameplay camera with a quick dust-settle transition.

### 3.3 Camera language

The cameras in the four photos share a few traits that the game cameras should copy.

They sit low. Most shots are at waist height or below, looking slightly up, which makes the batter look enormous. They sit close. The batter fills 60 to 80 percent of the frame in every reference. They use long lenses. The compression and the bokeh come from a telephoto look, so the virtual cameras should model a 135 to 300 millimeter equivalent with a wide aperture. Real sports broadcasters chasing the cinematic look do exactly this: larger-sensor cameras and open irises to shrink depth of field and make the subject pop.

Four named cameras cover most of the sequence: **Barrel Cam** (photo one, inches from contact), **Dust Cam** (photo two, behind the batter looking through the swing), **Drive Cam** (photo three, front three-quarter, full body, stadium lights as bokeh), and **Dive Cam** (photo four, ground level, dirt spraying toward the lens). The designer should produce a lighting and depth-of-field reference for each.

### 3.4 The big-play overlay card

The card that lands on the hero close-up is a lower-third, not a full-screen takeover. Broadcast lower-thirds get about two seconds to do their job, so the hierarchy is strict: play name first in large condensed caps (WALK-OFF HOMER), player name second, one stat third (distance, exit velocity, or count of the season). It enters with a directional wipe that matches the swing direction, sits on a dark glass panel with a solid scrim behind the text, and carries the team accent color only as a thin edge stripe. No logos larger than the player name. No animation that runs longer than the card is on screen.

### 3.5 Replay and highlight reel

After the game, the engine picks the top plays and presents them back in broadcast style, the way The Show's highlight reel has since 2009. Each replay uses the same four cameras and the same card. The reel gets a title card and a closing card in the same system, so the whole package feels like one broadcast package rather than a collection of screens.

## 4. In-game HUD and scorebug

During play the screen belongs to the field. The HUD exists to answer four questions at a glance (score, inning, count, runners) and then get out of the way.

### 4.1 Scorebug

The scorebug is the most-seen graphic in the game, so it is designed first and everything else inherits from it. Baseball bugs are denser than other sports because they carry score, inning with top or bottom arrow, outs, balls and strikes, runners on base, and often the pitcher and pitch count. Ours shows all of that in one compact unit anchored top-left, inside the title-safe area.

The look: a dark glass panel at 85 percent opacity with a thin warm edge light along the top, the same rim light that runs through the reference photos. Team abbreviations in condensed caps, scores in large tabular numerals, outs as three small diamonds that fill warm amber, balls and strikes as a 3 by 2 dot grid, runners as a small diamond diagram that lights the occupied bases. Team color appears only as a 3 pixel left stripe per team row. When a run scores the affected score cell flashes to white and settles over 400 milliseconds, which is the standard way game UI tells the player a number changed.

Fan backlash to the oversized NESN bug earlier this year is a useful warning. The bug should never exceed 18 percent of screen width on a 16:9 display and never carry sponsor space.

### 4.2 Pitch and strike zone overlay

A strike zone box has been a broadcast fixture since ESPN's K-Zone in 2011, and it is a genuinely contested graphic: some fans find it distracting and it never matches the umpire's zone exactly. The game should offer it as a toggle, default on for the batting view, drawn as a thin white rectangle with 60 percent opacity and corner ticks rather than a full box, so it feels like part of the photograph instead of a sticker on top of it. Pitch location dots use the same amber for strikes and a cool gray for balls, with pitch speed shown inside the bug rather than next to the zone.

### 4.3 Transient callouts

Short bugs for pitch type, exit velocity, and a batter's line slide in from the edge nearest the relevant action, hold for 2 seconds, and slide out. They share the scorebug's panel style and never stack more than two at a time.

### 4.4 Pause and between-innings screens

Pausing dims the field with a dark vignette and heavier bokeh, drops a quiet particle drift over it, and surfaces the menu as a left-anchored column. Between innings, a single full-width band carries the inning summary over a slow-motion loop of the best play from that half. These are the moments the game most resembles the reference photos while the player is not actually swinging, so they should be designed with the same care as the big-play card.

## 5. Home page and front end

The home page is where most sports games lose the plot. MLB The Show 24's main menu drew complaints that form beat function and that you could not tell at a glance which tile opened which mode. NBA 2K went the other direction with a spatial menu anchored in a 3D arena, with a monochrome palette and a single orange accent driving attention. We want the second approach with the first photo's mood.

### 5.1 Layout

The home page is a full-bleed hero scene with a left-anchored navigation column. The hero is a slow, looping cinematic: a batter in the on-deck circle, a pitcher rubbing the ball, a close-up of hands on a bat, all shot with the same low, close, long-lens, rim-lit language as the big-play cameras. The crowd and stadium behind it are deep bokeh. Dust drifts. The scene changes subtly with time of day and season state (postseason gets colder light and more haze).

The navigation column sits over a dark gradient scrim on the left third so text always meets contrast. Items are condensed caps, generous spacing, one accent color for the focused item, and a thin rim-light rule under the active item. Each mode has a short descriptor line under its name so nobody has to guess what Franchise or Road to the Majors means.

### 5.2 Hierarchy

One primary action (Continue or Play Now) sits at the top of the column and is the only item with a filled button. Modes come next. Collection, settings, and store sit at the bottom in a smaller size. Season news and the player's last big play appear as a single card in the lower right, over the hero, using the big-play card style from section 3.4, so the home page quietly replays your own highlights.

### 5.3 Sub-menus

Every sub-menu keeps the hero scene behind it, pushed darker and blurrier with each level deeper, so the player always feels like they are standing in the stadium. Lists are left-aligned, never centered grids of tiles. Selection moves with a soft directional blur, the same motion grammar as the bat in the photos. Back navigation is always one input and always lands where you left.

### 5.4 Loading and transitions

Loading screens are a single still from the four-camera system with a short real-time stat about the matchup. No progress bar; a thin rim-light line grows along the bottom edge instead. Mode-to-game transitions use a dust-settle wipe: particles sweep across, the scene behind resolves from bokeh to sharp.

## 6. Stat pages and data screens

Stat pages are where the photo look is hardest to hold, because a box score is a wall of numbers. The trick is to keep the atmosphere in the frame and the data in a panel.

### 6.1 The shared page frame

Every data screen uses the same three layers. At the back, a cinematic still or slow loop from the four-camera system, darkened to roughly 25 percent brightness and blurred, with a slow particle drift. In the middle, a dark glass panel (near-black at 90 percent opacity, 12 pixel blur, 1 pixel warm top edge) that holds the data. On top, the data itself in high-contrast type. The background is mood only; nothing in it is meant to be read.

### 6.2 Screen inventory

| Screen | What it shows | Design notes |
|---|---|---|
| Box score | Line score by inning, batting and pitching lines for both teams | Two stacked tables. Line score uses large tabular numerals. Row hover brightens the row and shows a small headshot at left. |
| Player card | Portrait, ratings, season line, splits, recent game log | Portrait is a rim-lit three-quarter render on a dark field, same lighting as the hero close-up. Ratings as thin horizontal bars with amber fill. One hero stat displayed huge (OPS, ERA). |
| Team page | Roster, lineup, rotation, team stats | Roster as a sortable table; lineup as a vertical card stack you can drag. Team color appears as the accent for this page only. |
| Leaderboards | League leaders by category | Top three get portrait cards, the rest a table. Category tabs across the top in condensed caps. |
| Standings | Divisions, wild card, clinch and elimination markers | Dense table, division headers in team-neutral type, clinch markers as small amber diamonds. |
| Season and franchise dashboard | Record, streak, next game, injuries, trade deadline countdown | A few large stat tiles over the hero, not a spreadsheet. The one place we allow a chart (run differential over the season) drawn as a thin amber line. |
| Post-game summary | Final, top performers, the highlight reel entry point | Reuses the big-play card and the four cameras. The reel button is the primary action. |

### 6.3 Table rules

Tabular (fixed-width) numerals are mandatory so columns line up; numerals with distinct 6, 8, 3 and 1, 7 shapes are preferred so values read at a glance. Column headers are small condensed caps, left-aligned for text, right-aligned for numbers. Rows alternate between two near-black values that differ by about 4 percent luminance; no visible borders except a 1 pixel rule under the header. Sorted column shows a small amber caret. Nothing in a table is ever lighter than 4.5 to 1 contrast against its row.

### 6.4 Density and scale

Every stat page is designed at two densities: a default that fits a living-room TV at 10 feet, and a compact mode for monitors and handhelds. Minimum body text is 18 pixels at 1080p on the default. Long names (16 characters plus a suffix) and wide values (three-digit RBI totals, ERAs like 11.57) are used in every mockup so truncation is designed rather than discovered.

## 7. Shared design system

The designer delivers this as a token sheet and a component library. Starting values below are pulled from the reference photos and can be tuned, but the relationships between them should hold.

### 7.1 Color

| Token | Starting value | Where it comes from |
|---|---|---|
| Base black | `#0B0D12` | The void behind the batter in photo two. Material Design and most dark UI guidance warns against pure black; this is a very dark blue-black instead. |
| Surface | `#141821` | The shadowed stadium in photo three. Panels and cards. |
| Surface raised | `#1C2130` | Hover and focus states, one step lighter. |
| Rim light | `#F2E3C6` | The warm edge light on helmets and bats across all four photos. Used for 1 pixel edges, active rules, and the contact freeze pop. |
| Accent amber | `#E0A458` | The sodium-light glow on the dust in photo four. Primary accent: focus, outs, strikes, sorted columns. |
| Accent red | `#C8322F` | The stitching on the ball in photo one and the helmet in photo four. Secondary accent, used sparingly for alerts and the Tier 1 card stripe. |
| Text primary | `#F4F1EA` | Warm off-white, never pure white, to match the uniform tones. |
| Text secondary | `#9CA0AB` | Labels and column headers. Still passes 4.5 to 1 on Surface. |
| Dust | `#D9CBB3` at 20 to 40 percent | The chalk and dirt particles. Used for the drift layer and the burst. |

Team colors enter the system as two tokens per team (primary, secondary) and are only ever used as accents: a stripe, a caret, a fill on a small marker. They never fill a panel.

### 7.2 Light

One warm key light from upper-left at roughly 30 degrees, one cooler fill at a fifth of the intensity, and a rim light from behind-right. Every player render, every portrait, and every hero scene uses this rig so the whole game looks shot in the same stadium on the same night. UI panels fake it with a 1 pixel rim-light top edge and a soft dark drop shadow below.

### 7.3 Depth of field and atmosphere

Backgrounds behind any UI run at a 12 to 24 pixel blur and 25 to 40 percent brightness. The particle drift layer is slow (crossing the screen in about 20 seconds), low density, and lit by the key light. The burst used in Tier 1 and Tier 2 plays is the same particle system at 20 times the density with an outward velocity from the contact point. Film grain at 3 to 5 percent sits over everything, including menus, to tie the UI to the photographic look.

### 7.4 Typography

Two families. A bold condensed sans for display (play names, mode names, scores, headshot name plates), in the spirit of the condensed faces that dominate sports branding because they read instantly at distance. A neutral sans with true tabular figures for everything data-heavy, which is how CBS Sports pairs DIN for information with Heroic Condensed for specialty moments. Candidates to evaluate: a licensed sports family like Winner for display, and Inter or IBM Plex Sans for data. All numerals must have distinct 1 and 7, 3 and 8, and 6 and 8 shapes. Display type is set in caps with slight positive tracking; body and data are mixed case.

Scale at 1080p: display 72, 48, 36; heading 28, 22; body 18; label 14 caps. Everything scales linearly for 1440p and 4K.

### 7.5 Motion

Three durations: 150 milliseconds for state changes, 300 for element entrances and exits, 600 for scene transitions. Easing is fast-out, slow-in for anything arriving and the reverse for anything leaving. Directional blur on moving elements matches travel direction. The dust-settle wipe is the one bespoke transition and is used for scene changes only. Nothing loops faster than once per 2 seconds, and no element pulses to draw attention; brightness and the rim-light edge do that job.

### 7.6 Components

The library the designer delivers: scorebug, big-play card, transient callout, nav column item (rest, focus, active, disabled), primary and secondary button, glass panel, data table (header, row, sorted state, hover), stat tile, rating bar, player portrait frame, team stripe, tab bar, toggle, modal, toast, loading line, and the four camera reference boards.

### 7.7 Asset pipeline

All UI assets ship as vector where possible, with raster fallbacks at 1x, 1.5x, and 2x. Hero stills and loops render from the game engine using the lighting rig in 7.2 so they match gameplay exactly. Portraits render at 1024 square on the Base black with the rim light baked in. The designer provides a Figma (or equivalent) file with tokens as variables so engineering can read them directly.

## 8. Readability and accessibility

A dark cinematic look is only a win if people can read it on a bright living room TV. The guidelines that apply are the same ones the web uses: normal text at 4.5 to 1 contrast against its background, large text and UI components at 3 to 1, and a high-contrast mode available as an option. Every token pair in section 7.1 is checked against those ratios before it ships, and glass panels always put a solid scrim under text.

All HUD elements sit inside a 5 percent title-safe margin. Controller navigation is designed first, with keyboard and touch mapped after, and focus states are always visible (the rim-light edge, not just a color change). The big-play sequences include a reduced-motion setting that drops the slow-motion orbit and the particle burst to a single cut and a still, and nothing in the game flashes faster than three times per second. Text scale offers 100, 125, and 150 percent, and every stat table has been checked at 150 percent for truncation.

## 9. Deliverables

The designer hands these back in three phases. Each phase ends with a review against the four reference photos and the acceptance criteria in section 10.

| Phase | Deliverable | Format |
|---|---|---|
| 1. Foundation | Token sheet (color, type, spacing, motion), the lighting rig reference, the four camera reference boards, scorebug in all states, big-play card in all three tiers | Figma file with variables, PNG exports at 1080p and 4K |
| 1. Foundation | Mood board that maps each of the four photos to the screens it governs | PDF |
| 2. Screens | Home page (rest, focused, sub-menu open), pause screen, between-innings band, loading screen, all seven data screens from section 6.2 at both densities, post-game summary | Figma, with real data in every mockup |
| 2. Screens | Tier 1 storyboard (9 frames) and Tier 2 storyboard (5 frames) with timing marks | PDF plus a rough animatic |
| 3. Motion and handoff | Animation specs for every component (enter, exit, state change), the dust-settle wipe, particle drift and burst reference renders | After Effects or Lottie, plus a written spec |
| 3. Motion and handoff | Component library with every state, redlines, and a one-page usage guide per component | Figma |
| 3. Motion and handoff | Exported asset pack at 1x, 1.5x, 2x, plus SVG | Zip, organized by screen |

## 10. Acceptance criteria

A screen passes when all of the following are true.

1. Placed next to the four reference photos, it reads as the same world: dark, warm, close, frozen, dusty, rim-lit (at least four of six per section 1).
2. Every text and background pair meets 4.5 to 1 (normal) or 3 to 1 (large and UI) contrast, measured, not eyeballed.
3. The mockup uses real data with worst-case long values and nothing truncates unexpectedly.
4. Every element has a defined rest, focus, active, and disabled state and a defined entrance and exit.
5. The scorebug stays under 18 percent of screen width and inside the title-safe area.
6. Tier 1 and Tier 2 sequences are skippable at the stated times and have a reduced-motion variant.
7. Team color appears only as an accent, never as a panel fill.
8. A player who has never seen the game can name the primary action on the home page within three seconds.
9. The screen uses only tokens from the token sheet; any new value is added to the sheet first.

## 11. Open questions

- [ ] Target platforms and minimum resolution. The particle and depth-of-field budget depends on whether handheld or last-gen hardware is in scope.
- [ ] Engine. The big-play camera system assumes the engine can freeze a frame on a contact event and expose play tier and context flags. Confirm with the dev team before storyboarding.
- [ ] Licensed teams or fictional league. This decides whether team color tokens are a fixed table or a user-defined pair.
- [ ] Font licensing budget. A licensed sports display family versus an open alternative like Oswald or Fjalla One.
- [ ] Does the game ship a highlight reel and replay editor at launch, or is section 3.5 a later milestone?
- [ ] Commentary and audio. The big-play sequence timing should sync to a call. Who owns the audio spec?
