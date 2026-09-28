# 0046: The AUTH-7.7 alert probe's GitHub Actions schedule does not run at DEC-10's assumed cadence — owner decision needed to correct it

Status: accepted (the finding: DEC-10's assumed cadence does not hold in
production). The fix between it is not decided — recorded as a pending
decision on the owner's behalf per ADR 0035 §4, open until confirmed or
overruled. Amends [ADR 0042](0042-auth-alert-evaluation-point.md), which
chose GitHub Actions'
`schedule` trigger as the evaluator and accepted, as a _known limitation_,
that "GitHub's `schedule` trigger is best-effort and can run a few minutes
late under platform load." That assumption is false at the granularity DEC-10
relied on. This ADR does not change the decision itself — it corrects the
measured facts underneath it and lays out the two ways to actually fix it,
both of which are deploy-rail or cost changes AGENTS.md reserves for the
owner ("Deploy-rail and production-data changes require a human-only
sign-off leaf; agents never self-approve").

## Context (measured, ISSUE-157)

`gh run list --workflow auth-alerts.yml` on `main` shows 15 runs across
~43.5 hours, 2–5 hours apart, against a `cron: '*/5 * * * *'` schedule. This
is not "a few minutes late" — the workflow ran at roughly 1–2% of its
configured cadence. In that time, only the `cleanup_missed` condition (a
2-hour threshold) has ever fired live; `storage_unavailable` and
`limiter_unavailable` (2-minute thresholds, even after
[the ISSUE-156 fix](../operations/auth-delivery.md#storage-or-rate-limiter-unavailable)
that keeps their since-time alive through a continuous outage) and
`auth_5xx_rate` (10-minute window) are almost never observable at this real
cadence, because their windows lapse between runs GitHub actually executes.

GitHub documents this directly: "the schedule event can be delayed during
periods of high loads... The delay can be as much as 15 minutes, or even
longer if there's an outage affecting GitHub Actions"
(source below) — and the review's 15-run sample shows delays far past even
that stated ceiling. `schedule` was never designed for sub-hour reliability
at scale; ADR 0042 under-estimated how far short of 5 minutes it would fall.

ADR 0042 also already priced in that the 5-minute probe, by waking
`daisy-debate-staging` on every run (`auto_start_machines`), would keep the
machine running almost continuously — **owner decision DEC-10 (confirmed)**
accepted roughly $4/month of continuous run time for that. In practice the
probe runs 2–5 hours apart, so the machine is *not* being kept awake as
DEC-10's cost estimate assumed either: staging sleeps for hours at a time
between real runs, then the next probe wakes it, evaluates state that has
gone stale, and goes back to being invisible for hours. DEC-10's premise
(reliable 5-minute wake-ups, ~$4/month) does not match what is actually
deployed today.

## Options considered

Both options genuinely deliver a 5-minute cadence. Neither is free to
choose without the owner, for different reasons — this ADR does not pick
one.

**Option A — make staging genuinely always-on and move evaluation in-app.**
Set `fly.toml`'s `min_machines_running = 1` for `daisy-debate-staging` (no
longer scale-to-zero) and run the existing `evaluateAlerts`/
`readAlertSnapshot` logic on an in-process 5-minute interval (the same
`setInterval`/`unref` shape `retention-sweep.ts` already uses), posting
directly to the Incidents webhook from the app process instead of shelling
out to `notify-drive.ts` from CI.

- Delivers a _real_ 5-minute cadence for all four conditions, with no
  dependency on any external scheduler's reliability.
- Costs almost exactly what DEC-10 already approved: an always-on
  shared-cpu-1x/512mb machine (staging's current size) runs continuously
  for the same ballpark ~$4/month DEC-10 accepted for "the probe keeps it
  awake" — this corrects the mechanism, not the price DEC-10 signed off
  on. (Confirm against Fly's current published price per second before
  treating this figure as exact; ISSUE-168 already flags the deploy doc's
  idle-cost figure as stale.)
- **Loses the one thing ADR 0042 built the external evaluator to catch**:
  an evaluator running inside the app cannot notice the app being fully
  down or crash-looping. A much lighter external liveness probe (not the
  full alert-condition evaluator, just "is `/api/health/ready` answering
  at all") would still be worth keeping, at whatever cadence GitHub
  Actions actually delivers — that gap is now honestly documented instead
  of assumed away.
- Requires a new production secret: the Incidents webhook URL/secret,
  currently CI-only (`.github/workflows/auth-alerts.yml`'s `secrets:`),
  would need to reach the running web app's environment. Same webhook,
  same signing scheme `notify-drive.ts` already uses — not a new vendor —
  but it does move a credential's reachable surface from "CI only" to
  "the production app process," which is exactly the kind of thing
  [ADR 0019](0019-token-secret-ownership.md) exists to make an explicit
  call about, not an incidental side effect of a bug fix.
- `fly.toml` and a new production secret are both deploy-rail changes.

**Option B — a dedicated, always-on Fly machine that only runs the existing
external prober**, on its own true 5-minute loop (in-process interval, not
`fly machine run --schedule`, whose finest supported granularity is hourly —
confirmed via `fly machine run --help`, so Fly's own scheduled-machine
feature cannot hit this cadence at all). Leaves
`daisy-debate-staging` unchanged at `min_machines_running = 0`.

- Keeps ADR 0042's original detection guarantee intact (an evaluator
  genuinely outside the app it is evaluating), and needs no new secret in
  the web app's own environment.
- Is a wholly new piece of infrastructure to provision, deploy, and
  monitor — a small dedicated machine (e.g. shared-cpu-1x/256mb) run
  continuously, at a cost _in addition to_ what DEC-10 already accepted
  (order of $2/month more, not a substitution for it).
- A new Fly app/machine is unambiguously a new deploy-rail resource and a
  new ongoing cost, neither of which this ADR or any agent may accept on
  the owner's behalf.

## Decision

**Not made here.** Recorded as a pending decision
([DEC-33](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha), linked to
this ADR and to DEC-10) for the owner to confirm one of:
Option A, Option B, or a cadence the owner accepts GitHub's `schedule`
trigger actually delivering (superseding DEC-10's 5-minute assumption
outright, with the runbook's windows and the epic's evidence contract
updated to match). Until confirmed, `.github/workflows/auth-alerts.yml`
keeps running as today — degraded but not worse than before this ADR — and
AUTH-7.7-AC3 (cadence) and the live-trigger proof for
`storage_unavailable`/`limiter_unavailable`/`auth_5xx_rate` stay blocked
(ISSUE-157).

## Consequences (once decided)

- Option A: `apps/web/src/server/` gains an in-process alert-evaluation
  loop; `fly.toml` sets `min_machines_running = 1` for staging;
  `packages/config` gains the Incidents webhook URL/secret as a
  production-optional field; `docs/operations/deploy-staging.md`'s idle-cost
  section is rewritten (staging is no longer scale-to-zero); a lighter
  liveness-only external check may replace the current heavy probe.
- Option B: a new Fly app/machine, its own minimal Dockerfile/entrypoint
  running `scripts/auth-alert-probe.ts` on a true interval, its own secrets,
  and its own runbook entry for "the probe machine itself is down."
- Either way: `docs/decisions/0042-auth-alert-evaluation-point.md`'s "Known
  limitations" section is corrected (GitHub's schedule is not "a few minutes
  late" at the observed 2–5 hour granularity), and DEC-10 is either
  reaffirmed with the corrected mechanism or superseded with a new cadence.

## Sources

- GitHub Actions `schedule` trigger delay:
  https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
- Fly Machines `--schedule` granularity (hourly/daily/weekly/monthly only,
  confirmed via `fly machine run --help`, 2026-09-28):
  https://fly.io/docs/machines/flyctl/fly-machine-run/
- Fly.io scale-to-zero and `auto_start_machines`/`min_machines_running`:
  https://fly.io/docs/reference/configuration/#the-http_service-section
- `gh run list --workflow auth-alerts.yml` (measured cadence, 2026-09-28,
  this review's own reproduction of ISSUE-157's finding).
