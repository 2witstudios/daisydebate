# 0159: Signals that gate

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
piece A). Supersedes [ADR 0098](0098-ci-gate-only-while-greenfield.md).
Amends [ADR 0083](0083-lean-gates-and-slice-process.md) (knip, the PR loop's
stopping rule, who reviews) and [ADR 0128](0128-feature-parent-branch.md) §6
(its stopping rule now applies to every slice).

## Context

Measured on the 60 PRs merged from 16 to 19 November 2026:

- The browser suite ran only after merge. Main was red on 30 of 44 runs and
  for 49 of 66 hours, and five slices repaired it by hand. The failures read
  were stale assertions merged without running the suite, not flaky tests.
  Isolated Room Launch ran 155 tests in series for 51 to 71 minutes.
- Staging has real testers ([ADR 0098](0098-ci-gate-only-while-greenfield.md)
  made its trade "while nobody depends on staging").
- 42% of commits were fixes. 77 of 159 reviews came after the PR's first
  clean verdict and found 12 blockers or majors against 88 minors or nits:
  an approval had to name the merged head, so every fix drew a fresh full
  review, and the loop asked for three clean scans.
- 40 requests for an architecture pass drew one answer.
- The nightly run had failed every night since at least 7 November: knip as a
  report had reached 426 unused exports and types, the all-project browser run
  was cancelled at its 20-minute bound, and Bun's 5-second test default failed
  a different integration test each night.
- A dependency advisory published overnight failed every open PR.
- `bun lint` ran a side-literal check that the PR quick check did not, and
  main had drifted to eight violations.

## Decision

1. **The browser suite gates PRs.** `e2e.yml` runs on `pull_request`. The
   `main` ruleset requires `CI gate`, `Playwright E2E` and
   `Isolated Room Launch E2E`. A newer push to a PR replaces its run in
   progress; main, nightly and dispatched runs still each finish.
2. **Launch runs as five shards**, each on its own machine, slot and stack.
   No case is dropped.
3. **Nothing merges while main's latest Browser E2E run on a push is red**,
   except the PR that fixes it or reverts what broke it. The nightly
   all-project run does not hold merging. Staging still deploys on a green
   CI gate without waiting for Browser E2E.
4. **knip is a required check** (the `checks` matrix). A script started by
   path is an entry in `knip.jsonc`. The production pass
   (`bun run knip:production`) stays a report until its list is empty.
5. **The live dependency audit runs when a branch changed a dependency
   input, and nightly on main.** A branch that cannot be compared with main
   is audited. `DAISY_LIVE_AUDIT=1 bun run audit` audits by hand.
6. **Integration suites run under an explicit 30-second test deadline.**
7. **The quick check runs every repository-wide check `bun lint` runs.**
8. **Every PR loop stops at the first review verdict with zero blockers and
   zero majors**, with required checks green, the proof shown and a reply on
   every thread. One full review; after it, a fix that changes product code
   gets a difference review of the new commits only. There is no
   three-clean-scans condition.
9. **An approval counts when it names any commit of the PR.** A later
   difference review that finds a blocker or a major is the latest verdict
   and decides.
10. **`/review` and `/code-review` are the reviewers.** Nobody is asked for a
    separate architecture pass, a plan is confirmed by the point guard, and a
    hosted review app's threads never hold `PR_READY`.

## Consequences

- A PR waits for the browser suite: about 25 minutes in place of an hour of
  red main. Every PR push starts nine browser jobs, less those a newer push
  cancels.
- A fix pushed after an approval is not itself reviewed unless it changed
  product code and the builder asked for the difference review. The required
  checks still run at the new head.
- The owner applies the ruleset with `bun github:rules --apply` once this
  merges; until then the browser checks run on PRs without being required.
- The PR loop pages in PageSpace Resources › Universal prompts carry rule 8;
  they are edited there, not in this repository.
