# 0912: Public guides, the learning library and stories

Status: accepted, owner decisions in Delivery 2026-11-23 (messages 6885 and
later). Amends the copy rule in
[UI conventions](../development/ui-conventions.md#copy-says-what-the-interface-cannot).

Daisy's reading lives in the app, in public pages, with `/help` as the way
in. There are three homes, and the line between them is "help me use Daisy"
versus "help me get better at debate":

- **Guides** (`/guides`) explain how to use Daisy, task by task, grouped in
  collections such as Judging and ballots.
- **Learn debate** (`/learn`) teaches the craft: deciding a round, writing a
  reason, giving feedback.
- **Stories and updates** (`/stories`) carry what is new. A story points to
  the lasting Guide or Learn article, so good material does not sink into an
  archive.

A Guide and a Learn article link each other wherever a task calls for the
skill: the ballot guide links to writing a reason for decision, and that
article links back to the ballot.

Content is typed TypeScript in `apps/web/src/features/guides`, following
Help's topics. There is no markdown or MDX pipeline and no content
dependency. Copy links with `[label](/path)`, to local paths only.

Every Guide lists the repository files its product claims were checked
against (`sources`) and the day they were checked (`updated`). A unit test
fails when a cited file, a related article or a link in the copy no longer
resolves, so drift shows up at the change that causes it. Agents write and
own Guides, Learn and Stories; the accuracy gate is the review of each
article against its sources.

A guide for a feature behind a release flag takes the same flag. It renders
for exactly the viewers who have the feature and is not found for everyone
else, like the feature's own pages.

The repository's `docs/` is the only copy of the technical documentation.
The PageSpace documentation pipeline, which wrote user and technical
Canvases from merged code, is retired in a separate change once its shared
constants move (GUIDES-7). PageSpace stays the product tracker and links to
the canonical guides.

Guides own explanation. A screen that needs more than its labels links to
the guide that owns it rather than explaining in place; the onboarding steps
remain the introduction.
