# Dependency audit (M01, 2026-11-13)

Baseline: HEAD 26b6bdc, `npm audit --json` (saved outside the repo, in the session scratchpad as audit-before.json / audit-after.json).

| | info | low | moderate | high | critical | total |
|---|---|---|---|---|---|---|
| Before | 0 | 0 | 6 | 2 | 0 | 8 |
| After | 0 | 0 | 4 | 0 | 0 | 4 |

## Advisories

| Package | Sev | Path | Prod/dev | Installed -> fixed | Reachability (basis) | Action |
|---|---|---|---|---|---|---|
| @fastify/static (4 advisories: dir-listing traversal, two route-guard bypasses, non-canonical path auth bypass; GHSA-pr96-94w5-mx2h, x428-ghpx-8j92, 8pvw-jcv7-9cmj, 83w8-p2f5-377r) | high | @bb/server > @fastify/static | prod | 8.3.0 -> 10.1.11 | Serves the public built web app in `apps/server/src/app.ts`. No `list` (directory listing) option and no route guards are configured, so the guard-bypass and listing advisories need configuration this app does not use; the path-traversal advisory applies to any static root, so it was treated as reachable. Based on reading app.ts, not on an exploit attempt. | Upgraded (major of the plugin, see below) |
| drizzle-orm (GHSA-gpj5-g38j-94v9, SQL injection via unescaped identifiers) | high | @bb/server > drizzle-orm | prod | 0.44.7 -> 0.45.4 | Needs attacker-controlled identifiers. `grep` of apps/server/src shows no `sql.identifier`; `sql.raw` is used only in db/index.ts with column names derived from fixed keys of seed rows. Not found to be reachable from request input; upgraded anyway. | Upgraded (0.x minor) |
| glob (GHSA-3g3m-2fjr-6pw4) | moderate | @fastify/static > glob | prod | 11.1.0 -> 14.0.6 | Used by @fastify/static for wildcard route registration at startup, not per request with user input. | Fixed by the @fastify/static upgrade |
| minimatch (GHSA-g3hv-75wg-m249, DoS) | moderate | @fastify/static > glob > minimatch | prod | 10.2.6 -> 11.0.8 | Same as glob. | Fixed by the same upgrade |
| esbuild <=0.24.2 (GHSA-67mh-4wv8-2f99, dev server reads cross-origin) | moderate | drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild@0.18.20 | dev only | 0.18.20, no fix in range | Affects only esbuild's `--serve` dev server. drizzle-kit's loader uses esbuild's transform API only and `db:generate` is run by hand; nothing starts an esbuild server. Basis: reading package scripts and drizzle.config.ts. | Left |
| @esbuild-kit/core-utils, @esbuild-kit/esm-loader, drizzle-kit | moderate | as above | dev only | drizzle-kit 0.31.11 | Inherit the esbuild finding above. | Left |

The remaining four are one chain. `npm audit` offers `drizzle-kit@0.18.1` as the fix, which is a downgrade across many minors and would break migration generation (not allowed here, and `--force` was not used). Next action: re-run the audit when drizzle-kit drops `@esbuild-kit/esm-loader` (it is deprecated upstream in favor of tsx); or add an `overrides` entry forcing `@esbuild-kit/core-utils > esbuild` to >=0.25 and test `npm run db:generate -w @bb/server` (not done now: the smaller no-change option is a dev-only, non-served tool).

## Version changes

- apps/server `@fastify/static` ^8.1.1 -> ^10.1.11 (installed 8.3.0 -> 10.1.11). Release notes read (v9.0.0: glob 13, content-disposition 1.0.1; v10.0.0: **breaking**, `setHeaders` now receives a `FastifyReply` instead of the raw response; content-disposition 2). The only code change: `setHeaders(res, path)` with `res.setHeader(...)` became `setHeaders(reply, path)` with `reply.header(...)` in apps/server/src/app.ts. Fastify is 5.12.8; the plugin has no fastify peer pin.
- apps/server `drizzle-orm` ^0.44.7 -> ^0.45.4 (0.44.7 -> 0.45.4). Release notes for 0.45.0 list fixes only.
- Transitive (lockfile): glob 11.1.0 -> 14.0.6, minimatch 10.2.6 -> 11.0.8; removed now-unneeded @isaacs/cliui, jackspeak, foreground-child, cross-spawn, which and related small packages; added @isaacs/nonrecursive-glob-match. No dependency added to a package.json.

## Verification

- `rm -rf node_modules && npm ci` succeeded.
- `npm run typecheck`: 0 `error TS`.
- `npm test`: server 28, web 159, shared 40, sim 164 tests, 0 fail (golden replays unchanged).
- `npm run build`: ok; apps/web/dist contains sw.js, manifest.webmanifest, icons, assets.
- Built server (`node apps/server/dist/index.js`, PORT 3917) served the built app: `/`, `/sw.js`, `/manifest.webmanifest` and client routes return `Cache-Control: no-cache`; `/assets/*.js` returns `public, max-age=31536000, immutable` (the setHeaders change works under v10).
- Browser smoke: `shot.mjs --phone --check` on duel-pitch and season-hub passed (dev server, as allowed). No live server API round trip in the browser was run.
