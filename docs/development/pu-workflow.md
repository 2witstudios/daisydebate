# Parallel worktree workflow

`pu` is the preferred orchestration tool when multiple OpenCode agents or
isolated worktrees are involved. It is not mandatory for direct single-agent
work. Parallel or isolated work should use `pu` so branches, worktrees, logs,
and cleanup remain visible to the orchestrator.

## Common flow

```text
pu spawn -a opencode -n NAME -b BASE
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

The orchestrator owns the PageSpace task board: claiming work, updating status,
recording plans, and marking acceptance. Delegated agents may report progress
and evidence to the orchestrator, but do not write the board. After completion,
the orchestrator uses `pu kill` and any repository-approved cleanup flow to
remove stopped agent sessions and stale worktrees.

## Acceptance criteria

- Given parallel or isolated agent work, should use `pu spawn` and separate
  worktrees, with status and logs discoverable through `pu status` and
  `pu logs`.
- Given a focused delegated task, should use `pu send` or `pu attach` without
  editing another agent's worktree.
- Given completed or abandoned work, should use `pu kill` followed by `pu clean`,
  while the orchestrator alone updates the PageSpace task board.
- Given direct single-agent work, should be allowed to proceed without `pu`.
