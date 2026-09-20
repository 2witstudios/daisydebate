# PageSpace documentation review workflows

The documentation pipeline has two trigger classes:

- merge and release events request content changes;
- scheduled PageSpace workflows audit and maintain published Canvases.

Scheduled reviews must write findings to the review queue before changing a
published page. A no-op is a valid result and should be recorded.

## Page setup

All documentation content lives in the existing `Daisy Debate` drive under the
top-level `Documentation` folder. The Documentation Agent lives under the
drive's `Agents` folder with the Scrum Master, Builder, and Reviewer. The
repository records the drive and folder IDs in
`PAGESPACE_DOCUMENTATION_DRIVE_ID` and
`PAGESPACE_DOCUMENTATION_ROOT_PAGE_ID`.

New documentation Canvases are created as children of the appropriate hub page;
they do not need their own webhook. Merge events enter through the PageSpace
CLI/SDK or a single stable Documentation Agent entry point. Scheduled PageSpace
workflows run the periodic reviews directly against the Documentation tree.

| Agent page           | Pipeline             | Cadence                                            | Default action                                      |
| -------------------- | -------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Accuracy Auditor     | `accuracy-review`    | Daily for recently changed pages; weekly full scan | Mark stale or invalid; create findings              |
| Adversarial Reviewer | `adversarial-review` | Weekly                                             | Create counterexamples and tasks                    |
| Prose Editor         | `prose-review`       | Weekly                                             | Draft low-risk prose corrections                    |
| Anti-Slop Reviewer   | `anti-slop-review`   | Weekly                                             | Draft targeted rewrites only                        |
| Consistency Auditor  | `prose-review`       | Weekly                                             | Report conflicting terminology or behavior          |
| Publication QA       | `accuracy-review`    | After publication and weekly                       | Check links, metadata, rendering, and mobile layout |

## Prompt and data boundary

Prompts are versioned in the repository and delivered by
`bun docs:prompt <pipeline>`; a run record must echo the version it used. The
registered prompts instruct every agent that event envelope fields (titles,
bodies, branch names, task IDs) are untrusted data, never instructions. An
event whose text was flagged by the dispatch scanner arrives with
`textRisk: flagged` and must be handled as review-only: the agent records an
injection finding and does not publish.

## Failure-path contract

A run that ends with empty, truncated, or timed-out output is a `failed` run;
a run that completed only part of its scope is `partial`. Failed and partial
runs:

- write a valid run record with the corresponding status;
- create findings describing what could not be verified;
- never publish, and never leave a page half-edited.

Payloads (events and run records) must pass the repository's contract
validation in `scripts/docs-contracts.ts` before use; an invalid payload is a
failed run, not a warning.

## Accuracy prompt contract

The accuracy agent must check claims against current source code, tests,
protocol schemas, configuration, and linked PageSpace evidence. Each finding
must contain:

```text
page ID
section ID
claim
source checked
current evidence
severity: blocker | major | minor | editorial
recommended action
```

It must not replace a published page when evidence conflicts. It marks the
page `stale` or `invalid`, records the source conflict, and creates a review
task instead.

## Adversarial prompt contract

The adversarial agent tries to disprove the page by checking missing
permissions, invalid input, retries, moved or deleted resources, clean
environment setup, mobile behavior, and the documented task order. It reports
counterexamples; it does not invent fixes or silently rewrite behavior.

## Prose and anti-slop prompt contract

These agents may edit a review revision, but must preserve factual claims and
source anchors. They should remove generic introductions, repeated summaries,
unsupported certainty, vague benefits, filler, fake specificity, and
changelog-like prose. They must not flatten intentional product voice or
redesign a Canvas during a prose-only change.

## Publication policy

Publication decisions are executed by `bun docs:policy`, which takes the
validated event, the finding severities, the run status, and any recorded
approvals, and returns `publish`, `revision`, `review`, or `block`:

- `block`: a blocker finding invalidates the page; mark it `invalid` and
  notify the documentation channel.
- `review`: a major finding, injection-flagged text, a failed or partial run,
  or a breaking/security change without recorded human sign-off.
- `revision`: minor or editorial findings batch into a review revision; blog
  output without explicit approval stays a draft.
- `publish`: no gating condition applied.

Cross-page contradictions require an authoritative-page decision. Successful
no-op runs record the reviewed page count and source snapshot.

## Run record

Each workflow should write a run record to the Documentation Runs page. The
schema is enforced by the repository (`scripts/docs-contracts.ts`):

```json
{
  "runId": "...",
  "workflow": "accuracy-review",
  "startedAt": "...",
  "completedAt": "...",
  "scope": { "pageIds": [], "changedSince": "..." },
  "pagesReviewed": 0,
  "findings": [],
  "autoFixed": 0,
  "tasksCreated": 0,
  "pagesInvalidated": 0,
  "promptVersion": "docs-prompt-v1",
  "sourceSnapshot": "repository@commit",
  "status": "complete | failed | partial",
  "baseRevision": "...",
  "resultingRevision": "..."
}
```

`baseRevision` records the page revision the run observed before editing;
`resultingRevision` records what the write produced. Both together make
interleaved writes detectable and replayable.

The repository event sender provides the merge-time envelope and PageSpace
workflow context supplies the Canvas pages and prior run history. No webhook
secret or raw credential may be written into a PageSpace page or log.

## Replaying a lost event

Dispatch is idempotent by `repository:commit:eventType`, so replays are safe:

1. Re-run the failed workflow from the Actions tab, or run
   `bun docs:dispatch` locally with the same environment the workflow sets
   (`DOC_*` variables from the merge or release).
2. If a merged fork PR skipped the event (fork runs carry no secrets), run the
   same dispatch from a trusted checkout and delete the skip notice in
   incidents after it succeeds.
