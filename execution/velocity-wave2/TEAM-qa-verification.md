# Team: QA Verification

Owner: Carson
Status: IN_PROGRESS

## Scope

Own regression depth and release confidence for Wave 2:
- integration harness coverage parity
- data integrity regression scenarios
- route + end-to-end scenario validation

## Why This Matters

Wave 2 touches high-risk trust and platform semantics. Without hard regressions, we can reintroduce leaderboard corruption silently.

## Work Items

### W2-018 (Medium) Integration harness does not apply migration `0003`

Problem:
- integration setup applies only early migrations, skipping rank constraint trigger migration.

Refs:
- `apps/velocity-mvp/src/worker/data/db.integration.test.ts:25`
- `apps/velocity-mvp/migrations/0003_leaderboard_rank_constraints.sql:25`

Acceptance Criteria:
- [x] integration harness applies all required migrations for current schema
- [x] rank constraint trigger behavior is asserted in integration context

Status:
- DONE (test coverage added and passing in local suite)

### W2-019 (Medium) Missing regression: refresh preserves manual entrants

Problem:
- no explicit automated guard that refresh keeps manual canonical rows intact.

Refs:
- `apps/velocity-mvp/src/worker/data/db.integration.test.ts:304`
- `apps/velocity-mvp/src/worker/data/db.ts:1256`

Acceptance Criteria:
- [ ] automated test verifies manual canonical rows survive refresh
- [x] test asserts no data loss after failed/partial refresh attempt where applicable

Status:
- BLOCKED on W2-001 implementation (preservation regression is red by design until fix lands)

### W2-020 (High) Missing scenario coverage for challenge + canonical policy behavior

Problem:
- challenge/deep-link behavior and canonical persistence eligibility paths need end-to-end route-level regression coverage.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:155`
- `apps/velocity-mvp/src/worker/index.ts:853`

Acceptance Criteria:
- [ ] tests cover challenge deep-link parse/landing scenarios
- [ ] tests cover persisted vs non-persisted scan CTA metadata paths
- [ ] tests cover strict attribution and canonical-owner verification cases

Status:
- BLOCKED on W2-002 / W2-005 / W2-006 contracts and implementation

## Checklist

- [x] W2-018 fixed
- [ ] W2-019 fixed
- [ ] W2-020 fixed
- [ ] full verification report posted

## Dependencies / Requests

- Data Integrity and Product Loop for stable contracts before final sign-off.
- Platform Ops for failure-mode test hooks and staging validation windows.

## Work Log

Date: 2026-03-02
Engineer: Carson
Tasks touched: W2-018, W2-019, W2-020
What changed:
- Updated `apps/velocity-mvp/src/worker/data/db.integration.test.ts` to load migration `0003` and assert trigger-enforced `rank > 0`.
- Added W2-019 regressions for manual-entrant preservation across refresh and no-data-loss on failed refresh.
- Added W2-020 route regressions in `apps/velocity-mvp/src/worker/index.test.ts` for canonical-policy edge cases; added challenge-loop `todo` pending W2-002 contract.
Validation:
- `npm run test -- src/worker/data/db.integration.test.ts` -> FAIL (1 failing guard, expected blocker on W2-001), 8 passing including W2-018 + failed-refresh preservation.
- `npm run test -- src/worker/index.test.ts` -> FAIL (3 failing guards, expected blockers on W2-005/W2-006), 28 passing, 1 todo (challenge loop pending W2-002).
Open questions:
- Product Loop: confirm challenge deep-link landing contract (`?challenge=` parse target + signed-out behavior) to finalize W2-020 challenge coverage.
- Data Integrity: confirm canonical persistence gating contract for strict attribution and canonical-owner identity fields/reason codes.

## Notes To Future Contributors

Document blind spots, flaky scenarios, and follow-up hardening items here.
