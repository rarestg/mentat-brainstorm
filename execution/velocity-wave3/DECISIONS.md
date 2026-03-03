# Decision Log (Wave 3)

Track material product/architecture decisions for Wave 3.

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

### DEC-W3-003

Decision ID: DEC-W3-003
Date: 2026-03-03
Owner: QA Verification
Related Tasks: W3-001, W3-005, W3-009, W3-012
Context: Wave 3 now emits freshness metadata in leaderboard/profile payloads, but stale-state policy and fallback semantics were not explicitly captured in the decision log.
Decision:
- Treat freshness as a contract tuple: `cacheVersion = <latestSuccessfulRefreshRunId>:<latestSnapshotId>`.
- Preserve freshness `source` as `server` or `static-fallback` for UI labeling and fallback diagnostics.
- Standardize current fallback notes as provisional reason labels: `db-binding-missing`, `d1-read-failure`, and `freshness-query-failed`.
Alternatives considered:
- Return null freshness payloads and force client-derived freshness assumptions.
- Hard-fail read endpoints when freshness cannot be computed.
Tradeoffs:
- Keeps user surfaces operational during partial outages, but stale semantics remain too coarse for SLA alerting.
- Note strings are human-readable but not yet a normalized machine enum.
Implementation notes:
- Implemented in worker freshness loaders/fallbacks and surfaced through shared types and profile/leaderboard payloads.
Follow-up actions:
- Add explicit stale-state enum and machine reason-code set.
- Define freshness SLA thresholds and dashboard/alert hooks (W3-009).

### DEC-W3-002

Decision ID: DEC-W3-002
Date: 2026-03-03
Owner: QA Verification
Related Tasks: W3-003, W3-004, W3-011
Context: Trust policies for verification and anomaly detection were encoded in implementation, but thresholds were not yet formally recorded.
Decision:
- Use `AI readiness score >= 80` as the provisional verification threshold for `Verified Agent Output`.
- Use anomaly thresholds:
  - `ci-coverage-low` when CI-verified merge coverage drops below `60%` (escalate to `high` when below `40%`).
  - `off-hours-dominant` when off-hours ratio is `>= 75%` with at least `12` active coding hours.
  - `commit-throughput-outlier` when commits/day is `>= 25` while CI-verified merged PRs are `<= 2`.
- Emit anomaly keys as machine-readable flags with severity tiers (`low`/`medium`/`high`) and explanatory labels/reasons.
Alternatives considered:
- Dynamic percentile thresholds recalculated per refresh window.
- Manual moderation-only trust flags without deterministic heuristics.
Tradeoffs:
- Deterministic thresholds are easy to test and explain, but may require tuning across different repo sizes and contributor patterns.
- Current verification policy does not yet include freshness-window and throughput-minimum gates required for final closure.
Implementation notes:
- Threshold constants and trust signal construction are implemented in `apps/velocity-mvp/src/worker/data/db.ts`.
- Trust structures are exposed via `apps/velocity-mvp/src/shared/types.ts` and rendered in `apps/velocity-mvp/src/client/App.tsx`.
Follow-up actions:
- Add machine reason-code enums for non-eligible verification states.
- Extend verification policy to include freshness window + CI throughput constraints before marking W3-003 `DONE`.

### DEC-W3-001

Decision ID: DEC-W3-001
Date: 2026-03-03
Owner: Program Lead
Related Tasks: W3-001..W3-012
Context: Wave 2 closure left non-blocking but product-critical completion gaps for rivalry freshness, trust badging, anomaly transparency, and loop conversion measurement.
Decision:
- Execute Wave 3 in five lanes: Data Contracts, Product Growth, Trust Anti-Gaming, Platform Observability, QA Verification.
- Sequence contract-first dependencies with `W3-001` as the foundation task before downstream growth/trust implementations.
- Treat conversion instrumentation (`W3-007`, `W3-008`, `W3-012`) as release-gating, not optional analytics.
Alternatives considered:
- Fold completion gaps into ad hoc backlog without a dedicated wave.
- Prioritize growth surfaces first and defer trust/observability semantics.
Tradeoffs:
- Adds coordination overhead across lanes, but keeps accountability clear and release gating explicit.
- Front-loads schema/API contract work, which may delay visible UI changes but reduces rework risk.
Implementation notes:
- Wave 3 board and team lanes created under `execution/velocity-wave3/`.
- All tasks initialized as `TODO` pending owner kickoff updates.
Follow-up actions:
- Teams to log contract and dependency asks in `COMMS.md`.
- Add decision entries for badge eligibility thresholds and anomaly policy once finalized.
