---
name: epic-pipeline
description: Carry an owner-authorized epic through planning, branch implementation, integration, independent reviews and main acceptance.
---

# Epic pipeline

Read AGENTS.md and [the agent delivery pipeline](../../../docs/development/agent-pipeline.md).
The owner's implementation request authorizes execution within that outcome.
A planning-only request stays planning-only. The owner steers scope and product
intent; agents own routine planning, board administration, spawning, integration,
review fixes and continuation.

1. Ground the requested outcome in relevant product/architecture documents and
   existing work. Read Issues touching the current work, not every unrelated
   bucket before every small edit. Record the objective and execution plan in
   PageSpace. Reuse existing tasks, decisions and artifacts.
2. Use [the task workflow](../task/SKILL.md) to maintain build inputs separately
   from acceptance obligations. Review complex plans independently and apply
   findings without another owner approval relay. Record decisions made on the
   owner's behalf; unresolved product choices remain provisional.
3. Build and integrate in the owning branch. Actual pinned unmerged producers
   may satisfy build availability. Coordinate actual live writers and migration
   generation. Do not wait for unrelated main merges or global Done statuses.
4. Run focused proofs as behavior becomes runnable. Record failed/deferred gates
   with SHA, reason, remaining work, responsible agent and discharge point.
   Expected intermediate CI failure does not forbid commits, pushes or reviews.
5. Spawn independent reviewers with native `pu spawn`, fix findings, obtain
   relevant delta review and continue. Review stable commits; shared mutable
   worktrees pause only while a reviewer uses them. No pass-count escalation or
   mandatory parent acknowledgment between steps.
6. Before main acceptance, reconcile the complete composed candidate, applicable
   gates, contracts, security and migration integrity. Obtain independent
   exact-head acceptance review and obey main's required checks. Deliver with
   `/pr` and `/handoff`; never grant yourself Done or directly merge main/default/protected release targets.

Escalate ambiguity in product intent, changed outcomes, real writer conflicts and
human-only production/identity/secret/data actions. Continue unaffected work.
Report meaningful milestones and final delivery directly to your spawning parent
with `pu send`; the owner is not the message bus. Native `pu status` and `pu logs`
provide agent state. A stopped tool or context handoff does not reauthorize scope.

`/epic-pipeline <outcome>` resumes the first unfinished part of the delivery.

## Receiving branch authority

Within owner-authorized work, owners, point guards, root/main-level agents and
worktree agents may merge producers into their own allocated unprotected
non-main receiving branch. Root agents use an isolated receiving checkout, never
the parent-main checkout. Coordinate actual writers/resources; ordinary merges
and conflict resolution are allowed, never another agent's checkout/branch,
force-push, history rewrite, reset or dirty-work loss. Resolve symbolic default
and live branch protection/rulesets before acting; main, default and protected
release targets retain acceptance/human protections, other protected targets
follow their policy, and unknown protection facts refuse integration. Before PR
merge automation, re-read live repository/base/head and verify the intended
allocated receiving branch and candidate; refuse mismatches or changed targets.

Non-main integration needs no global Done, separate producer approval, green
whole-app CI or per-step root permission. Pin source/integration SHAs and gaps,
record failed/deferred checks honestly, and preserve security/tests. One
short-lived integration branch and umbrella PR may compose children before they
are main-ready. Integration grants neither Done nor main acceptance. Autonomous
agents never merge directly into main/default/protected release targets; request
main auto-merge only under the live required review-record ruleset and applicable
checks, otherwise report ready for owner merge. Production retains human gates.
