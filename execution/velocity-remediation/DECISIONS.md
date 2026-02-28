# Decision Log

Track material product and architecture decisions for the velocity remediation effort.

Rules:
1. Newest decision at top.
2. Include explicit alternatives considered.
3. Include impact on tasks and docs.

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

### DEC-005

Decision ID: DEC-005  
Date: 2026-02-28  
Owner: Cloudflare/Platform (Curie)  
Related Tasks: VEL-011, VEL-012, VEL-013, VEL-014, VEL-015, VEL-016  
Context: Platform remediation needed deploy safety defaults, deterministic migration targeting, read-path caching with safe invalidation, and refresh-run serialization without introducing new infrastructure dependencies.  
Decision:  
- Make root worker config explicitly dev-safe and require environment-explicit deploy scripts.  
- Target D1 migrations by immutable DB names (`velocity-mvp-dev/staging/production`) rather than binding alias (`DB`).  
- Use a bounded isolate-local cache plus edge cache key versioning derived from successful `refresh_runs.id`, and purge local public caches after refresh completion.  
- Serialize refresh via D1 lock row (`refresh_locks`) with TTL-based takeover semantics and return `409` on manual lock conflict.  
- Run retention cleanup after successful refresh with explicit per-table windows: `scans/snapshots/profile_metrics_history` 180d, `refresh_runs` 45d, revoked sessions 30d, expired sessions 7d, expired locks 1d.  
Alternatives considered:
- Durable Object coordinator for refresh locking
- Cache purge via external API-only invalidation workflow
- Keep root deploy path environment-implicit and rely on operator discipline
Tradeoffs:
- D1 lock table keeps implementation simple and colocated, but requires QA validation for concurrency behavior under load.
- Cache versioning avoids hard purge dependencies, but stale windows remain possible until edge TTL expiry.
- Wrangler v4 command path is enforced in scripts, but full lockfile migration is blocked in this sandbox by outbound network restrictions.
Implementation notes:
- Updated `apps/velocity-mvp/wrangler.toml`, `apps/velocity-mvp/package.json`, `apps/velocity-mvp/src/shared/cache.ts`, `apps/velocity-mvp/src/worker/index.ts`.
- Logged cross-team validation request in `execution/velocity-remediation/COMMS.md`.
Follow-up actions:
- Complete Wrangler v4 lockfile migration when network-enabled install is available.
- Security/QA to validate lock conflict and retention behavior in CI/staging D1 environment.

### DEC-004

Decision ID: DEC-004  
Date: 2026-02-28  
Owner: Backend/Data  
Related Tasks: VEL-003, VEL-004  
Context: `closed+updated` pagination with a fixed page cap and fixed CI verification cap was undercounting high-activity repos and silently reducing trust in merged-PR and CI-verified metrics.  
Decision: Use merged-window-aware adaptive pagination (stop when oldest `updated_at` is older than window start, with explicit max-page truncation metadata) and adaptive CI verification bounds with exposed coverage/confidence metadata in scan payloads.  
Alternatives considered:
- Keep fixed pagination and CI verification caps
- Verify every merged PR without bounds
Tradeoffs:
- Improves trust by reducing silent truncation and exposing confidence limits.
- Still bounded for runtime/rate-limit safety, so some high-volume windows remain sampled rather than exhaustive.
Implementation notes:
- Updated `apps/velocity-mvp/src/shared/github.ts` and `apps/velocity-mvp/src/shared/scanService.ts`.
- Added high-volume pagination/window + CI confidence tests in `apps/velocity-mvp/src/shared/github.test.ts`.
Follow-up actions:
- Security/QA to validate heavy-repo behavior in unrestricted CI/staging execution environment.

### DEC-003

Decision ID: DEC-003  
Date: 2026-02-28  
Owner: Backend/Data  
Related Tasks: VEL-001, VEL-002, VEL-005  
Context: Anonymous scans and invalid rank writes could mutate canonical leaderboard ordering and percentile outputs, undermining trust and downstream growth loops.  
Decision: Canonical leaderboard writes from `/api/scan` require authenticated session ownership (session handle must match scanned repo owner). Anonymous/owner-mismatch scans remain readable but non-mutating, with explicit persistence metadata in API response. Enforce `rank > 0` at DB layer and rerank after persistence updates.  
Alternatives considered:
- Allow anonymous writes and rely on post-hoc cleanup
- Allow authenticated writes without owner-match requirement
Tradeoffs:
- Strongly protects leaderboard integrity and anti-gaming posture.
- Adds conversion dependency on auth/claim flow for scans to affect canonical leaderboard.
Implementation notes:
- Updated `apps/velocity-mvp/src/worker/index.ts` and `apps/velocity-mvp/src/worker/data/db.ts`.
- Added migration `apps/velocity-mvp/migrations/0003_leaderboard_rank_constraints.sql`.
- Added regression coverage in `apps/velocity-mvp/src/worker/index.test.ts` and `apps/velocity-mvp/src/worker/data/db.test.ts`.
Follow-up actions:
- Product/UX/Growth to confirm owner-match canonical-write policy and tune scan-to-claim UX copy.

### DEC-002

Decision ID: DEC-002  
Date: 2026-02-28  
Owner: Product/UX/Growth  
Related Tasks: VEL-006, VEL-008, VEL-009, VEL-010  
Context: Client previously synthesized trend/heatmap/insight values, which reduced trust and made “authoritative” modules ambiguous.  
Decision: For trust-critical profile modules, remove synthetic defaults and render explicit “data unavailable” states with provenance labels until backend supplies authoritative payloads.  
Alternatives considered:
- Keep synthetic placeholders with disclaimers
- Hide modules entirely when data is missing
Tradeoffs:
- Improves trust and anti-gaming posture immediately.
- Temporarily reduces visual richness for sparse payloads.
Implementation notes:
- Trend/heatmap/insight modules now require backend profile fields to render live data.
- Scan conversion lane includes non-authoritative rank preview explicitly labeled as estimate.
Follow-up actions:
- Backend/Data to provide profile trend/heatmap/insight payloads and explicit provenance metadata.

### DEC-001

Decision ID: DEC-001  
Date: 2026-02-28  
Owner: Program Lead  
Related Tasks: VEL-001..VEL-019  
Context: Need an execution system for parallel team work without losing global coherence.  
Decision: Use file-based execution board under `execution/velocity-remediation/` with one master board, four team docs, shared comms log, and shared decision log.  
Alternatives considered:
- Ad hoc updates in PR threads only
- Single monolithic remediation doc
Tradeoffs:
- File-based docs are lightweight and transparent in repo history.
- Requires discipline to keep status current.
Implementation notes:
- Team docs include scoped findings, acceptance criteria, and checklists.
- `BOARD.md` is source of truth for status and release gates.
Follow-up actions:
- Assign explicit owners per team doc.
- Start with critical and high-severity tasks first.
