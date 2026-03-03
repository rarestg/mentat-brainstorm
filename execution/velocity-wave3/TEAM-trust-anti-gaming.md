# Team: Trust Anti-Gaming

Owner: Hegel
Status: IN_PROGRESS

## Scope

Own trust signaling that keeps public rankings credible:
- Verified Agent Output badge eligibility semantics
- anomaly signal definitions and visualization policy

## Why This Matters

If users cannot distinguish high-quality velocity from noisy activity, leaderboard credibility degrades.

## Work Items

### W3-003 (High) Verified Agent Output badge is not live

Problem:
- the doctrine calls for trust badges, but profile/leaderboard still lack enforceable badge eligibility logic.

Refs:
- `spec/mentat-doctrine.md`
- `spec/mentat-velocity.md`
- `execution/velocity-wave2/WAVE_CLOSURE_REPORT.md`

Acceptance Criteria:
- [ ] badge eligibility policy is explicit and machine-enforced (readiness threshold, CI-verified throughput, freshness window)
- [ ] non-eligible states expose reason codes for user-visible explanation
- [ ] profile and leaderboard surfaces render badge state consistently

### W3-004 (High) Anomaly visualization is missing

Problem:
- suspicious throughput patterns are not yet surfaced visually, reducing transparency and anti-gaming trust.

Refs:
- `spec/mentat-velocity.md`
- `apps/velocity-mvp/src/shared/metrics.ts`
- `apps/velocity-mvp/src/client/App.tsx`

Acceptance Criteria:
- [ ] anomaly heuristics are defined with severity tiers and documented thresholds
- [ ] API payload includes machine-readable anomaly flags with explanatory labels
- [ ] profile trend/heatmap surfaces display anomaly overlays without hard-ban side effects

## QA Validation Snapshot (2026-03-03)

Task status (evidence-based):
- W3-003: IN_PROGRESS
- W3-004: IN_PROGRESS

Evidence observed:
- `apps/velocity-mvp/src/worker/data/db.ts` now computes trust payloads:
  - verification states (`verified`/`pending`/`unknown`) with thresholded readiness checks.
  - anomaly flags with severity tiers and machine keys (`ci-coverage-low`, `off-hours-dominant`, `commit-throughput-outlier`).
- `apps/velocity-mvp/src/shared/types.ts` defines `LeaderboardEntryTrustSignals`, `TrustAnomalyFlag`, and `VerifiedAgentOutputStatus`.
- `apps/velocity-mvp/src/client/App.tsx` renders verification and anomaly cards on profile and leaderboard rows.
- Regression coverage exists in `apps/velocity-mvp/src/worker/data/db.integration.test.ts` and `apps/velocity-mvp/src/worker/index.test.ts` for trust payload propagation.

Acceptance gaps that block `DONE`:
- W3-003:
  - badge policy is partially enforced (readiness threshold) but does not yet enforce freshness-window and CI-verified-throughput eligibility jointly.
  - non-eligible explanations are human-readable strings, not normalized machine reason codes.
- W3-004:
  - anomaly thresholds exist in code but were not previously logged in `DECISIONS.md` (added in this QA update).
  - anomaly rendering appears in trust cards, but dedicated overlays on trend/heatmap visuals are not implemented yet.

## Checklist

- [ ] W3-003 fixed
- [ ] W3-004 fixed
- [ ] policy decisions logged in `DECISIONS.md`
- [ ] trust-surface QA evidence attached

## Dependencies / Requests

- Data Contracts for readiness/freshness correlation inputs and metadata.
- Product Growth for final badge/anomaly placement and explanatory UX copy.
- QA Verification for edge-case anti-gaming regression scenarios.

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
Tasks touched: W3-003, W3-004
What changed: Validated trust payload + UI exposure and downgraded status to partial-complete where acceptance criteria are only partly met.
Validation:
- `npm --prefix apps/velocity-mvp run test -- src/client/App.route.test.ts src/client/App.wave3.test.ts src/worker/data/db.test.ts src/worker/data/db.integration.test.ts src/worker/index.test.ts` (pass)
- `npm --prefix apps/velocity-mvp run typecheck` (pass)
- `npm --prefix apps/velocity-mvp run check` (pass with lint warnings only)
Open questions:
- Confirm whether anomaly overlays must be rendered directly on trend/heatmap primitives to meet release bar, or if trust cards are acceptable for Wave 3 GA.

## Notes To Future Contributors

Document threshold changes and rationale when anomaly or badge policy shifts.
