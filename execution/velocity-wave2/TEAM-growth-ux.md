# Team: Growth UX

Owner: Sagan
Status: DONE

## Scope

Own conversion friction, sharing mechanics, and return-loop UX quality:
- post-scan eligibility/freshness clarity
- challenge/share channel friction
- mobile interaction quality
- recurring rivalry return loops

## Why This Matters

Even with strong metrics, growth stalls if users cannot immediately understand how to join, compare, and come back.

## Work Items

### W2-007 (High) Post-scan conversion lacks persistence/freshness clarity

Problem:
- post-scan CTA can imply ranking impact even when scan is non-canonical; leaderboard freshness is not reconciled immediately.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:1577`
- `apps/velocity-mvp/src/client/App.tsx:1608`
- `apps/velocity-mvp/src/client/App.tsx:373`

Acceptance Criteria:
- [x] UI explicitly indicates canonical persistence status and reason
- [x] CTA branches differ for persisted vs non-persisted scans
- [x] compare/leaderboard view refreshes or offers explicit refresh action after scan

### W2-014 (Medium) Share loop is channel-fragile

Problem:
- outbound sharing is primarily X intent links.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:159`
- `apps/velocity-mvp/src/client/App.tsx:1206`

Acceptance Criteria:
- [x] first-class copy-link flow exists
- [x] native share path is used where supported
- [x] UX tracking covers each outbound channel

### W2-015 (Medium) Signed-out challenge flow can dead-end

Problem:
- pseudo-handle challenge URLs can route to “not found” states.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:700`
- `apps/velocity-mvp/src/client/App.tsx:783`

Acceptance Criteria:
- [x] signed-out challenge sharing produces valid recipient landing state
- [x] no dead-end challenge URLs are generated
- [x] clear “claim profile to challenge” alternative exists when required

### W2-016 (Low) Mobile challenge/share controls are undersized

Problem:
- small tap targets likely depress mobile conversion.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:1348`
- `apps/velocity-mvp/src/client/styles.css:49`

Acceptance Criteria:
- [x] mobile tap targets meet minimum accessible sizing
- [x] mobile leaderboard action row remains visually clear and compact
- [x] QA screenshots attached

### W2-017 (Medium) Return loop is local-only

Problem:
- streak and deltas are localStorage-backed, limiting cross-device stickiness and shared rivalry progression.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:94`
- `apps/velocity-mvp/src/client/App.tsx:607`

Acceptance Criteria:
- [x] server-backed rivalry progression signal is introduced (or contract created)
- [x] returning-user modules show meaningful cross-session changes
- [x] telemetry captures revisit loop engagement

## Checklist

- [x] W2-007 fixed
- [x] W2-014 fixed
- [x] W2-015 fixed
- [x] W2-016 fixed
- [x] W2-017 fixed
- [x] desktop/mobile UX QA evidence attached

## Dependencies / Requests

- Product Loop for challenge destination and compare semantics.
- Data Integrity for canonical persistence metadata.
- QA Verification for UX scenario test plan.

## Work Log

Date: 2026-03-02
Engineer: Sagan
Tasks touched: W2-007, W2-014, W2-015, W2-016, W2-017
What changed:
- post-scan lane now surfaces canonical persistence reason/status and branches CTA behavior by persistence outcome
- leaderboard refresh can be triggered directly from scan lane and leaderboard view, with refresh telemetry and timestamps
- sharing actions now prioritize native-share or copy-link flows, with channel-specific telemetry and fallback handling
- challenge links now avoid pseudo-handle generation and signed-out dead-end states; claim-profile gates were added where required
- mobile action targets were increased to >=44px in leaderboard/share/challenge controls and auth CTA
- introduced optional `ProfileResponse.rivalry` client contract with history-derived fallback rendering for cross-session rivalry progression
Validation:
- `npm run typecheck` (pass)
- `npm run build` (pass)
- `npm run test -- src/shared/repoUrl.test.ts src/shared/metrics.test.ts` (pass)
Open questions:
- backend can now optionally hydrate `profile.rivalry` for stronger rivalry precision (see `COMMS.md`)

Template:
```
Date:
Engineer:
Tasks touched:
What changed:
Validation:
Open questions:
```

## Notes To Future Contributors

Record experiment results and conversion-impact observations here.
