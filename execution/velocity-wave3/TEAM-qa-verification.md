# Team: QA Verification

Owner: Carson
Status: IN_PROGRESS

## Scope

Own release confidence for Wave 3 through automated regression and scenario validation:
- trust-surface regressions (badge and anomalies)
- growth loop regressions (rivalry, challenge, share)
- data contract and instrumentation verification

## Why This Matters

Wave 3 expands both product UX and ranking trust semantics; regressions in either area reduce credibility quickly.

## Work Items

### W3-011 (Medium) Missing regression depth for trust + growth critical paths

Problem:
- current suite does not cover end-to-end scenarios for badge eligibility, anomaly overlays, and upgraded rivalry/challenge loops.

Refs:
- `apps/velocity-mvp/src/client/App.route.test.ts`
- `apps/velocity-mvp/src/worker/index.test.ts`
- `execution/velocity-wave2/TEAM-qa-verification.md`

Acceptance Criteria:
- [ ] route and worker tests cover verified-badge eligibility, non-eligibility reason codes, and anomaly payload rendering paths
- [ ] challenge/share/rivalry scenarios include signed-out and stale-freshness states
- [ ] regression suite is stable and included in default Wave 3 verification commands

### W3-012 (Medium) Contract and instrumentation release checks are incomplete

Problem:
- no consolidated QA gate currently validates correlation payload contracts and conversion event correctness in staging/production smoke.

Refs:
- `apps/velocity-mvp/src/shared/types.ts`
- `apps/velocity-mvp/src/worker/data/db.integration.test.ts`
- `execution/velocity-wave3/BOARD.md`

Acceptance Criteria:
- [ ] contract tests validate rivalry/freshness/correlation schema compatibility and null-safe behavior
- [ ] instrumentation tests validate event emission semantics and dedupe expectations
- [ ] staging and production smoke checklist includes conversion funnel and freshness assertions

## QA Validation Snapshot (2026-03-03)

Task status (evidence-based):
- W3-011: IN_PROGRESS
- W3-012: IN_PROGRESS

Validation command results:
- `npm --prefix apps/velocity-mvp run test -- src/client/App.route.test.ts src/client/App.wave3.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts src/worker/index.test.ts` -> pass (65/65)
- `npm --prefix apps/velocity-mvp run typecheck` -> pass
- `npm --prefix apps/velocity-mvp run check` -> pass (lint warnings only; no errors)

Evidence observed:
- New Wave 3 helper contract tests in `apps/velocity-mvp/src/client/App.wave3.test.ts`.
- Worker contract coverage expanded in:
  - `apps/velocity-mvp/src/worker/data/db.test.ts`
  - `apps/velocity-mvp/src/worker/data/db.integration.test.ts`
  - `apps/velocity-mvp/src/worker/index.test.ts`
- Existing deep-link routing contract remains covered in `apps/velocity-mvp/src/client/App.route.test.ts`.

Acceptance gaps that block `DONE`:
- W3-011:
  - badge/anomaly/rivalry scenarios are now covered, but signed-out challenge recovery + stale-freshness end-to-end UI scenario coverage is still incomplete.
- W3-012:
  - correlation payload-specific assertions (readiness delta/throughput delta/next-fix confidence) are not yet testable because contract work is incomplete.
  - no instrumentation dedupe/idempotency tests exist for conversion funnel events.
  - staging/production smoke checklist for conversion funnel and freshness assertions is not yet documented in Wave 3 artifacts.

## Checklist

- [ ] W3-011 fixed
- [ ] W3-012 fixed
- [ ] full Wave 3 verification report posted

## Dependencies / Requests

- Data Contracts, Product Growth, and Trust Anti-Gaming for stable API and UX contracts before final sign-off.
- Platform Observability for staging/prod telemetry access and alert test windows.

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
Tasks touched: W3-011, W3-012
What changed: Executed required Wave 3 validation commands and updated QA statuses based on observed contract/test completeness.
Validation:
- `npm --prefix apps/velocity-mvp run test -- src/client/App.route.test.ts src/client/App.wave3.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts src/worker/index.test.ts` (pass)
- `npm --prefix apps/velocity-mvp run typecheck` (pass)
- `npm --prefix apps/velocity-mvp run check` (pass with lint warnings only)
Open questions:
- Should staging/prod smoke evidence live in this file, `BOARD.md`, or a dedicated Wave 3 release report artifact?

## Notes To Future Contributors

Document flaky scenarios and release-blocking gaps as soon as discovered.
