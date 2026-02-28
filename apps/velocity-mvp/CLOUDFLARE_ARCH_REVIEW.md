# Cloudflare Architecture Review - Velocity MVP (UTC 2026-02-28)

## Verdict
The current Cloudflare architecture is appropriate for MVP and is largely implemented. The main outstanding issue is not architecture design; it is remote verification from this execution context.

## Current Architecture State
- Compute: single Cloudflare Worker (`Hono`) serving API routes and SPA assets.
- Frontend: React + Vite bundle served via Worker assets binding.
- Data: D1-backed persistence (migrations `0001` and `0002`).
- Auth: GitHub OAuth start/callback/logout + server-side D1 sessions.
- Scheduling: cron trigger configured for daily refresh at `03:17 UTC` in staging and production.

Implemented API routes:
- `/api/health`
- `/api/leaderboard`
- `/api/scan`
- `/api/profile/:handle`
- `/api/v/:handle`
- `/api/share/:handle/badge.svg`
- `/api/share/:handle/stat-card.json`
- `/api/auth/github/start`
- `/api/auth/github/callback`
- `/api/auth/logout`
- `/api/me`
- `/api/refresh/seeds`

## D1 Data Model (Implemented)
Core analytics/profile tables:
- `users`, `repos`, `snapshots`, `scans`, `leaderboard_rows`, `crowns`, `profile_metrics_history`

Identity/ops tables:
- `oauth_accounts`, `sessions`, `repo_ownership`, `refresh_runs`

Attribution metadata columns were added in migration `0002` and are part of current schema.

## Environment and Deployment Topology
`wrangler.toml` currently defines:
- default/dev configuration
- `env.staging` and `env.production`
- D1 bindings for each environment
- cron schedule `17 3 * * *` for both staging and production

This matches the intended MVP topology: one Worker app with env-separated deploy targets and one D1 binding per env.

## Operational Validation Snapshot
Timestamp (UTC): `2026-02-28T07:56:47Z`

Local command outcome:
- `npm run check` -> passed (`40` tests passed; typecheck/lint/tests/build all green)

Remote command outcomes from this environment:
- `npm run d1:migrate:staging` -> failed (`fetch failed`, `ENOTFOUND dash.cloudflare.com`)
- `npm run d1:migrate:production` -> failed (same)
- `npm run deploy:staging` -> failed (build succeeded; Wrangler auth/network failed)
- `npm run deploy:production` -> failed (same)
- staging/production smoke curls for seven required endpoints -> DNS resolution failures (`curl` exit `6`)

## Architecture Risks (Current)
1. Verification gap risk.
- Architecture is implemented, but live-state confirmation is blocked in this runtime.

2. Operational dependency risk.
- Non-interactive runs require valid `CLOUDFLARE_API_TOKEN` and network access to Cloudflare APIs.

3. Product-fidelity risk (non-blocking for MVP).
- Attribution remains login-match baseline; richer identity linking is future work.

## Practical Next Step
Run migrations, deploys, and endpoint smokes from a network-enabled environment with valid Cloudflare credentials to complete rollout verification.
