# Mentat Velocity MVP

Cloudflare Worker + React app for public developer velocity snapshots and shareable profile artifacts.

## Status
- MVP implementation is in place and locally validated.
- Remote Cloudflare verification was blocked in this execution context.

Validation snapshot timestamp: `2026-02-28T07:56:47Z`.

## Stack
- Frontend: React + Vite + TypeScript + Tailwind
- API runtime: Hono on Cloudflare Workers
- Persistence: D1
- External data source: GitHub REST API (public repos)

## Implemented API Surface
- `GET /api/health`
- `GET /api/leaderboard`
- `POST /api/scan`
- `GET /api/profile/:handle`
- `GET /api/v/:handle`
- `GET /api/share/:handle/badge.svg`
- `GET /api/share/:handle/stat-card.json`
- `GET /api/auth/github/start`
- `GET /api/auth/github/callback`
- `POST /api/auth/logout`
- `GET /api/me`
- `POST /api/refresh/seeds`

## D1 Persistence
Migrations applied in codebase:
- `migrations/0001_velocity_schema.sql`
- `migrations/0002_auth_identity_refresh.sql`
- `migrations/0003_leaderboard_rank_constraints.sql`

Tables:
- `users`
- `repos`
- `snapshots`
- `scans`
- `leaderboard_rows`
- `crowns`
- `profile_metrics_history`
- `oauth_accounts`
- `sessions`
- `repo_ownership`
- `refresh_runs`

`0002` also adds attribution columns used in snapshots/leaderboard/history flows.
`0003` enforces `leaderboard_rows.rank > 0` and normalizes rank order on migration apply.

## Cloudflare Runtime Configuration
`wrangler.toml` contains:
- `staging` and `production` environments
- D1 bindings per environment
- Daily cron trigger at `03:17 UTC` (`17 3 * * *`) for both staging and production

Release script order is now enforced as:
- `deploy:dev` -> `d1:migrate:development` then `deploy:dev:worker`
- `deploy:staging` -> `d1:migrate:staging` then `deploy:staging:worker`
- `deploy:production` -> `d1:migrate:production` then `deploy:production:worker`

## Local Validation
Run from `apps/velocity-mvp`:

```bash
npm run cf:types
npm run check
npm run build:worker
```

Verified on `2026-02-28T07:56:47Z`:
- `npm run check` passed (`typecheck`, `lint`, `test`, `build`; `40` tests passed).

## Remote Operations Snapshot (Same Verification Window)
Attempted commands:
- `npm run d1:migrate:staging` -> failed (`fetch failed`, `ENOTFOUND dash.cloudflare.com`)
- `npm run d1:migrate:production` -> failed (same)
- `npm run deploy:staging` -> failed (same)
- `npm run deploy:production` -> failed (same)

Smoke checks from this environment:
- Staging host: `https://velocity-mvp-staging.rarestg.workers.dev`
- Production host: `https://velocity-mvp-production.rarestg.workers.dev`
- All seven required endpoint curls failed DNS resolution (`curl` exit `6`).

Caveat: this run could not verify remote health/deploy state because Wrangler auth/network access and host DNS resolution were unavailable in this execution context.
