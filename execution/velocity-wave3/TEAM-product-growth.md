# Team: Product Growth

Owner: Sagan
Status: IN_PROGRESS

## Scope

Own Wave 3 conversion and retention loops on top of stable contracts:
- rivalry progression UX and freshness messaging
- share/challenge loop strength and landing reliability
- conversion instrumentation from Velocity -> Scan -> Velocity return

## Why This Matters

Velocity growth depends on users seeing clear progression, sharing it, and returning with measurable improvements.

## Work Items

### W3-005 (High) Rivalry progression remains weakly persistent

Problem:
- rivalry progression and freshness context are not yet fully server-backed in end-user surfaces.

Refs:
- `execution/velocity-wave2/TEAM-growth-ux.md`
- `apps/velocity-mvp/src/client/App.tsx`
- `apps/velocity-mvp/src/shared/types.ts`

Acceptance Criteria:
- [ ] profile and compare surfaces render server-backed rivalry progression across sessions/devices
- [ ] stale freshness states are explicitly labeled with actionable recovery controls
- [ ] fallback behavior for partial rivalry data is non-dead-end and user-visible

### W3-006 (High) Share/challenge loop still has avoidable drop-off

Problem:
- share and challenge flows need stronger deep-link reliability, better signed-out recovery, and clearer compare landing paths.

Refs:
- `spec/mentat-velocity.md`
- `apps/velocity-mvp/src/client/App.tsx`
- `apps/velocity-mvp/src/client/styles.css`

Acceptance Criteria:
- [ ] share flow supports native share + copy-link as first-class paths with reliable fallback
- [ ] challenge deep links resolve to explicit compare destinations for signed-in and signed-out recipients
- [ ] no generated challenge URL lands in a dead-end profile state

### W3-007 (High) Loop conversion instrumentation is incomplete

Problem:
- product cannot quantify Velocity -> Scan -> improvement -> return conversion without consistent event instrumentation.

Refs:
- `spec/mentat-doctrine.md`
- `spec/mentat-velocity.md`
- `apps/velocity-mvp/src/client/App.tsx`

Acceptance Criteria:
- [ ] event schema captures funnel steps (`view`, `scan_cta`, `scan_complete`, `return_visit`, `challenge_send`, `challenge_accept`)
- [ ] events include stable attribution keys (handle/session/source channel) and privacy-safe payload policy
- [ ] dashboard-ready aggregates for funnel conversion are queryable by day and channel

## QA Validation Snapshot (2026-03-03)

Task status (evidence-based):
- W3-005: IN_PROGRESS
- W3-006: IN_PROGRESS
- W3-007: TODO

Evidence observed:
- `apps/velocity-mvp/src/client/App.tsx` consumes `profileData.rivalry` and displays rivalry progression plus source labeling; history-derived fallback remains visible when server payload is absent.
- `apps/velocity-mvp/src/client/App.tsx` renders freshness panels for leaderboard/profile payloads, including fallback notes.
- Share/challenge deep-link logic is implemented and covered in `apps/velocity-mvp/src/client/App.route.test.ts` (`parseChallengeQuery`, `buildChallengeLink`, deterministic deep-link resolution states).

Acceptance gaps that block `DONE`:
- W3-005:
  - freshness stale states are labeled, but explicit user recovery controls for stale snapshots are not consistently present on profile/compare surfaces.
  - compare-specific server rivalry persistence validation is still limited.
- W3-006:
  - routing/deep-link behavior is covered, but no consolidated QA scenario proves full signed-out to signed-in recovery without dead-end across all challenge entry points.
- W3-007:
  - instrumentation is still client-local (`trackUxEvent` local storage/dataLayer/custom event); no server funnel ingestion contract, idempotent persistence, or day/channel query aggregate surface is present.
  - canonical funnel event names in acceptance criteria are not yet implemented as a stable schema.

## Checklist

- [ ] W3-005 fixed
- [ ] W3-006 fixed
- [ ] W3-007 fixed
- [ ] desktop/mobile scenario evidence attached

## Dependencies / Requests

- Data Contracts for rivalry/freshness and correlation payload availability.
- Trust Anti-Gaming for badge/anomaly display policy in profile surfaces.
- QA Verification for route-level and conversion-event regression coverage.

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
Tasks touched: W3-005, W3-006, W3-007
What changed: Revalidated growth-loop UX and challenge deep-link paths against current implementation and updated statuses conservatively.
Validation:
- `npm --prefix apps/velocity-mvp run test -- src/client/App.route.test.ts src/client/App.wave3.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts src/worker/index.test.ts` (pass)
- `npm --prefix apps/velocity-mvp run typecheck` (pass)
- `npm --prefix apps/velocity-mvp run check` (pass with lint warnings only)
Open questions:
- Should W3-007 funnel events land in a dedicated worker endpoint or piggyback on existing scan/profile endpoints with batched uploads?

## Notes To Future Contributors

Record conversion-impact experiments and share/challenge drop-off findings here.
