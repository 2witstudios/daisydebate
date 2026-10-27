# The slice process

An owner instruction to implement an outcome authorizes agents to carry that
outcome through discovery, planning, building, review and convergence. A
request only to investigate or plan stays in that scope. The owner steers
product intent; agents own routine execution
([ADR 0083](../decisions/0083-lean-gates-and-slice-process.md)).

## The six steps

1. **Semantic slice.** The point guard gives each builder a mission-only
   brief for one slice of the product: the outcome, the drive intent pages
   and ADRs that own it, the PRs and branches it inherits, and the autonomy
   rules. A slice is wide enough that its builder never needs to know what
   other builders are doing.
2. **Builder discovery and plan.** The builder reads the repository, the
   drive and the inherited work itself, and then writes one plan with a task
   list in `Plans/<slice>`. Before writing it, the builder reads:
   - the repository (AGENTS.md, the relevant docs and ADRs);
   - the drive (`Product intent/Product map`, the capability intents and
     their "Constraints other features must respect now" sections, the
     `Issues` buckets touching the slice);
   - the inherited PRs and branches.

   Every task is a `Given X, should Y` criterion with a code. The builder
   posts the plan's link on the pu channel.

3. **One confirmation.** The architecture reviewer and the point guard
   confirm or redirect within minutes. No other approval follows. Product,
   architecture or scope questions that come up later go to the point guard
   on the channel and are answered there.
4. **One PR.** The builder builds the whole slice on one branch and opens
   one PR. The PR title is a conventional commit naming every task code, and
   the body lists the codes and links the plan. The builder commits and
   pushes often, and splits off an earlier PR only when a piece must ship
   first.
5. **Ralph loop.** The builder runs the owner's Ralph loop on its PR,
   verbatim from PageSpace `p4xbp1iwavowuruqpi5fguf7`, until it emits
   `PR_READY`. That requires:
   - zero unresolved threads;
   - three consecutive clean scans;
   - green required checks and no conflicts;
   - the slice plan satisfied.

   After 50 iterations without convergence the loop emits `BLOCKED` with
   what it needs.

6. **Async reviews.** `/review`, `/code-review` and the architecture
   reviewer post PR comments during the loop, and the loop consumes them
   ([reviews](reviews.md)).

The point guard's flow sweep merges once `PR_READY` is out and the required
checks are green at the exact head. The builder then posts `SLICE DONE`, or
its next plan, on the channel.

## Branch development

- Work in your own worktree, on your slice branch. The branch may carry
  incomplete work and red checks between pushes: CI is evidence, not a
  prohibition. Never hide a failure by skipping a test, weakening security
  or inventing a PASS.
- Commits from inherited PRs and branches are carried into your slice branch
  (merge or cherry-pick them). Close each inherited PR in favor of the slice
  PR once the slice branch carries its content. Only main receives merged
  PRs, and no PR is ever merged into another branch.
- Shared surfaces resolve at merge. Whoever merges second regenerates or
  rebases, and the loop's conflict step handles it. Shared surfaces include:
  - migrations: the first ready merges first, and the other regenerates on
    main with `bun db:generate` and then runs `bun migrations:check`;
  - `globals.css`;
  - root configuration.

  Never edit another agent's worktree.

## Checks

Local runs are targeted: typecheck, lint, knip and unit tests for what you
touched. CI is the full gate. Heavy commands queue machine-wide through
`scripts/heavy.ts`.

- `bun check:affected` is the inner loop. `bun check` mirrors the blocking
  CI gates: format, lint, policy, invariants, typecheck, unit tests and
  build.
- `bun run knip`, `bun run duplication`, `bun evidence` and
  `bun metrics:check` are reports. CI runs them in its non-blocking
  "Advisory reports" job, and knip blocks only the nightly main run.
- CI runs the quick check once per PR or main push; a branch push without a
  PR runs no CI, so open the slice PR early. Chromium Playwright runs on every
  PR, and Isolated Room Launch is skipped only when every changed file is
  documentation or in a known non-room area. The
  nightly run on main adds every Playwright project.
- Run `bun migrations:check` whenever migrations change.

Treat a failing check as review input: fix it, or record why it is
environmental, and rerun it once the relevant input changes. Do not churn
an expensive command while its known blocking condition is unchanged.

## Long-running execution

- **Plan as delivery record.** Keep the plan page current with the
  objective, remaining work, decisions and anything a successor needs.
  Resume from it after a context handoff without asking anyone to
  reauthorize.
- **Scope.** Do not silently cut scope or weaken criteria. A changed product
  outcome goes to the point guard. An in-scope finding is remaining work in
  the same PR. A finding outside the slice is filed in `Issues` in the same
  session.
- **Reporting.** Report meaningful milestones, final delivery and real
  blockers on the channel or to the spawning parent. Never wait on the
  owner: the point guard answers product, architecture and scope questions.

## Production and environment protection

- Production identity, secrets, production deploys and production data keep
  explicit human sign-off.
- Staging (Fly org `daisy-debate`) is a builder's to use for proofs; never
  production.
- Agents never copy owner credentials, mutate the parent checkout, reset
  other slots or fake service evidence.
- `bun doctor` validates the active pu launcher, identity and the checkout's
  isolated environment.

## Maintained distribution

The repository's `.claude/skills/` and `policy/agent-pipeline/` are the
reviewable sources for this workflow. `bun pipeline:sync` checks the
installed shared skills and the named Daisy Library pages, and `--apply`
updates them with concurrent content checks and readback. The point guard's
personal copies of the task, handoff, pr and review skills
(`2witstudios/pointguard`) carry the same text as the repository copies.
