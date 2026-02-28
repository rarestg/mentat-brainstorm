# Velocity Remediation Workspace

This folder is the execution workspace for fixing the Mentat Velocity MVP gaps identified in the audit.

Use this folder as the single coordination surface for:
- task tracking (`BOARD.md`)
- team-specific implementation plans (`TEAM-*.md`)
- cross-team messages (`COMMS.md`)
- architectural/product decisions (`DECISIONS.md`)

## Operating Rules

1. `BOARD.md` is the source of truth for status.
2. Each engineer updates their team doc checklist as they work.
3. Cross-team asks go in `COMMS.md` (not buried in PR comments).
4. Any meaningful tradeoff/decision gets logged in `DECISIONS.md`.
5. When closing a task, include evidence (test output, endpoint smoke, screenshot, or PR link).

## Team Documents

- `TEAM-backend-data.md`
- `TEAM-product-ux-growth.md`
- `TEAM-cloudflare-platform.md`
- `TEAM-security-qa.md`

## Status Legend

- `TODO` not started
- `IN_PROGRESS` actively being worked
- `BLOCKED` waiting on dependency/decision
- `DONE` implemented and validated

