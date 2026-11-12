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
- [ ] W9 visual check harness: Playwright script that signs up a throwaway user, plays a duel, screenshots the field
      (`apps/web/scripts/shot.ts`), so art passes are reviewed as JPEGs in the scratchpad before pushing. Then use it to
      tune W8 (rig proportions, bat pose, crowd density, light levels).
- [ ] W10 uniform detail: jersey numbers + name arc via a per-team canvas texture, pinstripe/alt variants, stirrups;
      umpire behind the plate; on-deck batter.
- [ ] W11 season mode: 20-game schedule vs real teams, standings, playoff bracket, season rewards (server tables
      `seasons`, `season_games`; web Season tab). Coins only via server `payout()`.
- [ ] W12 player development: XP per game for drafted players, level-ups raise ratings within caps; shown on My team.
- [ ] W13 crowd + ballpark audio: procedural WebAudio bed (crowd murmur, bat crack, PA stings), mute toggle, respects
      reduced-motion/autoplay rules.
- [ ] W14 cosmetic gear store: helmet/cleat/batting-glove colourways, applied to the rig; Legendary drops stay
      milestone-only per ARCHITECTURE.md.
- [ ] W15 touch/mobile layout for the duel (big swing buttons, zone tap), landscape lock hint.
- [ ] W16 Railway: confirm migration 0005 applied in production, smoke the store endpoints, deploy check for each push.
- [ ] W17 polish pass: loading states, empty states, error toasts, keyboard hints, accessibility audit.
