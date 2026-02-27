# The Autonomous Readiness Framework

How to take any codebase — from hobby project to enterprise monorepo — and prepare it for AI-driven autonomous software development.

---

## Part 1: The Industrial Shift

### Software is no longer craft. It is production.

The core thesis, articulated clearly by Christian Weichel (co-founder of Ona, formerly Gitpod), is that software development has crossed an inflection point. For most of its history, writing software felt like a creative act — composing music, shaping clay. That feeling was real. But software development is no longer defined by that act.

Software development is a **multi-stage production system** that spans planning, coordination, execution, verification, integration, and release. Code is one station on a factory floor. An important one, but no longer the bottleneck.

The analogy is Henry Maudslay's precision screw-cutting lathe. Before Maudslay, every part was shaped by hand. Accuracy lived in the craftsman's fingers. After Maudslay, accuracy moved into the tooling itself. Parts became repeatable. Throughput exploded. Craft didn't disappear — it moved. Skilled workers stopped shaping every part and started designing machines, calibrating tools, and inspecting output.

AI is doing the same thing to code. Code generation is becoming automated. As that station accelerates, throughput shifts to everything else: review, testing, integration, deployment. **Craft no longer sets the pace of production. It sets the boundaries of correctness and trust.**

### The inventory problem

When one station on a factory floor speeds up by an order of magnitude and the rest don't, inventory piles up.

In software, inventory is work-in-progress: pull requests waiting for review, unmerged branches, unreleased features, untested changes. Most teams recognize this immediately. It shows up as growing backlogs, review queues that never clear, flaky CI, and releases that keep slipping.

Every manufacturing system learns this lesson the hard way. **Local optimization makes global throughput worse.** An AI agent that generates code 10x faster is worthless if the review, test, and deploy pipeline can't absorb it.

The companies that win next will not write the most code. They will move ideas through the system with the least friction.

### The human role shifts

As code becomes abundant, humans don't disappear — their leverage point moves. AI is good at searching solution spaces. It is not good at deciding which problems matter, what trade-offs are acceptable, or when something is correct enough to ship.

The human role shifts from **producing artifacts** to **specifying intent, defining constraints, and validating outcomes**. Less construction. More judgment. Knowing what *not* to build becomes the highest-value skill.

---

## Part 2: The Hobby Project Problem

### Why side projects are the perfect lens

Consider the typical hobby project on GitHub — especially a solo one. Does it go through the full SDLC?

No. And that is exactly why they are (were) so fun.

For a hobby project, the pipeline looks like this:

- **Planning & Coordination:** "I had this idea in the shower." No Jira tickets. No sprint planning.
- **Execution:** 90% of the time is spent here.
- **Verification:** Running the code locally to see if it crashes. Maybe a handful of tests.
- **Integration & Release:** Pushing directly to `main`.

Hobby projects are the exact equivalent of the 19th-century machinist: you are shaping every screw by hand. Highly creative, deeply personal, and completely unscalable.

The "factory" SDLC kicks in when you add a second, third, or fiftieth developer — which introduces the need for coordination, review queues, and strict verification. But here's the key insight: **AI agents are those additional developers.** Even on a solo project, the moment you introduce an autonomous agent, you need the factory floor.

### The gap nobody is addressing

Companies like Ona, Stripe, and Ramp have solved this for themselves — but they had years of infrastructure investment and dedicated platform teams. Their cloud development environments, standardized toolchains, and CI pipelines predated the AI agent era.

The vast majority of codebases — open source projects, startups, small teams, solo developers — have none of this. They're being told "AI will 10x your productivity" while sitting on a codebase that can't even be run deterministically by a second human, let alone an autonomous agent.

**The diagnostic is missing.** Nobody is telling these teams *specifically what's broken* and *exactly what to fix first*. That's what Mentat does.

---

## Part 3: The Six Protocols

To "autonomize" a project, you have to stop treating the codebase as a canvas and start treating it as a machine. You have to build the jigs and constraints — **protocols** — so that when an AI agent is turned on, it can build correctly, and towards your intention.

