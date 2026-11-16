# Daisy Tab staging handover

Operator procedure for deploying `pu/daisy-tab` after wiring is merged and
keeping staging on that parent until it lands on main (ADR 0128, owner
Tab decision 59). This document authorizes no deployment or data operation.
Use the existing staging apps, credentials and workflow described in
[deploy-staging](deploy-staging.md). Never run development seeds on staging.

## Before the first parent migration

1. Record the reviewed parent SHA and its green `CI gate` from the standing
   parent PR. Check that wiring and staging-readiness are included, the owner
   has completed the interface walk, and Tab's feature flag remains closed.
   Keep the last working deployment's SHA and **each app's image reference**
   from `fly releases -a <app> --image`. Include web, realtime, capture,
   Broadcast, Recording and audience publisher; a web-only rollback leaves
   workers writing a different schema. Retain the existing LiveKit/Egress
   images/configuration too.
2. Agree a short deployment window on Delivery. No live Rounds should be in
   progress: a manually dispatched workflow redeploys LiveKit and Egress even
   when their configurations have not changed, ending calls/capture. Tell
   other builders that staging will follow the parent, so main changes reach
   staging only after the point guard takes main into the parent.
3. Arrange and verify the pre-migration backup using the existing
   [backup and restore procedure](restore-rehearsal.md). Record its location,
   main image SHA and database migration head, without credentials or personal
   rows. Do not treat an image reference as a database backup. Any later restore
   requires explicit approval and loses writes since this backup.
4. Hold the automatic deploy rail **before** migration:

   ```sh
   gh workflow disable deploy-staging.yml
   gh api repos/2witstudios/daisydebate/actions/workflows/deploy-staging.yml --jq .state
   gh run list --all --workflow deploy-staging.yml --limit 100 \
     --json databaseId,event,headSha,status,conclusion
   ```

   Require `disabled_manually`. Disabling does not stop runs already queued,
   waiting or running. Cancel every unfinished deploy run by its recorded ID
   (`gh run cancel <id>`), then `gh run watch <id> --exit-status`; a cancelled
   run is expected to return nonzero. Re-list until none is unfinished.
   If a migrator already ran, determine its journal head before proceeding;
   cancelling a workflow does not undo a committed migration.

## Dispatch the parent while keeping main held

A disabled workflow cannot be dispatched. Use this short, coordinated window
for the initial deploy **and every subsequent parent deploy**:

1. Keep main merges/pushes and CI re-runs paused while the workflow is enabled.
   Let all existing main push CI runs complete while staging deployment is
   still disabled. Check all pages of runs if more than 100 exist:

   ```sh
   gh run list --workflow ci.yml --branch main --event push --limit 100 \
     --json databaseId,headSha,status,conclusion
   ```

   Require no unfinished main push CI run. This matters because CI completion,
   rather than the merge itself, creates the automatic deploy event. Do not
   open the dispatch window without control of both sources of events.

2. Fetch and record the candidate; dispatch the **existing** deploy workflow
   at the **parent ref**, then disable it again as soon as the manual run is
   registered:

   ```sh
   git fetch origin pu/daisy-tab
   git rev-parse origin/pu/daisy-tab
   gh workflow enable deploy-staging.yml
   gh workflow run deploy-staging.yml --ref pu/daisy-tab
   gh run list --all --workflow deploy-staging.yml --event workflow_dispatch \
     --branch pu/daisy-tab --limit 10 --json databaseId,headSha,status,url
   gh workflow disable deploy-staging.yml
   gh api repos/2witstudios/daisydebate/actions/workflows/deploy-staging.yml --jq .state
   ```

   The run's `headSha` must equal the reviewed candidate. Prevent parent pushes
   during dispatch too. Disabling prevents new runs; the already dispatched
   manual run continues. Record its ID and URL. If dispatch/list fails, disable
   the workflow immediately and inspect runs before retrying, to avoid duplicate
   deploys. Never leave it enabled while investigating.

3. Re-list deploy runs. There must be only the intended manual run unfinished,
   and no automatic `workflow_run` deployment. If another run appeared, cancel
   it, stop and re-establish the hold before proceeding. Resume main merges/CI
   only after the workflow is disabled again. Main CI continues normally during
   the hold; it cannot deploy staging.
4. Wait in one command:

   ```sh
   gh run watch <manual-run-id> --exit-status
   ```

   The workflow checks out `DEPLOY_SHA` from the dispatched ref, builds on its
   runner, runs the release-only migrator first, then deploys the runtime apps
   and workers, and checks readiness. Manual dispatch bypasses the automatic
   CI gate job; the recorded exact-head green CI in the preconditions is
   therefore essential. Inspect the run's actual steps and failures, not only
   whether dispatch returned successfully.

