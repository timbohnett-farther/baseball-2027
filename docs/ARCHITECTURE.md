# Baseball 2027 — Architecture

A web game where you draft real MLB players, play games with them, and earn
rewards (coins and special items) for winning. Hosted on Railway.

## Goals that drive the design

1. **Plays in any browser** (laptop, iPad, phone). No app store needed.
2. **Progress is saved on the server**, so you can switch devices and nobody
   can edit their coins.
3. **Real, current players.** Rosters and stats refresh automatically.
4. **One language, one repo, few moving parts.** Easy to change, cheap to run.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | Game rules are shared by the server and the browser |
| Browser app | React + Vite | Menus, draft board, roster, store, inventory |
| Game field | Three.js inside a React page | 3D ballpark; slow-motion replays and particle effects for big moments |
| Server | Node + Fastify | Small, fast API; also serves the built browser app |
| Database | Railway Postgres + Drizzle ORM | Typed queries, migrations kept in the repo |
| Login | Username + password, cookie sessions | Simple; parent can create the accounts |
| Repo layout | npm workspaces | One install, one build |

## Repo layout

```
apps/
  web/        React + Vite + Three.js (what the player sees)
  server/     Fastify API, auth, rewards, daily MLB refresh, serves web/dist
packages/
  sim/        Game engine: at-bat outcomes, innings, box score. Pure TS, seeded RNG
  shared/     Types, rating formulas, item definitions, constants
data/         players.json: rated draft pool snapshot (fallback + local dev)
docs/
```

## How a game works (server decides, browser animates)

```
Browser                         Server                        Postgres
  | "start game vs CPU" ------->  pick opponent, seed RNG  --->  game row
  | <------------------------- game id + seed + lineups
  | each pitch / swing choice ->  packages/sim resolves it
  | <------------------------- result (ball, strike, single...)
  | 3D field animates it
  | ... final out ...
  |                              compute rewards ---------->  coins, items, stats
  | <------------------------- "You won! +150 coins, Gold Bat unlocked"
```

- The **same `sim` package** runs in both places. The server's result is the
  one that counts, so rewards can't be faked from the browser.
- Every game has a **seed**, so any game can be replayed exactly (useful for
  fixing bugs and for "watch the replay").

### Built so far (step 4): server-simulated games with play-by-play

Today the server plays the whole game at once and the browser plays it back;
the interactive pitch/swing loop above arrives with the 3D field.

- `POST /api/games {opponentTeamId}` builds both teams, picks a random seed,
  runs `simulateGame`, and stores only the seed and a snapshot of both teams'
  ratings. `GET /api/games/:id` re-creates the identical play-by-play from them.
- **Your team** uses ratings after chemistry, an automatic batting order
  (contact + speed leads off, best hitter 3rd, most power cleanup) and your
  best starter first. You're the home team, so you bat last.
- **The opponent** is a real MLB team's best healthy lineup (one per infield
  spot, three outfielders, a DH, a starter and two arms), without anyone you
  drafted.
- **Engine** (`packages/sim/src/game.ts`), pitch by pitch: Control decides the
  zone, Eye the swing, Contact vs. Stuff the whiff, then balls in play become
  hits or outs from Power/Contact vs. Movement and team defense; Speed moves
  runners. Pitchers tire after about `15 + 0.35 × Stamina` pitches and the
  bullpen takes over. 3 innings; ties go to extra innings with a runner on
  second (a tie stands after 9).
- **Calibrated** on 400-1,000 simulated games: average teams strike out 21%,
  walk 8%, homer 3.6% of plate appearances (close to MLB). Rating gaps count at
  55% strength (`TALENT`) so upsets stay alive: an 80 team beats a 70 team
  about 69% of the time; a 99 team still loses 1 in 10.
- **Big plays** carry the visual design tiers (walk-offs, grand slams,
  game-ending strikeouts = Tier 1; homers, triples, double plays,
  inning-ending strikeouts with runners on = Tier 2), a card title, a stat
  (home run distance, strikeout velocity) and an announcer call.
- **Play screen**: opponent picker with team strength, scorebug (score, inning,
  outs, count, runners), at-bat/pitcher/velocity line, play-by-play grouped by
  half-inning, big-play lower-third cards, 1x/2x/4x and skip, final band, box
  score, win-loss record and replays of past games.

