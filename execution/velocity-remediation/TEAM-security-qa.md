# Team: Security / QA

Owner: Carson  
Status: IN_PROGRESS

## Scope

Own security hardening and verification depth:
- auth/state comparison hardening
- integration/regression test coverage for ranking and persistence
- quality gates before rollout

## Why This Matters

Mentat Velocity must be trusted by default. Security and QA are the final integrity gate before public leaderboard claims are considered credible.

## Work Items

### VEL-017 (Low) Timing-safe compare for OAuth state checks

Problem:
- state/signature comparisons use direct string equality.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:253`
- `apps/velocity-mvp/src/worker/index.ts:469`

Guidance:
- move to timing-safe comparison for secret-derived values.

Acceptance Criteria:
- [x] direct secret/state equality checks removed
- [x] tests cover mismatch behavior

### VEL-018 (Medium) Missing integration coverage on ranking/persistence SQL

Problem:
- route tests mock DB layer and do not verify critical ranking/persistence behavior in real DB context.

Refs:
- `apps/velocity-mvp/src/worker/index.test.ts:12`

Guidance:
- add integration tests with local D1 covering:
  - first scan
  - repeat scan update
  - rank ordering and percentile bounds
  - refresh-run interactions

Acceptance Criteria:
- [ ] integration suite added and passing
- [ ] catches regressions for VEL-001 and VEL-002 classes

### VEL-019 (Low) Limited end-to-end attribution/window edge coverage

Problem:
- boundary conditions for scan service windows and attribution fallback are lightly covered.

Refs:
- `apps/velocity-mvp/src/shared/scanService.ts:21`
- `apps/velocity-mvp/src/shared/scanService.ts:40`

Guidance:
- add scenario tests around heavy repo activity, fallback paths, and window boundaries.

Acceptance Criteria:
- [x] e2e-like scenarios for attribution and time-window edges are covered
- [x] CI output includes these test groups

## Checklist

- [x] VEL-017 fixed
- [ ] VEL-018 fixed
- [x] VEL-019 fixed
- [x] test reports attached
- [ ] sign-off posted in `COMMS.md`

## Dependencies / Requests To Other Teams

- Backend/Data to expose deterministic fixtures for ranking integration tests.
- Platform for stable local/staging test environments.

## Work Log

```
Date:
Engineer:
Tasks touched:
What changed:
Validation:
Open questions:
```

Date: 2026-02-28  
Engineer: Carson  
Tasks touched: VEL-017, VEL-018, VEL-019  
What changed:  
- Hardened OAuth state checks in `apps/velocity-mvp/src/worker/index.ts` with timing-safe comparison utility (signature and cookie-state checks).  
- Added OAuth mismatch regression tests in `apps/velocity-mvp/src/worker/index.test.ts`.  
- Added local-D1 integration suite in `apps/velocity-mvp/src/worker/data/db.integration.test.ts` (first scan, repeat persistence update, rank ordering/percentile bounds, refresh-run links) with explicit VEL-001/002 regression guards.  
- Added attribution/window edge scenarios in `apps/velocity-mvp/src/shared/scanService.test.ts` (strict handle mode, fallback mode, heavy activity + default-branch fallback assumptions).  
Validation:  
- `npx vitest run src/worker/index.test.ts src/shared/scanService.test.ts` -> PASS (31 tests).  
- Local D1 integration suite requires loopback listener access; elevated run request was interrupted/rejected and is pending re-run.  
Open questions:  
- Backend/Data confirmation requested in `COMMS.md` for canonical fixture expectations covering VEL-001/002 edge outcomes.

## Notes To Future Contributors

Use this section for known test blind spots and future hardening recommendations.
