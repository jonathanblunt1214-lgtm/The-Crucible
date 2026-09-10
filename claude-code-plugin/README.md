# The Crucible — Claude Code plugin

A Claude Code plugin for this repository's governed workflows. It is separate
from, and does not interact with, the Nexus plugin that occupies the rest of
this branch (`nexus.plugin.json`, `index.js`).

## Install

This branch is not the repository's default branch, so add the marketplace
with an explicit ref:

```
/plugin marketplace add https://github.com/jonathanblunt1214-lgtm/The-Crucible.git#Plug-in
/plugin install crucible@the-crucible
```

To test locally before installing from git:

```
claude --plugin-dir /path/to/The-Crucible/claude-code-plugin
```

## Commands

| Command | What it does |
| --- | --- |
| `/crucible:handoff` | Reads `DEVLOG.md`'s shared handoff and every file in `AI-HANDOFF.json`'s `governingDocuments`, then reports current state. Required by `AGENTS.md` before any action. |
| `/crucible:precheck` | Runs the pre-push verification and audit suite, reporting each command's real exit status separately. |
| `/crucible:audit` | Runs one named audit gate, or lists all of them. |
| `/crucible:research` | Runs the bounded, credential-free Google coding-resource research coordinator with its governed limits intact. |
| `/crucible:devlog` | Adds a compliant chain-of-custody `DEVLOG.md` entry, including the prune and `Devlog-Pruned` archival rules. |

## SessionStart hook

`hooks/hooks.json` runs `scripts/session-start.js` at session start. If the
working directory contains `AI-HANDOFF.json`, it prints the governing-document
list, how long it has been since `sessionPolicy.lastActionAt`, the active
prompt, any unresolved conflict count, and the branch policy.

The hook is advisory: it prints context, always exits 0, and never edits a
file. In a non-Crucible directory it exits silently. It runs under Node so it
behaves the same on Windows, macOS, and Linux.

## Deliberately not included

- No command pushes, merges, promotes, or creates branches. Branch policy in
  `AGENTS.md` is the owner's, and promotion to `main` goes through `release`.
- Nothing weakens, disables, or edits a governed bound to make a check pass.
- Nothing writes to `AI-CONFLICTS.json` or the known-bug ledger automatically.

## Second plugin in this marketplace

`ai-collaboration` is also published from this marketplace, sourced from
`jonathanblunt1214-lgtm/AI-collaboration-`. That repository ships a Codex
plugin, but its `plugin/skills/` directory uses the same `SKILL.md` frontmatter
Claude Code expects, so the marketplace entry points `skills` at it directly
and sets `strict: false` (it has no `.claude-plugin/plugin.json`). It ships
disabled by default:

```
/plugin install ai-collaboration@the-crucible
```

That entry installs the two skills only. It does **not** wire up the AI
Collaboration remote MCP service — that needs the deployed base URL, and its
`AI_COLLABORATION_BEARER_TOKEN` is a runtime secret that must never be
committed to this repository. To connect it, add the MCP server to your own
local or project configuration, keeping the token in the environment.
