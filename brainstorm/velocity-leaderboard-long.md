# Mentat Velocity: The Developer Leaderboard

### A competitive, public leaderboard for developer throughput in the age of AI agents.

---

### The Insight

Developers are already flexing their AI-augmented output. They post GitHub contribution graphs on Twitter showing walls of green. They blog about 94-commit days. They screenshot their PR counts. This behavior is organic and accelerating — but there's no home for it. No standardized way to measure, compare, or compete.

**Mentat Velocity is Strava for developer throughput.** Connect your GitHub, see how you stack up, claim your crown.

It serves a dual purpose: a viral top-of-funnel for the Mentat ecosystem, and a genuine signal of how effectively developers and teams are leveraging AI agents — because commit velocity is a proxy for agent adoption. A developer using autocomplete pushes 5-10 commits/day. A developer driving Claude Code pushes 20-40. A developer orchestrating agent swarms pushes 50-100+. The numbers tell the story.

---

### How It Ties Into the Mentat Ecosystem

| Product | What It Measures | The Hook |
|---|---|---|
| **Mentat Scan** | How ready is your repo for AI agents? | The badge. "AI-Ready: 85%" |
| **Mentat Velocity** | How effectively are you using AI agents? | The leaderboard. "Top 2% developer velocity" |

The scan tells you *what to build*. The velocity shows you *what it gets you*.

The loop: someone sees the leaderboard, realizes they're in the 30th percentile, runs Mentat Scan, discovers they're missing CI and agent instructions, fixes those two things, and watches their velocity climb. The diagnostic feeds the leaderboard. The leaderboard feeds the diagnostic.

---

### Core Metrics

Not all metrics are created equal. Raw commit count rewards noise. The leaderboard needs metrics that are fun to compare *and* meaningfully reflect AI-augmented output.

#### Primary Metrics (Public, Ranked)

**1. Equivalent Engineering Hours**
This is the hero number. The one that gets screenshotted, tweeted, and shown to investors.

- Analyze commit timestamps, diff sizes, and frequency
- Back-calculate against a human baseline: a developer writing code manually produces roughly X lines/hour at Y commit frequency
- Display: *"420 equivalent engineering hours this month — from 1 contributor"*
- This is the number that makes a solo founder look like a 10-person team

**2. PRs Merged (not commits)**
- Filters out WIP noise, fixup commits, and rebases
- Only counts PRs merged to the default branch
- Optionally: only PRs where CI passed before merge (filters out broken merges)

**3. Velocity Acceleration (the delta)**
- The *change* in throughput is more interesting than the absolute number
- *"This developer went from 8 PRs/week to 47 PRs/week in January"*
- This is the AI adoption signal — the inflection point where someone goes from manual to agent-assisted to agent-orchestrated
- Displayed as a trend line, not just a snapshot

**4. Commits Per Day (rolling average)**
- The classic. Simple, intuitive, easy to compare
- Rolling 30-day average smooths out spikes and weekends
- Breakdown: weekday vs. weekend, working hours vs. off-hours (agents work at 3am — the graph shows it)

#### Secondary Metrics (Profile, Non-Ranked)

**5. Lines Changed Per Day**
- Noisy on its own (agents are verbose), but useful in combination with PRs merged
- Ratio of lines changed per PR is interesting: high ratio = large PRs = potentially agent-generated bulk work

**6. Active Coding Hours**
- Derived from commit timestamp distribution
- A human codes 6-10 hours. An agent-orchestrated setup shows commits across 18-24 hours
- *"This contributor has 22 active coding hours per day"* — immediately tells you agents are involved

**7. Time from First Commit to PR Merge**
- How fast does an idea become production code?
- The OpenClaw guy claims "7 PRs in 30 minutes." That shows up here as near-zero cycle time

---

### The Crowns: Regional + Stack Leaderboards

This is the fun part. Global leaderboards are interesting but impersonal. Scoped leaderboards create identity, rivalry, and bragging rights.

#### Stack Crowns (Auto-Detected)
Language and framework detection from repo analysis. No self-reporting needed.

- *"King of TypeScript"*
- *"Queen of Python"*
- *"King of Rust"*
- *"Top Vercel AI SDK developer"*
- *"Top Next.js developer"*
- *"Top FastAPI developer"*

Framework detection via `package.json` dependencies, `pyproject.toml`, `Cargo.toml`, etc. The same signals Mentat Scan already reads.

#### Regional Crowns (Self-Reported or Inferred)
Location from GitHub profile or self-reported on signup.

- *"King of Python in the Middle East"*
- *"Top React developer in San Francisco"*
- *"Fastest solo founder in Southeast Asia"*

#### Combo Crowns
The intersection is where it gets addictive:

- *"#1 TypeScript developer in London"*
- *"#1 Rust developer in Berlin"*
- *"#1 AI SDK developer in the Bay Area"*
- *"Top solo founder velocity worldwide"*

#### Team Crowns
For companies / orgs that opt in:

- *"Fastest 5-person team globally"*
- *"Highest velocity-per-engineer for teams under 10"*
- *"Most improved team this month"*