There are six protocols. Each is a prerequisite for reliable autonomous operation.

---

### Protocol 1: Automated Verification (CI/CD + Tests)

**The question:** If an agent generates a PR, can the system automatically determine whether it's safe to merge?

**Why it matters:** This is the single most important protocol. Tests are the feedback loop that closes the autonomous cycle. Without them, an agent generates code but never knows if it worked. You get a massive pile of broken "inventory" — PRs that look right but haven't been validated.

**What the scanner checks:**
- `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `Makefile`
- `package.json` test scripts, `pytest.ini`, `cargo test`, etc.
- Whether tests run automatically on pull requests
- Whether code coverage is tracked

**The maturity ladder:**
- **0%** — No CI, no tests.
- **25%** — CI exists but no test scripts detected.
- **50%** — Tests exist and run in CI, but not enforced on PRs.
- **75%** — Tests run and are required to pass before merge.
- **100%** — Comprehensive test suite with coverage tracking, enforced on every PR, with integration/E2E tests alongside unit tests.

**Suggested weight: 35%** of overall score.

---

### Protocol 2: Reproducible Environments

**The question:** Can an agent spin up this exact environment deterministically, without human help?

**Why it matters:** Agents cannot troubleshoot "it works on my machine" problems. They need a sandbox where the code runs the exact same way every time. As Ona's team puts it: "The gap between 'generates a diff' and 'opens a merge-ready PR' is the development environment."

This doesn't mean every project needs full containerization on day one. There's a progression:

**The maturity ladder:**
- **Tier 0 (0%)** — Nothing. `git clone` and pray.
- **Tier 1 (25%)** — A `package.json` / `pyproject.toml` / `Cargo.toml` with working scripts (dev, build, test). An agent *can* work with this.
- **Tier 2 (50%)** — Lockfiles + version pinning (`.nvmrc`, `.python-version`, `rust-toolchain.toml`). Reproducible locally.
- **Tier 3 (75%)** — Docker / DevContainer. Reproducible anywhere.
- **Tier 4 (100%)** — Self-assembling cloud environments (Ona-style `automations.yaml`, or equivalent). Zero manual steps.

**What the scanner checks:**
- `Dockerfile`, `.devcontainer/`, `docker-compose.yml`
- Lockfiles (`package-lock.json`, `yarn.lock`, `poetry.lock`, `Cargo.lock`)
- Version pinning files (`.nvmrc`, `.python-version`, `.tool-versions`, `rust-toolchain.toml`)
- Build/run scripts that work without manual setup

**Suggested weight: 25%** of overall score.

---

### Protocol 3: Agent Instructions & Constraints

**The question:** Does the repo contain explicit, machine-readable instructions that tell an AI agent how to behave within this specific project?

**Why it matters:** An AI agent will solve a problem using the most mathematically obvious path, which might violate your project's specific architecture, conventions, or boundaries. Without explicit constraints, agents produce *plausible* code that doesn't fit *your* system.

This is distinct from human-facing docs like `CONTRIBUTING.md`. Agent instructions are machine-readable directives: "We use React Server Components, do not use client-side state for X," or "Never import from the legacy module," or "Always run `make lint` before committing."

This is also the **easiest win** for any repo. A well-written `CLAUDE.md` or `AGENTS.md` takes 30 minutes to create and immediately improves every agent interaction.

**What the scanner checks:**
- `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`
- Architectural decision records (`/docs/adr/`, `/docs/architecture/`)
- Whether these files contain actionable directives vs. just prose

**The maturity ladder:**
- **0%** — No agent-specific instructions.
- **50%** — Basic `CLAUDE.md` or equivalent exists with project conventions.
- **100%** — Comprehensive agent instructions covering architecture boundaries, forbidden patterns, testing requirements, and workflow directives. Ideally scoped per-directory for larger repos.

**Suggested weight: 20%** of overall score.

---

### Protocol 4: Linting & Formatting

**The question:** Are syntax and style rules strictly codified so agents don't waste cycles on formatting or break builds with trivial style violations?

**Why it matters:** Without automated formatting, agents will argue with humans (or other agents) over semicolons, tabs vs. spaces, and import ordering. Worse, inconsistent style makes diffs noisy and reviews harder. This is the lowest-friction protocol to implement and has outsized impact on reducing review friction.

**What the scanner checks:**
- `.eslintrc`, `.prettierrc`, `biome.json`, `.editorconfig`
- `pyproject.toml` (Ruff/Black config), `.flake8`, `setup.cfg`
- `.pre-commit-config.yaml`, Husky hooks
- Whether formatters are enforced in CI (not just configured locally)

**The maturity ladder:**
- **0%** — No linter or formatter config.
- **50%** — Config files exist but not enforced automatically.
- **100%** — Aggressive, auto-fixing linters/formatters enforced via pre-commit hooks or CI.

**Suggested weight: 10%** of overall score.

---

### Protocol 5: Structured Intent (Issue Tracking & Templates)

**The question:** When an agent picks up a task, is there enough structured context for it to act without human clarification?

**Why it matters:** AI agents are terrible at deciding *what* to build or what the trade-offs should be. They need explicit direction. "Fix the login bug" is not enough. Structured tickets with acceptance criteria, repro steps, and defined scope are the difference between an agent that produces useful PRs and one that produces plausible garbage.

**What the scanner checks (static):**
- `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`
- `CONTRIBUTING.md` (does it exist, does it contain structured guidance?)
- `/docs` folder presence and structure

**What the scanner recommends (advisory):**
- Whether issue templates enforce structured fields (repro steps, acceptance criteria)
- Whether PR templates include a checklist
- Whether there's a documented process for how work flows from idea to code

**The maturity ladder:**
- **0%** — No templates, no CONTRIBUTING.md, no docs.
- **50%** — Templates and docs exist.
- **100%** — Structured templates with required fields, robust CONTRIBUTING.md with architectural guidance, clear workflow documentation.

**Suggested weight: 5%** of overall score.

---

### Protocol 6: Observability & Feedback Loops

**The question:** Once code is deployed, can the system detect whether it's working — and can an agent act on that signal autonomously?

**Why it matters:** This is the protocol that closes the loop. Without it, the autonomous cycle is open-ended: an agent ships code but never knows if it actually works in production. Protocols 1-5 get code *to* production safely. Protocol 6 tells you what happens *after*.

The companies furthest ahead on autonomous development — Stripe, Ramp, Ona — all describe the same pattern: agents triggered by Sentry errors, monitoring alerts, or customer-reported bugs that autonomously triage and fix issues. This only works if the codebase has observability wired up: error tracking, structured logging, health checks, and alerting.

This is the difference between **autonomous execution** (agent writes and ships code) and **autonomous correction** (agent detects problems and fixes them without human initiation).

**What the scanner checks:**
- Sentry DSN / error tracking SDK integration (`@sentry/node`, `sentry-sdk`, etc.)
- Structured logging setup (not just `console.log` / `print`)
- OpenTelemetry / tracing instrumentation
- Health check endpoints
- Alerting/monitoring config (PagerDuty, Rootly, Datadog, etc.)
- Whether error tracking is wired to issue creation (Sentry → GitHub Issues, etc.)

**The maturity ladder:**
- **0%** — No observability. `console.log` only.
- **25%** — Basic error tracking (Sentry or equivalent) is installed.
- **50%** — Structured logging + error tracking + health checks.
- **75%** — Full observability stack (tracing, metrics, alerting) with dashboards.
- **100%** — Observability is wired into automated feedback loops: errors auto-create issues, agents can query error data, alerts trigger autonomous triage.

**Suggested weight: 5%** of overall score.

---

## Part 4: The Scanner Architecture

### Overview

Mentat is an AI-readiness audit tool that any developer can run against their codebase to get an immediate, actionable readiness score. It scans the repo, evaluates each of the six protocols, and produces a scorecard with a prioritized action plan.

The design principle: **scan what's in the repo, recommend what should be.** The scanner detects static signals (config files, project structure, CI definitions). The recommendations layer provides advice that goes beyond what files can tell you.

### The Orchestrator

- Takes a repo (local path or URL)
- Dispatches six specialized scanning agents in parallel
- Aggregates findings into a weighted score (0-100%)
- Outputs a scorecard with per-protocol breakdown and a prioritized action plan

### The Six Scouts

| Scout | Scans | Signals |
|---|---|---|
| **Verification Scout** | CI config, test scripts, coverage config | `.github/workflows/`, `jest.config`, `pytest.ini`, `Makefile` test targets |
| **Environment Scout** | Container config, lockfiles, version pins | `Dockerfile`, `.devcontainer/`, lockfiles, `.nvmrc`, `.tool-versions` |
| **Constraints Scout** | Agent instructions, architecture docs | `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, ADRs |
| **Style Scout** | Linter/formatter config, pre-commit hooks | `.eslintrc`, `.prettierrc`, `biome.json`, `.pre-commit-config.yaml` |
| **Intent Scout** | Issue templates, PR templates, docs | `.github/ISSUE_TEMPLATE/`, `CONTRIBUTING.md`, `/docs` |
| **Observability Scout** | Error tracking, logging, monitoring config | Sentry SDK imports, OTel config, health endpoints, alerting config |

