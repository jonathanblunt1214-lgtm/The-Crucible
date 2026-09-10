# The Crucible — Claude Code plugin

A Claude Code plugin for this repository's governed workflows. It is separate
from, and does not interact with, the Nexus plugin that occupies the rest of
this branch (`nexus.plugin.json`, `index.js`).

## Canonical-source rule

This plugin **does not restate repository policy**. Per this branch's
`AGENTS.md`, shared governance is canonical on the default `main` branch and is
not copied here. Every command therefore names the canonical documents to read
— `AGENTS.md`, `DEVLOG.md`, `AI-HANDOFF.json`'s `governingDocuments`,
`templates/*`, and the relevant `src/*` modules — and carries only mechanics:
which script to run, in what order, and how to report the result.

That is deliberate. Policy here changes; a paraphrase frozen into a command
file would silently go stale and start contradicting the canonical text. If you
find a command asserting a rule instead of pointing at where the rule lives,
that is a defect in this plugin.

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

| Command | Mechanics it provides | Canonical source it defers to |
| --- | --- | --- |
| `/crucible:handoff` | Reads the handoff documents in order, then reports current state | `AGENTS.md`, `DEVLOG.md`, `AI-HANDOFF.json` |
| `/crucible:precheck` | Runs the pre-push verification and audit suite, each exit status reported separately | `package.json` scripts, `AGENTS.md`, known-bug policy |
| `/crucible:audit` | Runs one named audit gate, or lists them | `package.json` scripts, `templates/required-check-rollout.md` |
| `/crucible:research` | Validates the Python/pypdf prerequisite, then runs readiness and the research coordinator | `governingDocuments/scientific-learning-policy.md`, `src/automatedGoogleResearch.js`, `src/scientificLearning.js` |
| `/crucible:devlog` | Adds a chain-of-custody entry and updates the handoff in the same unit of work | `AGENTS.md`, `src/handoffPolicy.js` |

## SessionStart hook

`hooks/hooks.json` runs `scripts/session-start.js` at session start. When the
working directory contains `AI-HANDOFF.json` it reports observable facts only:
the `governingDocuments` list (separating branch-qualified entries, which name
a file on another branch rather than a path in the checkout), the literal
`sessionPolicy.lastActionAt` and how long ago that was, the active prompt, the
count of outstanding items, and any unresolved conflict count. It then points
at `AGENTS.md` for the recheck and branch rules rather than asserting them.

Advisory only: it prints context, always exits 0, never edits a file, and exits
silently outside a Crucible checkout. It runs under Node, so behaviour is the
same on Windows, macOS, and Linux.

## Deliberately not included

- No command pushes, merges, promotes, or creates branches.
- Nothing weakens, disables, or edits a governed bound to make a check pass.
- Nothing writes to `AI-CONFLICTS.json` or the known-bug ledger automatically.

## Second plugin in this marketplace

`ai-collaboration` is also published from this marketplace, sourced from
`jonathanblunt1214-lgtm/AI-collaboration-`. That repository ships a Codex
plugin, but its `plugin/skills/` directory uses the same `SKILL.md` frontmatter
Claude Code expects, so the marketplace entry points `skills` at it directly
and sets `strict: false` (it has no `.claude-plugin/plugin.json`). It ships
disabled by default and installs those skills only:

```
/plugin install ai-collaboration@the-crucible
```

It does **not** wire up the AI Collaboration remote MCP service. That needs the
deployed base URL, and `AI_COLLABORATION_BEARER_TOKEN` is a runtime secret that
must never be committed here. Add the MCP server to your own local or project
configuration, keeping the token in the environment.
