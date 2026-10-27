# 0083: Lean gates and the slice process

Status: accepted (owner decision, 2026-10-27).

Supersedes the review-evidence rules of [ADR 0064](0064-greenfield-feature-integration-and-review-evidence.md)
and the main-acceptance, review-record and receiving-branch rules of
[ADR 0065](0065-branch-autonomy-and-main-acceptance.md). Amends
[ADR 0013](0013-knip-dead-code-gate.md) and [ADR 0026](0026-duplication-gate.md).

## Context

The delivery process churned. On 2026-10-27 the owner sampled one day:

- About 60 small leaf PRs were spread across about 20 sessions.
- Main broke twice from back-to-back merges.
- Green PRs sat unmerged for hours.
- A hung builder's review findings were lost.

Of 15 sampled PR failures, 8 were rule churn and 5 were real defects. The
churn came from max-lines and complexity ceilings, 100% coverage floors and
zero-clone duplication. The browser suites had no real failures: every
browser red was a cascade from a quick-check failure.

Four causes stood out:

1. **The quick check ran three times per push.** The `pu/**` push trigger,
   CI and Browser E2E each started it. An 11-job matrix then reran format,
   lint, knip, duplication, typecheck and tests on top.
2. **Every push needed a new review.** The required `review-record` status
   wanted a fresh independent record for each head SHA, which fought a
   convergence loop that pushes many times.
3. **The skills split work too thin.** The point guard's personal skills
   said "one leaf = one PR, 1–3 files" and "never spawn before owner
   approval", so work fragmented into slices so thin that agents had to
   track each other.
4. **Isolated Room Launch was the long pole.** At about 31 minutes, it ran
   on every PR whatever the PR touched.

## Decision

### The slice process

1. **Slices.** One Claude builder owns each semantic slice of the product,
   wide enough that it never needs to know what other builders are doing.
   Its brief is a mission: the outcome, the owning intent pages and ADRs,
   and the PRs and branches it inherits. The brief contains no research.
2. **Discovery and plan.** The builder does its own discovery, then writes
   one plan with a task list in `Plans/<slice>` and posts it on the pu
   channel.
3. **One confirmation.** The architecture reviewer and the point guard
   confirm or redirect the plan. No other approval follows.
4. **One PR.** The builder builds the whole slice on one branch and opens
   one PR naming every task code. It splits off an earlier PR only when a
   piece must ship first. Commits from inherited branches are carried into
   the slice branch, and only main ever receives a merged PR.
5. **The Ralph loop.** The builder converges the PR with the owner's Ralph
   loop (PageSpace `p4xbp1iwavowuruqpi5fguf7`, run verbatim). The loop ends
   only when all of these hold:
   - zero unresolved review threads;
   - three consecutive clean scans;
   - green required checks and no conflicts;
   - the slice plan is satisfied.

   It then emits `PR_READY`.

6. **Async reviews.** `/review`, `/code-review` and the architecture
   reviewer post PR comments, which the loop consumes. Reviews are not a
   required status.
7. **Merge.** The point guard's flow sweep merges once the builder has
   emitted `PR_READY` and the required checks are green at the exact head.
   It merges at most two PRs per cycle. The owner may merge any PR at any
   time.

Board Done follows the merge. `scripts/merge-followup.ts` moves a merged PR's
tasks to Done when the PR's latest review verdict line approves with no open
blocker or major; otherwise it moves them to Merged, where the board keeper
reconciles them.

### Lean gates

| Gate                                                     | Now                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quick check (`check:affected`)                           | Once per push, from `ci.yml` only. Owns format, lint, boundaries, styling, root script tests and turbo typecheck and unit tests (affected on PRs, full on main).                                                                                                   |
| CI matrix                                                | `policy`, `invariants`, `build`, plus image, audit, migrations and Infrastructure contracts. Nothing the quick check runs.                                                                                                                                         |
| ESLint `max-lines` / `complexity`                        | Warnings. The loop's `/simplify` pass acts on them.                                                                                                                                                                                                                |
| Coverage floors (`metrics:check`), jscpd, `bun evidence` | Reports in the non-blocking "Advisory reports" job. Not in `bun check`.                                                                                                                                                                                            |
| knip                                                     | Warns on PRs; blocks the nightly scheduled CI run on main, which posts failures to Incidents.                                                                                                                                                                      |
| Playwright                                               | Chromium only on PRs, main pushes and the queue. The nightly run on main runs every project: engines, mobile layouts and visual.                                                                                                                                   |
| Isolated Room Launch                                     | Required, but a PR skips it when every changed file is documentation or in a known non-room area (admin, theme, dashboard, shell, beta gate, agent process files). Anything else runs it, unknown paths included, and the gate passes a skip only for that reason. |
| `review-record`                                          | Deleted with its workflow, scripts, App wiring and review-debt automation.                                                                                                                                                                                         |

The required checks are now CI gate, Playwright E2E and Isolated Room Launch
E2E, all from GitHub Actions. `bun check` mirrors the blocking CI gates:
format, lint, policy, invariants, typecheck, unit tests and build.

## Consequences

- **A non-room PR** runs one quick check, a three-task matrix, integration,
  image and Chromium Playwright. Room Launch skips as a pass, so the run
  finishes in well under the old 35 minutes.
- **Rule churn stops blocking.** Oversized files, new clones, coverage dips
  and knip findings surface as warnings. Knip debt still cannot settle
  silently on main, because the nightly run fails on it.
- **Cross-browser and visual regressions surface nightly, not per PR.** A
  nightly failure posts to Incidents and is fixed by the owning slice.
- **The path filter fails safe.** It skips only on an allowlist of
  non-room areas, so a new or unknown path runs the suite. A regression that
  comes through an allowlisted area is caught on the main push that
  follows; main pushes, merge groups and dispatches always run the suite.
- **Affected-only checks can still break main.** PRs run typecheck and
  unit tests on the affected turbo graph, and no merge queue retests a PR
  against the latest main. Two PRs can each pass and still conflict once
  both merge. Every main push runs the full quick check, and a red main is
  fixed first. The flow sweep merges at most two PRs per cycle and checks
  main after each batch.
- **Done needs a trusted approval of the merged head.** A merge moves tasks
  to Done only when the PR's latest `## Review:` comment from a repository
  collaborator names the merged head SHA, declares a reviewer other than the
  builder, and approves on a whole verdict line. Until the agent machine
  identity exists (GRD-6.2), builders and reviewers share the owner's
  account, so the Reviewer/Builder line is a declaration, not a proof.
  Anything short of these conditions leaves the tasks in Merged for the
  board keeper.
- **Review quality is the loop's job, not a status check.** `PR_READY`
  cannot be emitted with an unresolved thread or a red check.
- **The live ruleset changes only through the owner.** The owner applies it
  with `bun github:rules --apply`. Deleting the review-record GitHub App,
  its `review-record` environment, the `REVIEW_RECORD_APP_KEY` secret and
  the `REVIEW_RECORD_APP_ID` variable is the owner's follow-up (PROC-8),
  because these are production identity actions.
