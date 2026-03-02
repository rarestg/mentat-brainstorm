# Cross-Team Communications Log

Use this file for implementation handoffs and cross-team requests.

Rules:
1. Add newest entries at the top.
2. Keep each message actionable and specific.
3. Reference task IDs (`VEL-xxx`) and file paths.
4. When resolved, add a resolution note under the same message block.

---

## Message Template

```
Date:
From Team:
To Team:
Task IDs:
Subject:
Message:
Action requested:
Due:
Status: OPEN | RESOLVED
Resolution notes:
```

---

## Messages

### 2026-03-02

Date: 2026-03-02  
From Team: Product/UX/Growth  
To Team: Backend/Data  
Task IDs: VEL-008, VEL-010  
Subject: QA follow-up: profile payload contract needed for live trend/heatmap/insight modules  
Message: Desktop/mobile QA closeout confirms fallback UX is correct (explicit unavailable states + provenance), but profile modules remain unavailable without backend fields. This does not block remediation closure, but it blocks activation of live trust modules.  
Action requested: Provide field-level contract + ETA for `profile.trendPoints` (>=2 chronological points), `profile.throughputHeatmap` (matrix bins), `profile.rotatingInsights` (non-empty string array), and explicit provenance metadata in `/api/leaderboard` and `/api/profile` payloads so Product can remove unavailable states without additional copy changes.  
Due: 2026-03-04  
Status: RESOLVED  
Resolution notes:
- Delivered in backend payload assembly updates on 2026-03-02:
  - `entry.profile.trendPoints` (authoritative when >=2 history points).
  - `entry.profile.throughputHeatmap` (authoritative when scan windows include commit-hour buckets).
  - `entry.profile.rotatingInsights` (deterministic non-empty array from persisted metrics/history).
  - `entry.provenance` block for trust-critical metrics/modules in both `/api/leaderboard` and `/api/profile/:handle`.
- Unavailable states are explicit and machine-readable via provenance (`state: unavailable`, `reason`), so Product/UX can keep copy stable while enabling live modules as data becomes available.

Date: 2026-03-02  
From Team: Program Lead  
To Team: Cloudflare/Platform, Security/QA, Backend/Data  
Task IDs: VEL-011, VEL-018, VEL-014, VEL-015, VEL-016  
Subject: Full-access verification pass complete  
Message: Completed Wrangler v4 local upgrade and runtime types migration, re-ran integration suites (including local D1 integration), and executed staging/production migrations + deploy + smoke checks.  
Action requested: None. Mark lane status complete and proceed to release bookkeeping.  
Due: 2026-03-02  
Status: RESOLVED  
Resolution notes:
- `wrangler@4.69.0` installed locally; `cf:config:check` passes.
- Integration suite now passes: `db.integration`, `scanService`, and `index` tests.
- Remote migration/deploy succeeded for staging + production and smoke checks passed on both workers.dev hosts.

### 2026-02-28

Date: 2026-02-28  
From Team: Cloudflare/Platform (Curie)  
To Team: Backend/Data (Pasteur), Security/QA (Carson)  
Task IDs: VEL-014, VEL-015, VEL-016  
Subject: Refresh lock + retention policy landed; request shared validation pass  
Message: Platform implemented refresh serialization in `apps/velocity-mvp/src/worker/index.ts` using a D1 lock table (`refresh_locks`) and added retention cleanup execution after each successful refresh (`scans`, `snapshots`, `profile_metrics_history`, `refresh_runs`, `sessions`, `refresh_locks`). Public read cache version now keys off latest successful `refresh_runs.id`.  
Action requested: Backend/Data confirm no conflict with current `refresh_runs` lifecycle assumptions; Security/QA validate manual-vs-scheduled overlap behavior and retention deletions in CI/staging D1 environment.  
Due: 2026-03-01  
Status: RESOLVED  
Resolution notes:
- Backend/QA confirmed no schema conflict with refresh lock and `refresh_runs` usage.
- Staging and production deploy + smoke checks passed on 2026-03-02.
- Follow-up hardening can continue in normal backlog if deeper lock-stress tests are needed.

Date: 2026-02-28  
From Team: Backend/Data  
To Team: Security/QA  
Task IDs: VEL-001, VEL-002, VEL-003, VEL-018  
Subject: Ranking/persistence remediations landed; request unrestricted CI sign-off run  
Message: We shipped canonical write gating, rank>0 enforcement, repeat-scan leaderboard updates, and heavy-repo ingestion/verification coverage. Focused test suites pass locally, but full `npm run check` in sandbox cannot complete because `src/worker/data/db.integration.test.ts` needs localhost listen permissions (`listen EPERM 127.0.0.1`).  
Action requested: Execute `npm run check` (or `vitest run src/worker/data/db.integration.test.ts`) in CI/staging runner with localhost permissions and post evidence for Gate C sign-off.  
Due: 2026-03-01  
Status: RESOLVED  
Resolution notes:
- Local D1 integration suite now runs with full-access runtime and passes.
- Validation evidence captured in `TEAM-security-qa.md` and gate tracking in `BOARD.md`.

