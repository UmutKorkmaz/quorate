---
roles: architect, security, qa
agents: claude, codex
---

# Project defaults

Quorate reads this file on shell launch to seed session defaults. Put it in the
repo root as `QUORATE.md`, or under `.quorate/QUORATE.md`.

## Default roles

You can also declare defaults as markdown sections instead of frontmatter:

- architect
- security

## Preferred agents

- claude
- codex

Run `/inspect` in the shell to see what was loaded. CLI flags such as
`--providers` override preferred agents for that session.