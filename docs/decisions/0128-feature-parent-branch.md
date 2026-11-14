# 0128: A feature parent branch, and a PR loop that stops

Status: accepted (owner direction, 2026-11-13; decisions 57 and 58 on
[Daisy Tab › Direction](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/jro30yyuynd11e7qzjfdby0u)).
Amends [ADR 0083](0083-lean-gates-and-slice-process.md) for slices of a
feature the owner has named here, and for nothing else.

## Context

ADR 0083 has every slice merge to main and converge through the universal PR
loop. Two things in the record of the runs since then
([what past runs cost](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/w9ziawm09eb16cet5qd0z0is))
make that a poor fit for a feature built as several large slices:

- **The loop has no stopping rule.** 40% of all PR-hours (595 of 1,471) came
  after a PR's first review with no blocker and no major, and 55% of reviews
  fell in that tail. The universal loop asks for continued improvement and
  three consecutive clean scans; each fix moves the head and draws a fresh
  review with no memory of the last. The tail was not empty (137 blockers and
  majors, mostly from defects the fixes introduced), so review cannot simply
  end at the first approval.
- **Slices chase main.** A PR re-merges main and re-runs CI each time main
  moves, and merges that are each green break main together (27 October,
  3 November, 7 November).

The owner builds a feature of this size by locking the interface, then the
schema, then connecting them. The interface cannot reach main alone: the
sample tournament screens merged that way were deleted in #615 with nothing
behind them.

## Decision

1. **A feature parent branch.** The owner may name one branch as the parent
   of a feature. Today there is one: `pu/daisy-tab`, for Daisy Tab. A slice of
   that feature branches from the parent, is named `pu/daisy-tab-<slice>`, and
   opens its one PR against the parent (`gh pr create --base pu/daisy-tab`).
   This is the only case in which a PR merges into a branch other than main.
2. **The feature has one point guard**, named in the feature's run book
   (Daisy Tab: [run book](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/t3w4s5fzt3gbo4tsluo97ktp)).
   It merges into the parent one PR at a time, after the slice's builder
   emits `PR_READY` and the required checks are green at the exact head.
   The two-per-cycle sweep on main does not apply to the parent. Builders
   still never merge.
3. **The parent's own checks are a standing draft PR from the parent to
   main**, opened at the first merge into the parent. CI runs on pull
   requests, not on pushes to the parent, so this draft PR is what runs the
   full CI on the parent after each merge and shows whether the parent
   still merges cleanly with main. Its title says it is not to be merged,
   no builder emits `PR_READY` on it, and the sweep on main leaves it alone.
   - Its CI tests the parent merged with main. When it goes red after a
     merge, the point guard first checks whether main moved; if it did,
     taking main in is the fix. Otherwise the builder of the merged slice
     fixes it, and nothing else merges into the parent first.
   - GitHub runs no pull-request CI while the draft PR conflicts with main,
     so a conflict is resolved by taking main in before the next merge.
4. **The parent takes main in at slice boundaries.** The point guard merges
   `origin/main` into the parent and pushes it; this is the one direct push
   to the parent. A slice merges the parent into itself only when the two
   conflict or the point guard says the parent moved. Slices never merge
   main.
5. **The parent merges to main once**, when the feature is whole: the
   standing draft PR is marked ready and goes through ADR 0083 as an
   ordinary PR with the owner's sign-off. Until then the feature stays
   behind its closed flag.
6. **The PR loop for these slices stops.** They run PR Loop (Feature slice)
   (`ptq5uh3pf2t654xw2kdmky44`, Product › Daisy Tab) in place of the universal
   loop. It ends when the latest review has zero blockers and zero majors at
   the current head, the required checks are green, there is no conflict with
   the parent, and the slice's proof passes with its output shown in the PR.
   There is no three-clean-scans condition.
7. **A fix is reviewed as a difference.** When a fix changes product code
   after a review, the builder spawns one reviewer with `/review <PR url>`
   and adds to the prompt the link to the earlier review comment and the
   range `<reviewed sha>..HEAD`. That reviewer checks the earlier findings
   and the new commits only, and ends with a verdict line as usual. A fresh
   full review of the whole PR is not requested.
8. **Findings after the first clean verdict, and findings outside the
   slice, go on the feature's findings list**, a PageSpace channel the run
   book names (Daisy Tab: Tab findings `djo6x2xc9mqtxwv5v43gwr36`). For these
   slices this replaces filing in `Issues` in the same session. At each
   slice boundary the point guard reads the list and, for every item, folds
   it into the next slice's plan, files it in `Issues`, or drops it with a
   reason, so no finding lives only in a comment.
9. **`BASE_REF=origin/pu/daisy-tab bun check:affected` runs before every
   push.** Without `BASE_REF` it compares against main. Formatting, lint and
   type errors are not for CI to find.
10. **Each slice names one proof that it is done**, and the PR description
    shows that proof failing on the parent and passing on the branch.
11. **The board follows merges into the parent as it does merges into main.**
    The merge follow-up runs on any merged PR, so a slice's tasks move to
    Done or Merged when it merges into the parent. For this feature Done
    therefore means merged into the parent with an approving review. Whether
    the feature is on main is tracked on its status canvas, not the board.

## Consequences

- Staging deploys from main, so the feature is not on staging until it
  lands or the owner arranges a deployment of the parent. The wiring
  slice's proof needs one.
- After the schema slice, each time the parent takes main in its migrations
  are re-ordered behind main's (`bun migrations:check`). That is the cost of
  holding the schema on a branch.
- The final PR to main is large. It is reviewed as the sum of slices that
  were each reviewed, and its risk is carried by the closed flag.
- **Decision records for the feature go to main, not the parent.** A slice
  that needs one opens it as its own docs-only PR to main, where
  `bun adr:next` claims numbers as usual, and the slice refers to it. A
  record held only on the parent would not be reliably claimed: the claim
  check reads at most 100 files of an open PR. This record went to main for
  the same reason.
- A fix pushed after an approval moves the head, so a slice's tasks may
  land in Merged and not Done, as on main.
- Everything else in ADR 0083 stands: one plan, one confirmation, one PR per
  slice, async reviews, the CI gate.
- This is not a general licence for long-lived branches. A second feature
  parent needs the owner to name it here.