Date: 2026-02-28  
From Team: Backend/Data  
To Team: Product/UX/Growth  
Task IDs: VEL-001, VEL-006, VEL-008  
Subject: Canonical scan-write policy is live; confirm intended UX policy  
Message: `/api/scan` now writes canonical leaderboard rows only when an authenticated session handle matches scanned repo owner. Anonymous or owner-mismatch scans return `persistence` metadata with reasons (`unauthenticated`, `owner-mismatch`) and do not mutate canonical rows.  
Action requested: Confirm this policy is intended and align claim/auth conversion UX copy with the new `persistence` metadata states.  
Due: 2026-03-01  
Status: RESOLVED  
Resolution notes:
- Product/UX accepted owner-match canonical-write policy.
- Scan conversion and claim/auth UX were updated accordingly (`VEL-006` complete).

Date: 2026-02-28  
From Team: Security/QA (Carson)  
To Team: Backend/Data (Pasteur)  
Task IDs: VEL-018, VEL-001, VEL-002  
Subject: Deterministic fixture expectations for ranking/persistence integration suite  
Message: Added local-D1 integration tests in `apps/velocity-mvp/src/worker/data/db.integration.test.ts`, including VEL-001/002 regression guards. Please confirm expected fixture outcomes for: (1) first manual scan row rank normalization, (2) repeat manual scan aggregate refresh behavior, and (3) percentile bounds after mixed seeded + manual writes.  
Action requested: Reply with canonical expected outputs so QA can finalize VEL-018 sign-off and unmark pending guards.  
Due: 2026-03-01  
Status: RESOLVED  
Resolution notes:
- First manual scan canonical row must persist with `rank >= 1` after rerank pass; no `rank=0` persistence is allowed.
- Repeat manual scans must refresh leaderboard totals from latest per-repo snapshots for that handle, then rerank globally.
- Percentiles must remain bounded `[0, 100]` for all outputs, including mixed seeded/manual rows and invalid-rank legacy data scenarios.

Date: 2026-02-28  
From Team: Product/UX/Growth  
To Team: Backend/Data  
Task IDs: VEL-008, VEL-006  
Subject: Backend provenance payloads needed to replace unavailable profile modules  
Message: We removed synthetic trend/heatmap/insight rendering and now show explicit unavailable states with provenance labels. To fully unlock these modules, provide authoritative `profile.trendPoints`, `profile.throughputHeatmap`, `profile.rotatingInsights`, and explicit provenance metadata in leaderboard/profile payloads.  
Action requested: Confirm payload shape + ETA for these fields so UX can flip modules from unavailable to live signal without copy changes.  
Due: 2026-03-03  
Status: RESOLVED  
Resolution notes:
- Backend payload shape is now live in both `/api/leaderboard` and `/api/profile/:handle`:
  - `entry.profile.trendPoints`
  - `entry.profile.throughputHeatmap`
  - `entry.profile.rotatingInsights`
  - `entry.provenance` with trust-critical blocks (`totals`, `thirtyDay`, and profile module provenance).
- Provenance semantics:
  - `state: authoritative` only when block is backed by persisted DB data.
  - `state: unavailable` includes explicit `reason` (`no-profile-history`, `insufficient-history-points`, `no-scan-history`, `missing-current30d-window`, `missing-throughput-heatmap-buckets`).
- Throughput heatmap source is authoritative commit-hour scan buckets (`windows[].throughputHeatmap`) aggregated from latest scan per repo; no synthetic authoritative fallback is emitted.
- Rotating insights are deterministic text derived from authoritative stored metrics/history; trend points require >=2 history snapshots to become authoritative.

Date: 2026-02-28  
From Team: Program Lead  
To Team: Backend/Data, Product/UX/Growth, Cloudflare/Platform, Security/QA  
Task IDs: VEL-001..VEL-019  
Subject: Velocity remediation kickoff  
Message: Review assigned team doc, confirm owner, and start with highest-severity open item.  
Action requested: Post owner + ETA in your team doc and update `BOARD.md` statuses.  
Due: 2026-03-01  
Status: RESOLVED  
Resolution notes:
- Kickoff objectives completed; all `VEL-001`..`VEL-019` are now tracked as DONE in `BOARD.md`.
