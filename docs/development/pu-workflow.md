# Parallel worktree workflow

`pu` is the preferred orchestration tool when multiple Claude Code agents or
isolated worktrees are involved. It is not mandatory for direct single-agent
work. Parallel or isolated work should use `pu` so branches, worktrees, logs,
and cleanup remain visible to the orchestrator. `pu spawn` defaults to the
`claude` agent type; pass `--agent-args` for extra CLI flags such as a model
override.

## Common flow

```text
pu spawn -n NAME -b BASE "prompt"
pu status
pu logs AGENT_ID
pu attach AGENT_ID
pu send AGENT_ID "focused instruction"
pu kill AGENT_ID
pu clean
```

`pu spawn` creates a separate worktree from the selected base. Agents work only
in their assigned worktree and report their branch, commit, tests, and
limitations. The orchestrator owns coordination, integration, and cleanup;
delegated agents do not modify another worktree.

Use `pu kill AGENT_ID` to stop an active delegated session, then `pu clean` for
safe cleanup of stopped sessions and stale worktrees. Do not manually remove an
active agent's worktree. `pu play` or `pu bench` are optional and useful only
when the task specifically needs a playbook run or a benchmark; they are not
required for ordinary development.

The orchestrator coordinates the PageSpace task board: claiming work,
recording plans, and marking acceptance. Delegated agents keep the board
current too, following [parallel work](parallel-work.md#branch-and-worktree-hygiene):
they never edit the acceptance criteria or scope of a task delegated to
them, and a change to their own spec goes back to the orchestrator. After
completion, the orchestrator uses `pu kill` and any repository-approved
cleanup flow to remove stopped agent sessions and stale worktrees.

## Rules

- Use `pu spawn` and separate worktrees for parallel or isolated agent work;
  status and logs stay discoverable through `pu status` and `pu logs`.
- Send a focused delegated task through `pu send` or `pu attach`; never edit
  another agent's worktree directly.
- Stop completed or abandoned work with `pu kill` followed by `pu clean`.
  The orchestrator owns coordination and acceptance decisions on the
  PageSpace board; delegated agents keep their own status, evidence,
  follow-up leaves and Issues entries current (see
  [parallel work](parallel-work.md#branch-and-worktree-hygiene)).
- Direct single-agent work may proceed without `pu`.
