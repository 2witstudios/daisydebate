# 0101: Operational signals report only what happened

Status: accepted by the point guard on the owner's behalf, 2026-11-02.
Supersedes the "Cleanup missed" section and the `KNOWN_OPERATIONS` sentence of
[ADR 0042](0042-auth-alert-evaluation-point.md), and the build-time clause for
`NEXT_PUBLIC_SENTRY_DSN` in [ADR 0037](0037-error-tracking-and-product-analytics.md).
Plan: [operational signals](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/pti88x87gd032ys1ki6m28x5).
Issues: ISSUE-1007, ISSUE-1008, ISSUE-1009.

## Context

The 2026-11 architecture audit found three signals that report success when
nothing worked:

- `cleanup_missed` read any target's `retention.sweep.completed`, and three
  recurring jobs reused the sweep as if they were retention targets. One of them
  runs every 5 seconds, so the alert could not fire while PostgreSQL answered.
- Browser error capture read a build-time variable no build received, while the
  CSP read the runtime one. Setting the deploy secret opened the CSP and captured
  nothing.
- A hand-kept list labelled the latency histogram, so most route handlers merged
  into `other`, and a slow check-in could not be told from a slow inbox.

## Decision

**A retention run decides its own outcome.** `retention.run.completed` is logged
only when every target succeeded and shutdown cut nothing short, and it is the
only event the `cleanup_missed` marker reads. The per-target events stay.

**Observation purges, privacy jobs and file maintenance are scheduled workers,**
not retention targets. Each has its own name, marker, alert and failure counter,
and shares only `startRunSchedule` with the sweep.

**A worker is healthy only when it owes nothing.** A retried job backs off, so
the next runs find nothing due. If an idle run counted as success it would refresh
the marker between retries, and the alert could never fire during a vendor outage.
So a run logs `worker.run.failed` if it threw or retried, nothing if a job is
still in backoff, and `worker.run.completed` only if neither.

**Alerts are per worker.** `observation_purges_missed` after 15 minutes,
`privacy_jobs_missed` after 2 hours, each longer than its backoff ceiling, and
`file_maintenance_missed` after the greater of 2 hours and three intervals. A
worker this process does not run raises nothing; a running worker with no healthy
run on record fires, as `cleanup_missed` does.

**Browser capture reads runtime configuration.** The root layout writes the DSN and
environment on `<html>` per request and `instrumentation-client` reads them there.
The CSP and the client read one value, one image serves any environment, and no
inline script is needed. The variable keeps its name, as PostHog's runtime key
does. Source-map upload remains the only build-time Sentry behaviour.

**Operation names are a closed type.** `handleOperation` accepts only
`OperationName`, so a new route with no entry fails to compile. The `other` label
is gone, and the histogram is `http_request_duration_ms`, since it was never only
auth.

## Consequences

- `privacy_jobs_missed` fires if a vendor is down for over 2 hours. That is the
  intent: a required deletion is unpaid.
- The histogram can reach one series per operation name per bucket. That is bounded
  by the list, and nothing scrapes it yet.
- A render that fails before the root layout's `<html>` reaches the browser leaves
  browser capture uninitialised, because `global-error` renders its own document
  without the attributes. The server tracker still reports that failure. This is
  from reading the code, not a run; ISSUE-1042 tracks it.
- The owner still activates Sentry (PRIV-H). The browser proof uses an intercepted
  origin, not a live project.
