# Velocity MVP Remediation Board

Last updated: 2026-02-28
Owner: Program Lead (TBD)

## Objective

Ship a trustworthy, competitive, and sticky Mentat Velocity experience by closing critical correctness gaps first, then growth and platform hardening.

Primary outcomes:
- leaderboard integrity and ranking trust restored
- credible metrics pipeline and refresh behavior
- stronger growth loops (claim, compare, share, return)
- production-safe Cloudflare operations

## Workstreams

- Backend/Data: `TEAM-backend-data.md`
- Product/UX/Growth: `TEAM-product-ux-growth.md`
- Cloudflare/Platform: `TEAM-cloudflare-platform.md`
- Security/QA: `TEAM-security-qa.md`

## Global Backlog

| ID | Severity | Area | Summary | Owner | Status | Dependency |
|---|---|---|---|---|---|---|
| VEL-001 | Critical | Backend/Data | `rank=0` and anonymous scans corrupt leaderboard ordering/percentile | Pasteur | DONE | None |
| VEL-002 | High | Backend/Data | existing leaderboard rows not updated on re-scan | Pasteur | DONE | VEL-001 |
| VEL-003 | High | Backend/Data | lossy PR ingestion (`updated` sort + page cap) | Pasteur | DONE | None |
| VEL-004 | Medium | Backend/Data | CI-verified PR cap truncates high-volume contributors | Pasteur | DONE | VEL-003 |
| VEL-005 | Medium | Backend/Data | silent fallback masks DB/seed failures | Pasteur | DONE | None |
| VEL-006 | Critical | Product/UX/Growth | no scan -> join leaderboard conversion path | Hegel | DONE | VEL-001, VEL-002 |
| VEL-007 | High | Product/UX/Growth | virality mechanics not first-class (share/challenge/invite) | Hegel | DONE | VEL-006 |
| VEL-008 | High | Product/UX/Growth | placeholder/synthetic profile blocks weaken trust | Hegel | DONE | VEL-001, VEL-002, VEL-003 |
| VEL-009 | High | Product/UX/Growth | weak return loop (not Strava-sticky) | Hegel | DONE | VEL-006 |
| VEL-010 | Medium | Product/UX/Growth | profile loading false negative + mobile comparison gaps | Hegel | DONE | None |
| VEL-011 | High | Platform | wrangler v3 drift vs current v4 | Curie | IN_PROGRESS | None |
| VEL-012 | High | Platform | root deploy footgun (non-`--env` publishes unintended worker) | Curie | DONE | None |
| VEL-013 | Medium | Platform | D1 migration targets binding alias not DB names | Curie | DONE | VEL-011 |
| VEL-014 | Medium | Platform | no shared cache and weak edge caching for read APIs | Curie | DONE | VEL-001, VEL-002 |
| VEL-015 | Medium | Platform | overlapping refresh runs (no serialization lock) | Curie | DONE | VEL-001, VEL-002 |
| VEL-016 | Medium | Platform | missing D1 retention/cleanup policy | Curie | DONE | None |
| VEL-017 | Low | Security | timing-safe compare missing for OAuth state | Carson | DONE | None |
| VEL-018 | Medium | QA | missing DB integration coverage for ranking/persistence | Carson | IN_PROGRESS | VEL-001, VEL-002, VEL-003 |
| VEL-019 | Low | QA | limited end-to-end coverage for attribution/window edges | Carson | DONE | VEL-003 |

## Release Gates

- [ ] Gate A: all `Critical` items marked `DONE`
- [ ] Gate B: all `High` data trust items (`VEL-001`, `VEL-002`, `VEL-003`) marked `DONE`
- [ ] Gate C: integration tests for ranking/persistence merged
- [ ] Gate D: staging smoke pass recorded
- [ ] Gate E: production deploy + smoke pass recorded
- [ ] Gate F: growth loop MVP (`claim`, `share`, `compare`) live

## Progress Tracker

| Metric | Target | Current |
|---|---:|---:|
| Critical done | 2 | 2 |
| High done | 7 | 5 |
| Medium done | 8 | 3 |
| Low done | 2 | 0 |
| Total done | 19 | 10 |

## Standup Update Template

Copy/paste for each daily update:

```
Date:
Team:
Completed:
In progress:
Blocked:
Needs from other teams:
ETA changes:
```

## Notes For Coordinators

- If any task changes severity or scope, update this board first.
- If two teams touch the same API/schema, require a shared entry in `DECISIONS.md`.
- Cross-team implementation questions must be logged in `COMMS.md`.
