# Mentat: The Autonomous Readiness Framework

### Executive Summary

AI is accelerating code generation, shifting the engineering bottleneck from *writing code* to *verifying and integrating code*. Without automated infrastructure, AI agents just generate broken "inventory"—pull requests that humans still have to manually test, format, and review.

While enterprise teams (Ona, Stripe) have built the "factory floor" required to support autonomous agents, the vast majority of codebases are still artisanal. A solo dev pushing straight to `main` with no CI has an AI-readiness score of ~10%. A startup with basic GitHub Actions but no containerization sits around ~40%. **Mentat is the missing diagnostic tool.** It is a vendor-agnostic scanner that audits any codebase — from hobby project to enterprise monorepo — scores its AI-readiness, and tells developers exactly what to fix first so agents can operate safely and autonomously.

---

### The Six Protocols of AI-Readiness

To safely unleash agents on a codebase, it must be treated as a machine with strict constraints. Mentat evaluates repos against six weighted protocols:

#### 1. Automated Verification (Weight: 35%)

* **The Goal:** An agent must know if the code it just wrote actually works. Without tests, the autonomous loop is broken.
* **Why 35%:** Tests are the only protocol that closes the autonomous feedback loop. Every other protocol supports agent work; this one *validates* it. A repo with great tests and nothing else is more agent-ready than a repo with everything else and no tests.
* **The Scan:** Detects CI/CD workflows (`.github/workflows`, `.gitlab-ci.yml`), test scripts (`package.json`, `pytest.ini`), and verifies if tests are strictly enforced on PRs.
* **Maturity:** From 0% (No tests) to 100% (Enforced CI + E2E tests + Coverage tracking).

#### 2. Reproducible Environments (Weight: 25%)

* **The Goal:** Agents cannot troubleshoot "it works on my machine." They require a deterministic sandbox to run and test code.
* **Why 25%:** This is the foundation that lets agents run code at all. Without it, even perfect tests are useless because the agent can't execute them reliably.
* **The Scan:** Detects `Dockerfile`, `.devcontainer`, `docker-compose.yml`, lockfiles, and strict version pins (`.nvmrc`, `rust-toolchain.toml`).
* **Maturity:** From 0% (`git clone` and pray) to 100% (Self-assembling cloud dev environments).

#### 3. Agent Instructions & Constraints (Weight: 20%)

* **The Goal:** Prevent agents from writing mathematically plausible code that violates your specific architecture.
* **Why 20%:** This is the easiest win with the highest immediate impact on agent output quality. A well-written `CLAUDE.md` takes 30 minutes to create and immediately improves every agent interaction.
* **The Scan:** Checks for machine-readable directives like `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, and Architectural Decision Records (ADRs).
* **Maturity:** From 0% (No instructions) to 100% (Robust, directory-scoped agent rules and boundaries).

#### 4. Linting & Formatting (Weight: 10%)

* **The Goal:** Eliminate AI-generated style violations and noisy diffs. Agents shouldn't waste cycles arguing over syntax.
* **Why 10%:** Low friction to implement, outsized impact on reducing review noise. Prevents the dumbest class of broken builds.
* **The Scan:** Looks for aggressive, auto-fixing configs (`.eslintrc`, `.prettierrc`, `biome.json`) and `pre-commit` hooks.

#### 5. Structured Intent (Weight: 5%)

* **The Goal:** Ensure tasks have enough structured context for an agent to act without asking a human for clarification.
* **Why 5%:** Important but hard to scan meaningfully — template existence is a weak proxy for template quality. Mostly advisory.
* **The Scan:** Detects `.github/ISSUE_TEMPLATE`, PR templates with checklists, and `CONTRIBUTING.md`.

#### 6. Observability & Feedback Loops (Weight: 5%)

* **The Goal:** Enable *autonomous correction*. Agents should be able to detect a production error, triage it, and push a fix without human initiation.
* **Why 5%:** This is what separates autonomous *execution* from autonomous *correction*. Advanced concern for most repos, but the protocol that unlocks the full loop.
* **The Scan:** Looks for error tracking SDKs (Sentry), OpenTelemetry, structured logging, and health endpoints.

---

### System Architecture

**The Orchestrator:**
Takes a repo URL or local path, parallel-dispatches six specialized Scout agents, aggregates findings into a weighted score (0-100%), and outputs a ranked action plan.

**The Scout Team:**

| Scout | What It Scans | Key Signals |
|---|---|---|
| **Verification Scout** | CI config, test scripts, coverage | `.github/workflows/`, `jest.config`, `pytest.ini`, `Makefile` test targets |
| **Environment Scout** | Container config, lockfiles, version pins | `Dockerfile`, `.devcontainer/`, lockfiles, `.nvmrc`, `.tool-versions` |
| **Constraints Scout** | Agent instructions, architecture docs | `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, ADRs |
| **Style Scout** | Linter/formatter config, pre-commit hooks | `.eslintrc`, `.prettierrc`, `biome.json`, `.pre-commit-config.yaml` |
| **Intent Scout** | Issue templates, PR templates, docs | `.github/ISSUE_TEMPLATE/`, `CONTRIBUTING.md`, `/docs` |
| **Observability Scout** | Error tracking, logging, monitoring | Sentry SDK imports, OTel config, health endpoints, alerting config |

**The output isn't just a score — it's a ranked action plan.** Each missing item is assigned a point value, and the top actions are sorted by impact so the developer knows exactly what to fix first and how much their score improves per fix.

**Example CLI Output (`npx mentat scan`):**

```text
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

---

### Distribution & Strategy

* **The Wedge:** A CLI tool (`npx mentat scan`) for instant local feedback, and a dynamic README Badge (e.g., `AI-Ready: 85%`) to drive viral adoption in open-source.
* **The Ecosystem Play:** Mentat provides the *diagnostic* (telling teams their environment score is 25%); platforms like Ona, Docker, and GitHub provide the *infrastructure* to fix it. Mentat's value lies in remaining a strict, neutral, vendor-agnostic auditor.
