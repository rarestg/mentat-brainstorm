# Decision Log (Wave 2)

Track material product/architecture decisions for Wave 2.

Rules:
1. Newest decision at top.
2. Include alternatives considered.
3. Include impact on tasks/docs.

---

## Decision Template

```
Decision ID:
Date:
Owner:
Related Tasks:
Context:
Decision:
Alternatives considered:
Tradeoffs:
Implementation notes:
Follow-up actions:
```

---

## Decisions

### DEC-W2-005

Decision ID: DEC-W2-005
Date: 2026-03-02
Owner: Platform Ops
Related Tasks: W2-008, W2-009, W2-010, W2-011
Context: Platform lane needed to close cache coherence gaps on canonical scan writes, prevent partial refresh-state mutation, harden lock lease behavior for long runs, and enforce migration-before-deploy release ordering.
Decision:
- Public read cache version now uses a composite token (`max(successful refresh_runs.id):max(snapshots.id)`) so canonical `/api/scan` writes advance cache keys even outside seed refresh runs.
- Canonical scan writes now trigger immediate public-cache prefix purge plus local cache-version token refresh.
- Seed refresh failure handling now snapshots/restores `leaderboard_rows` and removes partial `profile_metrics_history` rows tied to the failed `refresh_run_id`.
- Refresh lock now renews via heartbeat and surfaces explicit lock-loss conflicts.
- `deploy:{dev,staging,production}` scripts now enforce migrate-before-deploy with split worker-only deploy commands.
Alternatives considered:
- Keep refresh-run-id-only cache versioning and accept scan-write stale windows.
- Use SQL `BEGIN/COMMIT` transaction for refresh atomicity.
- Increase lock TTL only (no renewal).
- Keep deploy and migration as separate manual steps.
Tradeoffs:
- Composite cache version adds a small read overhead, but keeps leaderboard/profile keys coherent with canonical writes and bounds staleness.
- Runtime D1 in this environment rejects SQL transaction statements; snapshot/restore rollback protects canonical leaderboard state but does not fully revert every non-canonical side-table mutation.
- Heartbeat renewal adds periodic writes to lock rows during long refreshes.
- Enforced migration-before-deploy increases release safety but requires remote D1 credentials in deploy environments.
Implementation notes:
- Updated `apps/velocity-mvp/src/worker/index.ts` for cache tokening, scan-write invalidation, lock heartbeat, and lock-loss handling.
- Updated `apps/velocity-mvp/src/worker/data/db.ts` for refresh rollback safeguards.
- Updated `apps/velocity-mvp/package.json` release scripts to chain migrations before deploy.
- Added regressions in `apps/velocity-mvp/src/worker/index.test.ts` (W2-008, W2-011) and `apps/velocity-mvp/src/worker/data/db.integration.test.ts` (W2-009).
Follow-up actions:
- Run staging/production smoke checks with deploy credentials.
- QA to continue concurrency/failure-mode verification on staging D1 runtime.

### DEC-W2-004

Decision ID: DEC-W2-004
Date: 2026-03-02
Owner: Data Integrity
Related Tasks: W2-001, W2-005, W2-006, W2-012, W2-013
Context: Canonical trust policy still allowed repo-wide-attributed writes, owner checks based on URL segments, and thirty-day/commit ingestion read models that obscured confidence or double-counted repeat scans.
Decision:
- Treat canonical write eligibility as strict by default: authenticated scans request `handle-authored` attribution and canonical persistence requires canonical-owner authorization plus strict attributed-handle alignment.
- Resolve canonical repo identity from GitHub metadata and compare authorization against OAuth GitHub login identity (`providerLogin`), not local profile handle alias or URL owner segment.
- Preserve manual canonical entrants during seed pruning by deleting only stale seed-managed leaderboard rows (`ownership_source LIKE 'seed-%'` and no non-seed ownership source).
- Change `thirtyDay` aggregation to latest-per-repo semantics and label provenance accordingly.
- Add explicit commit ingestion coverage/truncation/confidence metadata to scan payloads.
Alternatives considered:
- Keep repo-wide canonical writes with warning labels only.
- Continue URL-owner authorization and treat transfer/rename drift as edge-case noise.
- Keep snapshot-sum thirty-day semantics and rely on UI disclosure text.
Tradeoffs:
- Stronger trust and anti-gaming guarantees, but more conservative canonical persistence (more scans explicitly non-ranked).
- Additional payload complexity (persistence metadata + canonical repo identity + commit ingestion confidence), requiring downstream consumer alignment.
- Seed pruning relies on repo ownership source quality; malformed historical ownership source data may require later cleanup migration.
Implementation notes:
- Updated `apps/velocity-mvp/src/worker/index.ts`, `apps/velocity-mvp/src/shared/scanService.ts`, `apps/velocity-mvp/src/shared/github.ts`, `apps/velocity-mvp/src/shared/types.ts`, and `apps/velocity-mvp/src/worker/data/db.ts`.
- Added/updated regressions in `apps/velocity-mvp/src/worker/index.test.ts`, `apps/velocity-mvp/src/shared/scanService.test.ts`, `apps/velocity-mvp/src/shared/github.test.ts`, and `apps/velocity-mvp/src/worker/data/db.integration.test.ts`.
Follow-up actions:
- Platform Ops to validate cache-version invalidation behavior for canonical write eligibility (`W2-008`).
- QA Verification to rerun W2-019/W2-020 against updated persistence metadata contract.

