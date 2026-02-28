# Gap To Ideal (Mentat Velocity)

Snapshot timestamp (UTC): `2026-02-28T07:56:47Z`

## Ideal End State
- Reliable public leaderboard and profile APIs.
- Identity-backed attribution with transparent trust metadata.
- Stable scheduled refresh plus controlled manual refresh.
- Repeatable Cloudflare migration/deploy/smoke verification.

## Current State
- Core Worker + React implementation is present.
- MVP API surface is implemented, including auth, profile, share, and refresh routes.
- D1 persistence covers leaderboard/profile/auth/session/ownership/refresh data.
- Local quality checks pass (`npm run check`, `40` tests).
- Remote Cloudflare verification is blocked in this execution context.

## Remaining Gaps (Ranked)
1. Remote verification in this runtime.
- Gap: migrate/deploy/smoke cannot be validated here (`fetch failed`, `ENOTFOUND dash.cloudflare.com`, DNS failures).
- Why it matters: live environment status is still unproven in this run.

2. Attribution fidelity expansion.
- Gap: strict attribution is login-match based.
- Why it matters: identity linking edge cases remain.

3. Profile insight depth.
- Gap: some profile insight pathways remain lightweight/placeholder.
- Why it matters: reduced product depth beyond core MVP trust surfaces.

4. Refresh governance ergonomics.
- Gap: admin allowlist is env-string based operational control.
- Why it matters: governance/audit UX is minimal for multi-admin operation.
