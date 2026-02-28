# Team: Backend/Data

Owner: TBD  
Status: TODO

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
- [ ] anonymous scans do not corrupt canonical leaderboard
- [ ] no row can persist with invalid rank
- [ ] percentile output is bounded and valid
- [ ] regression tests added

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
- [ ] repeated scans update displayed totals
- [ ] rank reflects latest accepted metrics
- [ ] integration tests cover first scan + repeat scan sequence

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
- [ ] merged PR count stable for high-activity repos
- [ ] tests cover heavy-repo pagination/window behavior

### VEL-004 (Medium) CI-verified PR hard cap truncates contributors

Problem:
- hard cap (20) undercounts high-output developers and suppresses EEH contribution.

Refs:
- `apps/velocity-mvp/src/shared/github.ts:10`
- `apps/velocity-mvp/src/shared/github.ts:383`

Guidance:
- Replace hard cap with safer adaptive bound and explicit confidence metadata.

Acceptance Criteria:
- [ ] no silent severe truncation for high-activity users
- [ ] confidence/limits exposed in API metadata

### VEL-005 (Medium) Silent fallback hides runtime data failures

Problem:
- `/api/leaderboard` falls back silently, masking DB failures with stale/static results.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:376`

Guidance:
- Keep fallback if needed, but attach clear data source health metadata and logs.

Acceptance Criteria:
- [ ] failures are observable in API response and logs
- [ ] stale fallback has explicit marker

## Checklist

- [ ] VEL-001 fixed
- [ ] VEL-002 fixed
- [ ] VEL-003 fixed
- [ ] VEL-004 fixed
- [ ] VEL-005 fixed
- [ ] DB migration (if needed) created and documented
- [ ] test evidence attached

## Dependencies / Requests To Other Teams

- Security/QA for integration coverage sign-off.
- Product for policy decision on anonymous vs claimed leaderboard writes.

## Work Log

```
Date:
Engineer:
Tasks touched:
What changed:
Validation:
Open questions:
```

## Notes To Future Contributors

Use this section for caveats, edge cases, and deferred follow-ups.

