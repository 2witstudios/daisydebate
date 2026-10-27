---
name: task
description: >
  Plan a semantic slice (or an epic) after your own discovery: one plan with a task list in the
  repo's PageSpace drive (Plans/<slice>), posted for one confirmation, then built as one PR.
  Use when asked to plan a slice or epic, break work into board tasks, sync progress, replan, or
  check the board against the plan, or when the user says "/task", "/task sync", "/task replan",
  "/task validate".
compatibility: Requires the pagespace CLI with an active key, gh, and pu for the channel. In a repository with bun board:*, bun decision:record or bun adr:next (Daisy) it uses them.
---

# 🗺️ task

Act as the builder who owns a semantic slice end to end. The process is:
**semantic slice → your discovery and plan → one confirmation → one PR → Ralph loop → async reviews.**
This skill covers the planning half; `/pr` and `/handoff` cover the rest.

Constraints {
AGENTS.md governs. Read it first for the drive id, the board, the channel and the task-code prefixes in use. No drive declared => keep the plan in the PR description and say so.
Discovery is yours. A mission brief names the outcome, the owning intent pages and ADRs, and the PRs and branches you inherit; it never contains research, so do the research yourself.
One plan, one confirmation. Post the plan link on the pu channel; the architecture reviewer and the point guard confirm or redirect. Never wait for another approval after that, and never wait on the owner: product, architecture or scope questions go to the point guard on the channel.
One PR per slice. A task is a provable outcome, not a PR: there is no file-count, line-count or one-PR-per-task rule. Split off an earlier PR only when a piece must ship first.
A decision you make on someone's behalf is recorded (`bun decision:record` when present, otherwise the plan's Decisions list). Never bury one as "please confirm".
Never edit the criteria of a task someone else delegated to you; take a change to whoever owns it.
Never invent a page id; verify with `pagespace pages read-details <id>`.
Never put secrets, tokens or .env material in a page or message.
}

## Process

### 1 — Discover

discover() {

1. Read AGENTS.md, the docs and ADRs your slice touches, and the code itself.
2. Read the drive: `Start here`, `Product intent/Product map`, the capability intents for your slice and their "Constraints other features must respect now" sections, the affected-capability links, and every `Issues` bucket for items touching your slice.
3. Read every PR and branch you inherit: what each one carries, its head SHA, its open review threads, and whether its CI is green.
4. Resume rather than duplicate: search the drive for an existing plan or epic for this slice (`pagespace search text "<slice>" --drive <id>`).
   }

### 2 — Plan

plan() {

1. Create `Plans/<slice>` if missing, then one DOCUMENT `Plan — <slice>`. Sections, in order:
   - Outcome: what is true when the slice merges.
   - Sources: the intent pages, ADRs, mission prompt and inherited PRs (page mentions; GitHub URLs for PRs).
   - Discovery findings: the facts that shape the design.
   - Design: what changes, where, and why; migrations and ADRs (numbers from `bun adr:next`, announced on the channel when you claim one).
   - Task list: one line per task, `<CODE> — Given X, should Y`. Reuse existing codes for inherited leaves and issues; new tasks take the slice's prefix. Human-only tasks are marked `(human, <who>)`.
   - Verification: local targeted checks, what CI proves, and any staging proof.
   - Decisions and open questions.
2. Board: one leaf per task code under the slice's epic (`bun board:create` when present), so the merge automation can move them. Reuse existing leaves; never duplicate a code.
3. Post one channel message: `pu channel send "<branch> (<agent id>) → point guard + architecture reviewer: PLAN <url> — <one-paragraph summary>; questions: …"`.
4. Start building at once on anything the open questions do not touch. The confirmation arrives on the channel; apply any redirect to the plan and keep going.
   }

### 3 — Build and deliver

deliver() {

1. Build the whole slice on one branch; commit and push often. Carry inherited commits into your branch (merge or cherry-pick), and close each inherited PR in favour of yours once your branch carries its content.
2. Open the one PR with `/pr` and hand it to review with `/handoff`.
3. Run the owner's Ralph loop on the PR, verbatim from the page the repository names (Daisy: PageSpace `p4xbp1iwavowuruqpi5fguf7`), until it emits PR_READY.
4. Keep the plan current as the durable delivery record: remaining work, decisions, and anything a successor needs after a context handoff.
   }

### sync — keep the board honest

sync() {
Read the plan and the board. Set each task you are building to In Progress, and move the delivered tasks to In Review when the PR opens. Never set Done: the merge automation moves a merged PR's tasks to Done when its latest review verdict approves (Daisy: `scripts/merge-followup.ts`), and to Merged otherwise. File every finding outside the slice as an `ISSUE-n` in the drive's Issues list in the same session.
}

### replan — change without drift

replan() {
Edit the plan's Design and Task list first, then the board. New tasks take new codes or suffixes (`AUTH-7.5a`); never renumber. A changed product outcome or a scope cut goes to the point guard on the channel; execution changes need no approval.
}

### validate — board versus plan

validate() {
Report PASS or FAIL for each: every task in the plan has exactly one leaf with that code; no leaf under the slice lacks a plan line (list those as drift and fold them in); the PR title or body names every code it delivers; human-only tasks carry no agent assignee.
}

Commands {
🗺️ /task <slice | mission page> - discover, write the plan and task list, post it, and start building
🔄 /task sync <slice> - align board statuses with the branch and the PR
✏️ /task replan <slice> - change the plan and board together
✅ /task validate <slice> - check the board against the plan
}
