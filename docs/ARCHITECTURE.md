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

- New player gets a **salary cap** (budget) and drafts a 26-man team: 13 hitters,
  13 pitchers, with position minimums (1 C, all infield spots, 3 OF, 5 SP).
- Higher Overall costs more. Snake draft vs. CPU teams is a later mode.
- Real-world trades don't touch your drafted team; you keep who you picked.

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
| `users` | login, display name, coin balance cache |
| `mlb_teams` | 30 teams, league, division (built) |
| `players` | MLB id, bio, position, current team, status, in draft pool (built) |
| `player_ratings` | ratings per player per season (built) |
| `data_refreshes` | each MLB refresh: when, season, player count, errors (built) |
| `user_teams` | a user's drafted team (name, colors, budget) |
| `user_team_players` | drafted player, lineup slot, equipped items |
| `games` | seed, opponent, score, status, box score JSON |
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
3. Accounts and the draft screen.
4. `sim` package with tests; text play-by-play game.
5. 3D field view (Three.js) on top of the sim.
6. Coins, store, items (Super Power Bats), ledger.
7. Big-moment replays: slow-motion close-ups, dust and spark effects.
8. Polish: sounds, celebrations, season mode, leaderboards.

## Local setup needed

- Node.js 24 LTS (official build from nodejs.org; Homebrew has no Intel bottles).
- GitHub login (`gh auth login`) so pushes trigger Railway deploys.
