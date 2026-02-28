# Mentat Product Doctrine

Canonical product doctrine for Mentat. This document defines what Mentat is, what it is not, and how product decisions should be made as we build.

---

## 1) Purpose

Mentat exists to accelerate the transition from artisanal software delivery to autonomous, system-driven software production.

Mentat does this with two connected products:

- **Mentat Scan:** Diagnoses whether a repo can safely support autonomous agents.
- **Mentat Velocity:** Measures and visualizes AI-augmented throughput in public, competitive form.

Mentat is a **diagnostic + measurement** system, not an agent runtime vendor.

---

## 2) Core Thesis

- Software delivery is a flow system (`Plan -> Code -> Review -> Test -> Deploy`), not just a coding activity.
- AI accelerates code generation first, which shifts bottlenecks downstream into review, verification, integration, and release.
- Faster local code generation without system readiness creates inventory (WIP, PR queues, unreleased changes), not shipped value.
- The winning organizations will optimize end-to-end flow, not a single station.
- Human leverage shifts from writing artifacts to specifying intent, defining constraints, and validating outcomes.

---

## 3) Product Loop

Mentat is intentionally a closed loop:

1. **Velocity creates awareness and demand**
   Developers compete on public throughput and rankings.
2. **Scan converts demand into action**
   Teams discover why throughput is constrained and what to fix first.
3. **Improvements raise both readiness and output**
   Better infrastructure increases trusted velocity.
4. **Profiles surface correlation**
   AI-Ready score and throughput sit side-by-side, teaching the system-level lesson automatically.

If a roadmap item does not strengthen this loop, it is lower priority.

---

## 4) Product Principles

- **Vendor-agnostic by default:** Mentat audits outcomes and readiness signals, not vendor allegiance.
- **Throughput with trust:** We optimize for shipped, validated work, not raw activity.
- **Actionability over analysis:** Every scan should produce a prioritized fix list, not just a score.
- **System over station:** Features should improve end-to-end flow, not isolated local speed.
- **Low-friction adoption:** First run must deliver immediate value via CLI and simple sharing artifacts.
- **Anti-gaming by design:** Public metrics should reward durable output and visibly flag low-signal behavior.
- **Explainable scoring:** Users should understand why they got a score and how to improve it.

---

## 5) Readiness Doctrine (Mentat Scan)

Mentat Scan evaluates six protocols of AI readiness:

| Protocol | Weight | Why it matters most |
|---|---:|---|
| Automated Verification | 35% | Closes the autonomous feedback loop |
| Reproducible Environments | 25% | Enables deterministic autonomous execution |
| Agent Instructions & Constraints | 20% | Aligns agent output with architecture and policy |
| Linting & Formatting | 10% | Reduces review noise and trivial failures |
| Structured Intent | 5% | Improves task quality and autonomous clarity |
| Observability & Feedback Loops | 5% | Enables autonomous correction post-deploy |

Scoring doctrine:

- A repo with strong verification but weaker tooling can still be meaningfully ready.
- A repo with polished tooling but weak verification is not agent-ready.
- Output must include per-protocol maturity and ranked actions with point impact.

---

## 6) Velocity Doctrine (Mentat Velocity)

Mentat Velocity must measure value-like throughput, not noise.

Ranked/public metrics:

- Equivalent Engineering Hours (hero metric)
- CI-passed PRs merged to default branch
- Velocity acceleration (trend delta over time)
- Commits/day (supporting signal, never sole truth)

Supporting profile signals:

- Active coding hours
- Throughput heatmaps
- Stack/regional/combo crowns
- Operating Stack tier inference

Trust rules:

- Prefer CI-gated merged output over raw commit counts.
- Add verification badges for high-readiness repos.
- Flag anomalies visually rather than over-policing edge cases.

---

## 7) Canonical Definitions

- **Autonomous execution:** Agents can produce merge-ready code without continuous human supervision.
- **Autonomous correction:** Agents can respond to production signals, triage issues, and ship fixes.
- **Inventory:** Unvalidated or unmerged code changes that have not become shipped value.
- **Factory floor:** The full SDLC flow system, not just coding.
- **Background agent:** An asynchronously triggered agent running in isolated, reproducible cloud environments.

---

## 8) Non-Goals

- Building a proprietary coding model.
- Replacing CI/CD or source control systems.
- Acting as a single-vendor runtime lock-in layer.
- Ranking developers purely by raw commit volume.
- Treating velocity as independent from quality and readiness.

---

## 9) Decision Rubric

A feature is high-priority when it satisfies most of these:

- Improves the Scan <-> Velocity loop
- Increases trusted throughput (not vanity activity)
- Produces specific next actions users can complete
- Preserves vendor neutrality
- Improves credibility/anti-gaming
- Creates natural shareability/distribution
- Keeps first-run adoption simple

---

## 10) Success Criteria

Early product success should be tracked across both products:

- Scan adoption: repeated scan runs per repo/team
- Readiness uplift: score change over time per repo
- Action completion: % of recommended actions implemented
- Velocity credibility: share of throughput tied to CI-passed merges
- Loop conversion: users moving from Velocity profile -> Scan -> measurable score and throughput improvement

---

## 11) Canonical Positioning

- **Mentat Scan:** "How ready is your repo for AI agents?"
- **Mentat Velocity:** "How fast are you shipping?"
- **Mentat together:** "Build the factory floor, then prove the throughput."

