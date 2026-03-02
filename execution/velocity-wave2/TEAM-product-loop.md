# Team: Product Loop

Owner: Hegel
Status: DONE

## Scope

Own the product-level loop between Velocity and Scan:
- challenge/compare destination behavior
- Scan actionability in Velocity surfaces
- Factory Floor completeness and trust utility

## Why This Matters

Velocity is supposed to be the growth engine for Scan. If the loop is not real in-product, retention and conversion plateau.

## Work Items

### W2-002 (Critical) Challenge deep-link behavior is broken

Problem:
- app generates challenge query params but does not consume them, so compare context is lost on arrival.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:155`
- `apps/velocity-mvp/src/client/App.tsx:184`

Acceptance Criteria:
- [x] app parses and handles inbound challenge context
- [x] recipient lands in a working compare destination (not generic profile fallback)
- [x] signed-out recipient path is valid and non-dead-end

### W2-003 (High) Velocity -> Scan action loop still placeholder

Problem:
- core doctrine loop (throughput + readiness + next fix) is not fully exposed in the MVP product surface.

Refs:
- `spec/mentat-doctrine.md:34`
- `spec/mentat-velocity.md:64`
- `apps/velocity-mvp/src/shared/leaderboard.ts:104`

Acceptance Criteria:
- [x] Velocity profile/leaderboard exposes actionable Scan hook (not placeholder)
- [x] profile shows a concrete “next fix” action path where available
- [x] trust labels remain explicit for missing readiness data

### W2-004 (High) Factory Floor payload is empty

Problem:
- profile repo cards are empty in backend payload, so core profile section cannot deliver.

Refs:
- `apps/velocity-mvp/src/worker/data/db.ts:1493`
- `apps/velocity-mvp/src/worker/data/db.ts:1677`
- `apps/velocity-mvp/src/client/App.tsx:1104`

Acceptance Criteria:
- [x] profile includes real repo-level cards for top repos
- [x] each card includes throughput + readiness/trust context + insight slot
- [x] empty-state only appears when no valid repo snapshots exist

## Checklist

- [x] W2-002 fixed
- [x] W2-003 fixed
- [x] W2-004 fixed
- [x] scenario validation evidence attached

## Dependencies / Requests

- Data Integrity for canonical attribution/authorization semantics.
- Growth UX for challenge/distribution copy and CTA wiring.
- QA Verification for compare-loop and profile-contract regression tests.

## Work Log

Date: 2026-03-02
Engineer: Program follow-up
Tasks touched: W2-003, W2-004
What changed:
- Added actionable Velocity->Scan loop UX in `apps/velocity-mvp/src/client/App.tsx` with explicit scan CTAs from leaderboard rows and profile repo cards.
- Wired backend repo-card payloads in `apps/velocity-mvp/src/worker/data/db.ts` via latest-per-repo snapshot reads and trust-context parsing.
- Normalized legacy persisted placeholder scan insights at read time in `apps/velocity-mvp/src/worker/data/db.ts` to always return actionable next-fix guidance.
Validation:
- `npm run test -- src/client/App.route.test.ts src/worker/index.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts` (pass)
- `npm run typecheck` (pass)
- staging deploy + smoke (`/api/health`, `/api/leaderboard`, `/api/scan`) pass at `https://velocity-mvp-staging.rarestg.workers.dev` with `LEGACY_PLACEHOLDER_PRESENT=false`
- production deploy + smoke (`/api/health`, `/api/leaderboard`, `/api/scan`) pass at `https://velocity-mvp-production.rarestg.workers.dev` with `LEGACY_PLACEHOLDER_PRESENT=false`
Open questions:
- None.

Date: 2026-03-02
Engineer: Sagan (Product + Growth UX lane owner for W2-002 handoff)
Tasks touched: W2-002, W2-015
What changed:
- challenge query parsing is now consumed from inbound profile URLs (`/v/:handle?challenge=:target`)
- challenge deep links render an explicit compare destination card with target-specific deltas
- invalid/missing challenger profile links now render non-dead-end recovery actions
Validation:
- `npm run typecheck` (pass)
- `npm run build` (pass)
- `npm run test -- src/shared/repoUrl.test.ts src/shared/metrics.test.ts` (pass)
Open questions:
- QA to add scenario regression for inbound challenge permutations (`W2-020`)

Template:
```
Date:
Engineer:
Tasks touched:
What changed:
Validation:
Open questions:
```

## Notes To Future Contributors

Capture product policy decisions and user-facing rationale here.
