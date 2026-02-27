# Mentat: The Autonomous Readiness Framework

### Executive Summary

AI is accelerating code generation, shifting the engineering bottleneck from *writing code* to *verifying and integrating code*. Without automated infrastructure, AI agents just generate broken "inventory"—pull requests that humans still have to manually test, format, and review.

While enterprise teams (Ona, Stripe) have built the "factory floor" required to support autonomous agents, the vast majority of codebases are still artisanal. **Mentat is the missing diagnostic tool.** It is a vendor-agnostic scanner that audits any codebase, scores its AI-readiness, and tells developers exactly what infrastructure to build so agents can operate safely and autonomously.

---

### The Six Protocols of AI-Readiness

To safely unleash agents on a codebase, it must be treated as a machine with strict constraints. Mentat evaluates repos against six weighted protocols:

#### 1. Automated Verification (Weight: 35%)

* **The Goal:** An agent must know if the code it just wrote actually works. Without tests, the autonomous loop is broken.
* **The Scan:** Detects CI/CD workflows (`.github/workflows`, `.gitlab-ci.yml`), test scripts (`package.json`, `pytest.ini`), and verifies if tests are strictly enforced on PRs.
* **Maturity:** From 0% (No tests) to 100% (Enforced CI + E2E tests + Coverage tracking).

#### 2. Reproducible Environments (Weight: 25%)

* **The Goal:** Agents cannot troubleshoot "it works on my machine." They require a deterministic sandbox to run and test code.
* **The Scan:** Detects `Dockerfile`, `.devcontainer`, `docker-compose.yml`, lockfiles, and strict version pins (`.nvmrc`, `rust-toolchain.toml`).
* **Maturity:** From 0% (`git clone` and pray) to 100% (Self-assembling cloud dev environments).

#### 3. Agent Instructions & Constraints (Weight: 20%)

* **The Goal:** Prevent agents from writing mathematically plausible code that violates your specific architecture.
* **The Scan:** Checks for machine-readable directives like `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, and Architectural Decision Records (ADRs).
* **Maturity:** From 0% (No instructions) to 100% (Robust, directory-scoped agent rules and boundaries).

#### 4. Linting & Formatting (Weight: 10%)

* **The Goal:** Eliminate AI-generated style violations and noisy diffs. Agents shouldn't waste cycles arguing over syntax.
* **The Scan:** Looks for aggressive, auto-fixing configs (`.eslintrc`, `.prettierrc`, `biome.json`) and `pre-commit` hooks.

#### 5. Structured Intent (Weight: 5%)

* **The Goal:** Ensure tasks have enough structured context for an agent to act without asking a human for clarification.
* **The Scan:** Detects `.github/ISSUE_TEMPLATE`, PR templates with checklists, and `CONTRIBUTING.md`.

#### 6. Observability & Feedback Loops (Weight: 5%)

* **The Goal:** Enable *autonomous correction*. Agents should be able to detect a production error, triage it, and push a fix without human initiation.
* **The Scan:** Looks for error tracking SDKs (Sentry), OpenTelemetry, structured logging, and health endpoints.

---

### System Architecture

**The Orchestrator:**
Takes a repo URL or local path, parallel-dispatches six "Scout" agents to read configuration files, aggregates the findings into a weighted score (0-100%), and outputs a prioritized action plan.

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

### Distribution & Strategy

* **The Wedge:** A CLI tool (`npx mentat scan`) for instant local feedback, and a dynamic README Badge (e.g., `AI-Ready: 85%`) to drive viral adoption in open-source.
* **The Ecosystem Play:** Mentat provides the *diagnostic* (telling teams their environment score is 25%); platforms like Ona, Docker, and GitHub provide the *infrastructure* to fix it. Mentat's value lies in remaining a strict, neutral, vendor-agnostic auditor.
