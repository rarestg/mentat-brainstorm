# Team: Cloudflare / Platform

Owner: TBD  
Status: TODO

## Scope

Own deployment safety, runtime operability, caching, and refresh orchestration on Cloudflare:
- Wrangler and release pipeline hardening
- D1 migration safety and retention
- API caching strategy
- refresh concurrency control

## Why This Matters

Velocity is a public competitive surface. Platform drift or operational footguns can compromise reliability and trust quickly.

## Work Items

### VEL-011 (High) Wrangler major version drift

Problem:
- repo is pinned to wrangler v3 while v4 is current.

Refs:
- `apps/velocity-mvp/package.json:53`

Guidance:
- Upgrade to wrangler v4 and update scripts if required.
- Add config/types checks in CI.

Acceptance Criteria:
- [ ] wrangler v4 adopted
- [ ] `wrangler types --check` or equivalent enforced in CI

### VEL-012 (High) Root deploy footgun (`wrangler deploy` without `--env`)

Problem:
- root worker config can publish unintended deployment with dev-like settings.

Refs:
- `apps/velocity-mvp/wrangler.toml:1`
- `apps/velocity-mvp/wrangler.toml:10`

Guidance:
- Rename/root-scope explicitly for dev only and guard release commands.

Acceptance Criteria:
- [ ] non-env deploy path is safe by default
- [ ] deploy scripts and docs force explicit env

### VEL-013 (Medium) D1 migrations target binding alias

Problem:
- migration scripts use `DB` alias instead of immutable DB names.

Refs:
- `apps/velocity-mvp/package.json:20`
- `apps/velocity-mvp/package.json:22`

Guidance:
- target database names in migration commands.

Acceptance Criteria:
- [ ] migration scripts updated to DB names
- [ ] migration runbook updated

### VEL-014 (Medium) Caching strategy is weak

Problem:
- isolate-local/unbounded cache and minimal edge cache headers on public reads.

Refs:
- `apps/velocity-mvp/src/shared/cache.ts:6`
- `apps/velocity-mvp/src/worker/index.ts:370`

Guidance:
- introduce bounded local cache and/or shared cache layer
- set explicit edge caching headers for read-heavy endpoints

Acceptance Criteria:
- [ ] public leaderboard/profile endpoints have explicit cache strategy
- [ ] cache invalidation/purge behavior defined on refresh

### VEL-015 (Medium) Refresh overlap risk (manual + scheduled)

Problem:
- concurrent refreshes can interleave writes.

Refs:
- `apps/velocity-mvp/src/worker/index.ts:663`
- `apps/velocity-mvp/src/worker/index.ts:812`

Guidance:
- add serialization lock (DB lock row or dedicated coordinator).

Acceptance Criteria:
- [ ] concurrent refresh attempts are serialized/rejected safely
- [ ] lock behavior tested

### VEL-016 (Medium) Missing D1 retention policy

Problem:
- append-heavy tables can grow without cleanup policy.

Refs:
- `apps/velocity-mvp/migrations/0001_velocity_schema.sql:19`
- `apps/velocity-mvp/migrations/0002_auth_identity_refresh.sql:23`

Guidance:
- add scheduled retention cleanup jobs and policy docs.

Acceptance Criteria:
- [ ] retention windows defined per table
- [ ] cleanup job implemented and tested

## Checklist

- [ ] VEL-011 fixed
- [ ] VEL-012 fixed
- [ ] VEL-013 fixed
- [ ] VEL-014 fixed
- [ ] VEL-015 fixed
- [ ] VEL-016 fixed
- [ ] staging and production smoke evidence recorded

## Dependencies / Requests To Other Teams

- Backend/Data for schema/refresh write pattern decisions.
- Security/QA for deploy/runbook validation.

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

Use this section for ops caveats, on-call notes, and runbook lessons learned.

