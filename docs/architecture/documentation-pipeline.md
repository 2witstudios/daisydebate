# Canvas documentation pipeline

PageSpace Canvas pages in the `Daisy Debate` drive are the canonical published artifacts for technical
documentation, user-facing documentation, and blog posts. Git is the evidence
source: commits, pull requests, changed files, tests, releases, and task IDs
are sent to PageSpace as a versioned event envelope.

The documentation tree starts at the top-level `Documentation` folder in that
drive. It is not a separate drive and new content must be created below this
folder. The `Documentation Agent` lives in the sibling `Agents` folder beside
the Scrum Master, Builder, and Reviewer agents, and owns the page discovery and
creation workflow.

## Event flow

1. A merge or release produces a structured documentation event.
2. Deterministic classification selects technical docs, user docs, blog, or a
   no-op. A bug fix with no changed contract must not create documentation work.
3. The local Bun CLI or CI invokes the PageSpace Documentation Agent in the
   existing drive using the drive-scoped PageSpace CLI/SDK credential.
4. The agent lists the Documentation folder, finds the registered page, and
   creates a child page when no suitable page exists.
5. The agent edits a review Canvas or review revision, not an unrelated page.
6. Accuracy, adversarial, prose, and anti-slop checks validate the candidate.
7. The workflow publishes only according to the page's risk policy.

## Canvas contract

Each canonical page should retain stable semantic sections and a provenance
manifest. Content updates must preserve the page's visual language and update
only affected sections where possible. The manifest records the source commit,
changed paths, task IDs, prompt and validation versions, content/source hashes,
publication state, and invalidation history.

Recommended states are `fresh`, `needs-review`, `stale`, `invalid`, and
`superseded`. Deleted or renamed source behavior invalidates dependent sections;
an unrelated bug fix leaves them unchanged.

## Scheduled maintenance

Merge-triggered workflows create or update content. Scheduled PageSpace
workflows maintain it:

- accuracy audit: compare claims, examples, links, and source anchors with the
  current repository;
- adversarial review: try invalid inputs, missing permissions, retries, moved
  resources, and clean-environment workflows;
- prose review: improve clarity and reader task completion without changing
  facts;
- anti-slop review: remove generic introductions, repetition, unsupported
  claims, and templated AI phrasing;
- consistency review: detect contradictory terminology and behavior across
  pages;
- publication QA: check rendered Canvas layout, mobile behavior, metadata, and
  public links.

Review workflows write findings and create tasks before making high-risk edits.
Low-risk prose fixes may be applied to a review revision. A successful no-op is
also recorded as a run result.

## Safety rules

- PageSpace writes are idempotent by repository, commit, event type, and stable
  documentation key.
- The PageSpace token is server-only and never included in logs or Canvas
  content.
- AI agents must cite source paths and commits for technical claims.
- Published pages are not rewritten when source evidence conflicts; they are
  marked stale and routed to review.
- Blog publication requires an explicit blog classification or task marker.
