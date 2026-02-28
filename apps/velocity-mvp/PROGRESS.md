# Velocity MVP Progress

## Verification Snapshot
- Timestamp (UTC): `2026-02-28T07:56:47Z`
- Context: local execution environment only
- Caveat: remote Cloudflare health/deploy could not be verified from this environment because Wrangler auth/network and DNS resolution were unavailable

## Current Status
- MVP implementation status: complete enough for release candidate use.
- Local validation status: passed.
- Remote migration/deploy/smoke status: blocked in this execution context.

## Implemented Scope
- Worker + React implementation with APIs:
  - `/api/health`, `/api/leaderboard`, `/api/scan`
  - `/api/profile/:handle`, `/api/v/:handle`
  - `/api/share/:handle/badge.svg`, `/api/share/:handle/stat-card.json`
  - `/api/auth/github/start`, `/api/auth/github/callback`, `/api/auth/logout`, `/api/me`
  - `/api/refresh/seeds`
- D1 persistence includes:
  - `users`, `repos`, `snapshots`, `scans`, `leaderboard_rows`, `crowns`, `profile_metrics_history`
  - `oauth_accounts`, `sessions`, `repo_ownership`, `refresh_runs`
  - attribution columns from migrations `0001` and `0002`
- `wrangler.toml` includes `staging` and `production` envs, D1 bindings, and daily cron `17 3 * * *` (`03:17 UTC`).

## Command Results (UTC 2026-02-28)
- `npm run check` -> passed (`typecheck`, `lint`, `test`, `build`; `40` tests passed).
- `npm run d1:migrate:staging` -> failed (`fetch failed`, `ENOTFOUND dash.cloudflare.com`; requires `CLOUDFLARE_API_TOKEN` in a non-interactive environment with network access).
- `npm run d1:migrate:production` -> failed (same reason).
- `npm run deploy:staging` -> failed (build succeeded; Wrangler auth/network failed).
- `npm run deploy:production` -> failed (build succeeded; Wrangler auth/network failed).

Smoke checks to these hosts:
- `https://velocity-mvp-staging.rarestg.workers.dev`
- `https://velocity-mvp-production.rarestg.workers.dev`
- All seven required endpoint checks failed DNS resolution from this environment (`curl` exit `6`).

## Human Verification Still Required
1. Run Wrangler auth and remote commands in a network-enabled environment with valid `CLOUDFLARE_API_TOKEN`.
2. Re-run:
- `npm run d1:migrate:staging`
- `npm run d1:migrate:production`
- `npm run deploy:staging`
- `npm run deploy:production`
3. Re-run smoke checks for these endpoints in both environments:
- `GET /api/health`
- `GET /api/leaderboard`
- `GET /api/profile/:handle`
- `GET /api/share/:handle/badge.svg`
- `GET /api/share/:handle/stat-card.json`
- `GET /api/me`
- `GET /api/auth/github/start`