## Verify before inviting ordinary play

- Confirm the workflow succeeded at the recorded SHA and the migrator succeeded.
  Compare each app machine's `GIT_COMMIT` with that SHA using
  `fly machines list -a <app> --json`; pinned LiveKit/Egress use their
  `LIVEKIT_SOURCE_COMMIT` / `EGRESS_SOURCE_COMMIT` metadata instead.
- Run these operator checks (the workflow retries these same readiness paths):

  ```sh
  curl -fsS --max-time 20 https://beta.daisydebate.com/api/health/live
  curl -fsS --max-time 20 https://beta.daisydebate.com/api/health/ready
  curl -fsS --max-time 20 https://daisy-debate-staging-realtime.fly.dev/health/ready
  curl -fsS --max-time 20 https://daisy-debate-staging-livekit.fly.dev/
  ```

  Verify response deployment metadata where supplied against the candidate.
  Inspect `fly logs -a daisy-debate-staging --no-tail` for startup refusal,
  worker errors and database errors; keep evidence scrubbed. A liveness 200
  alone does not prove startup/readiness.

- With the owner's test accounts, prove ordinary one-on-one Room creation,
  friend join, Ready, Start, audio in both directions, normal completion and
  retained outcome/chat/Recording access. Check existing ranked history and
  beta admission. Confirm Tab stays hidden for an ordinary account. The local
  migration rehearsal establishes preservation; it does not replace this
  deployed smoke test.
- Post candidate SHA, run URL, health and ordinary-play results on Delivery.
  Keep the deploy workflow disabled throughout the parent-only period.
  Take fixes from main into the parent through the point guard; deploy the
  reviewed parent again with the same controlled dispatch window.

## Failure and rollback

Migrations only go forward (DEC-304). Do not edit the journal, run down
migrations, run `db:reset`, or redeploy main blindly. The schema migration adds
lobbies/tenant keys and maps existing ratings; `tab_seats` rewrites stored
rules, seats, outcomes, receipts and capture configuration, removes `role`
and `outcome` columns used by pre-Tab main, and validation/template migrations
complete that change. An old machine that accepts **additions** cannot make
those removed columns reappear. None of these migrations has an undo path.

- **Before any parent migration commits:** the operator may roll each affected
  runtime app back to its captured main image using
  `fly deploy -a <app> --image <captured-main-image> --ha=false` (retain each
  app's existing config; use its corresponding `-c fly.<service>.toml` when
  deploying from a checkout). Do not deploy the migrator to roll back code.
  Verify SHA/health/ordinary play as above. Main automatic deployment stays
  held until its database compatibility is confirmed.
- **After any parent migration commits:** inspect the committed journal and
  failed step. Prefer fixing forward on the parent and rerunning the release;
  previously committed folders stay applied, and the failed folder rolls back.
  A partial deploy can leave old workers running, so inventory every app.
- **If returning to the pre-Tab main image is required after the rewrite:**
  keep automatic deployment disabled, stop traffic and every database writer,
  obtain explicit sign-off for restoring the pre-migration backup and the
  resulting loss of newer writes, and follow the linked restore runbook plus
  its post-restore session/link invalidation. Only after the restored database
  matches main should the operator redeploy **all** captured main runtime
  images using the command above. Do not run the parent's migrator against
  the restored database. Recheck identities, health and ordinary play before
  traffic resumes. This is a database recovery operation, never an image-only
  rollback. If restoration is not authorized, remain on forward repair.

## Release the hold when Tab lands on main

Keep the hold until the owner-approved parent PR is merged to main, main's
exact merge SHA has a green `CI gate`, and that main migration history
contains the staging journal. No pre-Tab main image is eligible.

```sh
gh workflow enable deploy-staging.yml
gh api repos/2witstudios/daisydebate/actions/workflows/deploy-staging.yml --jq .state
gh workflow run deploy-staging.yml --ref main
gh run list --all --workflow deploy-staging.yml --event workflow_dispatch \
  --branch main --limit 10 --json databaseId,headSha,status,url
gh run watch <main-manual-run-id> --exit-status
```

Require `active`, the reviewed main SHA and the same health/ordinary-play
checks. Dispatch explicitly because CI may have completed while the workflow
was disabled; enabling does not replay that completion event. Automatic
main-after-green-CI staging deployments now resume. Post the released hold,
main SHA and evidence on Delivery. Production remains a separate human action.

Command references: [GitHub workflow disabling](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows),
[workflow dispatch](https://cli.github.com/manual/gh_workflow_run),
and [run listing](https://cli.github.com/manual/gh_run_list). The installed
CLI help was checked when writing this procedure. `--all` includes disabled
workflows in run listings. No deployment or remote data proof was performed
while writing this document.
