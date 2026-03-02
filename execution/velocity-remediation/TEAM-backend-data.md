# Team: Backend/Data

Owner: Pasteur  
Status: DONE

## Scope

Own correctness and trustworthiness of leaderboard data:
- scan ingestion
- ranking + percentile integrity
- PR ingestion quality
- error behavior for leaderboard APIs

## Why This Matters

Mentat Velocity depends on credibility. If ranking logic is wrong or stale, every growth and UX improvement becomes meaningless.

## Work Items

### VEL-001 (Critical) Leaderboard integrity: anonymous scan + `rank=0`

Problem:
- Anonymous scans can mutate leaderboard state.
- First-time rows can be created with `rank=0`.
- Ordering by ascending rank means invalid entries can appear above rank 1.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:382`
- `apps/velocity-mvp/src/worker/index.ts:397`
- `apps/velocity-mvp/src/worker/data/db.ts:861`
- `apps/velocity-mvp/src/worker/data/db.ts:881`

Guidance:
- Require explicit policy for who can write canonical leaderboard rows.
- Guarantee rank is positive integer and recomputed transactionally.
- Enforce DB constraints preventing `rank <= 0`.

Acceptance Criteria:
- [x] anonymous scans do not corrupt canonical leaderboard
- [x] no row can persist with invalid rank
- [x] percentile output is bounded and valid
- [x] regression tests added

### VEL-002 (High) Re-scan does not update existing leaderboard rows

Problem:
- Follow-up scans append snapshots but do not update leaderboard aggregates/rank.

Refs:
- `apps/velocity-mvp/src/worker/data/db.ts:728`
- `apps/velocity-mvp/src/worker/data/db.ts:754`

Guidance:
- Convert persistence to upsert/update path for existing handles.
- Recompute rank after write set completion.

Acceptance Criteria:
- [x] repeated scans update displayed totals
- [x] rank reflects latest accepted metrics
- [x] integration tests cover first scan + repeat scan sequence

### VEL-003 (High) Lossy PR ingestion

Problem:
- Using closed PRs sorted by `updated`, plus capped pagination, misses merged PRs in-window on active repos.

Refs:
- `apps/velocity-mvp/src/shared/github.ts:354`
- `apps/velocity-mvp/src/shared/github.ts:367`

Guidance:
- Align retrieval with merged-window semantics.
- Avoid brittle early stop conditions.

Acceptance Criteria:
- [x] merged PR count stable for high-activity repos
- [x] tests cover heavy-repo pagination/window behavior

### VEL-004 (Medium) CI-verified PR hard cap truncates contributors

Problem:
- hard cap (20) undercounts high-output developers and suppresses EEH contribution.

Refs:
- `apps/velocity-mvp/src/shared/github.ts:10`
- `apps/velocity-mvp/src/shared/github.ts:383`

Guidance:
- Replace hard cap with safer adaptive bound and explicit confidence metadata.

Acceptance Criteria:
- [x] no silent severe truncation for high-activity users
- [x] confidence/limits exposed in API metadata

### VEL-005 (Medium) Silent fallback hides runtime data failures

Problem:
- `/api/leaderboard` falls back silently, masking DB failures with stale/static results.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:376`

Guidance:
- Keep fallback if needed, but attach clear data source health metadata and logs.

Acceptance Criteria:
- [x] failures are observable in API response and logs
- [x] stale fallback has explicit marker

## Checklist

- [x] VEL-001 fixed
- [x] VEL-002 fixed
- [x] VEL-003 fixed
- [x] VEL-004 fixed
- [x] VEL-005 fixed
- [x] DB migration (if needed) created and documented
- [x] test evidence attached

## Dependencies / Requests To Other Teams

- Security/QA for integration coverage sign-off.
- Product for policy decision on anonymous vs claimed leaderboard writes.

## Work Log

Date: 2026-03-02  
Engineer: Pasteur  
Tasks touched: VEL-008, VEL-006  
What changed:
- Implemented backend payload assembly for `profile.trendPoints`, `profile.throughputHeatmap`, and `profile.rotatingInsights` in both `/api/leaderboard` and `/api/profile/:handle`.
- Added explicit per-block provenance metadata (`authoritative` vs `unavailable`) for trust-critical leaderboard/profile metric blocks (`totals`, `thirtyDay`, and profile modules).
- Extended scan metric computation to persist authoritative commit-hour throughput buckets (`windows[].throughputHeatmap`), then aggregated latest per-repo scan windows into profile heatmap payloads.
- Kept trust semantics strict: profile modules are only marked authoritative when backed by persisted data; otherwise response includes explicit unavailable reason (no synthetic authoritative fallback).
- Added regression coverage in `src/shared/metrics.test.ts`, `src/shared/scanService.test.ts`, and `src/worker/data/db.test.ts` for payload shape and provenance semantics.
Validation:
- Focused tests: `npm test -- src/shared/metrics.test.ts src/shared/scanService.test.ts src/worker/data/db.test.ts src/worker/index.test.ts` (pass).
- Quality gates: `npm run typecheck && npm run lint && npm run build` (pass; lint reports existing warnings in generated `src/worker/env.d.ts`).
Open questions:
- None for this lane; Product/UX can now consume module-level provenance to decide when to render live data vs unavailable copy.

Date: 2026-02-28  
Engineer: Pasteur  
Tasks touched: VEL-001, VEL-002, VEL-003, VEL-004, VEL-005  
What changed:
- Enforced canonical leaderboard write policy in `/api/scan`: only authenticated sessions whose handle matches scanned repo owner can persist canonical rows.
- Added rank hardening in persistence/read paths and migration `0003_leaderboard_rank_constraints.sql` with rank>0 triggers.
- Reworked `persistScanReport` to aggregate latest per-repo snapshots, upsert leaderboard rows on every scan, recompute ranks, and append updated history points.
- Replaced brittle PR ingestion behavior with merged-window-aware adaptive pagination + truncation metadata.
- Replaced fixed CI verification cap with adaptive bounds + confidence/coverage metadata.
- Updated `/api/leaderboard` fallback behavior to expose explicit data-source health markers and log DB-read failures.
- Added regression tests in `src/worker/index.test.ts`, `src/shared/github.test.ts`, and `src/worker/data/db.test.ts`.
Validation:
- Focused tests: `npm test -- src/worker/index.test.ts src/shared/github.test.ts src/worker/data/db.test.ts` (pass).
- `npm run check`: typecheck/lint/unit tests/build path passed until existing local-D1 integration tests hit sandbox `listen EPERM 127.0.0.1`; elevated rerun was requested and declined.
Open questions:
- Product/UX should confirm if owner-match canonical-write policy is final or if explicit "claim/import" exceptions are needed.
- Security/QA should validate local-D1 integration coverage in CI/staging where localhost-listening is allowed.

## Notes To Future Contributors

Use this section for caveats, edge cases, and deferred follow-ups.
