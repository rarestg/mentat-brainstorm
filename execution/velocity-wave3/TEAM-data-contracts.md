# Team: Data Contracts

Owner: Pasteur
Status: IN_PROGRESS

## Scope

Own canonical server contracts that power Wave 3 product loops and trust overlays:
- rivalry and freshness payload semantics
- readiness <-> throughput correlation models
- Factory Floor correlation fields and compatibility guarantees

## Why This Matters

Product and trust lanes cannot ship stable UX without explicit, versioned data contracts.

## Work Items

### W3-001 (Critical) Rivalry and freshness contracts are still client-fallback heavy

Problem:
- rivalry progression and freshness handling are still partially derived client-side, weakening cross-device consistency and post-scan reconciliation.

Refs:
- `execution/velocity-wave2/COMMS.md`
- `apps/velocity-mvp/src/shared/types.ts`
- `apps/velocity-mvp/src/worker/data/db.ts`

Acceptance Criteria:
- [ ] profile and leaderboard APIs include server-computed `rivalry` and `freshness` objects with versioned schema
- [ ] freshness payload includes `snapshotId`, `refreshedAt`, stale state, and machine-readable stale reason code(s)
- [ ] contract tests cover missing-history, non-ranked scan, and stale-snapshot edge cases

### W3-002 (High) Scan-readiness correlation payload is missing

Problem:
- Velocity surfaces do not yet expose explicit readiness-to-throughput correlation signals for repo and profile views.

Refs:
- `spec/mentat-doctrine.md`
- `spec/mentat-velocity.md`
- `apps/velocity-mvp/src/worker/data/db.ts`

Acceptance Criteria:
- [ ] backend model joins readiness score history with verified throughput history using a documented time-window policy
- [ ] payload includes confidence metadata (sample count, window coverage, missing-data flags)
- [ ] API behavior is deterministic and null-safe when scans or throughput snapshots are sparse

### W3-010 (Medium) Factory Floor correlation context is incomplete

Problem:
- Factory Floor cards show throughput/readiness but do not yet expose explicit deltas and next-fix confidence context.

Refs:
- `spec/mentat-velocity.md`
- `apps/velocity-mvp/src/shared/leaderboard.ts`
- `apps/velocity-mvp/src/worker/data/db.ts`

Acceptance Criteria:
- [ ] each Factory Floor repo card includes readiness delta, throughput delta, and next-fix confidence metadata
- [ ] payload includes last-correlation refresh timestamp and clear fallback state when prerequisites are missing
- [ ] schema changes are backward-compatible and documented for client consumers

## QA Validation Snapshot (2026-03-03)

Task status (evidence-based):
- W3-001: IN_PROGRESS
- W3-002: TODO
- W3-010: TODO

Evidence observed:
- `apps/velocity-mvp/src/shared/types.ts` now includes `PayloadFreshness`, plus `freshness` on leaderboard/profile contracts and rivalry/trust structures.
- `apps/velocity-mvp/src/worker/data/db.ts` now computes `freshness` via refresh/snapshot IDs and computes server-backed rivalry in `getProfileByHandle`.
- Contract tests added in `apps/velocity-mvp/src/worker/data/db.test.ts` and `apps/velocity-mvp/src/worker/data/db.integration.test.ts` validate freshness shape and server rivalry payload path.

Acceptance gaps that block `DONE`:
- W3-001:
  - no explicit contract schema version field (current token is `cacheVersion` only).
  - no machine-readable stale-state enum/reason-code list; current fallback uses free-form `note`.
  - no explicit test coverage for non-ranked scan + stale-snapshot reason-code edge handling.
- W3-002:
  - no readiness-history x verified-throughput-history time-window join model is exposed.
  - no confidence metadata contract (`sampleCount`, `windowCoverage`, `missingDataFlags`) is present.
- W3-010:
  - Factory Floor repo cards still lack readiness delta, throughput delta, next-fix confidence, and correlation refresh timestamp.

## Checklist

- [ ] W3-001 fixed
- [ ] W3-002 fixed
- [ ] W3-010 fixed
- [ ] contract tests updated and passing

## Dependencies / Requests

- Product Growth for final rivalry/freshness UI contract consumption needs.
- Trust Anti-Gaming for badge/anomaly payload integration points.
- Platform Observability for freshness SLA metrics and instrumentation ingestion expectations.

## Work Log

Template:
```
Date:
Engineer:
Tasks touched:
What changed:
Validation:
Open questions:
```

Date: 2026-03-03
Engineer: Carson (QA)
Tasks touched: W3-001, W3-002, W3-010
What changed: Validated current worker/client contract implementation against Wave 3 acceptance criteria and set non-optimistic statuses.
Validation:
- `npm --prefix apps/velocity-mvp run test -- src/client/App.route.test.ts src/client/App.wave3.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts src/worker/index.test.ts` (pass)
- `npm --prefix apps/velocity-mvp run typecheck` (pass)
- `npm --prefix apps/velocity-mvp run check` (pass with lint warnings only)
Open questions:
- Should stale freshness reasons be normalized into a finite enum (for example: `snapshot-lag`, `refresh-failed`, `db-fallback`) before UI wiring?

## Notes To Future Contributors

Document contract version changes and migration strategy in this file.
