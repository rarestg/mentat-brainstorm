# Team: Data Integrity

Owner: Pasteur
Status: DONE

## Scope

Own canonical leaderboard correctness and anti-gaming trust semantics:
- refresh/seed persistence behavior
- canonical write authorization and attribution policy
- consistency of read models (`totals`, `thirtyDay`, provenance)
- ingestion confidence transparency

## Why This Matters

If data trust is weak, every growth/UX improvement is fragile.

## Work Items

### W2-001 (Critical) Refresh pruning deletes manual entrants

Problem:
- Seed refresh currently prunes rows outside seed artifact, which can remove legitimate manual entrants.

Refs:
- `apps/velocity-mvp/src/worker/data/db.ts:1256`
- `apps/velocity-mvp/src/worker/data/db.ts:1010`

Acceptance Criteria:
- [x] manual authenticated canonical entrants survive scheduled/manual seed refreshes
- [x] seed refresh still updates seeded baseline safely
- [x] regression test covers manual-row preservation across refresh

### W2-005 (High) Canonical scan writes are repo-wide by default

Problem:
- `/api/scan` canonical persistence defaults to repo-wide attribution.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:825`
- `apps/velocity-mvp/src/shared/scanService.ts:74`

Acceptance Criteria:
- [x] canonical writes use strict handle-authored attribution by default
- [x] repo-wide scans are non-canonical or explicitly marked as non-ranked
- [x] response payload clearly exposes attribution mode and ranking eligibility

### W2-006 (High) Owner authorization uses URL owner, not canonical identity

Problem:
- canonical write gate trusts URL owner segment instead of resolved canonical repo owner identity.

Refs:
- `apps/velocity-mvp/src/shared/repoUrl.ts:26`
- `apps/velocity-mvp/src/shared/scanService.ts:149`
- `apps/velocity-mvp/src/worker/index.ts:846`

Acceptance Criteria:
- [x] authorization compares session handle to canonical GitHub repo owner identity
- [x] repo rename/transfer edge cases covered by tests
- [x] mismatch reasons remain explicit in API response metadata

### W2-012 (Medium) `thirtyDay` can double-count repeat scans

Problem:
- `thirtyDay` read model sums all snapshots in window instead of latest-per-repo semantics.

Refs:
- `apps/velocity-mvp/src/worker/data/db.ts:1414`
- `apps/velocity-mvp/src/worker/data/db.ts:1543`

Acceptance Criteria:
- [x] `thirtyDay` semantics align with latest-per-repo policy (or clearly marked alternate semantics)
- [x] provenance/metadata reflects true semantics
- [x] regression coverage for repeat-scan behavior added

### W2-013 (Medium) Commit ingestion truncation confidence is incomplete

Problem:
- commit fetching has hard page cap without explicit confidence metadata in output.

Refs:
- `apps/velocity-mvp/src/shared/github.ts:8`
- `apps/velocity-mvp/src/shared/github.ts:352`

Acceptance Criteria:
- [x] output includes explicit commit-fetch coverage/confidence metadata
- [x] truncation is machine-readable in scan payload
- [x] tests cover high-volume truncation path

## Checklist

- [x] W2-001 fixed
- [x] W2-005 fixed
- [x] W2-006 fixed
- [x] W2-012 fixed
- [x] W2-013 fixed
- [x] tests updated and passing

## Dependencies / Requests

- Product Loop for final canonical ranking policy UX copy.
- QA Verification for integration and regression sign-off.
- Platform Ops for cache/version invalidation alignment after canonical writes.

## Work Log

Date: 2026-03-02
Engineer: Pasteur
Tasks touched: W2-001, W2-005, W2-006, W2-012, W2-013
What changed:
- Seed pruning now deletes only stale seed-managed leaderboard rows (`ownership_source LIKE 'seed-%'`) so manual canonical entrants are preserved.
- `/api/scan` now requests strict handle-authored attribution for authenticated sessions and gates canonical persistence on canonical GitHub owner identity (`providerLogin`) plus strict target-handle alignment.
- Scan payload now includes canonical repo identity metadata (`requested` vs `canonical`) plus ranking eligibility metadata in persistence response.
- `thirtyDay` read model now aggregates latest-per-repo snapshots in the 30-day window and provenance source reflects this policy.
- Commit ingestion now returns machine-readable pagination/truncation coverage + confidence metadata and is surfaced in scan payload metadata.
Validation:
- `npm --prefix apps/velocity-mvp run test -- src/shared/github.test.ts src/shared/scanService.test.ts src/worker/index.test.ts src/worker/data/db.integration.test.ts -t "W2-001 guard|W2-012 guard|worker routes|fetchMergedPrsForWindow|fetchCommitsForWindow|scanService attribution/window edges"` (pass)
- `npm --prefix apps/velocity-mvp run test -- src/worker/data/db.test.ts` (pass)
- `npm --prefix apps/velocity-mvp run typecheck` (pass)
- `npm --prefix apps/velocity-mvp run lint` (pass with existing warnings in generated `env.d.ts`)
- `npm --prefix apps/velocity-mvp run build` (pass)
Open questions:
- QA integration tests that call `refreshLeaderboardFromSeed` directly are still blocked in local Miniflare by `BEGIN IMMEDIATE` transaction support; see COMMS for coordination request.

## Notes To Future Contributors

Document edge cases, fallback semantics, and policy rationale here.
