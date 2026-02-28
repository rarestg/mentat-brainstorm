# Mentat

**The AI-readiness diagnostic and developer velocity platform.**

Mentat is two products that feed each other:

1. **Mentat Scan** — A CLI tool that audits any codebase against 6 protocols of AI-readiness and outputs a weighted score (0-100) with a prioritized action plan. *"How ready is your repo for AI agents?"*

2. **Mentat Velocity** — A public leaderboard and developer profile page that tracks AI-augmented throughput (equivalent engineering hours, PRs merged, velocity acceleration). Strava for developers. *"How fast are you shipping?"*

The loop: Velocity drives awareness (competitive, shareable). Scan drives conversion (actionable, diagnostic). The profile page ties them together — your velocity numbers sit next to your AI-Ready score, and the correlation teaches itself.

---

## Repo Structure

The thinking evolved in layers: Notion raw notes → standalone essays → long-form drafts → polished specs. The repo mirrors that lineage.

```
spec/                              # Product specs (the polished, current source of truth)
  mentat-doctrine.md               #   Canonical product doctrine (thesis, principles, decision rules)
  mentat-scan.md                   #   Mentat Scan — 6 Protocols, scoring, scanner architecture
  mentat-velocity.md               #   Mentat Velocity — Leaderboard, crowns, profile page, GTM

brainstorm/
  notion/                          # Raw exports from our Notion workspace (will keep growing)
    project-overview.md            #   Original project vision, name ideas, form factor options
    the-cycle.md                   #   The 5-stage bottleneck framework (Plan → Code → Review → Test → Deploy)
    signals.md                     #   What signals we can realistically scan in a codebase
    reading-list.md                #   Reference articles and blog posts
  thoughts/                        # Standalone thinking — reactions to the Notion notes + research
    autonomous-sdlc-thoughts.md    #   The "hobby project → factory" essay + original scanner blueprint
  drafts/                          # Long-form drafts that were condensed into the specs
    autonomous-readiness-framework-long.md   #   Extended scan spec (includes industrial history + philosophy)
    velocity-leaderboard-long.md             #   Extended velocity spec (full metrics breakdown + shareables)

research/                          # External reference material
  ona/blog/                        #   Ona (formerly Gitpod) blog posts
    industrializing-software-development.md
    the-self-driving-codebase.md
    last-year-of-localhost.md
    dont-build-a-sandbox.md
  ona/docs/                        #   Ona product documentation
    what-is-ona.md
    how-ona-works.md

_archive/                          # Superseded earlier drafts
```

**How things flow:** New Notion exports land in `brainstorm/notion/`. Reactions and essays go in `brainstorm/thoughts/`. When thinking matures into a long-form draft, it goes in `brainstorm/drafts/`. When a draft is condensed into a product spec, it goes in `spec/`.

---

## Key Concepts

**The 6 Protocols of AI-Readiness** (see `spec/mentat-scan.md`):

| # | Protocol | Weight | One-liner |
|---|---|---|---|
| 1 | Automated Verification | 35% | Tests close the autonomous feedback loop |
| 2 | Reproducible Environments | 25% | Agents need deterministic sandboxes |
| 3 | Agent Instructions | 20% | Explicit constraints prevent architectural violations |
| 4 | Linting & Formatting | 10% | Eliminate style noise from agent output |
| 5 | Structured Intent | 5% | Issue templates give agents enough context to act |
| 6 | Observability & Feedback Loops | 5% | Closes the loop from deploy back to detect + fix |

**Operating Stack Tiers** (see `spec/mentat-velocity.md`):

| Tier | Label | Signal |
|---|---|---|
| 0 | Human Level | <15 commits/day, working hours only |
| 1 | Copilot User | 15-30 commits/day, working hours only |
| 2 | Single Agent | 30-60 commits/day OR off-hours commits OR bot co-authors |
| 3 | Agent Swarm | 60+ commits/day AND 18+ active hours AND concurrent branches |

---

## Status

Pre-development. Brainstorming and spec-writing phase. Start here:
- [`spec/mentat-doctrine.md`](spec/mentat-doctrine.md) — canonical doctrine (mission, principles, loop)
- [`spec/mentat-scan.md`](spec/mentat-scan.md) — the scanner product spec
- [`spec/mentat-velocity.md`](spec/mentat-velocity.md) — the leaderboard product spec
