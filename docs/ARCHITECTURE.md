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
| Game field | Phaser 3 inside a React page | 2D field, pitches, hits and runners animated on a canvas |
| Server | Node + Fastify | Small, fast API; also serves the built browser app |
| Database | Railway Postgres + Drizzle ORM | Typed queries, migrations kept in the repo |
| Login | Username + password, cookie sessions | Simple; parent can create the accounts |
| Repo layout | npm workspaces | One install, one build |

## Repo layout

```
apps/
  web/        React + Vite + Phaser (what the player sees)
  server/     Fastify API, auth, reward logic, serves web/dist
  jobs/       Roster + stats refresh (runs on a schedule)
packages/
  sim/        Game engine: at-bat outcomes, innings, box score. Pure TS, seeded RNG
  shared/     Types, rating formulas, item definitions, constants
data/         Snapshot JSON from MLB (seed data for local dev)
docs/
```

## How a game works (server decides, browser animates)

```
Browser                         Server                        Postgres
  | "start game vs CPU" ------->  pick opponent, seed RNG  --->  game row
  | <------------------------- game id + seed + lineups
  | each pitch / swing choice ->  packages/sim resolves it
  | <------------------------- result (ball, strike, single...)
  | Phaser animates it
  | ... final out ...
  |                              compute rewards ---------->  coins, items, stats
  | <------------------------- "You won! +150 coins, Gold Bat unlocked"
```

- The **same `sim` package** runs in both places. The server's result is the
  one that counts, so rewards can't be faked from the browser.
- Every game has a **seed**, so any game can be replayed exactly (useful for
  fixing bugs and for "watch the replay").

## Player ratings

Ratings are 40–99, built from MLB stats as percentiles against all MLB players
at that position group, so they stay balanced year to year.

- **Hitters:** Contact (AVG, K%), Power (ISO, HR rate), Eye (BB%), Speed
  (sprint speed / SB), Fielding (position + fielding stats)
- **Pitchers:** Stuff (K%), Control (BB%), Movement (HR/9, GB%), Stamina (IP/GS)
- **Overall** = weighted mix of the above. Drives draft cost and card rarity.
- Players with few at-bats/innings are blended toward career numbers so a
  rookie with 10 at-bats doesn't rate 99.

Formulas live in `packages/shared` so the draft screen and the sim agree.

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
- All coin changes go through one server function and are logged in a
  `ledger` table. Balance = sum of the ledger, so it can always be audited.

## Database tables (first pass)

| Table | Holds |
|---|---|
| `users` | login, display name, coin balance cache |
| `mlb_teams` | 30 teams, league, division |
| `mlb_players` | MLB id, bio, position, current team, status |
| `player_ratings` | ratings per player per season |
| `user_teams` | a user's drafted team (name, colors, budget) |
| `user_team_players` | drafted player, lineup slot, equipped items |
| `games` | seed, opponent, score, status, box score JSON |
| `items` / `user_items` | item catalog and what each user owns |
| `ledger` | every coin earned or spent, with reason |

## Railway setup

One Railway project, `baseball-2027`, with:

| Service | What it runs | Notes |
|---|---|---|
| `web` | `apps/server` (also serves the built `apps/web`) | Deploys on every push to `main`; health check at `/health` |
| `Postgres` | Railway Postgres | `DATABASE_URL` shared to `web` and `jobs` |
| `refresh-rosters` | `apps/jobs` | Railway cron, daily at 09:00 UTC; upserts teams, players, stats, ratings |

- Database migrations run on deploy, before the server starts.
- Secrets (`SESSION_SECRET`, `DATABASE_URL`) live in Railway variables, never
  in the repo.
- A `staging` environment can be added later so changes are tested before
  they reach `main`.
- Expected cost: a few dollars a month at family scale.

## Data from MLB

- Source: the public MLB Stats API (`statsapi.mlb.com`). No key needed.
- The Python script in `scripts/fetch_rosters.py` proves the data; it will be
  ported to TypeScript in `apps/jobs` so everything shares one toolchain.
- Free agents are pulled as a separate pool so stars between teams are
  still draftable.
- **No MLB or team logos.** Teams use city names and our own colors. Player
  names are fine for a private family game; selling it would need MLB and
  MLBPA licenses.

## Build order

1. Scaffold the monorepo; deploy a "hello" page to Railway with Postgres.
2. Data job: load teams, players, 2026 stats; compute ratings.
3. Accounts and the draft screen.
4. `sim` package with tests; text play-by-play game.
5. Phaser field view on top of the sim.
6. Coins, store, items, ledger.
7. Polish: sounds, celebrations, season mode, leaderboards.

## Local setup needed

- Node.js 24 LTS (official build from nodejs.org; Homebrew has no Intel bottles).
- GitHub login (`gh auth login`) so pushes trigger Railway deploys.
