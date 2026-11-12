# Overnight build loop (started 2026-11-11, Tim asleep)

Standing instruction from Tim: keep building until this is a fully developed game. Players look lifelike and professional
(no chibi / Baseball 9 copy). Each heartbeat:

1. Check `/Users/tim/Documents/kimi/tasks/` for folders newer than LAST_SEEN below. Read any new `.md` docs; treat them
   as new instructions/data and fold them into the wave list before building.
2. Build the next unchecked wave below. Verify with `npm run typecheck && npm test && npm run build --workspace @bb/web`.
   Commit with the Co-Authored-By line, push with `env -u GITHUB_TOKEN -u GH_TOKEN git push origin main`.
3. Update LAST_SEEN and tick the wave here; keep `~/.claude/projects/-Users-tim/memory/project_baseball_2027.md` current.

LAST_SEEN: 2026-11-11/21-49-21-fe1e5e03 (Baseball 9 research folder, already consumed)

## Waves

- [x] W8 pro-proportioned rigs + night ballpark (fc87e8c)
- [x] W9 art-review harness: `node apps/web/scripts/shot.mjs [outDir] [moment ...]` (playwright-core + local Chrome,
      dev-only `/?shot=<pitch|swing|hr|k|single|double|final>` fixture page in `apps/web/src/shot.tsx`, no sign-in
      needed). First tuning pass: bat rests over the back shoulder, scoreboard text auto-fits, half-size ball in
      close cameras.
- [x] W10 uniform detail: `jerseyTexture(team, player)` canvas on the torso (name arc + back/chest numbers from
      `jerseyNumber(id)`, pinstripes for every other club), stirrup socks, `dress()` replaces `recolor()`, fielders
      dressed by lineup position, mound rig follows `pitcherId`, plate umpire, on-deck batter = next in order.
- [x] W11 (c6eb250) season mode: 20-game schedule vs real teams, standings, playoff bracket, season rewards (server tables
      `seasons`, `season_games`; web Season tab). Coins only via server `payout()`.
- [x] W12 player development (c3746af): XP per game for drafted players, level-ups raise ratings within caps; shown on My team.
- [x] W13 crowd + ballpark audio (426e920): procedural WebAudio bed (crowd murmur, bat crack, PA stings), mute toggle, respects
      reduced-motion/autoplay rules.
- [x] W14 cosmetic gear store: helmet/cleat/batting-glove colourways, applied to the rig; Legendary drops stay (5c36163)
      milestone-only per ARCHITECTURE.md.
- [x] W15 touch/mobile layout for the duel (big swing buttons, zone tap), landscape lock hint. (f32529e)
- [x] W16 Railway: confirm migration 0005 applied in production, smoke the store endpoints, deploy check for each push. (5041846; prod 8/8 migrations verified)
      After every push: `scripts/deploy-check.sh` (waits for /health to report the pushed SHA + all migrations). Two Railway
      projects (`baseball-2027` → baseball-2027-production.up.railway.app, `Baseball 2027` → web-production-6a936) both
      deploy main; the first is the one with the bucket vars and is the canonical URL.
- [x] W17 polish pass: loading states, empty states, error toasts, keyboard hints, accessibility audit. (bbc47f7; apps/web/src/ui.tsx primitives, numpad aim in the duel zone, skip link + tab roles)
