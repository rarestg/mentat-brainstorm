Here is a tightened, product-ready version of your spec. I stripped out the repetitive justifications, merged the gamification elements into a cleaner structure, and made the "anti-gaming" mechanics a core product feature rather than an afterthought.

---

# Mentat Velocity: Strava for AI-Augmented Developers

### The Concept

Developers are using AI agents to push 50–100+ commits a day, but they have nowhere to flex this exponential output besides posting messy GitHub graphs on Twitter. **Mentat Velocity** is a public, competitive leaderboard that tracks, ranks, and visualizes developer throughput.

### The Growth Flywheel

Velocity is the viral engine that drives adoption for Mentat’s core product (the Scanner).

* **Mentat Scan (Defensive):** "How ready is your repo for AI?" (The Infrastructure)
* **Mentat Velocity (Offensive):** "How fast are you shipping?" (The Output)

**The Loop:** A dev sees a competitor's Top 1% Velocity profile 👉 They check their own and see they are in the 30th percentile 👉 They run *Mentat Scan* to figure out why 👉 The scan tells them to add CI/CD and Agent Instructions to unblock their agents 👉 They fix the repo, their velocity spikes, and they share their new Top 1% score.

---

### 1. Core Metrics (The Leaderboard)

Raw commit counts reward noise (like single-line typo fixes). To make the leaderboard credible, we track metrics that prove actual value shipped:

* **Equivalent Engineering Hours (The Hero Metric):** Analyzes commit frequency, diff sizes, and cycle times, then back-calculates it against a human baseline.
* *Example:* "420 equivalent engineering hours this month — from 1 contributor." (Perfect for founder investor updates).


* **Velocity Acceleration (The AI Signal):** Tracks the *delta* in output over time.
* *Example:* "Throughput increased 640% since January." This visually pinpoints the exact moment a developer switched from Copilot to an Agent Swarm.


* **CI-Passed PRs Merged:** We do not count raw commits on the primary leaderboard. We only count PRs merged to `main` *that passed CI*. This enforces a "Definition of Done" and filters out AI-generated broken code.
* **Active Coding Hours:** Identifies agent usage by showing commits spanning 18–24 hours a day.

### 2. Gamification: The "Crowns" System

Global leaderboards lose their stickiness quickly. We use auto-detected repo data (`package.json`, `pyproject.toml`) and GitHub profile locations to generate hyper-niche, highly competitive titles.

* **Stack Crowns:** "King of Rust", "Top Vercel AI SDK Dev"
* **Regional Crowns:** "Fastest Solo Founder in Southeast Asia"
* **Combo Crowns:** "#1 Next.js Dev in London"

### 3. The Developer Profile

Every user gets a public URL (e.g., `mentat.dev/v/elvis`). The profile serves as their AI-era resume. It displays:

* Global Percentile Rank (e.g., "Top 1% Worldwide")
* The Hero Metrics (Equivalent Hours, PRs Merged)
* A 6-month Velocity Trend Graph
* Earned Crowns
* **The Kicker:** A list of their top repos, displaying both their PR throughput *and* their **Mentat Scan AI-Ready Score**. This publicly correlates high infrastructure readiness with high output.

### 4. Trust & Anti-Gaming

People will try to game this. We lean into it, but keep the data clean:

* **"Verified Agent Output" Badge:** Repos that score >80% on Mentat Scan get a verified checkmark on the leaderboard. It proves their high velocity is backed by real testing infrastructure, not just pushing raw slop to `main`.
* **Anomaly Visualizations:** If someone pushes 500 single-line commits in an hour, we don't ban them—we just flag the anomaly visually on their graph so the community can see the pattern.

### 5. Go-To-Market & Shareables

We need artifacts that developers naturally want to post on Twitter/LinkedIn:

* **The Artifact:** Auto-generated, beautifully designed stat cards (like Spotify Wrapped) showing Monthly Equivalent Hours and new Crowns.
* **The README Badge:** Markdown badges showing live percentiles (`![Mentat Velocity](.../badge)`).
* **Head-to-Head Challenges:** "Compare your throughput against @username" links to drive direct peer-to-peer signups.

---

╭─────────────────────────────────────────────────────────────────╮
│  @elvischidera  //  MENTAT VELOCITY PROFILE                     │
│  🏆 Global Top 1%         🤖 Operating Stack: Agent Swarm       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⚡ THE OUTPUT (Last 30 Days)                                   │
│  Equivalent Eng Hours:   2,400 hrs   [========> ] 99th %tile    │
│  Verified PRs Merged:    187         [========> ] 99th %tile    │
│  Throughput Delta:       +640%       (Since Jan 2026)           │
│  CI Pass Rate:           94%         (High signal-to-noise)     │
│                                                                 │
│  📈 THE INFLECTION POINT (6-Month Trend)                        │
│   200 │                                        ╭─● 187 PRs/mo   │
│       │                                    ╭───╯                │
│   100 │                                   ╭╯                    │
│       │        Copilot         Swarm ─>  ╭╯                     │
│     0 ╰──●──────●──────●──────●──────●───╯                      │
│        Sep    Oct    Nov    Dec    Jan    Feb                   │
│                                                                 │
│  🕰️ 24/7 THROUGHPUT HEATMAP                                     │
│   Human Core Hrs: ████████............... (8 hours active)      │
│   Agent Off-Hrs:  ███████████████████████ (22 hours active)     │
│   ↳ 💡 Your agents merged 62 PRs while you were sleeping.       │
│                                                                 │
│  👑 ACTIVE CROWNS                                               │
│   [#1] TypeScript — Worldwide                                   │
│   [#1] OpenClaw Swarm Architect — North America                 │
│   [#3] Solo Founder Velocity — Global                           │
│                                                                 │
│  🏭 THE FACTORY FLOOR (Top Repositories)                        │
│   medialyst/app   [AI-Ready: 91% 🟢] ── 94 PRs/mo               │
│   medialyst/sdk   [AI-Ready: 85% 🟢] ── 43 PRs/mo               │
│   ↳ 🛠️ Mentat Scan Insight: Add a `CLAUDE.md` to medialyst/sdk  │
│        to push readiness to 95% and boost PR acceptance.        │
╰─────────────────────────────────────────────────────────────────╯

---

### Phased Rollout

* **V1 (The Wedge):** GitHub OAuth, ingest public repos, calculate Equivalent Hours / PRs Merged, generate Stack Crowns (auto-detected languages), launch the Profile Page and Shareable Cards.
* **V2 (The Ecosystem):** Introduce Regional Crowns, Team Leaderboards (aggregate org velocity), and deep integration with Mentat Scan (showing AI-Ready scores directly on the profile).
* **V3 (The Enterprise):** Private company leaderboards for internal engineering teams, and correlation dashboards proving to CTOs that investing in AI-readiness directly increases throughput.