### DEC-W2-003

Decision ID: DEC-W2-003
Date: 2026-03-02
Owner: Product Loop + Growth UX
Related Tasks: W2-002, W2-007, W2-014, W2-015, W2-016, W2-017
Context: Challenge routing and sharing flows were generating dead-end links (`open-challenge`) and post-scan conversion lacked clear canonical persistence/freshness semantics. Return-loop rivalry deltas were also local-only.
Decision:
- Treat challenge URLs as first-class route state: parse `?challenge=` on `/v/:handle`, render explicit compare destination cards, and instrument deep-link resolution outcomes.
- Generate shareable challenge URLs only when challenger identity is resolvable; otherwise route users to claim-profile gating instead of pseudo-handle links.
- Make sharing channel-resilient: primary action uses native share when available with copy-link fallback, while preserving X only as terminal fallback.
- Introduce optional client contract `ProfileResponse.rivalry` for server-backed rivalry progression; render a history-derived fallback until backend payload is available.
- Require >=44px touch targets for challenge/share actions in mobile-priority surfaces.
Alternatives considered:
- Keep X intent links as primary and add passive copy affordance only.
- Preserve pseudo-handle challenge URLs with stronger “profile not found” copy.
- Keep rivalry progression strictly local-storage until backend fully ships server fields.
Tradeoffs:
- Improves challenge/share completion reliability and signed-out flow safety.
- Adds UI/state complexity (share channel handling, deep-link telemetry, refresh controls).
- Rivalry progression is now contract-driven but backend precision is deferred until Data Integrity populates optional fields.
Implementation notes:
- Updated `apps/velocity-mvp/src/client/App.tsx`, `apps/velocity-mvp/src/client/styles.css`, and `apps/velocity-mvp/src/shared/types.ts`.
- Updated status/comms docs under `execution/velocity-wave2/`.
Follow-up actions:
- Data Integrity to optionally populate `profile.rivalry` and confirm freshness token/versioning strategy.
- QA Verification to convert challenge deep-link placeholder coverage to executable assertions.

### DEC-W2-002

Decision ID: DEC-W2-002
Date: 2026-03-02
Owner: QA Verification
Related Tasks: W2-020, W2-002, W2-005, W2-006
Context: QA needed to land W2-020 regression coverage while challenge deep-link destination semantics (`?challenge=` parse + landing) and canonical scan-write policy details were still in-flight across Product Loop and Data Integrity.
Decision:
- Add executable failing regressions now for canonical policy behavior in `apps/velocity-mvp/src/worker/index.test.ts`.
- Add a single explicit `it.todo` placeholder for challenge deep-link parse/landing coverage until W2-002 contract is implemented.
- Mark W2-020 as `BLOCKED` in board/team docs until dependencies are resolved.
Alternatives considered:
- Wait to add any W2-020 tests until all upstream implementation work is complete.
- Add speculative challenge assertions before Product Loop publishes final landing contract.
Tradeoffs:
- Preserves immediate regression pressure on trust-critical canonical policy paths.
- Leaves one challenge-loop assertion pending, requiring follow-up conversion from `todo` to executable test.
Implementation notes:
- Added W2-020 tests and placeholder in `apps/velocity-mvp/src/worker/index.test.ts`.
- Logged dependency asks in `execution/velocity-wave2/COMMS.md`.
Follow-up actions:
- Product Loop to finalize W2-002 challenge route contract.
- QA to replace `it.todo` with executable challenge parse/landing assertions once contract lands.

### DEC-W2-001

Decision ID: DEC-W2-001
Date: 2026-03-02
Owner: Program Lead
Related Tasks: W2-001..W2-020
Context: Post-remediation independent audits found that trust/growth/platform gaps remain despite prior wave closure.
Decision:
- Run Wave 2 with five focused lanes: Data Integrity, Product Loop, Growth UX, Platform Ops, QA Verification.
- Prioritize two critical blockers first: `W2-001` and `W2-002`.
- Require all implementation agents to read doctrine + scan + velocity specs before coding.
Alternatives considered:
- Single monolithic team execution.
- Immediate full rearchitecture to new infra primitives.
Tradeoffs:
- Multi-lane execution increases coordination overhead but reduces cycle time.
- Defers major rearchitecture in favor of hardening current architecture first.
Implementation notes:
- Workspace created under `execution/velocity-wave2/` with board/team docs/comms/decisions.
Follow-up actions:
- Start parallel team execution and update board daily.