## Player ratings

Ratings are 40–99. **70 = an average MLB regular**, each standard deviation
is 10 points (8.5 for Overall, so a 99 overall stays rare: about 6 players).

How they're built (`packages/shared/src/ratings.ts`):

1. **Combine recent seasons**: MLB 2026 ×1.0, 2025 ×0.8, 2024 ×0.6; Triple-A
   counted at half weight and translated to MLB level (more strikeouts,
   fewer homers).
2. **Regress small samples** toward a "fringe big-leaguer" baseline, so 20 hot
   at-bats can't make a star and an unproven prospect lands around 50–65.
3. **Score against MLB regulars** and clamp to 40–99.

| Rating | Built from |
|---|---|
| Contact | strikeout rate, batting average |
| Power | isolated power, home-run rate |
| Eye | walk rate (no intentional walks) |
| Speed | Statcast sprint speed, stolen-base attempts |
| Fielding | Statcast outs above average; catchers: caught-stealing rate; DH = 45 |
| Stuff | strikeout rate, fastball velocity |
| Control | walk rate |
| Movement | home-run rate allowed, ground-ball rate |
| Stamina | outs per appearance |
| **Overall (hitter)** | weighted on-base value + fielding + speed + position (C/SS up, 1B/DH down) |
| **Overall (pitcher)** | FIP + stamina; role SP or RP from games started |

The draft pool is everyone on a 40-man roster plus unsigned players with real
2026 playing time (50+ PA or 15+ IP), currently about 1,380 players.

## Draft

Built (`packages/shared/src/draft.ts`, `apps/server/src/team.ts`):

- Each account drafts **one 12-player arcade team**: a 9-man lineup (C, 1B,
  2B, 3B, SS, three outfielders, DH) plus 3 pitchers (1 starter + any 2 more).
- **No salary cap.** Pick anyone. Balance comes from **team chemistry** (below).
- The server refuses picks that overfill the lineup (9 hitters) or staff (3 pitchers).
- "Finish draft" marks the team **ready**; dropping a player reopens it.
- Two-way players (Ohtani) fill DH and the starting pitcher spot.
- Players who leave the MLB pool stay on your team.
- Everyone can draft the same real player; teams play the CPU, not a shared league.

## Team chemistry

Built (`packages/shared/src/chemistry.ts`). Who you put together changes how
they play. Every effect is a set of rating changes on specific players, so the
game engine uses them directly, and the draft screen explains each one in a
sentence. **Team Power** = average rating after chemistry.

| Effect | When | Change |
|---|---|---|
| Bad Blood | Players from rival MLB teams (18 real rivalries: Yankees/Red Sox, Dodgers/Giants, Cubs/Cardinals, Subway Series...) | −3 to all per rival teammate (max −9) |
| Crossed Signals | Your catcher and a pitcher come from rival teams | pitcher −6 Control |
| Veteran Presence | A 34+ veteran who isn't in the feud | Bad Blood cut in half |
| Clubhouse Chemistry | 3+ players from the same MLB team (5+ = more) | +2 (or +4) to all of them |
| Battery Mates | A pitcher and his real-life catcher | pitcher +3 Control, +2 Movement |
| Spotlight Overload | Star power over 6 (90–94 = 1, 95–98 = 2, 99 = 3) | −2 per point over to every star (max −16) |
| Overshadowed | Pitching star power beats hitting star power | star hitters −2 Power per point of gap |
| Forgotten Arms | Hitting star power beats pitching by 5+ | pitchers lose Control and Stamina |
| Showtime | Exactly one big personality (power 95+ or a 99 hitter) | +3 Power |
| Clash of Personalities | Two or more big personalities | each −3 Contact per extra ego |
| Glue Guy | A steady 72–84 hitter with 80+ contact and fielding | +1 to every teammate |
| Hungry Free Agents | Unsigned players | +2 to all |
| Country Pride | 3+ players from the same country (outside the USA) | +2 Contact or Control |
| Mentors / Rookie Jitters | Rookies with a 34+ veteran / without one | +3 / −3 to all for rookies |
| Old Legs | 4+ players aged 33+ | hitters −4 Speed |
| Predictable Lineup / Lefty-Righty Mix | 7+ hitters bat the same side / a real mix | −2 / +1 Contact |
| Strength Up the Middle | 80+ gloves at C, SS and CF | pitchers +3 Movement |

