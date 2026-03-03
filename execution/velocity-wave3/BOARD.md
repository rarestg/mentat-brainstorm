# Velocity MVP Wave 3 Board

Last updated: 2026-03-03 (QA validation pass)
Owner: Program Lead

## Objective

Ship Wave 3 to complete the core "Strava for AI developers" experience with stronger trust, clearer Scan correlation, and measurable growth-loop conversion.

Primary outcomes:
- rivalry progression and freshness are server-backed and reliable across sessions
- profile surfaces show readiness <-> throughput correlation instead of isolated metrics
- high-velocity trust layer is visible via verified badge and anomaly visualization
- share/challenge loops are stronger and less fragile
- loop conversion instrumentation is complete and operable

## Workstreams

- Data Contracts: `TEAM-data-contracts.md`
- Product Growth: `TEAM-product-growth.md`
- Trust Anti-Gaming: `TEAM-trust-anti-gaming.md`
- Platform Observability: `TEAM-platform-observability.md`
- QA Verification: `TEAM-qa-verification.md`

## Global Backlog

| ID | Severity | Area | Summary | Owner | Status | Dependency |
|---|---|---|---|---|---|---|
| W3-001 | Critical | Data Contracts | Server-backed rivalry progression + freshness token contract for profile and leaderboard payloads | Pasteur | IN_PROGRESS | None |
| W3-002 | High | Data Contracts | Scan-readiness and verified-throughput correlation model + API payload | Pasteur | TODO | W3-001 |
| W3-003 | High | Trust Anti-Gaming | Verified Agent Output badge policy, eligibility pipeline, and profile/leaderboard exposure | Hegel | IN_PROGRESS | W3-002 |
| W3-004 | High | Trust Anti-Gaming | Anomaly visualization signal model and UI payload overlays for suspicious throughput patterns | Hegel | IN_PROGRESS | W3-002 |
| W3-005 | High | Product Growth | Rivalry progression UI modules powered by server data with explicit freshness handling | Sagan | IN_PROGRESS | W3-001 |
| W3-006 | High | Product Growth | Share/challenge loop v2 with resilient deep links, compare landing, and signed-out recovery | Sagan | IN_PROGRESS | W3-005 |
| W3-007 | High | Product Growth | Instrument Velocity -> Scan -> return conversion funnel events and attribution metadata | Sagan | TODO | W3-001, W3-005 |
| W3-008 | Medium | Platform Observability | Event ingestion reliability (dedupe/idempotency/backfill) for conversion instrumentation | Curie | TODO | W3-007 |
| W3-009 | Medium | Platform Observability | Freshness/SLA dashboards and alerting for rivalry snapshots and profile contract lag | Curie | TODO | W3-001, W3-005 |
| W3-010 | Medium | Data Contracts | Factory Floor correlation payload adds readiness delta, throughput delta, and next-fix confidence metadata | Pasteur | TODO | W3-002 |
| W3-011 | Medium | QA Verification | Regression coverage for badge/anomaly/rivalry/share-challenge user-critical scenarios | Carson | IN_PROGRESS | W3-003, W3-004, W3-006 |
| W3-012 | Medium | QA Verification | Contract + smoke verification for correlation payloads and conversion instrumentation | Carson | IN_PROGRESS | W3-002, W3-007, W3-008, W3-010 |

## Release Gates

- [ ] Gate A: foundation contract task (`W3-001`) is `DONE`
- [ ] Gate B: trust layer tasks (`W3-003`, `W3-004`) are `DONE`
- [ ] Gate C: growth loop tasks (`W3-005`, `W3-006`, `W3-007`) are `DONE`
- [ ] Gate D: Scan correlation tasks (`W3-002`, `W3-010`) are `DONE`
- [ ] Gate E: observability tasks (`W3-008`, `W3-009`) are `DONE`
- [ ] Gate F: QA gates (`W3-011`, `W3-012`) are merged and passing with staging/production smoke evidence

## Progress Tracker

| Metric | Target | Current |
|---|---:|---:|
| Critical done | 1 | 0 |
| Critical in progress | 1 | 1 |
| High done | 6 | 0 |
| High in progress | 6 | 4 |
| Medium done | 5 | 0 |
| Medium in progress | 5 | 2 |
| Low done | 0 | 0 |
| Total done | 12 | 0 |
| Total in progress | 12 | 7 |
| Total todo | 12 | 5 |

## Validation Snapshot (2026-03-03)

- Required QA command set passed:
  - `npm --prefix apps/velocity-mvp run test -- src/client/App.route.test.ts src/client/App.wave3.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts src/worker/index.test.ts` (65/65 tests passed)
  - `npm --prefix apps/velocity-mvp run typecheck` (pass)
  - `npm --prefix apps/velocity-mvp run check` (pass; lint warnings only, no errors)
- Evidence of implemented Wave 3 partials:
  - trust + freshness payload extensions and server rivalry source plumbing are present in worker/client tests and code paths.
- Release remains blocked:
  - no Wave 3 task has full acceptance-criteria closure yet; all release gates stay open.

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

- If scope or severity changes, update this board first.
- If two lanes touch schema/API contracts, log one shared decision in `DECISIONS.md`.
- Cross-team asks belong in `COMMS.md`, not only in commits.
