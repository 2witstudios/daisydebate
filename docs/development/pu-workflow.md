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
  The launcher exports the machine identity from the main checkout's
  `.env.agent` and sets `DAISY_AUTONOMOUS=1`, so `gh` and `git push` act as
  the machine user over HTTPS, never with the owner's keyring token or SSH
  key. It refuses to start an agent with an incomplete identity, and
  `bun doctor` fails if an autonomous session resolves to the owner. Until
  the owner creates `.env.agent` (GRD-6.2), the launcher starts agents as
  the owner with a warning and `bun doctor` warns (ADR 0035 section 1a).

## Spawning and messaging

```text
bun agent:spawn [--task <leaf>] [--cap N] [--override] \
  -- -n <name> [-b main] [-a claude|codex|opencode] "<prompt>"
bun agent:spawn --role reviewer --worktree <worktreeId> \
  -- [-a claude|codex|opencode] "<prompt>"
bun agent:send <agent> "<text>"
pu status | pu logs <agent> | pu attach <agent>
pu kill --agent <agent> && pu clean
```

Every agent is spawned with `bun agent:spawn`. Before a builder starts, it
refuses:

- a leaf whose `Prerequisite:` line names an unmerged leaf, PR or ADR, or a
  leaf with no Related pages section to declare them in
- a leaf or prompt that uses a term a merged ADR superseded
  (`policy/superseded-terms.json`)
- a new builder when the builder cap (3) is reached; every running coding
  agent not registered as a reviewer counts

A reviewer (`--role reviewer`) joins the existing worktree it reviews,
named with `--worktree`, with no new worktree or setup, and counts only
against the reviewer cap (2). Only `builder` and `reviewer` are roles. The
owner may change a cap with `--cap` and override a refusal with
`--override`. An autonomous agent may spawn reviewers, but may not pass
`--cap`, cannot override, and must pass `--task` for a builder. For a
builder it then:

1. creates the worktree
2. runs `bun install --frozen-lockfile` and `bun slot:up` in it, so the
   agent never starts on another checkout's databases, Redis namespace or
   ports ([ADR 0034](../decisions/0034-shared-stack-slots.md))
3. starts the agent in that worktree
4. resolves the child id from `pu status --json`
5. registers the child's parent (the spawner's `PU_AGENT_ID`), role and
   worktree in `.pu/daisy/agents/<id>.json` in the main checkout, where the
   child cannot write
6. confirms the prompt was taken (a new user turn in the transcript, or
   output from an agent that was quiet before the send), nudging with an
   empty `pu send` when it was not

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
- An autonomous agent never merges. It runs `gh pr merge <n> --auto --merge`
  only after the check in ADR 0035 section 4 confirms the live `main`
  ruleset requires `review-record`; GitHub then merges once `CI gate`,
  `Playwright E2E` and `review-record` all pass. Without that ruleset
  (before GRD-6.2) it reports "ready for owner merge" to its parent and
  waits. The owner may merge directly at any time.
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

That notifies the registered parent (or, with none, the owner on the Epic
Updates channel) and comments on the PR, then pauses the loop with its state
and iteration kept; when nobody could be told it fails and the loop stays
active. Only the parent or the owner answers it:

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
- hand edits of loop state, the agent registry and the guard's own hooks
- `bun board:status … completed`: Done comes from an independent review

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
  `gh pr merge --auto --merge`, and only once the live `main` ruleset
  requires `review-record`, while the owner may merge any PR at any time.
- Given direct single-agent work, should be allowed to proceed without `pu`.
