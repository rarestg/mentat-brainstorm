# Team: Platform Ops

Owner: Curie
Status: DONE

## Scope

Own Cloudflare operational safety and runtime correctness:
- cache coherence on all canonical write paths
- atomic refresh semantics
- lock/coordination robustness
- release pipeline safety and observability

## Why This Matters

If platform behavior diverges under load/failure, leaderboard trust and user confidence collapse quickly.

## Work Items

### W2-008 (High) Cache invalidation misses canonical scan writes

Problem:
- public cache version/invalidation is tied to refresh runs and does not fully reconcile canonical scan persistence updates.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:417`
- `apps/velocity-mvp/src/worker/index.ts:870`
- `apps/velocity-mvp/src/worker/index.ts:1090`

Acceptance Criteria:
- [x] canonical scan writes trigger cache coherence updates for affected read paths
- [x] stale leaderboard/profile windows are bounded and documented
- [x] regression tests cover cache behavior after canonical scan write

### W2-009 (High) Refresh persistence is non-atomic

Problem:
- refresh path can partially mutate leaderboard state before full success.

Refs:
- `apps/velocity-mvp/src/worker/data/db.ts:1286`
- `apps/velocity-mvp/src/worker/data/db.ts:1368`

Acceptance Criteria:
- [x] refresh persistence is atomic (transaction or stage/swap)
- [x] failed refresh cannot leave partial canonical leaderboard state
- [x] rollback/failure behavior is tested

### W2-010 (Medium) Deploy and migration are decoupled

Problem:
- deployment can proceed without guaranteed schema migration application.

Refs:
- `apps/velocity-mvp/package.json:17`
- `apps/velocity-mvp/package.json:29`

Acceptance Criteria:
- [x] release path enforces migration-before-deploy for each env
- [x] runbook and scripts reflect enforced order
- [x] CI gate fails clearly on migration/deploy mismatch

### W2-011 (Medium) Refresh lock has no heartbeat/renewal

Problem:
- lease-expiry takeover can overlap long-running refresh operations.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:44`
- `apps/velocity-mvp/src/worker/index.ts:587`
- `apps/velocity-mvp/src/worker/index.ts:898`

Acceptance Criteria:
- [x] lock strategy prevents overlap for long refresh runs
- [x] renewal/heartbeat or stronger coordinator approach implemented
- [x] contention behavior tested and documented

## Checklist

- [x] W2-008 fixed
- [x] W2-009 fixed
- [x] W2-010 fixed
- [x] W2-011 fixed
- [x] staging + production smoke evidence attached

## Dependencies / Requests

- Data Integrity for canonical write timing and invalidation integration. (Resolved in `COMMS.md`, 2026-03-02)
- QA Verification for concurrency/failure-mode test coverage.

## Work Log

Date: 2026-03-02
Engineer: Program follow-up
Tasks touched: Gate F validation
What changed:
- Ran remote migration/deploy validation for staging and production using enforced migration-before-deploy scripts.
- Staging deploy completed with version `d2edbf2a-4b06-42e5-adad-549ff64378b2`; production deploy completed with version `542a167e-7b77-4924-9824-bfa074881cc7`.
- Smoke checks executed on both workers.dev hosts for `/api/health`, `/api/leaderboard`, and `/api/scan`.
Validation:
- `npm run d1:migrate:staging` (pass; no migrations pending)
- `npm run deploy:staging` (pass)
- `npm run d1:migrate:production` (pass after one transient `fetch failed` retry)
- `npm run deploy:production:worker` (pass)
- `curl -fsS https://velocity-mvp-staging.rarestg.workers.dev/{api/health,api/leaderboard}` + POST `/api/scan` (pass)
- `curl -fsS https://velocity-mvp-production.rarestg.workers.dev/{api/health,api/leaderboard}` + POST `/api/scan` (pass)
Open questions:
- None.

Date: 2026-03-02
Engineer: Curie
Tasks touched: W2-008, W2-009, W2-010, W2-011
What changed:
- W2-008: Cache version token now combines successful refresh run id + latest snapshot id; canonical `/api/scan` writes now invalidate/refresh public cache version and purge local public cache prefixes.
- W2-009: Refresh persistence now snapshots `leaderboard_rows` before seed refresh and restores on failure, plus removes partial `profile_metrics_history` rows keyed by failed `refresh_run_id`.
- W2-010: `deploy:{dev,staging,production}` now enforce migrate-before-deploy; added `d1:migrate:development`; deploy worker-only commands split into explicit `deploy:*:worker`.
- W2-011: Refresh lock lease now supports heartbeat renewal (`UPDATE refresh_locks ... SET expires_at`) with configurable TTL/heartbeat env vars and explicit lock-loss handling (`409`).
Validation:
- `npm run test -- src/worker/index.test.ts -t "W2-008 guard|W2-011 guard"` (pass)
- `npm run test -- src/worker/data/db.integration.test.ts` (pass)
- `npm run typecheck` (pass)
- `npm run cf:config:check` (pass for development/staging/production dry-run)
- `npm run deploy` (expected fail with explicit guarded message)
Open questions:
- Staging/production smoke evidence still pending remote credentials + host checks.

## Notes To Future Contributors

- Cache-version staleness is bounded by `PUBLIC_CACHE_VERSION_TTL_MS` (15s) for local cache-version token reuse; edge cache uses tokenized keys so old keys age out by standard TTL without serving current paths.
