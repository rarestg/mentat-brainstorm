# Team: Platform Observability

Owner: Curie
Status: TODO

## Scope

Own runtime reliability for Wave 3 telemetry and freshness guarantees:
- conversion event ingestion durability
- freshness/SLA monitoring and alerting

## Why This Matters

Without reliable telemetry and freshness observability, growth and trust improvements cannot be verified or operated safely.

## Work Items

### W3-008 (Medium) Conversion event ingestion reliability is undefined

Problem:
- loop conversion instrumentation needs a production-safe ingestion path with idempotency, dedupe, and replay/backfill support.

Refs:
- `apps/velocity-mvp/src/worker/index.ts`
- `apps/velocity-mvp/src/worker/data/db.ts`
- `execution/velocity-wave2/TEAM-platform-ops.md`

Acceptance Criteria:
- [ ] ingestion path supports idempotency keys and deduplicates retried client submissions
- [ ] failed writes can be retried or backfilled without double-counting conversion events
- [ ] monitoring exposes ingestion error rate, latency, and dropped-event counts

### W3-009 (Medium) Freshness and contract lag lack operational guardrails

Problem:
- rivalry/freshness contracts need explicit SLA metrics and alerts to prevent silent stale-user experiences.

Refs:
- `execution/velocity-wave2/WAVE_CLOSURE_REPORT.md`
- `apps/velocity-mvp/src/worker/index.ts`
- `apps/velocity-mvp/src/worker/data/db.ts`

Acceptance Criteria:
- [ ] freshness SLA metrics are defined for profile, leaderboard, and rivalry snapshot lag
- [ ] staging and production alerts fire on threshold breaches with actionable runbook links
- [ ] smoke/runbook checks include freshness token and rivalry age validation

## QA Validation Snapshot (2026-03-03)

Task status (evidence-based):
- W3-008: TODO
- W3-009: TODO

Evidence observed:
- Required command suite passed for app correctness, but no platform observability implementation artifacts were found in current Wave 3 diff.
- `apps/velocity-mvp/src/worker/index.ts` exposes freshness payload values but does not define freshness SLA metrics/alerts or ingestion reliability telemetry surfaces.
- No idempotent conversion-event ingestion path, dedupe key contract, or replay/backfill workflow is present in worker data access paths.

Acceptance gaps that block progress:
- W3-008:
  - missing ingestion endpoint/storage for conversion funnel events with idempotency keys.
  - missing monitoring counters for ingest latency, error rate, dropped events, and replay outcomes.
- W3-009:
  - missing explicit freshness-lag SLO/SLA definitions and alert thresholds for profile/leaderboard/rivalry paths.
  - missing runbook-linked alerting and smoke checks in staging/production operation docs.

## Checklist

- [ ] W3-008 fixed
- [ ] W3-009 fixed
- [ ] dashboards + alerts configured for staging and production
- [ ] operations evidence attached

## Dependencies / Requests

- Product Growth for final event taxonomy and funnel attribution semantics.
- Data Contracts for freshness token schema and acceptable lag windows.
- QA Verification for observability/failure-mode checks in release gates.

## Work Log

Template:
```
Date:
Engineer:
Tasks touched:
What changed:
Validation:
Open questions:
```

Date: 2026-03-03
Engineer: Carson (QA)
Tasks touched: W3-008, W3-009
What changed: Confirmed platform observability lane remains unimplemented for Wave 3 acceptance criteria and kept statuses at TODO.
Validation:
- `npm --prefix apps/velocity-mvp run test -- src/client/App.route.test.ts src/client/App.wave3.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts src/worker/index.test.ts` (pass)
- `npm --prefix apps/velocity-mvp run typecheck` (pass)
- `npm --prefix apps/velocity-mvp run check` (pass with lint warnings only)
Open questions:
- Which system owns Wave 3 funnel-event storage: D1 in this worker or an external analytics sink with replay guarantees?

## Notes To Future Contributors

Keep runbook links and alert owners current as routing/on-call changes.
