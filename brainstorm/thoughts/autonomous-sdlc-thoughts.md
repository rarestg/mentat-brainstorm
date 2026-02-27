## What protocols must be established before SDLC can be “autonomized”?

In [this](https://ona.com/stories/industrializing-software-development?utm_source=background-agents&utm_medium=microsite&utm_campaign=background-agent-manual) article, the co-founder of Ona mentions some parts of the SDLC: *planning, coordination, execution, verification, integration, and release*.

Let’s think about the typical hobby project on GitHub.

Does it go through these stages?

No. And that is exactly why they are (were) so fun!

For a GitHub hobby project (especially a solo one), the pipeline looks different:

- **Planning & Coordination:** Replaced by "I had this idea in the shower." No Jira tickets or sprint planning.
- **Execution:** This is where 90% of the time is (was) spent.
- **Verification:** Running the code locally to see if it crashes. Very rarely are there extensive unit or integration tests.
- **Integration & Release:** Pushing directly to `main` .

Hobby projects are the exact equivalent of the 19th-century machinist: you are shaping every screw by hand. 

It’s highly creative, deeply personal, and completely unscalable. 

The "factory" SDLC kicks in when you add a second, third, or fiftieth developer to the mix, which introduces the need for coordination, review queues, and strict verification.

### The "Autonomization" Checklist

To take a project (whether a hobby repo or a corporate codebase) and prep it so AI background agents could reliably take over the "execution" phase without everything 🔥 catching on fire 🔥 , you have to build the factory floor first.

Since AI creates an "inventory bottleneck" if the rest of the system isn't ready, here are the protocols that must be in place:

**1. Automated Verification System (CI/CD)**

- *Why:* If an AI agent generates 10,000 lines of code in a minute, a human cannot manually review it.
- *What you need:* A suite of unit, integration, and end-to-end tests that run automatically on every pull request. If the tests pass, you know the code is fundamentally safe. Without this, AI agents will just generate a massive pile of broken "inventory."

**2. Highly Structured Intent (Issue Tracking)**

- *Why:* AI is terrible at deciding *what* to build or what the trade-offs should be. It needs explicit direction.
- *What you need:* A disciplined way of writing issues. Instead of "Fix the login bug," the project needs structured tickets with clear acceptance criteria, steps to reproduce, and defined scope. The human becomes the "specifier of intent."

**3. Deterministic, Reproducible Environments**

- *Why:* Agents cannot easily troubleshoot "it works on my machine" issues. They need a sandbox where the code is guaranteed to run the exact same way every time.
- *What you need:* Containerization (like Docker) or standardized dev environments (like DevContainers). The agent needs to be able to spin up the environment, run the code, and read the console errors autonomously.

**4. Formatting and Linting Rules**

- *Why:* You don't want AI agents arguing with humans (or other agents) over syntax styles, or breaking builds due to minor typos.
- *What you need:* Aggressive, automated linters and formatters (e.g., Prettier, Ruff, ESLint) that auto-format code on save or commit.

**5. Explicitly Documented Constraints**

- *Why:* An AI agent will solve a problem using the most mathematically obvious path, which might violate your project's specific architecture.
- *What you need:* A robust `CONTRIBUTING.md`, architectural guidelines, or system prompts that explicitly tell the agent: "We use React Server Components here, do not use client-side state for this," or "Never import from this legacy module."

To "autonomize" a project, you have to stop treating the codebase as a canvas and start treating it as a machine. You have to build the *jigs and constraints* (protocols!) so that when the AI agent is turned on, it can build correctly, and towards your intention.

---

Potential names for these things:

- Guardrails
- Protocols

---

Blueprint idea for an **"AI-Readiness Repo Scanner."** 

### The Architecture

- **The Orchestrator:** Takes a repo URL, clones it, dispatches the specialized agents, aggregates their findings, and calculates the final "AI-Readiness Score" (0-100%).
- **The Output:** A dashboard showing the overall percentage, a Red/Yellow/Green status for each category, and a prioritized checklist of missing items.

### The Specialized Agent Team

**1. The CI/CD Scout (Verification)**

- **What it scans:** `.github/workflows`, `.gitlab-ci.yml`, `package.json` test scripts, Makefile.
- **What it looks for:** Are there automated tests? Do they run automatically on Pull Requests? Is code coverage tracked?
- **100% Ready looks like:** Tests exist and are automatically enforced on every commit.

**2. The Environment Inspector (Reproducibility)**

- **What it scans:** `Dockerfile`, `.devcontainer`, `docker-compose.yml`, lockfiles (`package-lock.json`, `poetry.lock`).
- **What it looks for:** Can an agent spin up this exact environment deterministically without human help?
- **100% Ready looks like:** Fully containerized setup or explicit DevContainer config.

**3. The Style Warden (Linting & Formatting)**

- **What it scans:** `.eslintrc`, `.prettierrc`, `pyproject.toml` (Ruff/Black), `.editorconfig`, `.pre-commit-config.yaml`.
- **What it looks for:** Are syntax and formatting rules strictly codified so AI doesn't waste time arguing over style or breaking builds with bad formatting?
- **100% Ready looks like:** Aggressive, auto-fixing linters and formatters are present and enforced via pre-commit hooks or CI.

**4. The Context Miner (Docs & Constraints)**

- **What it scans:** `README.md`, `CONTRIBUTING.md`, `/docs` folders, `.github/ISSUE_TEMPLATE`, PR templates.
- **What it looks for:** Are the "rules of the road" written down? Is the architecture explained? Do issue templates force structured input?
- **100% Ready looks like:** A robust `CONTRIBUTING.md` with explicit architectural boundaries and structured templates for bugs/features.

### The Final Output (Example)

- **Overall AI-Readiness:** 62%
- 🟢 **Style/Linting:** 100% (Prettier/ESLint found)
- 🟡 **CI/CD:** 50% (GitHub Actions found, but no test scripts detected)
- 🔴 **Environment:** 0% (No Dockerfile or DevContainer)
- 🟢 **Context:** 100% (Robust CONTRIBUTING.md found)
- **Action Plan:** "To reach 80% readiness, add a `Dockerfile` so background agents can reliably run your code."