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

The workflow prompt should include the target Canvas page IDs, the review
scope, the current repository commit, and the requirement to preserve stable
semantic sections and the page's visual language.

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

- Blocker and major accuracy findings: mark the page `stale` or `invalid` and
  notify the documentation channel.
- Minor factual corrections: create a review revision with provenance.
- Editorial and anti-slop corrections: batch into weekly review revisions.
- Cross-page contradictions: require an authoritative-page decision.
- Blog revisions: remain drafts unless the blog publication policy explicitly
  allows automatic publishing.
- Successful no-op runs: record the reviewed page count and source snapshot.

## Run record

Each workflow should write a run record to the Documentation Runs page with:

```json
{
  "runId": "...",
  "workflow": "accuracy-review",
  "startedAt": "...",
  "completedAt": "...",
  "scope": { "pageIds": [], "changedSince": "..." },
  "pagesReviewed": 0,
  "findings": 0,
  "autoFixed": 0,
  "tasksCreated": 0,
  "pagesInvalidated": 0,
  "promptVersion": "...",
  "sourceSnapshot": "...",
  "status": "complete"
}
```

The repository event sender provides the merge-time envelope and PageSpace
workflow context supplies the Canvas pages and prior run history. No webhook
secret or raw credential may be written into a PageSpace page or log.
