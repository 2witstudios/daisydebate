# Parallel worktree workflow

`pu` is the orchestration tool whenever more than one agent works, or when
work needs an isolated worktree. Direct single-agent work may proceed without
it. The guardrails that make autonomous agents safe are decided in
[ADR 0035](../decisions/0035-autonomy-guardrails.md).

## Two modes

- **Owner.** The owner's own sessions use the owner's GitHub identity, may
  merge any PR at any time, and are only asked, never blocked, before a merge
  or a push to `main`.
- **Autonomous.** Every agent `pu` starts runs through
  `scripts/agent-launch.sh` (configured in the committed `.pu/config.yaml`).
  The launcher exports the machine identity from `.env.agent` (copied into
  each worktree by pu's `envFiles`) and sets `DAISY_AUTONOMOUS=1`, so `gh` and
  `git push` act as the machine user over HTTPS, never with the owner's
  keyring token or SSH key. It refuses to start an agent without a valid
  identity, and `bun doctor` fails if an autonomous session resolves to the
  owner.

## Spawning and messaging

```text
bun agent:spawn [--task <leaf>] [--role builder|reviewer] [--cap N] [--override] \
  -- -n <name> [-b main] [-a claude|codex|opencode] "<prompt>"
bun agent:send <agent> "<text>"
pu status | pu logs <agent> | pu attach <agent>
pu kill --agent <agent> && pu clean
```

`bun agent:spawn` replaces a bare `pu spawn`. Before a builder starts, it
refuses:

- a leaf whose `Prerequisite:` line names an unmerged leaf, PR or ADR
- a leaf that uses a term a merged ADR superseded
  (`policy/superseded-terms.json`)
- a new builder when the active-builder cap (3) is reached

The owner may override with `--override`; agents cannot. It then:

1. creates the worktree
2. runs `bun install --frozen-lockfile` and `bun slot:up` in it, so the
   agent never starts on another checkout's databases, Redis namespace or
   ports ([ADR 0034](../decisions/0034-shared-stack-slots.md))
3. records the spawner's `PU_AGENT_ID` in `.daisy/parent` and the role in
   `.daisy/role`
4. starts the agent in that worktree
5. resolves the child id from `pu status --json`
6. confirms the prompt reached the child's transcript, nudging with an
   empty `pu send` when it did not

`bun agent:send` confirms any later message the same way. Agents report to
their parent directly with it, so the owner never relays status.

The spawning agent owns coordination, integration and cleanup; delegated
agents never modify another agent's worktree. Code-writing help is always a
`bun agent:spawn` child. Worktree-isolated subagents and forks are for
read-only research and review: the subagent sandbox refused about half of
their shell commands, and concurrent forks broke shared trees.

## Pull requests and merges

- Open and update PRs with `/pr` (its body declares `Builder: <agent id>`)
  and hand off in one step with `/handoff`: push, PR, handoff page with the
  head SHA, tasks to In Review, parent notified.
- Independent reviews use the Reviewer contract and `/review`. The review
  record's `Candidate:` line mints the `review-record` check through the
  review-record GitHub App; nobody sets that status by hand.
- An autonomous agent never merges. When the owner directs a merge, the agent
  runs `gh pr merge <n> --auto --squash`; GitHub merges once `CI gate`,
  `Playwright E2E` and `review-record` all pass. The owner may merge directly
  at any time.
- After a merge, the tasks the PR names move to **Merged** and wait there
  for a review record to grant Done. After the enforcement cutoff, a merge
  without a `review-record` status files review debt (`ISSUE-n` plus a
  Sprint Room notice).

## PR loops

A PR convergence loop is started with the Library "Converge loop" prompt, not
a pasted prompt:

```text
/ralph-loop Run: pagespace pages read ek1lle4urffctxmt2t6sozf1 and converge PR #<n> by that page. --completion-promise CONVERGED --max-iterations 40
```

A loop agent that cannot truthfully finish pauses its loop:

```text
bun loop:escalate <needs-owner|blocked|stalled|out-of-scope> "<detail>"
```

That keeps the state and iteration, notifies the parent (or prints an owner
notice) and comments on the PR. Only the parent or the owner answers it:

```text
bun loop:close <agent> "<why>"
bun loop:resume <agent> "<instructions>"
```

The guard refuses the loop agent any other way to end or restart its own
loop.

## The guard

`scripts/agent-guard.ts` runs from `.githooks/pre-push` and from the committed
Claude Code `PreToolUse` hook (`.claude/settings.json`).

With `DAISY_AUTONOMOUS=1` it refuses:

- pushes to `main` and `--no-verify` pushes
- direct and `--admin` merges
- ruleset, branch-protection and repository-settings changes
- kill commands not scoped to the agent's worktree
- Docker cleanup and `compose down` on the shared stack
- `db:reset` or `slot:down` against another slot
- hand edits of loop state

In owner sessions it asks before a merge or a push to `main`. It catches
accidents and can be bypassed; the machine identity and the `main` ruleset
are the hard limits.

## Acceptance criteria

- Given parallel or isolated agent work, should use `bun agent:spawn` and
  separate worktrees, with status and logs discoverable through `pu status`
  and `pu logs`.
- Given a focused delegated task, should use `bun agent:send` or `pu attach`
  without editing another agent's worktree.
- Given completed or abandoned work, should use `pu kill` followed by
  `pu clean`; the orchestrator owns coordination and acceptance decisions on
  the PageSpace board while delegated agents keep their own status,
  evidence, follow-up leaves and Issues entries current.
- Given an autonomous agent, should request merges only with
  `gh pr merge --auto`, while the owner may merge any PR at any time.
- Given direct single-agent work, should be allowed to proceed without `pu`.