Measured on real players (2026 ratings): best player at every spot = 93.2 base
→ **77.9** Team Power; a team of solid 80–89s → 88.6; two superstars with a
good supporting cast → 90.2; a chemistry-smart mix → 91.8. Stars matter, how
you combine them matters more. The draft board previews every pick's
chemistry impact (for example, "−31").

Personalities are inferred from stats (huge power = showboat), never claims
about real people's character.

## Game format (arcade)

- **3 innings, 3–4 minutes a game.** Pace over simulation detail.
- **Two-button controls.** Pitching: aim location, hold to charge velocity
  and movement. Batting: tap for timing, hold for power. Fielding: the engine
  hands you only the close balls (the narrow band around hit-or-out) and names
  the fielder; one timed glove tap decides it. A perfect tap steals a hit
  ("ROBBED" card), a whiff lets it through. Everything else is auto-fielded.
  No pitch menus or defensive shifts.
- **Heated up.** A meter fills with hits and strikeouts; when it's full the bat
  glows, contact goes farther, and special swings and pitches unlock
  (this is the same Power meter that Super Power Bats and power-ups use).
  Turbo pitches leave a visible trail.
- **Announcer calls** tied to events players chase: heated up ("He's on
  FIRE!"), grand slams, monster homers ("into the stratosphere!"), record
  pitch speeds. Our own lines and voice.
- **Ratings, exaggerated.** Real ratings drive the sim, then arcade boosts sit
  on top, so stars feel like superstars.
- **2-player head-to-head on one device** (later): one bats while the other
  pitches and fields, swapping each half-inning.

## Rewards and items

- **Coins** for wins, bonus for shutouts, homers, comebacks, win streaks.
- **Store** sells items with coins; some items only drop from milestones.
- Items are small, capped boosts or cosmetic:
  - Bats (+Power or +Contact), Gloves (+Fielding), Cleats (+Speed),
    Rosin bag (+Control), plus jerseys, stadiums, celebrations.
- Item definitions are data (a table in `shared`), so adding items needs no
  new code paths.

### Standard wood bats (free, everyone starts here)

Every hitter swings a pro-style wood bat by default. You pick its specs, and
they nudge ratings slightly (always on, at most ±2) with no Super Swing:

| Choice | Options | Effect |
|---|---|---|
| Wood | Maple or Ash | Maple: harder, +1 Power. Ash: more flex, +1 Contact |
| Length | 33" or 34" | 34": +1 Power, −1 Contact |
| Weight | 31 oz or 32 oz | 32 oz: +1 Power, −1 Contact |
| Drop (length − weight) | −1 to −3, from the two above | shown on the bat card |

- Barrel stays at the pro maximum, 2.61". Bats are named by our own makers
  (inspired by Marucci, Victus, Louisville Slugger and Old Hickory, the most
  used in MLB in 2026), purely cosmetic.

### Super Power Bats

Special bats bought with coins and **activated at big moments**, not always on.

- Each bat has a few **charges per game**. Using one turns the next swing into
  a Super Swing: a large boost for that one swing, with its own effect
  (glowing barrel, sparks, shockwave on contact).
- Charges can only be used in **clutch spots**: runners in scoring position,
  7th inning or later, or two strikes. They're a choice, not an autopilot.
- Every bat is defined by **real bat properties**, and the game turns those into
  its Super Swing. Same specs, same behavior, so adding a bat is just data:

| Property | Game effect |
|---|---|
| Swing weight: **balanced** | +Contact; easier to square up |
| Swing weight: **mid-loaded** | some +Contact and +Power |
| Swing weight: **end-loaded** | big +Power, slightly more strikeouts |
| Build: **one-piece alloy** | stiff and durable: +1 charge per game, steady results |
| Build: **two-piece composite** | bigger sweet spot (more solid hits), vibration control |
| Build: **hybrid** (alloy barrel, composite handle) | between the two |
| Class: **Wood** (pro, standard bat) | baseline: no pop bonus, 2.61" barrel |
| Class: **BBCOR** (high school/college) | wood-like pop (BPF .50); regulation **−3 drop** and **2⅝" barrel**, so heavier and slower to swing than USSSA; steadier, fewer weak hits |
| Class: **USSSA** (travel ball) | most pop: BPF 1.15 trampoline barrel, so higher exit velocity; biggest barrel (2¾") = biggest sweet spot; light drops (−12 to −5) = faster swing |

- **The bat list.** Names are our own, since real brand names are trademarks
  (the same issue as team logos). The "inspired by" column is design notes only.

| Class | Inspired by | Swing weight | Build | Plays like |
|---|---|---|---|---|
| USSSA | Louisville Slugger Supra | balanced | two-piece composite | best all-rounder |
| USSSA | DeMarini Zen | balanced | two-piece composite | top contact |
| USSSA | Easton Hype Fire | mid-loaded | two-piece composite | big barrel, all-around |
| USSSA | Rawlings Icon / Easton The Dub | end-loaded | two-piece composite | power |
| USSSA | Marucci CAT X2 | balanced | one-piece alloy | control, durable |
| BBCOR | 2027 Easton Hype Fire | mid-loaded | two-piece composite | big barrel, all-around power |
| BBCOR | 2027 Marucci Rckless Gen 2 Alloy | balanced | one-piece alloy | stiff, durable, steady |
| BBCOR | 2027 Rawlings Icon | balanced, slight end-load | two-piece composite | consistent contact and power |
| BBCOR | 2027 Louisville Slugger Atlas 2.0 | balanced | one-piece alloy | contact and gap hitter (doubles) |
| BBCOR | 2027 Marucci Rckless Gen 2 Hybrid | end-loaded | hybrid | power hitter's bat |

- Tiers: Common, Rare, Legendary (more charges, bigger boost, flashier effect).
  Tier sets how big the Super Swing is; class and specs set its *shape*
  (pop vs. contact vs. steadiness). Any class can come in any tier.
  Legendary bats only drop from milestones, never sold.
- Boosts are applied inside the `sim` on the server, so they can't be faked.

### Power-ups

Arcade power-ups on top of the real-player sim. Rules that keep them fun:

- **Earned in play**, not just bought: strikeouts, double plays, homers and
  clutch hits fill a **Power meter**. Each power-up costs meter to use, so
  using one is a decision. Super Power Bats draw from the same meter.
- **Tiers**: cheap/weak and expensive/strong, so players can mix and match.
- **Readable chaos**: every power-up has a clear look and sound, so you always
  know what just happened.
- Like bats, effects are resolved by the server-side `sim`; the browser just
  shows them.

| Role | Power-up | What happens | Tier |
|---|---|---|---|
| Batting | Aluminum Bat | any contact is a home run (the rarest drop) | Legendary |
| Batting | Undergrounder | ball sinks into the field and pops up elsewhere: ground-rule double | Rare |
| Batting | Crazy Bunt | bunt bounces wildly around the infield; very hard to field | Common |
| Batting | Meteor Swing | ball becomes a flaming meteor; a fielder who catches it is dazed | Rare |
| Batting | Leaf Hit | ball floats down like a leaf; outfielders misjudge it | Common |
| Pitching | Fireball | blazing fast pitch, nearly unhittable | Rare |
| Pitching | Big Freeze | looks slow, freezes before the plate; batter swings early | Rare |
| Pitching | Ninja Ball | splits into several balls; only one is real | Rare |
| Pitching | Corkscrew | spirals toward the plate, hard to track | Common |
| Pitching | Elevator Pitch | rises sharply, then drops | Common |
| Pitching | Dizzy Ball | if put in play, the fielding team's controls flip for a few seconds | Rare |
| Fielding/special | Earthquake | on a hard hit, all runners freeze for a few seconds | Rare |
| Fielding/special | Invisible Ball | ball vanishes mid-flight; fielders guess | Rare |
| Fielding/special | Hyper-Run | runner gets super speed to first base | Common |
| Fielding/special | Bomb Hit | ball explodes on the glove or ground, knocking the fielder down | Rare |
| Fielding/special | Orbit Hit | ball circles a fielder 2–3 times before settling | Common |

- Since the sim decides outcomes, each power-up becomes a probability change
  (Fireball: much lower contact chance; Leaf Hit: higher chance of a dropped
  fly). Controls-based effects (Dizzy Ball) apply in the moments where the
  player makes choices.

## Graphics and big moments

Target look: dramatic, close-up, slow motion, with flying dirt and motion blur.

- **Live play in 3D (Three.js)**: a stylized ballpark and players, camera
  behind the plate, so every pitch and swing is fast and readable.
- **Big-moment replays**: after a home run, strikeout to end an inning, diving
  catch or Super Swing, the game cuts to a **slow-motion close-up**: bat
  smashing the ball, dust and dirt bursting, sparks from a Super Power Bat.
  - Built from short cinematic clips and stills (generated once, stored in the
    `baseball-assets` bucket), layered with live effects: particles for dirt
    and dust, slow-mo ramp, camera shake, motion blur, flash on contact.
  - The player's name, number and team colors are overlaid, so every replay
    feels like it's your player.
- Generated art shows **generic players, never real players' faces**. Real
  likenesses, like logos, need licenses.
- Full photo-realism in real time isn't practical in a browser. The mix of
  stylized live play and cinematic replays gets the look where it matters.
- All coin changes go through one server function and are logged in a
  `ledger` table. Balance = sum of the ledger, so it can always be audited.

## Database tables (first pass)

| Table | Holds |
|---|---|
| `mlb_teams` | 30 teams, league, division (built) |
| `players` | MLB id, bio, position, current team, status, in draft pool (built) |
| `player_ratings` | ratings per player per season (built) |
| `data_refreshes` | each MLB refresh: when, season, player count, errors (built) |
| `users`, `sessions` | accounts (scrypt passwords) and sign-in sessions (built) |
| `user_teams` | a user's team: name, color, drafting or ready (built) |
| `user_team_players` | drafted players (built) |
| `games` | seed, opponent, both teams' rating snapshot, score, W/L/T (built) |
| `items` / `user_items` | item catalog and what each user owns |
| `ledger` | every coin earned or spent, with reason |

## Railway setup

One Railway project (`incredible-perception`, to be renamed `baseball-2027`), with:

| Service | What it runs | Notes |
|---|---|---|
| `baseball-2027` | `apps/server` (also serves the built `apps/web`) | Deploys on every push to `main`; health check at `/health` |
| `Postgres` | Railway Postgres | `DATABASE_URL` referenced by the app |
| `baseball-assets` bucket | S3-compatible storage | Replay clips, art, sounds; `BUCKET_*` variables on the app |

- Database migrations run when the server starts.
- **Daily data refresh runs inside the server**: every hour it checks, and if
  the last good refresh is over 20 hours old it pulls rosters and stats,
  re-rates everyone (about 6 seconds), saves to Postgres and swaps the new
  pool into memory. No separate cron service needed.
- If the database is empty (first deploy), the server serves the committed
  snapshot `data/players.json` until its first refresh finishes.
- Secrets (`SESSION_SECRET`, `DATABASE_URL`) live in Railway variables, never
  in the repo.
- A `staging` environment can be added later so changes are tested before
  they reach `main`.
- Expected cost: a few dollars a month at family scale.

## Data from MLB

- Sources: the public MLB Stats API (`statsapi.mlb.com`: rosters, MLB and
  Triple-A season stats) and Baseball Savant (Statcast sprint speed, outs above
  average, fastball velocity). No keys needed. If Savant is down, ratings fall
  back to box-score stats.
- Code: `apps/server/src/mlb/`. Run by hand with `npm run refresh`, which also
  rewrites `data/players.json`.
- Free agents (not on any 40-man roster) stay in the pool, marked "Free Agent".
- **No MLB or team logos.** Teams use city names and our own colors. Player
  names are fine for a private family game; selling it would need MLB and
  MLBPA licenses.

## Build order

1. ✅ Scaffold the monorepo; deploy to Railway with Postgres.
2. ✅ Data refresh: teams, players, stats, Statcast; compute ratings; player board.
3. ✅ Accounts, the draft (12-man arcade team, no cap) and team chemistry.
4. ✅ `sim` game engine with tests; games vs. MLB teams with text play-by-play.
5. 3D field view (Three.js) on top of the sim.
6. Coins, store, items (Super Power Bats), ledger.
7. Big-moment replays: slow-motion close-ups, dust and spark effects.
8. Polish: sounds, celebrations, season mode, leaderboards.

## Local setup needed

- Node.js 24 LTS (official build from nodejs.org; Homebrew has no Intel bottles).
- GitHub login (`gh auth login`) so pushes trigger Railway deploys.
