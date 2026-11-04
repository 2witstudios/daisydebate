# Work management

All repository work is planned in the PageSpace "Daisy Debate" drive, through
the `pagespace` CLI. [AGENTS.md](../../AGENTS.md#addresses) holds the drive,
Project Status and channel ids.

Codex must run the `pagespace` CLI outside its sandbox, requesting command
escalation when required. The sandbox can block network access or access to
the CLI's stored credentials; a failure inside it is not evidence that no
credential exists. Retry sandbox-blocked PageSpace commands with escalation
before diagnosing missing credentials or asking the owner to log in. Never
print credentials or copy them into the worktree to bypass the sandbox.

## The drive

The root is Table of Contents, General Discussion (the human channel),
Product, Resources, Agents and Business:

- `Product` holds everything about building Daisy: Vision; Project Status
  (every area scored on Features, Stable, Hardened, Scale and Spec, plus what
  is in flight now); `Product intent`, one page per area with its purpose,
  Score block, "What 100% means", constraints, tensions and future intent;
  `Roadmap` (epics, phases and leaves); `Issues`; `Plans`, `Prompts` and
  `Reviews`; and `Documentation`.
- `Resources` holds reusable material: `Designs` and `Universal prompts` (the
  PR loops).
- `Agents` holds the agent channels (Delivery, Standup, Epic Updates,
  Incidents) and the Documentation Agent.
- `Business` holds founder material.

PageSpace is the workspace, not only the board. The slice plan and its task
list live in `Plans/<slice>`, mission briefs and shared rules in `Prompts`,
and reusable prompts in `Resources/Universal prompts`. Reviews live on the
PR. Tasks mention the plan and the PR in their Related pages; documents use
page mentions, and GitHub descriptions and comments use verified PageSpace
URLs. Never upload credentials or environment secrets to PageSpace. Obsolete
pages go to the PageSpace trash, which is restorable: there is no Archive
folder and no pointer or index page that only repeats another page. Moves keep
page ids, direct task-list membership, criteria and status.

## Work intake

Start at Product → Project Status, then the area's Product intent page.
Before planning or building, read:

- the applicable `Product intent` area pages: Score, "What 100% means" and
  "Constraints other features must respect now";
- the affected-capability links (Rooms/realtime to Spectating, Formats to
  Judging, Messaging to Privacy).

Link these sources from the slice plan. Future intent constrains current
work without creating a future task tree. Design work extends the existing
shipped UI and canvases in `Resources/Designs`.

Project Status is generated from the area pages' Score blocks by
`bun progress:sync`; change a score on its area page, never on the canvas.

## Task status

Record and claim work within the owner-authorized outcome; board
administration never reauthorizes the same outcome. Advance In Progress to In
Review when the slice PR opens. A merge moves the PR's tasks to Done when its
latest review verdict approves, otherwise to Merged ([reviews](reviews.md)).
Status belongs in the status field; task bodies are acceptance criteria
(`Given X, should Y`). Every agent keeps its tasks current, but none grants
Done or edits a task's criteria or scope, including a task its run appears to
satisfy: Done comes from the merge automation
([ADR 0083](../decisions/0083-lean-gates-and-slice-process.md)). Board and scratch-versus-durable-artifact rules are in
[parallel work](parallel-work.md#branch-and-worktree-hygiene); they apply to
every agent, worktree or not.

## Issues

Work that is not an epic leaf goes in the `Product/Issues` task list, always
inside one of its buckets (Bugs, Test coverage, Agent tooling, Doc and spec
drift, User feedback, Backlog, Pending decisions), never directly under
Issues and never in GitHub Issues. `bun board:create --issue --bucket <name>`
files it, and `bun board:stale` fails on an issue left directly under
Issues.

It holds defects found after the owning leaf is Done, review findings and
minors with no open leaf to carry them, and small non-epic improvements. The
test is whether an open leaf owns it: if one does, the finding is a follow-up
leaf under that phase regardless of merge state.

Title `ISSUE-n — Given X, should Y`; the body records origin (PR, review
comment, reporter), why, and the acceptance criteria; the Related pages block
links the origin. An issue closes through a PR that names it, or is promoted
to an epic leaf when it grows into feature work. `Issues/Backlog` holds
feature candidates awaiting a spec, and `Issues/Pending decisions` the open
owner decisions.

Filing is an obligation: whoever observes a defect or a deferrable
improvement — reviewer, builder, or orchestrator — creates the leaf or issue
in the same session rather than mentioning it in prose, because an
observation that lives only in a comment or a handoff is lost once the PR
merges. During discovery, the slice builder reads every `Issues` bucket for
anything touching its slice and carries it into the plan; a slice cannot
close while any issue it produced is untriaged (promoted, scheduled, or
deferred by the owner with a reason).

## Pull requests

Open and update pull requests with the `/pr` skill: the description links
the plan, prompt and task pages so a reviewer can check the change against
what was asked. PR titles are conventional commits: the documentation
pipeline classifies a merge from that prefix (`!` marks a breaking change)
and reads task codes from the title, branch and body, so name every task
code in full (`AUTH-3.1`, `AUTH-3.2`, never `AUTH-3.1–3.6`). Reviews are PR
comments in the [reviews](reviews.md) format, and the builder's PR loop
consumes them.

## Reporting

Parallel sessions follow [parallel work](parallel-work.md): one branch and one
PR per slice, and execution changes update the plan without a new approval
relay; changed product intent or scope cuts go to the point guard on the
Delivery channel. The orchestrator owns Agent Memory writes.

Report meaningful milestones, final delivery, genuine blockers and actual
writer conflicts directly to the spawning parent. Use the designated PageSpace
channels for requested standups, epic milestones, merge discussion and
incidents; do not duplicate routine task administration as messages or wait
for acknowledgments. Keep durable environment findings in Agent Memory.
Deploy-rail and production-data changes require a human-only sign-off leaf;
agents never self-approve.
