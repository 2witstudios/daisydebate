# 0035: Autonomy guardrails

Status: accepted (GRD-6.1). The owner applies the GitHub side in GRD-6.2,
a human-only step. Extends [ADR 0019](0019-token-secret-ownership.md)
(secret ownership) and [ADR 0023](0023-greenfield-baseline.md) (terms that
superseded others are flagged at spawn).

## Context

The owner works in two modes on one repository:

- **Human in the loop.** The owner merges any PR whenever they choose, on
  CI and bot reviews, and the independent review record may land after the
  merge. The owner never waits on a review check.
- **Autonomous.** An agent must not be able to merge without an independent
  review, and that must be a hard limit, not a prose rule.

Until now GitHub could not tell the two apart. Every agent used the owner's
`gh` keyring token and SSH key, and `main` had no protection, so any rule the
owner could bypass an agent could bypass too. PR convergence loops wasted
about 230 iterations because a loop agent had no truthful way out.

The 2026-09-22 retrospective also found machine-load failures (unscoped
`pkill`, foreign `infra:down` and Docker cleanups), ADR and migration
numbers claimed twice by parallel branches, a board that drifted from git,
and process rules that contradicted each other. GRD-6.1 answers all of it;
this ADR records the consequential choices.

## Decision

### 1. Two identities

- **The owner** keeps the keyring token and SSH key and is the only bypass
  actor on `main`.
- **Agents** act as one machine user (working name `daisy-agent`, Write
  access), from a gitignored `.env.agent`. The committed `.env.agent.example`
  sets `GH_TOKEN` and `DAISY_AUTONOMOUS=1`, plus `GIT_CONFIG_*` entries that
  rewrite `git@github.com:` to HTTPS, clear inherited credential helpers and
  use `gh auth git-credential`. `GIT_SSH_COMMAND=false` stops any SSH use, and
  `core.hooksPath=.githooks` makes the pre-push guard run for every push.
- **Launch path.** `.pu/config.yaml` (now committed) copies `.env.agent`
  into each new worktree through `envFiles`. pu copies env files but does
  not export them, so every coding agent starts through
  `scripts/agent-launch.sh`. The launcher refuses to start an agent while
  the identity is missing or incomplete, then `exec`s the agent with it.
- **Doctor.** `bun doctor` reports the active identity. With
  `DAISY_AUTONOMOUS=1` it fails (`github-identity`) when `gh` resolves to the
  owner, when `GH_TOKEN` is unset, when origin pushes over SSH, or when git
  does not authenticate through `gh`.
- **One machine account.** GitHub's Terms of Service allow one free machine
  account per person, so there is exactly one agent identity. Builders and
  reviewers share it, which rules out a native approving review from a
  separate reviewer identity.
- **Token type.** A fine-grained token cannot act on another user's
  repository as a collaborator, so the machine user holds a classic token
  with `repo` and `workflow` scopes (`workflow` lets it push workflow
  changes).

### 2. The main ruleset as code

`policy/github/repository.json` holds the ruleset for the default branch:

- pull requests required
- no force-push (`non_fast_forward`) and no deletion
- three required checks:
  - `CI gate`, the aggregate job in `ci.yml`, pinned to GitHub Actions (App 15368)
  - `Playwright E2E`, pinned to GitHub Actions (App 15368)
  - `review-record`, pinned to the review-record App
- one bypass actor: the repository admin role (the owner)

It also sets `allow_auto_merge` and `delete_branch_on_merge`.

`bun github:rules` diffs the committed rules against live GitHub and changes
nothing. `bun github:rules --apply` creates or updates the ruleset and patches
the settings. It refuses to run when `DAISY_AUTONOMOUS=1`, when `gh` is not the
owner, or while the App id is unknown; the guard refuses it for agents too.

Rulesets are available on public repositories with GitHub Free, and on
private repositories from GitHub Pro. The repository is public. Unlike
classic branch protection, a ruleset on a user-owned repository accepts a
bypass list.

### 3. The review-record status: a GitHub App restricted to main

A status an agent could set itself would be worthless:

- Anyone with Write access can create commit statuses.
- A workflow added in a PR runs as GitHub Actions with `statuses: write`.

So neither a personal token nor the Actions App can be the source. The
`review-record` check is pinned to a dedicated **review-record GitHub App**,
and only code running from `main` can use its key.