### The Output

```
============================================
  MENTAT — AI Readiness Score: 62/100
============================================

  Verification (CI/CD + Tests)     ██████████░░░░  50%  🟡
  Reproducible Environments        ██████░░░░░░░░  25%  🟡
  Agent Instructions               ████████████████ 100% 🟢
  Linting & Formatting             ████████████████ 100% 🟢
  Structured Intent                ██████░░░░░░░░  50%  🟡
  Observability & Feedback Loops   ░░░░░░░░░░░░░░   0%  🔴

--------------------------------------------
  TOP 3 ACTIONS TO REACH 80%:
--------------------------------------------
  1. Add test scripts and enforce them in CI (+18 pts)
  2. Add a Dockerfile or devcontainer.json (+12 pts)
  3. Install Sentry or equivalent error tracking (+3 pts)
============================================
```

### Distribution

- **CLI:** `npx mentat scan` — the core experience. Works on any repo, immediate value.
- **Skill:** Runs inside any coding agent (Claude Code, Codex, OpenCode). Publishable to skills.sh.
- **Badge:** A README badge showing the score — the viral hook for open source.
- **Website:** A public dashboard where teams can publish and compare scores.

---

## Part 5: The Leverage Insight

Ona is building the *infrastructure* — cloud environments, VMs, runners, guardrails. Mentat is building the *diagnostic* that tells people they need that infrastructure.

