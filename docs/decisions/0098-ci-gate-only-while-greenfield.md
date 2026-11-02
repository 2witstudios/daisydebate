# 0098: CI gate only while greenfield

Status: accepted (owner, 2026-11-02). Amends the required checks and the
Playwright and Isolated Room Launch gates of
[ADR 0083](0083-lean-gates-and-slice-process.md). Temporary: strict gating
returns before real users.

## Context

Daisy has no users. Browser E2E took about 50 minutes per run and pushes
cancelled about half of its PR runs. Main still failed 5 of its last 13 browser
runs, and merges kept cancelling deploys. Waiting for that suite on every PR and
every deploy cost more than it protected.

## Decision

- **Merging.** The `main` ruleset requires only `CI gate`.
- **Browser E2E.** `e2e.yml` no longer runs on `pull_request` or `merge_group`.
  It runs on main pushes, nightly on main, and on manual dispatch. A builder
  proves the specs its change touches, locally or by dispatching the workflow
  on its branch. A risky PR, such as rooms or migrations, may ask for a full run.
- **A red run on main.** The merging point guard owns it at once and fixes
  forward or reverts.
- **Staging.** `scripts/staging-gate.ts` deploys main on a green CI gate without
  waiting for Browser E2E. The main-tip rule stays, so a re-run of an older
  commit never rolls staging back. Production sign-off is unchanged.
- **Removed with the PR trigger.** The `scope` job, the Room Launch path filter,
  the spec ownership map and the merge-queue check that enabled affected
  selection (it never activated: the ruleset has no merge queue).
  `scripts/affected-e2e.ts` became `scripts/browser-selection.ts`.

## Consequences

- A PR can merge with a browser regression, and staging can run it, until the
  main run reports it. That is the accepted trade while nobody depends on
  staging.
- `Playwright E2E` and `Isolated Room Launch E2E` still exist as jobs, on main
  and on a dispatch, and are no longer required.
- A dispatch runs the three-run release qualification (AUTH-6.2-AC7), not a
  single run, so it is slow and uses the 60-minute budget.

## Restoring strict gating

Before real users, alongside expand/contract migrations: revert the PR that
carries this ADR, then have the owner apply the restored
`policy/github/repository.json` with `bun github:rules --apply`. Its required
contexts are `CI gate`, `Playwright E2E` and `Isolated Room Launch E2E`.
