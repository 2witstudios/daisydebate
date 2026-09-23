---
name: pu
description: >
  Use when user asks to spawn agents, check workspace status, manage
  parallel coding tasks, schedule future agents, or when you need to
  run work in isolated worktrees. PurePoint orchestrates parallel AI
  coding agents.
---

# PurePoint Agent Awareness

You are operating inside PurePoint, an agent-first coding workspace. PurePoint spawns AI coding agents in isolated git worktrees so multiple agents can work in parallel without conflicts.

This file is committed in the Daisy repository (ADR 0035) so that `pu` never replaces it with its generic default. `AGENTS.md` is the operating map and wins over anything here.

## Your Role

You are an AI agent managed by PurePoint. You may be:

- A **worktree agent**: Working in an isolated git worktree (`pu/<branch-name>`). You have your own branch, your own working directory, and your own terminal. Other agents are working in parallel on other branches.
- A **root agent** (point guard): Operating in the project root, directing and monitoring other agents. You don't write code — you orchestrate.

Check `pu status --json` to see where you fit in the current workspace.

## Autonomous mode

Agents started by `pu` run autonomously (`DAISY_AUTONOMOUS=1`) under the agent machine identity, never the owner's GitHub token or SSH key.

- Never merge. Request a merge with `gh pr merge --auto --squash`; GitHub merges once every required check, including `review-record`, passes.
- Never push to `main`, change rulesets or repository settings, kill processes outside your worktree, or clean up a Compose stack you do not own. The guard refuses these.
- In a PR loop you cannot truthfully finish, pause it with `bun loop:escalate <needs-owner|blocked|stalled|out-of-scope> "<detail>"`. Only your parent or the owner closes or resumes it.

## Long-Horizon Expectations

PurePoint tasks are expected to be **completed fully**. This means:

- **No truncation.** Implement every requirement, not just the easy parts.
- **No simplification.** Don't reduce scope without explicit permission from the user or point guard.
- **No deferring your own scope.** Every criterion of the task you were given is yours to finish. Findings outside it are filed, not dropped: a follow-up leaf when an open leaf owns it, otherwise an `ISSUE-n` in the drive's `Issues` list, as `AGENTS.md` requires.
- **No TODO stubs.** Every function, every test, every integration — complete.
- **If your context is filling up**, that's a signal to commit your progress and communicate status — not to abandon work.

## Communication

- **Commit messages**: Clear, descriptive. Reference the task or spec you're implementing.
- **Code comments**: Only where logic isn't self-evident. Don't narrate — explain the WHY.
- **If you're stuck**: Say so explicitly in your output. The point guard monitors via `pu logs`.

## Key Rules

1. **Work autonomously.** You have everything you need. Read the codebase, read the specs, figure it out.
2. **Verify your changes.** Run tests, type checks, linters — whatever the project uses. Don't submit broken work.
3. **Don't stop early.** If the task says "implement X," implement ALL of X. Not part of X.
4. **Respect the architecture.** Read `AGENTS.md` and the documents it links before making structural decisions.
5. **Stay in your lane.** Only modify files relevant to your task. Don't refactor unrelated code.

## Quick CLI Reference

Use `/pu` for the full CLI reference. Key commands:

- `pu status` — see all agents and worktrees
- `pu logs <agent_id>` — read agent output
- `pu send <agent_id> "message"` — send input to an agent
- `bun agent:spawn -- <pu spawn arguments>` — spawn a child agent, record you as its parent, and confirm its prompt was submitted
- `pu kill --agent <agent_id>` — stop an agent
