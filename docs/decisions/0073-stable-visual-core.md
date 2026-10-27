# 0073: A stable visual core, rebaselined in one action

Status: accepted (owner decision, 2026-10-26). Narrows the screenshot suite
that grew from [ADR 0028](0028-tailwind-v4.md) decision 8 (parity is proven
with screenshots); the rest of ADR 0028 stands.

## Context

`apps/web/e2e/visual.e2e.ts` compared 108 full-page baselines: the
dashboard, settings, the lobby and every onboarding screen in both schemes
at three widths, plus the AUTH-4.7 confirm pages in both schemes at three
widths. Measured on `origin/main`:

- In the last 30 days, 28 commits touched the baselines and rewrote 568
  baseline files.
- Over 60 days, no commit shows a visual diff catching an unintended
  regression. Every baseline change was a deliberate regeneration,
  including temporary "zero-tolerance harvest" commit/revert pairs.
- Daisy is pre-ship and its UI changes daily, so each UI pull request paid
  a fail, download artifacts, commit round trip for a change it meant to
  make. Behavior, accessibility (axe) and palette contrast are proven by
  their own suites; the screenshots added cost without catching anything.

## Decision

1. **A surface keeps a baseline only when it rarely changes on purpose
   and a purely visual regression there would matter**: brand, auth and
   confirm pages, the app shell frame and settings. Surfaces under active
   design (the lobby, onboarding, rooms, rounds, records) do not, and gain
   one only when they stabilize and meet this rule.
2. **The core is 13 baselines.** The signed-out dashboard (the app shell
   frame) and settings, each in light at desktop and mobile width and in
   dark at desktop; the sign-in confirm page's confirm state in light at
   AUTH-4.7's 1280, 640 (200% zoom) and 320 widths and in dark at 1280; its
   expired and sent states in light at 1280; and the email-change confirm
   page in light at 1280. Light leads because it is the default scheme
   ([ADR 0069](0069-light-default-scheme.md)). Every other baseline and
   its test case is deleted, not skipped. The 2% pixel tolerance is
   unchanged.
3. **An intended change rebaselines in one action.** The manual
   `Rebaseline visuals` workflow (`.github/workflows/rebaseline-visuals.yml`)
   takes a pull request number or branch, renders the visual project with
   `--update-snapshots` on the Playwright E2E job's runner image, and
   commits only changed files under `apps/web/e2e/visual-baselines/` back
   to that branch as `test(visual): rebaseline visual snapshots`.
4. **The workflow never puts a write token beside branch code.** It
   refuses fork branches, pull requests that are not open, `main` and the
   default branch, and branch names outside a plain character set. The job that builds and runs branch code
   holds `contents: read`, keeps no checkout token and sees no secret; the
   one `contents: write` job runs nothing from the branch, accepts only
   flat `*.png` artifact entries, stages only the baselines folder and
   pushes a fast-forward of the commit it rendered, so a branch that moved
   meanwhile rejects the push. A dispatch runs in `main`'s cache scope, so
   the render job restores the browser cache and never saves one: a cache
   it wrote would reach every branch and `main`. Branch code can still
   reach the cache service through the runner's own token; that residual
   path is accepted because no consumer of the cache holds a secret.

## Consequences

- UI pull requests outside the core no longer touch baselines; one inside
  it runs `gh workflow run rebaseline-visuals.yml -f target=<pr>` instead
  of a local Linux browser server and an artifact download.
- A push made with the workflow token does not start CI (GitHub's rule
  against recursive runs), so the branch's next push, or a close and
  reopen of the pull request, runs the gates on the rebaselined head.
- The bot commit moves the pull request head; rebaseline before reviewers
  start, so their comments refer to the head that merges.
- Visual coverage of the removed surfaces is gone by choice; their
  behavior, accessibility and contrast remain covered by the E2E, axe and
  palette suites.
- `scripts/rebaseline-visuals.test.ts` pins the workflow's trigger,
  permissions, credential separation and target refusals.
