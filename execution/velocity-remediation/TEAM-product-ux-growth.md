# Team: Product / UX / Growth

Owner: TBD  
Status: TODO

## Scope

Own conversion, virality, stickiness, and UX clarity:
- scan -> leaderboard conversion
- share/challenge loops
- profile trust presentation
- mobile/desktop comparison quality

## Why This Matters

Mentat Velocity is meant to be the viral engine. If users cannot easily claim, compare, and share, growth stalls even with correct backend metrics.

## Work Items

### VEL-006 (Critical) Missing scan -> leaderboard conversion path

Problem:
- User can scan but there is no explicit path to join/claim profile/challenge.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:942`
- `apps/velocity-mvp/src/client/App.tsx:991`

Guidance:
- Add explicit post-scan CTA lane:
  - claim profile (or sign in)
  - view ranking impact
  - compare against selected developer

Acceptance Criteria:
- [ ] post-scan screen includes clear next action toward leaderboard participation
- [ ] signed-out and signed-in paths both supported
- [ ] conversion metrics instrumented

### VEL-007 (High) Virality mechanics are not first-class

Problem:
- share/challenge/invite are not visible in primary journey.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:488`
- `apps/velocity-mvp/src/client/App.tsx:880`

Guidance:
- Promote sharing and comparison into hero/profile action rows.
- Add one-click “challenge @handle”.

Acceptance Criteria:
- [ ] visible share action on profile and leaderboard row
- [ ] challenge link generation implemented
- [ ] outbound traffic events tracked

### VEL-008 (High) Placeholder/synthetic blocks undermine trust

Problem:
- synthesized trend/heatmap/insights can appear as real signal.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:90`
- `apps/velocity-mvp/src/client/App.tsx:137`
- `apps/velocity-mvp/src/client/App.tsx:727`

Guidance:
- Prefer explicit “data unavailable” over synthetic default for trust-critical modules.
- Use provenance labels on every metric block.

Acceptance Criteria:
- [ ] no synthetic value presented as authoritative metric
- [ ] each key module shows data source/provenance

### VEL-009 (High) Weak return loop (not sticky yet)

Problem:
- experience behaves like one-off read, not recurring competition habit.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:803`

Guidance:
- Add recurring loop triggers:
  - streak/progress indicators
  - “you moved +/- rank” cards
  - weekly compare snapshots

Acceptance Criteria:
- [ ] at least one weekly re-engagement mechanic shipped
- [ ] “what changed since last visit” section on profile

### VEL-010 (Medium) UX clarity gaps: loading + mobile comparisons

Problem:
- false “not found” while loading; mobile loses comparative context.

Refs:
- `apps/velocity-mvp/src/client/App.tsx:551`
- `apps/velocity-mvp/src/client/App.tsx:811`

Guidance:
- proper loading/skeleton states
- compact but comparable mobile metric set

Acceptance Criteria:
- [ ] no false negative profile state during fetch
- [ ] mobile cards include enough comparison signal to rank users meaningfully

## Checklist

- [ ] VEL-006 fixed
- [ ] VEL-007 fixed
- [ ] VEL-008 fixed
- [ ] VEL-009 fixed
- [ ] VEL-010 fixed
- [ ] desktop + mobile UX QA complete

## Dependencies / Requests To Other Teams

- Backend/Data for trusted metrics source/provenance flags.
- Security/QA for instrumentation and regression checks.

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

Use this section for copy decisions, design rationale, and deferred UX explorations.

