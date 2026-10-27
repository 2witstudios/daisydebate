---
name: task
description: >
  Plan a semantic slice (or an epic) after your own discovery: one plan with a task list in the
  repo's PageSpace drive (Plans/<slice>), posted for one confirmation, then built as one PR.
  Use when asked to plan a slice or epic, break work into board tasks, sync progress, replan, or
  check the board against the plan, or when the user says "/task", "/task sync", "/task replan",
  "/task validate".
compatibility: Requires the pagespace CLI with an active key (it also posts to the Delivery channel), gh, and pu. In a repository with bun board:*, bun decision:record or bun adr:next (Daisy) it uses them.
---

# 🗺️ task

Act as the builder who owns a semantic slice end to end. The process is:
**semantic slice → your discovery and plan → one confirmation → one PR → PR loop → async reviews.**
This skill covers the planning half; `/pr` and `/handoff` cover the rest.

Constraints {
AGENTS.md governs. Read it first for the drive id, the board, the Delivery channel and the task-code prefixes in use. No drive declared => keep the plan in the PR description and say so.
Discovery is yours. A mission brief names the outcome, the owning intent pages and ADRs, and the PRs and branches you inherit; it never contains research, so do the research yourself.
One plan, one confirmation. Post the plan link on the PageSpace Delivery channel; the architecture reviewer and the point guard confirm or redirect. Never wait for another approval after that, and never wait on the owner: product, architecture or scope questions go to the point guard on the Delivery channel.
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
2. Read the drive: Product → `Project Status`, then the `Product intent` area pages for your slice (Score, What 100% means) and their "Constraints other features must respect now" sections, the affected-capability links, and every `Issues` bucket for items touching your slice.
3. Read every PR and branch you inherit: what each one carries, its head SHA, its open review threads, and whether its CI is green.
4. Resume rather than duplicate: search the drive for an existing plan or epic for this slice (`pagespace search text "<slice>" --drive <id>`).
   }

### 2 — Plan

plan() {

1. Create `Plans/<slice>` if missing, then one DOCUMENT `Plan — <slice>`. Plan from intent, not from the existing code. Sections, in this order:
   1. Intent: what the owner and the user want, in product words, from the Product intent page, the DEC records and the owner's own words. Not code. Link the sources (page mentions; GitHub URLs for PRs), the mission prompt and inherited PRs.
   2. Concepts and names: the domain vocabulary, what each word means, and which concepts must stay separate.
   3. Ideal design: how you would build it from scratch to serve that intent (layers, ownership, names, data flow). Write this BEFORE studying the current implementation in depth.
   4. Current state and divergence: where today's code differs from the ideal, and why.
   5. Refactors first: each divergence that matters becomes a refactor at the start of the slice. Never build on a wrong shape.
   6. Build: what changes, where, and why; migrations and ADRs (numbers from `bun adr:next`, announced on the Delivery channel when you claim one). Then the task list, one line per task, `<CODE> — Given X, should Y` (reuse existing codes for inherited leaves and issues; new tasks take the slice's prefix; human-only tasks are marked `(human, <who>)`); the verification (local targeted checks, what CI proves, any staging proof); and the decisions and open questions.
   - Planning is a dialogue: post intent and design questions on Delivery as they come up ("is X the same concept as Y?", "the code does Z, the ideal is W: refactor?"). The point guard answers and challenges ("is this the best way, or just the existing way?"). The plan is confirmed only after its Ideal design and Divergence have been discussed.
   - The architecture rules in AGENTS.md "Design constraints" are blockers: never build on flawed architecture, one concept one home, no coupling for efficiency, and the reserved words.
2. Board: one leaf per task code under the slice's epic in Roadmap (`bun board:create` when present), so the merge automation can move them. Reuse existing leaves; never duplicate a code. A finding outside the slice is an issue, always in a bucket: `bun board:create --issue --bucket <name>`.
   - Name the areas the slice advances in the plan, and update their Score blocks on the area pages when the slice merges.
3. Post one channel message: `pagespace channels send <Delivery channel id> "<slice> (<agent id>) → point guard + architecture reviewer: PLAN <url> — <one-paragraph summary>; questions: …"`.
4. Start building at once on anything the open questions do not touch. The confirmation arrives on the Delivery channel (read it with `pagespace pages read <Delivery channel id>`; AGENTS.md names the id); apply any redirect to the plan and keep going.
   }

### 3 — Build and deliver

deliver() {

1. Build the whole slice on one branch; commit and push often. Carry inherited commits into your branch (merge or cherry-pick), and close each inherited PR in favour of yours once your branch carries its content.
2. Open the one PR with `/pr` and hand it to review with `/handoff`.
3. Run your harness's PR loop on the PR, verbatim from the page the repository names, until it emits PR_READY (Daisy, in Resources › Universal prompts: PR Loop (Ralph Loop) `cvslieavdwwkbz8l551hhhsz` for Claude Code; PR Loop (Goal) `asdc6hmpbeyu9ujlqrnes1oc` for Codex and opencode).
4. Keep the plan current as the durable delivery record: remaining work, decisions, and anything a successor needs after a context handoff.
   }

### sync — keep the board honest

sync() {
Read the plan and the board. Set each task you are building to In Progress, and move the delivered tasks to In Review when the PR opens. Never set Done: the merge automation moves a merged PR's tasks to Done when its latest review verdict approves (Daisy: `scripts/merge-followup.ts`), and to Merged otherwise. File every finding outside the slice as an `ISSUE-n` in the drive's Issues list in the same session.
}

### replan — change without drift

replan() {
Edit the plan first (its Ideal design and Build sections; the task list lives in Build, and a changed intent starts again from Intent), then the board. New tasks take new codes or suffixes (`AUTH-7.5a`); never renumber. A changed product outcome or a scope cut goes to the point guard on the Delivery channel; execution changes need no approval.
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
