# Team: Cloudflare / Platform

Owner: Curie  
Status: DONE

## Scope

Own deployment safety, runtime operability, caching, and refresh orchestration on Cloudflare:
- Wrangler and release pipeline hardening
- D1 migration safety and retention
- API caching strategy
- refresh concurrency control

## Why This Matters

Velocity is a public competitive surface. Platform drift or operational footguns can compromise reliability and trust quickly.

## Work Items

### VEL-011 (High) Wrangler major version drift

Problem:
- repo is pinned to wrangler v3 while v4 is current.

Refs:
- `apps/velocity-mvp/package.json:53`

Guidance:
- Upgrade to wrangler v4 and update scripts if required.
- Add config/types checks in CI.

Acceptance Criteria:
- [x] wrangler v4 adopted
- [x] `wrangler types --check` or equivalent enforced in CI

### VEL-012 (High) Root deploy footgun (`wrangler deploy` without `--env`)

Problem:
- root worker config can publish unintended deployment with dev-like settings.

Refs:
- `apps/velocity-mvp/wrangler.toml:1`
- `apps/velocity-mvp/wrangler.toml:10`

Guidance:
- Rename/root-scope explicitly for dev only and guard release commands.

Acceptance Criteria:
- [x] non-env deploy path is safe by default
- [x] deploy scripts and docs force explicit env

### VEL-013 (Medium) D1 migrations target binding alias

Problem:
- migration scripts use `DB` alias instead of immutable DB names.

Refs:
- `apps/velocity-mvp/package.json:20`
- `apps/velocity-mvp/package.json:22`

Guidance:
- target database names in migration commands.

Acceptance Criteria:
- [x] migration scripts updated to DB names
- [x] migration runbook updated

### VEL-014 (Medium) Caching strategy is weak

Problem:
- isolate-local/unbounded cache and minimal edge cache headers on public reads.

Refs:
- `apps/velocity-mvp/src/shared/cache.ts:6`
- `apps/velocity-mvp/src/worker/index.ts:370`

Guidance:
- introduce bounded local cache and/or shared cache layer
- set explicit edge caching headers for read-heavy endpoints

Acceptance Criteria:
- [x] public leaderboard/profile endpoints have explicit cache strategy
- [x] cache invalidation/purge behavior defined on refresh

### VEL-015 (Medium) Refresh overlap risk (manual + scheduled)

Problem:
- concurrent refreshes can interleave writes.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:663`
- `apps/velocity-mvp/src/worker/index.ts:812`

Guidance:
- add serialization lock (DB lock row or dedicated coordinator).

Acceptance Criteria:
- [x] concurrent refresh attempts are serialized/rejected safely
- [x] lock behavior tested

### VEL-016 (Medium) Missing D1 retention policy

Problem:
- append-heavy tables can grow without cleanup policy.

Refs:
- `apps/velocity-mvp/migrations/0001_velocity_schema.sql:19`
- `apps/velocity-mvp/migrations/0002_auth_identity_refresh.sql:23`

Guidance:
- add scheduled retention cleanup jobs and policy docs.

Acceptance Criteria:
- [x] retention windows defined per table
- [x] cleanup job implemented and tested

## Checklist

- [x] VEL-011 fixed
- [x] VEL-012 fixed
- [x] VEL-013 fixed
- [x] VEL-014 fixed
- [x] VEL-015 fixed
- [x] VEL-016 fixed
- [x] staging and production smoke evidence recorded

## Dependencies / Requests To Other Teams

- Backend/Data for schema/refresh write pattern decisions.
- Security/QA for deploy/runbook validation.

## Work Log

Date: 2026-02-28  
Engineer: Curie  
Tasks touched: VEL-011, VEL-012, VEL-013, VEL-014, VEL-015, VEL-016  
What changed:
- `apps/velocity-mvp/wrangler.toml`: root worker renamed to dev-safe target (`velocity-mvp-dev`) and explicit `env.development` added.
- `apps/velocity-mvp/package.json`: deploy guard (`deploy` fails without explicit env), env-specific deploy scripts, D1 migration scripts switched to immutable DB names, CI guard scripts added (`cf:config:check`, `cf:types:check`), and migration runbook helper script added.
- `apps/velocity-mvp/src/shared/cache.ts`: bounded in-memory cache + prefix invalidation + cache management helpers.
- `apps/velocity-mvp/src/worker/index.ts`: explicit cache-control strategy for public reads, cache versioning + invalidation on refresh, refresh serialization lock (`refresh_locks` table), and retention cleanup policy/job execution after refresh.
Validation:
- `npm run build` passed.
- `npm run test -- src/worker/index.test.ts` passed (28 tests).
- `WRANGLER_LOG_PATH=.wrangler/logs ./node_modules/.bin/wrangler deploy --dry-run --env development` passed (v3 binary).
- `npm run cf:config:check` failed in this sandbox because Wrangler v4 wrapper could not be downloaded (`ENOTFOUND registry.npmjs.org`).
Open questions:
- Security/QA: please run lock/retention behavior validation in CI/staging where D1 integration and unrestricted network are available.
- Platform: complete lockfile migration to Wrangler v4 when network escalation is available.

Date: 2026-03-02  
Engineer: Program follow-up  
Tasks touched: VEL-011, release-gate smoke verification  
What changed:
- Upgraded local dependency from `wrangler@3` to `wrangler@4.69.0` and regenerated lockfile.
- Updated project to runtime-generated Worker types (`wrangler types`) and removed `@cloudflare/workers-types` from TypeScript config path.
- Ran remote migrations and deploys for staging and production.
Validation:
- `npm run cf:config:check` (pass with Wrangler 4.69.0).
- `npm run d1:migrate:staging` (pass), `npm run d1:migrate:production` (pass).
- `npm run deploy:staging` (pass), `npm run deploy:production` (pass).
- Smoke pass recorded for both:
  - `https://velocity-mvp-staging.rarestg.workers.dev`
  - `https://velocity-mvp-production.rarestg.workers.dev`
  - `/api/health`, `/api/leaderboard`, `/api/profile/sindresorhus`, share endpoints = 200
  - `/api/me` and `/api/refresh/seeds` = 401 unauthenticated expected
  - `/api/auth/github/start` = 302 expected
Open questions:
- None blocking this lane.

## Notes To Future Contributors

Use this section for ops caveats, on-call notes, and runbook lessons learned.

- Refresh serialization uses a short-lived DB lock row (`refresh_locks`) to avoid overlapping manual/scheduled writes without requiring Durable Objects.
- Public read caching uses cache-key versioning sourced from successful `refresh_runs` IDs, plus local cache purge on refresh completion.
