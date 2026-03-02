# Team: Product / UX / Growth

Owner: Hegel  
Status: DONE

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
- [x] post-scan screen includes clear next action toward leaderboard participation
- [x] signed-out and signed-in paths both supported
- [x] conversion metrics instrumented

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
- [x] visible share action on profile and leaderboard row
- [x] challenge link generation implemented
- [x] outbound traffic events tracked

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
- [x] no synthetic value presented as authoritative metric
- [x] each key module shows data source/provenance

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
- [x] at least one weekly re-engagement mechanic shipped
- [x] “what changed since last visit” section on profile

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
- [x] no false negative profile state during fetch
- [x] mobile cards include enough comparison signal to rank users meaningfully

## Checklist

- [x] VEL-006 fixed
- [x] VEL-007 fixed
- [x] VEL-008 fixed
- [x] VEL-009 fixed
- [x] VEL-010 fixed
- [x] desktop + mobile UX QA complete

## Dependencies / Requests To Other Teams

- Backend/Data for trusted metrics source/provenance flags.
- Security/QA for instrumentation and regression checks.

## Work Log

Date: 2026-03-02  
Engineer: Product/UX QA closeout  
Tasks touched: VEL-006, VEL-007, VEL-008, VEL-009, VEL-010  
What changed: Completed desktop + mobile QA pass across post-scan conversion lane, share/challenge/invite visibility, trust/provenance treatment, return-loop modules, and loading/comparison clarity. Implemented a targeted client fix in `apps/velocity-mvp/src/client/App.tsx` so mobile leaderboard cards now show explicit loading and empty states (previously blank while artifact was loading or absent).  
Validation: `npm run lint -- src/client/App.tsx src/client/styles.css` (pass with non-blocking existing warnings in `src/worker/env.d.ts` and CSS-file ignore notice), `npm run typecheck` (pass), `npm run build` (pass).  
Open questions: None. Backend payload enrichments were delivered on 2026-03-02; modules remain explicitly unavailable only where per-profile authoritative history data is not yet present.  

Date: 2026-02-28  
Engineer: Hegel  
Tasks touched: VEL-006, VEL-007, VEL-008, VEL-009, VEL-010  
What changed: Added post-scan conversion lane (claim/sign-in, ranking impact preview, compare target), made share/challenge/invite first-class in home/profile/leaderboard rows, removed synthetic trend/heatmap/insight fallbacks in favor of explicit unavailable states with provenance, added weekly streak + “what changed since last visit” profile modules, fixed profile loading false-negative and expanded mobile cards with rank-comparison signals.  
Validation: `npm run lint -- src/client/App.tsx` (pass), `npm run build` (pass).  
Open questions: Backend/Data follow-up needed to supply authoritative trend/heatmap/insight payloads and explicit provenance fields so unavailable modules can become fully populated.

## Notes To Future Contributors

Use this section for copy decisions, design rationale, and deferred UX explorations.
