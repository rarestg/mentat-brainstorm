# Velocity MVP Wave 2 Board

Last updated: 2026-03-02
Owner: Program Lead

## Objective

Ship Wave 2 to close critical trust + growth gaps identified by independent audit.

Primary outcomes:
- manual entrants are never erased by refresh
- challenge links resolve to real compare behavior
- Velocity <-> Scan action loop is visible and actionable
- canonical ranking policy is consistent and anti-gaming
- platform operations are safer and easier to observe

## Workstreams

- Data Integrity: `TEAM-data-integrity.md`
- Product Loop: `TEAM-product-loop.md`
- Growth UX: `TEAM-growth-ux.md`
- Platform Ops: `TEAM-platform-ops.md`
- QA Verification: `TEAM-qa-verification.md`

## Global Backlog

| ID | Severity | Area | Summary | Owner | Status | Dependency |
|---|---|---|---|---|---|---|
| W2-001 | Critical | Data Integrity | Seed refresh pruning deletes non-seed canonical entrants | Pasteur | DONE | None |
| W2-002 | Critical | Product Loop | Challenge deep links (`?challenge=`) not consumed by app | Hegel | DONE | None |
| W2-003 | High | Product Loop | Velocity -> Scan action loop still placeholder in MVP | Hegel | TODO | W2-006 |
| W2-004 | High | Product Loop | Factory Floor payload is empty (`repos: []`) | Hegel | TODO | W2-003, W2-006 |
| W2-005 | High | Data Integrity | Canonical `/api/scan` persists repo-wide attribution by default | Pasteur | DONE | W2-006 |
| W2-006 | High | Data Integrity | Owner authorization uses URL owner segment, not canonical GitHub owner identity | Pasteur | DONE | None |
| W2-007 | High | Growth UX | Post-scan conversion path lacks persistence clarity + freshness reconciliation | Sagan | DONE | W2-005 |
| W2-008 | High | Platform Ops | Cache version/invalidation does not cover canonical scan writes | Curie | DONE | W2-005 |
| W2-009 | High | Platform Ops | Refresh persistence is non-atomic (partial state risk) | Curie | DONE | W2-001 |
| W2-010 | Medium | Platform Ops | Deploy and migration remain decoupled in release path | Curie | DONE | None |
| W2-011 | Medium | Platform Ops | Refresh lock lease has no heartbeat/renewal semantics | Curie | DONE | W2-009 |
| W2-012 | Medium | Data Integrity | `thirtyDay` read model can double-count repeat scans | Pasteur | DONE | W2-005 |
| W2-013 | Medium | Data Integrity | Commit ingestion truncation lacks explicit confidence metadata | Pasteur | DONE | None |
| W2-014 | Medium | Growth UX | Share/challenge loop depends mainly on X intent links | Sagan | DONE | W2-002 |
| W2-015 | Medium | Growth UX | Signed-out challenge flow can produce dead-end profile links | Sagan | DONE | W2-002 |
| W2-016 | Low | Growth UX | Mobile share/challenge control sizing reduces tap success | Sagan | DONE | None |
| W2-017 | Medium | Growth UX | Return loop relies on local-only streak/delta (no server-backed rivalry progression) | Sagan | DONE | W2-002 |
| W2-018 | Medium | QA Verification | Integration harness does not apply migration `0003` | Carson | DONE | None |
| W2-019 | Medium | QA Verification | Missing regression for refresh preserving manual scan entrants | Carson | BLOCKED | W2-001 |
| W2-020 | High | QA Verification | Missing scenario coverage for challenge loop + canonical policy behavior | Carson | BLOCKED | W2-002, W2-005, W2-006 |

## Release Gates

- [x] Gate A: `Critical` tasks (`W2-001`, `W2-002`) are `DONE`
- [x] Gate B: leaderboard trust tasks (`W2-001`, `W2-005`, `W2-006`, `W2-012`) are `DONE`
- [x] Gate C: challenge + compare loop tasks (`W2-002`, `W2-015`) are `DONE`
- [x] Gate D: platform safety tasks (`W2-008`, `W2-009`, `W2-010`) are `DONE`
- [ ] Gate E: QA regression additions (`W2-018`, `W2-019`, `W2-020`) are merged and passing
- [ ] Gate F: staging deploy + smoke + targeted scenario checks recorded

## Progress Tracker

| Metric | Target | Current |
|---|---:|---:|
| Critical done | 2 | 2 |
| High done | 9 | 5 |
| Medium done | 9 | 8 |
| Low done | 1 | 1 |
| Total done | 20 | 16 |

## Standup Template

```
Date:
Team:
Completed:
In progress:
Blocked:
Needs from other teams:
ETA changes:
```

## Coordinator Notes

- If scope/severity changes, update this board first.
- If two lanes touch schema/API contracts, log one shared decision in `DECISIONS.md`.
- Cross-team asks belong in `COMMS.md`, not only in commits.
