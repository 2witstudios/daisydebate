# 0128: A feature parent branch, and a PR loop that stops

Status: proposed (owner direction, 2026-11-13; decisions 57 and 58 on
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
   opens its one PR against the parent. This is the only case in which a PR
   merges into a branch other than main.
2. **One point guard merges into the parent**, one PR at a time, after the
   slice's builder emits `PR_READY` and the required checks are green at the
   exact head. After each merge the parent's own checks run and are green
   before the next merge. Builders still never merge.
3. **The parent takes main in at slice boundaries**, by the point guard, not
   by slices. A slice merges the parent into itself only when the two
   conflict or the point guard says the parent moved.
4. **The parent merges to main once**, when the feature is whole, as an
   ordinary PR under ADR 0083 with the owner's sign-off. Until then the
   feature stays behind its closed flag.
5. **The PR loop for these slices stops.** They run PR Loop (Feature slice)
   (`ptq5uh3pf2t654xw2kdmky44`, Product › Daisy Tab) in place of the universal
   loop. It ends when the latest review has zero blockers and zero majors at
   the current head, the required checks are green, there is no conflict with
   the parent, and the slice's proof passes with its output shown in the PR.
   There is no three-clean-scans condition.
6. **A fix is reviewed as a difference.** When a fix changes product code
   after a review, one reviewer is given the earlier findings and the commits
   since that verdict. A fresh full review of the whole PR is not requested.
7. **Findings after the first clean verdict, and findings outside the
   slice, are listed, not looped on.** They go on the feature's findings list
   and are read at each slice boundary.
8. **`bun check:affected` runs before every push**, against the parent.
   Formatting, lint and type errors are not for CI to find.
9. **Each slice names one proof that it is done**, and the PR description
   shows that proof failing on the parent and passing on the branch.
10. **The board is moved by hand for these merges.** `merge-followup` runs
    on merges to main only, so the point guard moves a merged slice's tasks
    to Merged; they reach Done when the parent lands on main.

## Consequences

- Staging deploys from main, so the feature is not on staging until it
  lands or the owner arranges a deployment of the parent. The wiring
  slice's proof needs one.
- After the schema slice, each time the parent takes main in its migrations
  are re-ordered behind main's (`bun migrations:check`). That is the cost of
  holding the schema on a branch.
- The final PR to main is large. It is reviewed as the sum of slices that
  were each reviewed, and its risk is carried by the closed flag.
- Everything else in ADR 0083 stands: one plan, one confirmation, one PR per
  slice, async reviews, the CI gate.
- This is not a general licence for long-lived branches. A second feature
  parent needs the owner to name it here.
