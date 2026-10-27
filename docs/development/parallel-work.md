# Parallel work

How several agents (or humans) work on Daisy at the same time without
stepping on each other. The unit of parallelism is the **semantic slice**: a
part of the product (formats, round runtime, social, rooms, access, and so
on) wide enough that its builder never needs to know what other builders are
doing. A slice owns its routes (`apps/web/src/app/...`), its application
operations (`apps/web/src/features/<name>/`), the packages it changes, and
their tests, and it ships as one PR ([the slice process](agent-pipeline.md)).

## Session isolation (one machine)

All sessions share one local Postgres and Redis. Each checkout owns the
databases, Redis namespaces and ports that `bun slot:up` derives from its
folder ([ADR 0034](../decisions/0034-shared-stack-slots.md); the recipe is
in [local development](local-development.md#parallel-sessions-on-one-machine)).

- Run `bun slot:up` in a new worktree.
- `bun doctor` catches a `.env` that names another slot.
- Run `bun slot:down` at handoff.
- A removed worktree's data is pruned by the next `slot:up` anywhere.

Unit tests need nothing.

## Branch and worktree hygiene

PageSpace's lesson: branch debris accumulates faster than agents clean it
(775 local branches, numeric leftovers, rescued worktree patches). Rules:

- **Branch names.** One branch per slice: `pu/<slice>` for work `pu`
  spawns, and `feat/<topic>`, `fix/<topic>`, `chore/<topic>` or
  `docs/<topic>` for direct work. No numeric or `backup/` branches; git
  history is the backup.
- **Inherited work.** A builder carries the commits of inherited PRs and
  branches into its slice branch, then closes those PRs in favor of the
  slice PR.
- **Merging.** Only main receives merged PRs. GitHub deletes the branch when
  the PR merges (`delete_branch_on_merge`, applied by `bun github:rules`).
- **Worktrees.** Worktrees (`git worktree`, or `pu` slots) are the supported
  way to run multiple sessions on one machine. Run `bun slot:up` in each so
  it gets its own databases and namespaces on the shared stack.
- **The parent checkout.** It stays on `main` and clear of committed work.
  Agents never run git there: no commits, checkouts, merges or pulls. All
  branch work happens inside the agent's own worktree, and new work reaches
  `main` only through a slice PR. A worktree cannot commit to a branch
  another worktree has checked out, so a direct commit landing on `main` is
  always a parent-checkout violation, not a worktree accident.
- **Records.** The slice plan in `Plans/<slice>` is the durable delivery
  record. Local notes are scratch; anything another session needs belongs
  in PageSpace.

## Work intake

Start in the drive's `Start here` page. Before planning a slice, read:

- `Product intent/Product map`;
- the applicable capability intents and their "Constraints other features
  must respect now" sections;
- the affected-capability links (Rooms/realtime to Spectating, Formats to
  Judging, Messaging to Privacy).

Link these sources from the slice plan. Future intent constrains current
work without creating a future task tree. Design work extends the existing
shipped UI and canvases in `Designs`.

Completed or superseded task history lives in `Archive/Work history`, which
remains a TASK_LIST so task identity survives moves. A merged PR's tasks
reach Done when its latest review verdict approves; otherwise they wait in
Merged for the board keeper ([reviews](reviews.md)).

## Shared surfaces

Slices rarely collide. When they do, the collision resolves at merge:
whoever merges second rebases or regenerates, and the Ralph loop's conflict
step does that work.

- **Migrations.** First ready, first merged. Applied migrations are
  immutable, and migrations are named by generation timestamp (ADR 0038).
  If another slice's migration lands first, regenerate yours on main with
  `bun db:generate`, then run `bun migrations:check`, which fails a branch
  that rewrites, edits or reorders shared migrations (see
  [database operations](../operations/database.md)).
- **Shared app-router files and theme tokens.** These are `src/app/layout.tsx`,
  `globals.css`, `middleware`/`proxy` and `src/app/theme/*.css`. Vertical
  route groups (`src/app/(<vertical>)/`) keep the rest merge-free (see
  [extending](extending.md#adding-a-product-vertical)). Screenshot baselines
  in `apps/web/e2e/visual-baselines/` change only with an intended visual
  change (see [testing](testing.md#visual-parity)).
- **Shared configuration.** `eslint.config.mjs`,
  `packages/typescript-config/` and `.prettierrc.json` invalidate every
  turbo cache. Change them only when the slice needs it, and say so in the
  PR.
- **ADR numbers.** Two open PRs can claim the same number with different
  filenames and merge without a git conflict. Take numbers from
  `bun adr:next`, which reads origin/main and every open PR. Announce a
  number you claim before your PR opens. `bun policy` (in `bun check` and
  CI) fails a branch whose ADR number an earlier-opened PR already holds.

## Inner loop

- `bun check:affected` is the fast loop: eslint and prettier on changed
  files, boundaries, styling, and the affected turbo typecheck and test
  graph. It is a convenience, not a gate.
- `bun check` mirrors CI's blocking gates. CI is the full gate.
- `bun migrations:check` runs whenever migrations change.
- CI is per-PR isolated (service containers, concurrency cancellation). The
  browser tier runs once per PR in the dedicated browser workflow.

## Reviewing and merging

Reviews are asynchronous PR comments that the builder's Ralph loop consumes
([reviews](reviews.md)). The builder spawns `/review` and `/code-review`
into its own worktree and asks the architecture reviewer for a pass. No
review is a required status.

Builders never merge. The point guard's flow sweep merges a PR into main
once its builder has emitted `PR_READY` and the required checks are green
at the exact head. The owner may merge any PR at any time.
`bun board:stale` lists tasks whose status disagrees with git.