These are complementary, not competitive. Mentat is the neutral, vendor-agnostic audit that says "your environment score is 25% — here's why, and here are your options." Those options might be Ona, or Docker, or DevContainers, or just a better Dockerfile. The neutrality is what makes it trustworthy and viral.

The scoring weights reflect real-world leverage:

| Protocol | Weight | Rationale |
|---|---|---|
| Verification (CI + Tests) | 35% | The feedback loop that makes everything else possible. Without it, agents produce unvalidated inventory. |
| Reproducible Environments | 25% | The foundation that lets agents run code at all. |
| Agent Instructions | 20% | The easiest win with the highest immediate impact on agent output quality. |
| Linting & Formatting | 10% | Low friction to implement, reduces noise in reviews. |
| Structured Intent | 5% | Important but hard to scan meaningfully — mostly advisory. |
| Observability | 5% | Closes the loop but is an advanced concern for most repos. |

The weights are opinionated by design. A repo with a solid test suite and no Docker (score: ~60%) is far more "agent-ready" than a repo with Docker and no tests (score: ~25%). Tests close the feedback loop. Everything else is support structure.

---

*This document synthesizes insights from Ona's engineering blog (Christian Weichel, Johannes Landgraf), internal brainstorming from the Mentat project, and analysis of how leading companies (Stripe, Ramp, Ona) have built their autonomous development infrastructure.*