---

### The Profile Page

Every developer gets a public profile. This is the thing they link in their Twitter bio, their portfolio, their job applications.

```
╔══════════════════════════════════════════════════════╗
║  @elvischidera                                       ║
║  Mentat Velocity — Top 1%                            ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  EQUIVALENT ENGINEERING HOURS (30d)      2,400 hrs   ║
║  PRs MERGED (30d)                             187    ║
║  COMMITS/DAY (avg)                             52    ║
║  VELOCITY ACCELERATION                      +640%    ║
║  ACTIVE CODING HOURS/DAY                     22.3    ║
║                                                      ║
║  ─── VELOCITY TREND (6 months) ──────────────────    ║
║                                                      ║
║       ▁▂▂▃▃▃▃▄▅▅▆▆▇▇█████████████████               ║
║   Sep  Oct  Nov  Dec  Jan  Feb                       ║
║                     ↑                                ║
║              started using                           ║
║              agent orchestration                     ║
║                                                      ║
║  ─── CROWNS ─────────────────────────────────────    ║
║                                                      ║
║  👑 #1 TypeScript — Worldwide                        ║
║  👑 #1 Next.js — North America                       ║
║  👑 #1 Solo Founder Velocity — Global                ║
║                                                      ║
║  ─── TOP REPOS ──────────────────────────────────    ║
║                                                      ║
║  medialyst/app        AI-Ready: 78%    94 PRs/mo     ║
║  medialyst/sdk        AI-Ready: 91%    43 PRs/mo     ║
║  medialyst/docs       AI-Ready: 62%    50 PRs/mo     ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
```

The AI-Ready score links directly to Mentat Scan. The velocity numbers link to the leaderboard. Everything is cross-referenced.

---

### Gaming & Trust

People will game any leaderboard. That's fine. Strava has people driving segments in cars. The community polices it, and real users compete with themselves.

**Defenses that don't kill the fun:**

- **CI-gated counting:** Optionally only count PRs where CI passed. Repos with Mentat Scan scores above a threshold get a "verified" badge on the leaderboard — their numbers are more trustworthy because their infrastructure enforces quality.
- **Anomaly flagging:** If someone goes from 5 commits/day to 500 overnight with single-line changes, flag it visually (not punitively). Let the community see the pattern.
- **Velocity acceleration over absolute numbers:** Gaming absolute counts is easy. Faking a consistent upward trend over months is hard.
- **"Verified Agent User" badge:** If the repo has `CLAUDE.md`, agent-pattern commit messages, or multi-author commits from bot accounts, tag the profile. This is a badge of honor, not shame — it means the velocity is real.

---

### The Shareables

The leaderboard needs to produce artifacts people *want* to post.

**1. The Card**
A shareable image (like Spotify Wrapped or GitHub Skyline) showing your monthly stats, crowns, and trend line. Auto-generated, optimized for Twitter/LinkedIn dimensions.

**2. The Badge**
For READMEs: `![Mentat Velocity](https://mentat.dev/badge/velocity/@username)`
Shows your current percentile or top crown.

**3. The Wrapped**
Monthly or quarterly recap:
- *"In February 2026, you merged 187 PRs — more than 98% of developers worldwide."*
- *"Your velocity increased 640% since September. You're now in the top 1%."*
- *"You unlocked 3 new crowns this month."*

**4. The Challenge**
Let users challenge friends: *"Think you're faster? Compare your velocity against @username."*
Side-by-side profile comparison. Instant shareability.

---

### V1 Scope vs. Future

**V1 (Launch):**
- GitHub OAuth signup
- Auto-ingest public repos (private repos opt-in)
- Core metrics: commits/day, PRs merged, equivalent engineering hours, velocity acceleration
- Global leaderboard + language-scoped leaderboards
- Profile page with trend line
- Shareable card + README badge

**V2:**
- Regional crowns (requires location data)
- Framework-scoped crowns (deeper dependency analysis)
- Team leaderboards (org-level aggregation)
- Monthly Wrapped
- Integration with Mentat Scan (AI-Ready score on profile)
- Challenges (head-to-head comparisons)

**V3:**
- Private company leaderboards (enterprise teams comparing internal velocity)
- Historical analysis ("show me when each engineer on my team started using agents")
- Correlation dashboard: AI-Ready score vs. velocity (proving that infrastructure investment → throughput)

---

### Why This Is the Viral Engine

The Mentat Scan badge is useful but passive — it sits in a README. The leaderboard is *active*. It gives people a reason to come back every day, a reason to share, a reason to challenge their friends.

The psychology is simple: developers are competitive. They already compare stars, followers, and contribution graphs. This gives them a real metric to compete on — one that actually reflects how they work, not just how popular their repos are.

And the kicker: the leaderboard *implicitly markets Mentat Scan*. Every profile shows the AI-Ready score next to velocity. The correlation is visible. The developer in the top 1% has a 91% AI-Ready score. The developer in the 40th percentile has a 35% AI-Ready score. The lesson teaches itself.

Nobody needs to be sold on AI readiness. They just need to see that the fast people have it and they don't.
