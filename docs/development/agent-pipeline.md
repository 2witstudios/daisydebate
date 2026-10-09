# Agent delivery pipeline

An owner instruction to implement an outcome authorizes agents to carry that
outcome through planning, branch development, integration, independent reviews
and fixes. A request only to investigate or plan stays in that scope. The owner
steers product intent; agents own routine execution. PageSpace records the work
and its evidence without becoming another authorization system.

## Branch development

Work in your own worktree. Build, experiment, refactor, make provisional
architecture choices and integrate actual unmerged producer commits. A branch
can contain an incomplete transition, failing CI, or code whose readers arrive
later in the same delivery. Keep tests that expose the unfinished behavior;
never hide failures by skipping tests, weakening security or inventing a PASS.

For a provisional producer, record its exact source SHA, contract, source owner,
integration SHA and known gaps. Verify that the composed branch actually contains
that implementation. A producer need not be on main, globally Done, or separately
approved before its consumer can be built. Proposed product rules remain
provisional and cannot authorize production activation. An unavailable producer
blocks proof that requires it; it does not block independent consumer work.

Coordinate actual concurrent writes and shared resources: migration generation,
shared files currently being changed, services or mutable review snapshots. A
package boundary or common concept alone is not a writer collision. Ordinary
files needed for the authorized outcome may be added to the working scope; check
active writers before editing their files. Respect explicit exclusions, protected
feature ownership and human-only actions. Do not edit another agent's worktree.

## Long-running execution

Keep one durable delivery record with the objective, remaining work, source
commits, decisions, dependencies and proof obligations. Update it at meaningful
milestones and before context handoff. Resume from it without asking the owner to
reauthorize the same outcome. Local notes and tool state can be scratch; records
needed by other sessions belong in PageSpace.

Agents may create and claim implementation and review tasks within the authorized
objective, write prompts, spawn PurePoint builders in separate worktrees, and
spawn independent read-only reviewers. Check live concurrency and existing work
before spawning. A reviewer reports to the builder that spawned it; that builder
fixes findings, obtains delta review and integrates the result. Notify the
original parent at substantial milestones, completion, real blockers or actual
writer conflicts. Do not require a parent acknowledgment for routine continuation
or repeat a delivered report merely to collect a procedural confirmation.

Preserve acceptance criteria and the requested end state. Agents may refine their
execution plan and create follow-up leaves without asking permission; they may
not silently cut scope, weaken criteria or reinterpret a human prerequisite as
complete. Ask the owner when product intent is ambiguous, the requested outcome
changes, or a protected action needs human sign-off. Continue unaffected work.
An in-scope finding is remaining work in the same delivery, not a reason to
announce completion and defer the outcome to an unspecified future project.

## Check scheduling and evidence

Run focused tests when they can prove the behavior being changed. Use TDD for new
behavior and meaningful negative controls. Run broader gates at integration
milestones and on the completed candidate. CI may run on intermediate PRs and
show failures; its output is evidence, not a prohibition on further branch work.

Record each failed or deferred check as a proof obligation:

| Candidate | Check           | State           | Reason / remaining work                                        | Responsible agent | Discharge point                                 |
| --------- | --------------- | --------------- | -------------------------------------------------------------- | ----------------- | ----------------------------------------------- |
| full SHA  | command / proof | FAIL or NOT RUN | missing producer, incomplete transition or unavailable service | agent ID          | integration milestone or before main acceptance |

A deferral schedules proof; it never satisfies a criterion. Distinguish expected
incomplete work, a reproduced defect, and an environment failure. Re-run when the
relevant code, dependency, environment or candidate changes. Do not churn the
same expensive command while its known blocking condition is unchanged. Cached
checks remain honestly labeled as cached; cache presence alone is not a reason
to force unrelated full reruns. Reuse evidence only where the relevant inputs and
candidate scope still match; no old exact-head approval proves a new head.

`bun check:affected` is an inner loop. `bun check` is the full main acceptance
gate, not a prerequisite for each commit, branch push or early review. The
optional pre-push hook allows branch snapshots and requires full verification
of an exact clean candidate pushed to main. GitHub's protected main checks remain
authoritative. Run migration integrity checks when migrations change and before
acceptance; migration generation remains single-writer.

## Review while building and before main

Request branch feedback early when it helps resolve a design or implementation
risk. Label its record `Review stage: branch`, name the exact SHA and list deferred
proof. A branch review may report sound source with outstanding proof; it cannot
mint the main acceptance status. Use the nonacceptance verdict `BRANCH FEEDBACK`
and describe source conclusions in prose; an approval verdict belongs only to
acceptance, including while stage-aware verification is being adopted. Fix real findings without waiting for every
service tier to become runnable. There is no review pass-count limit and no
mandatory owner relay between review passes.

Review a stable commit snapshot. Prefer a separate review worktree or scratch
copy so the builder can continue. If a reviewer uses the builder's mutable
worktree, hold mutation only while that reviewer is using it; end the hold when
the reviewer reports completion. A PageSpace artifact review does not freeze
source. Changes after review need relevant tests and an independent delta review
of the final composed candidate before main acceptance.

Main acceptance requires the completed transition, reconciled contracts,
architecture and security boundaries, applicable tests, migration integrity,
resolved blockers and majors, and independent review of the exact PR head.
Required GitHub CI/E2E/review-record checks must pass. Branch feedback is not an
acceptance record. Autonomous agents never merge directly; they may request
auto-merge only after confirming the live main ruleset requires review-record.
The owner retains control of merges. Done remains an evidence-backed completion
state, not something a builder grants itself after a cherry-pick or branch push.

Documentation-only acceptance is determined from the live PR diff and Git tree
modes, never a label or reviewer claim. Only regular non-executable markdown under
`docs/` qualifies; instruction files, skills, templates, workflows, mixed diffs,
missing facts, symlinks and executable modes do not. Eligible documents require
independent contract/link/status/number review, `bun check` and an applicable
negative control. Service tests can be NOT RUN with the applicability reason.
Runtime and unclassified acceptance retain integration PASS and a meaningful
negative control, for approvals with or without minor findings.

## Production and environment protection

Deployment, production data, identities, secrets and vendor activation retain
explicit human sign-off. Branch authorization never supplies production authority.
Agents cannot copy owner credentials, mutate the parent checkout, reset other
slots or fake service evidence. Doctor validates the active PU launcher, identity
and checkout's isolated environment. Parent Git dirtiness alone is not a safety
failure; unsafe launchers, invalid identities, wrong slots and unavailable
required services remain failures or warnings according to their actual checks.

## Maintained distribution

The repository's `.claude/skills/` and `policy/agent-pipeline/` contain the
reviewable sources for this workflow. `bun pipeline:sync` checks installed shared
skills and the named Daisy Library pages; `--apply` updates them with concurrent
content checks and readback. `--local-only` limits work to installed skills. The
command uses the CLI's existing credentials, never provisions them, and is not
part of CI or a permission gate. Init-offense's matching code and drive-seed
sources ship through its own reviewed branch; changing a live prompt alone is
not generator adoption.
