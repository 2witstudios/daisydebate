# Parallel work

How several agents (or humans) work on Daisy at the same time without
stepping on each other. The unit of parallelism is the **vertical**: a
feature slice that owns its routes (`apps/web/src/app/...`), its
application operations (`apps/web/src/features/<name>/`), and its tests.

## Session isolation (one machine)

Every local session pins its own Compose stack; the recipe and the four
`.env` knobs live in
[local development](local-development.md#parallel-sessions-on-one-machine).
Summary: distinct `DAISY_STACK_NAME` + ports per slot, `E2E_PORT` to keep
Playwright off another session's server, unit tests need nothing.

## Branch and worktree hygiene

PageSpace's lesson: branch debris accumulates faster than agents clean it
(775 local branches, numeric leftovers, rescued worktree patches). Rules:

- Branches are short-lived and named for the vertical:
  `feat/<vertical-topic>`, `fix/<topic>`, `chore/<topic>`. No numeric or
  `backup/` branches; git history is the backup.
- Delete the branch when the PR merges. Do not stack more than one
  open vertical per agent.
- Worktrees (`git worktree`, or `pu` slots) are the supported way to run
  multiple sessions on one machine; give each worktree its own `.env`
  slot per the isolation recipe.
- Worktree agents never write the task board directly. The session that
  owns the checkout (the orchestrator) claims leaves, advances statuses,
  and posts updates; subagents report back through their prompt channel.
- Deviating from a task's acceptance criteria is allowed exactly one way:
  update the task body (or the plan) to describe the new approach
  **before** declaring the work done. Silent scope substitution is the
  failure mode this prevents.

## What each session must not own concurrently

- **Migrations.** One migration writer at a time across the whole
  repository; generation collides on the journal and applied migrations
  are immutable. `bun migrations:check` fails a PR that rewrites or
  reorders shared migrations; see
  [database operations](../operations/database.md).
- **Shared app-router files.** `src/app/layout.tsx`, `globals.css`, and
  `middleware`/`proxy` are coordination points: changing them belongs to
  a dedicated change, not a vertical PR. Vertical route groups
  (`src/app/(<vertical>)/`) keep the rest merge-free; see
  [extending](extending.md#adding-a-product-vertical).
- **Shared config gates.** `eslint.config.mjs`,
  `packages/typescript-config/`, `.prettierrc.json` invalidate every
  turbo cache and affect all verticals; change them in isolated,
  dedicated PRs.

## Inner loop

- `bun check:affected` — fast per-vertical loop (eslint/prettier on
  changed files, boundaries, affected turbo graph). It is a convenience,
  not a gate.
- `bun check` — the pre-push gate for every PR.
- `bun migrations:check` — before pushing any change that touches
  `packages/db/migrations/`.
- CI is per-PR isolated (service containers, concurrency cancellation);
  E2E runs once per PR in the dedicated browser workflow.

## Reviewing parallel work

Follow [review records](review-record.md): gates run up front, findings
with severity and fix commits, an explicit verdict, and a second pass
that re-verifies the first. Plan compliance (acceptance criteria versus
diff) is part of the verdict, not an afterthought.