- **The App.** It is owned by the owner and installed only on this
  repository. Repository permissions: Commit statuses read and write; Pull
  requests read; Issues read (a PR's comments are issue comments); Metadata
  read. It has no webhook, because the workflow, not the App, reacts to
  events.
- **The key.** It lives in the environment secret `REVIEW_RECORD_APP_KEY`
  of an environment named `review-record`, whose deployment branch policy
  allows `main` only. Its id is the repository variable
  `REVIEW_RECORD_APP_ID`.
  - A job on a PR branch, whether from `workflow_dispatch` or a workflow a
    PR adds, cannot enter the environment, so it never sees the key.
  - The agent token cannot change environments, since that needs admin
    access.
- **Triggers.** `.github/workflows/review-record.yml` runs on:
  - `pull_request_target` (opened, reopened, synchronize, edited)
  - `issue_comment` (created, edited; `/review` posts the record link as a
    PR comment)
  - `repository_dispatch` of type `review-record`
  - `workflow_dispatch`

  Each runs the workflow as it is on `main`, checks out `main`, and never
  runs PR code. It mints an App token with `create-github-app-token`
  (SHA-pinned) and runs `scripts/review-record.ts`.

- **The verification**, a pure function (`verifyReviewRecord`). The
  verifier reads the PageSpace pages linked from the PR body and comments,
  then:
  - takes the records whose title or `Candidate:` line names the exact head
    SHA; with none it sets `pending`, and a new push starts pending again;
  - requires the line
    `Candidate: <40-hex sha> · PR #<n> · Builder: <id> · Reviewer: <id>`;
  - requires the builder to equal the `Builder:` line the PR body declares
    (the PR template and `/pr` write it; a PR without it fails);
  - requires the reviewer to differ from that builder;
  - requires a verdict of `APPROVE`, `APPROVE WITH MINORS` or
    `ALL RESOLVED`;
  - for a verdict with zero findings, requires `bun test:integration` PASS
    and a negative control in the gates section.

  Any approving record sets `success` with the record as the target URL.
  Otherwise it sets `failure` with the first reason.

- **Why not the other candidates.**
  - A second machine identity for reviewers is ruled out by the one free
    machine account.
  - A native required approval is ruled out because builders and reviewers
    share one GitHub identity, and GitHub refuses self-approval.
  - An Actions job with no App would accept statuses from any
    PR-introduced workflow.

### 4. Requesting a merge

An autonomous agent requests a merge with `gh pr merge --auto --merge`.
GitHub merges once every required check passes, `review-record` included.
The owner merges directly at any time through the bypass. The guard refuses
a direct or `--admin` merge by an agent, and asks the owner before one.

### 5. Merges leave a trace

The `board` job in `notify-merge.yml` runs `scripts/merge-followup.ts` on
every merge:

- **Merged status.** It moves each task the PR delivers to a new **Merged**
  status (in-progress group), where the task waits for a review record to
  grant Done. It never regresses Done. A PR delivers the codes in its
  title, branch and body `Tasks:` line. A code the body only mentions (a
  later leaf an ADR names, a related issue) is not delivered; counting those
  moved undelivered leaves in the first reconcile dry run.
- **Review debt.** After `reviewEnforcementCutoff` in
  `policy/github/repository.json` (null until the owner sets it in
  GRD-6.2), a merge whose head SHA lacks a successful `review-record` gets
  an `ISSUE-n` in the drive's Issues list and a Sprint Room notice. A re-run
  never files twice.
- **Before the cutoff.** Earlier merges are not debt.
- **Reconcile.** `bun board:stale` lists tasks whose status disagrees with
  git: merged but not yet In Review, or Done after the cutoff without a
  review record. `--apply` moves each to its pre-Done status (Merged, or In
  Review when unmerged). It never marks Done and never files debt.
- **Done before the cutoff.** Owner decision, 2026-09-23: Done without a
  review record is accepted when the task was completed or merged before
  the cutoff, because reviews before the convention often happened without
  being stored. While the cutoff is unset, everything so far counts as
  before it. The one-time reconcile therefore moved only merged tasks that
  never reached In Review, and left the pre-convention Done tasks alone.

### 6. The local guard (soft layer)

`scripts/agent-guard.ts` is one pure classifier with two callers:
`.githooks/pre-push` (which covers Codex and OpenCode) and the committed
Claude Code `PreToolUse` hook in `.claude/settings.json`. It reads the shell
command, including `&&` chains, pipes, `sh -c`, `eval`, `$(…)`, `cd` and
prefix assignments.

With `DAISY_AUTONOMOUS=1` it refuses:

- pushes to `main`, `--no-verify` pushes, and `core.hooksPath` overrides
- merges without `--auto`, and `--admin`
- ruleset, branch-protection and repository-settings mutations
- kill commands not scoped to the worktree
- Docker prunes, container, volume and network removals, and
  `compose down/stop/kill/rm`: every checkout shares one Compose stack
  (ADR 0034), so no agent owns a container
- `db:reset` or `slot:down` from another checkout, or with a database
  override that is not the agent's own slot (the slot is derived from the
  worktree folder with PAR-2's `deriveSlot`)
- hand edits of loop state
- clearing `DAISY_AUTONOMOUS` or `PU_AGENT_ID`

In owner sessions the hook asks before a merge or a push to `main` and
allows the rest.

A hook `deny` blocks even in bypass-permissions mode. This layer is still
bypassable (`--no-verify` outside Claude Code, a different shell, unsetting
a variable), so the hard layer is sections 1–4.

### 7. PR loops that can finish

- **Escalate.** `bun loop:escalate <needs-owner|blocked|stalled|out-of-scope> "<detail>"`
  moves `.claude/ralph-loop.local.md` to `.claude/ralph-loop.escalated.md`.
  It appends the reason, iteration, head SHA and UTC time, and changes
  nothing else. The vendored Ralph plugin's stop hook keys only on the
  active file, so the loop pauses unmodified.
- **Notify.** It notifies the parent recorded in `.daisy/parent` through
  `pu send` (text, then an empty send), or prints an owner notice when no
  parent is recorded, and comments on the PR.
- **Close or resume.** `bun loop:close` and `bun loop:resume` resolve the
  child through `pu status --json`. They accept only the recorded parent or
  the owner, and record the outcome on the PR. Resume restores the state
  byte for byte.
- **No self-exit.** The guard refuses the loop agent any other way to end
  or restart its loop (removing, moving or editing the state), so a truthful
  completion promise is its only exit.
- **Converge prompt.** The Library converge prompt replaces the pasted loop
  prompt.

### 8. Spawning, numbering and consistency

- **Spawn wrapper.** `bun agent:spawn` refuses a builder in any of these
  cases, unless the owner overrides:
  - a leaf with an unmerged declared prerequisite
  - a leaf with a term a merged ADR superseded (`policy/superseded-terms.json`)
  - a full active-builder cap (default 3)

  It creates the worktree, installs dependencies and brings the slot up
  before the prompt is sent. It records the parent, resolves the child from
  `pu status --json`, and confirms the prompt reached the transcript,
  nudging with an empty `pu send`. `bun agent:send` confirms any later send
  the same way.

- **Numbers.** `bun adr:next` prints the ADR and migration numbers free
  across origin/main and every open PR. `bun policy` fails a branch whose
  number an earlier-opened PR holds.
- **Agent context.** `.pu/agent-context.md` is committed, so pu, which
  writes it only when missing, never replaces it with its generic text.
  Tests fail if it names `CLAUDE.md` or forbids filing follow-ups.

## Owner setup (GRD-6.2)

1. **Machine user.** Create the machine user, invite it to the repository
   with Write, and issue a classic token with `repo` and `workflow`. Copy
   `.env.agent.example` to `.env.agent` in the main checkout and fill in
   `GH_TOKEN`.
2. **Main checkout.** Before pulling this change, move the untracked
   `.pu/config.yaml` and `.pu/agent-context.md` aside. Both are now tracked,
   and git refuses to overwrite them.
3. **Review App.** Create the review-record App: no webhook; permissions
   Commit statuses read and write, Pull requests read, Issues read,
   Metadata read. Install it on this repository only, and generate a
   private key.
4. **Environment and variable.** Create the `review-record` environment
   with a deployment branch rule allowing `main` only. Add the key as its
   secret `REVIEW_RECORD_APP_KEY`, and the App id as the repository variable
   `REVIEW_RECORD_APP_ID`. Keep the repository secret `PAGESPACE_TOKEN`.
5. **Apply.** Run `bun github:rules`, review the diff, then run
   `bun github:rules --apply`. A second dry run must show `in sync`,
   including the admin-role bypass (actor id 5).
6. **Cutoff.** Set `reviewEnforcementCutoff` to a UTC time in a PR you
   merge.
7. **Optional hardening.** Agents run as the owner's OS user, so the
   keyring token and SSH key stay readable. Gating `gh` and SSH behind
   Touch ID (1Password) closes that.

## Residual risk

- **Same OS user.** Agents can read the owner's keyring and SSH key, so a
  deliberately hostile agent could act as the owner. The design stops
  mistakes and honest agents. Setup step 7 is the full fix.
- **Self-declared ids.** Builder and reviewer are pu session ids declared
  in the PR body and the record, and PageSpace attributes every edit to the
  owner. A builder that fabricated a record under a false reviewer id could
  mint the status. That is a deliberate forgery, visible in the record and
  the PR history, and outside what this layer claims to stop.
- **Soft layer.** The guard is bypassable, as described in section 6.

## Sources

- About rulesets (plan limits):
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- Available rules, including the `integration_id` source pin:
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- Rulesets REST API: https://docs.github.com/en/rest/repos/rules
- Protected branches (bypass lists need an organization):
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Auto-merge:
  https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request
- Commit statuses (Write can create them):
  https://docs.github.com/en/rest/commits/statuses
- Workflow triggers (`workflow_run`, `repository_dispatch` and
  default-branch rules):
  https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Machine accounts:
  https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- Claude Code hooks, including `permissionDecision` and deny in bypass
  mode: https://code.claude.com/docs/en/hooks
- GitHub Actions App id 15368 is read from this repository's own check runs
  (`gh api repos/2witstudios/daisydebate/commits/<sha>/check-runs`).
