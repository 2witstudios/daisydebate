# Review records

A review record is the durable artifact of reviewing one change. It lives in
the Daisy Debate PageSpace drive, under `Reviews/<Epic>`, not in the
repository — point-in-time documents rot into misinformation when committed
at the root. The template below is the contract; keep sections in this order.

The record gates autonomous main acceptance; it is not a prerequisite for
allowed unprotected non-main integration. Branch feedback and honest failed or
deferred checks may accompany that integration without granting Done or main
acceptance. Resolve default/protected targets and PR base under
[receiving branch authority](agent-pipeline.md#receiving-branch-authority).

The review record's page title ends
with the full 40-character head SHA, and its `Candidate:` line names that
SHA, the PR, the builder the PR body declares and the reviewer. When the
record's link lands on the PR, the review-record workflow reads it and sets
the `review-record` check through the review-record GitHub App. The check
passes only when all of these hold:

- the SHA is exactly the PR's head
- the builder matches the PR's `Builder:` line
- the reviewer is someone else
- the verdict approves

Nobody sets that status by hand. The owner may merge before the record
exists. The merged tasks then wait in **Merged** until the record grants
Done.

**Self-check before posting the verdict (ISSUE-122).** After publishing the
record, run `bun review:check <recordPageId> --pr <n> --dispatch` and fix the
record until it passes, before posting the verdict comment. It runs the same
`verifyReviewRecord` decision the live check runs, against the record page
and the PR's live head SHA and body, and prints `PASS` or the exact refusal.
`--dispatch` re-runs the live status once it passes, so a red status left by
an earlier comment (posted while the record page existed but was still being
written) does not linger as the final state. A merged PR whose branch no
longer carries the reviewed SHA can be checked with `--sha <sha>` to compare
against the record's own SHA instead of the PR's current head.

The optional local CLI is host-provisioned: the operator installs
`@pagespace/cli` outside this workspace so `pagespace` resolves on `PATH`, and
supplies an already authorized drive-scoped credential through that CLI.
The adapter was verified with CLI 1.11.0 and its packaged README's content-key
contract. Repository installation and CI do not provision this tool or its
credentials. Without it, tokenless local reads fail closed; an explicit API
token remains the other supported route. The root workspace's exact
`ignoreBinaries: ["pagespace"]` entry in `knip.jsonc` records this external
binary contract rather than adding an unused package dependency. It applies
only to the named external binary (Knip also consults root binary entries
for child workspaces); other unlisted binaries remain reported. Knip 6.37.0's installed schema and
[configuration reference](https://knip.dev/reference/configuration#ignorebinaries)
define this option.

Local self-checks without `PAGESPACE_TOKEN` use the installed `pagespace` CLI's
existing authorized credential through `pages read-details --json`. Returned
page IDs and the Daisy drive must match before content reaches the verifier.
The subprocess uses argv, suppresses stderr, and is limited to 15 seconds and
1 MiB of output; failures remain unreadable records. No credentials are copied
into the checkout. Explicit tokens retain the HTTPS API path with redirects
refused. CI (`CI` or `GITHUB_ACTIONS` set) and the shared check never fall back
to ambient CLI credentials. Branch feedback and stale heads still cannot approve.

```markdown
# Review: <task or PR title> (<branch>)

Candidate: <full head sha> · PR #<n> · Builder: <PR body's Builder id> · Reviewer: <your agent id, or owner>

## Gates run

bun check at <sha>: PASS (format, lint, policy, knip, duplication, invariants, evidence,
typecheck, unit tests, metrics, build) · date
bun test:integration: PASS (<n> pass, 0 fail)
or, when integration ran only in CI:
Integration: PASS (CI run https://github.com/<owner>/<repo>/actions/runs/<id>, job Infrastructure contracts, sha <full head sha>)
E2E: PASS (CI run https://github.com/<owner>/<repo>/actions/runs/<id>, job Playwright E2E, sha <full head sha>)
Negative control run: yes (below)

## Findings

Each finding is CONFIRMED (reproduced, with the triggering scenario) or
SUSPECTED (what would confirm it). Report only what you verified.

- [ ] blocker · <file>:<line> · <why it must not merge> · <fix commit or PR note>
- [ ] major · <file>:<line> · <why> · <fix>
- [ ] minor · <file>:<line> · <why> · <fix>
- [ ] nit · <file>:<line> · <why> · <fix>

Only check a finding once its fix is verified in the code, not when the
fix is claimed.

Where an unfixed finding goes is decided by one question: is the leaf it
belongs to still open? Open leaf: a follow-up leaf under that phase, always,
whether or not the PR merged. Leaf already Done, or no leaf owns it: an
`ISSUE-n` task in the drive-root `Issues` list (never a GitHub Issue) that
names this record as its origin. Say which in the finding's fix column.

Filing is the reviewer's job, not a suggestion: a record is not finished
while any unfixed finding lacks the page id of the leaf or issue that now
carries it. "Out of scope for this PR" is a reason to file, never a reason
to leave the finding in prose.

## What is good

<two or three specific things worth keeping>

## Privacy & telemetry findings

Check the diff against [ADR 0036](../decisions/0036-privacy-by-design.md)
and [ADR 0037](../decisions/0037-error-tracking-and-product-analytics.md):
every new log field, database/Redis column, `outbox.payload` kind, realtime
topic-family payload field and analytics event is classified and
registered; no `personal`, `sensitive` or `secret` value reaches a log
line, an error report or an analytics event; an `outbox.payload` kind or
realtime topic message carries a `personal`/`public` value only once it is
classified in the inventory, and never a `personal`/`private`, `sensitive`
or `secret` value; every new personal-data column has a retention and
erasure rule, and new client-side tracking declares a consent category.
Findings here follow the
same CONFIRMED/SUSPECTED and severity rules as `## Findings`, and file the
same way when
unfixed.

## Verdict

<n blocker / n major / n minor / n nit> — <APPROVE | APPROVE WITH MINORS | CHANGES REQUESTED>
```

Rules:

- The verdict line is the first line under the last `Verdict` heading,
  and the `review-record` check takes the verdict from nowhere
  else: it accepts exactly `APPROVE` or `APPROVE WITH MINORS`, and refuses
  an approval that counts an open blocker or major.
- Acceptance evidence is selected from the actual live PR diff and Git tree
  modes. Regular markdown under `docs/` can use `Documentation review: PASS`,
  `bun check: PASS` and `Negative control run: yes`; explicitly record the
  independent contract/link/status/number checks and applicable negative proof.
  Service tests may be NOT RUN with the documentation-only reason. Instruction
  files, skills, templates, workflows, executable/symlink modes, mixed changes,
  missing or incomplete diffs never qualify. Runtime/unclassified approvals
  require integration PASS (local, or verified CI evidence below) and a
  negative control regardless of finding count.
  A decorated or false PASS saying NOT RUN, deferred or carrying `?` never counts.
- CI evidence is verified, never trusted. A Gates run line beginning
  `Integration: PASS` or `E2E: PASS` must read exactly
  `<gate>: PASS (CI run <run url>, job <job name>, sha <40-hex>)`, and the
  check reads the run and its latest jobs from the GitHub Actions API (with
  the workflow's own read-only `actions: read` token; PR code is never
  checked out). It accepts the citation only when the URL is a run of this
  repository; the cited and run SHAs equal the reviewed SHA (which must be
  the PR head); the run's repository and head repository are this one (never
  a fork); it is a `pull_request` run of this PR's own head branch or a
  `push` run of the default branch. A run does not report the base its
  workflow was merged onto, so CI evidence also requires that the PR
  targets the default branch, that its timeline has no base change, and
  that no other PR in any state was ever opened from its head branch; it ran the gate's
  own workflow (`.github/workflows/ci.yml` for `Integration`,
  `.github/workflows/e2e.yml` for `E2E`); the complete PR diff does not
  change that workflow; and the named job exists and concluded `success`.
  `Integration` cites only the CI job `Infrastructure contracts` (the one
  that runs `bun test:integration`); `E2E` cites `Playwright E2E` or
  `Isolated Room Launch E2E`. A verified `Integration` citation satisfies
  the runtime integration requirement in place of a local
  `bun test:integration: PASS`; an `E2E` citation never does. Any malformed
  or unverifiable citation refuses the record with its reason, even when a
  local PASS is also present, so a local run is always written as its
  `bun test:…` command, never as `Integration:` or `E2E:`. The negative
  control requirement is unchanged.
- Branch feedback carries `Review stage: branch` and the nonacceptance verdict
  `BRANCH FEEDBACK` (source conclusions go in prose). It names the candidate,
  findings and deferred proof but cannot mint main acceptance. An acceptance
  record evaluates the complete exact-head candidate and all relevant findings;
  outstanding main proof cannot be bypassed by calling feedback an approval.
- No pass limit: the reviewer reviews again as many times as it takes to
  reach a verdict, and takes an open disagreement to the orchestrator or
  owner only when it is a decision only they can make, never because of a
  pass count.
- A second-pass review re-verifies the first pass finding by finding
  before approving.
- Record environment gotchas discovered during review (stale builds,
  shared stacks, port collisions) — they are the next reviewer's
  parallel-work traps.
- Plan compliance is a separate discipline: extract every
  "Given X, should Y" acceptance criterion from the task and mark each
  PASS/FAIL/PARTIAL against the diff before writing a verdict.

Review timing and check scheduling follow [the agent delivery pipeline](agent-pipeline.md).

## Review App contents permission

Exact-candidate documentation classification reads SHA-bound comparisons and Git
trees, which require repository Contents: read in the review App installation
and minted token. See [GitHub compare permissions](https://docs.github.com/en/rest/commits/commits#fine-grained-access-tokens-for-compare-two-commits).
New generated App manifests request this read-only permission; no content-writing
permission is added. For an existing App, its human owner must update Repository
permissions → Contents → Read-only in GitHub App settings, then approve the
permission update for the repository installation. Do not replace the App, copy
its key or self-approve this identity permission change. Record a human-only
acceptance prerequisite and verify the protected-main workflow after that update.
Unapproved or unreadable facts fail closed; agents continue independent branch
work without representing document classification or main acceptance as passed.
