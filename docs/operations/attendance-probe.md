# Attendance probe repair

Production requires explicit human sign-off. A narrowly scoped staging repair
may be delegated explicitly by the owner; coordinate configuration and fixture
changes with the point guard. It repairs future evidence: no sample is ever backfilled, and no past
Round is rewritten.

## When

`availability.probe_invalid` names what is wrong with the resources
`ATTENDANCE_PUBLIC_PROBE` points at:

| `cause`               | Meaning                                   |
| --------------------- | ----------------------------------------- |
| `round_missing`       | The synthetic Round no longer exists      |
| `round_not_active`    | The synthetic Round has ended             |
| `segment_missing`     | The configured segment is not in it       |
| `participant_missing` | The configured seat is not in it          |
| `check_failed`        | The check could not read them; it retries |

These describe the resources only. A healthy result here does not prove public
ingress works: only a real check-in does.

## What still works while it is broken

On-time speakers are credited, and Rounds complete (ADR 0095). What stops is
absence inference: a missing speaker postpones until the cutoff, then the Round
ends with no winner.

## Repair

1. Recreate the synthetic probe account, Round, segment and seat with
   `scripts/staging-transcript-fixture.ts` conventions, on an admitted synthetic
   account (ISSUE-698: it needs a durable age fact before the gate is on).
   `apps/web/scripts/staging-attendance-probe.ts` is the guarded staging repair
   entry: bundle it with Bun and run it on the verified web machine with the
   actual full image commit as its argument. It refuses any other app, origin,
   commit or actual database before creating three fresh synthetic members.
   It records durable age/Terms and admission, signs normal seven-day sessions,
   then uses the same public Room/Ready/Start/check-in/yield flow as the isolated
   launch fixture. Both speeches earn real receipts before being yielded. No
   AI provider is called. It retains the negative speaker's session and writes
   only the new fixture secret to a unique mode0600 `.env` file on that machine;
   output contains the file path and safe proof facts, never the cookie.
   Pipe that private file directly into the staged secret update without
   displaying it. Remove the private file after the staged value is verified.
2. `ATTENDANCE_PUBLIC_PROBE` contains only `roundId`, `segmentId`,
   `participantId` and `cookie`. The probe derives its destination and Origin
   header from `PUBLIC_APP_URL`, the same authority used by the strict public
   route gate. An `origin` field is invalid; there is no second destination.
   Replace only the synthetic fixture secret if needed. Never paste credentials
   or the raw secret into a page, log, task or command argument.
   For the first rollout of this schema, stage the secret without `origin`
   alongside the new image: old and new strict parsers accept different shapes.
   Never activate that staged secret against the old image. A rollback needs
   its matching secret shape, or the old process cannot start its probe.
3. Confirm `availability.probe_invalid` stops at the next hourly check or restart.
4. Confirm the real boundary: the probe gets an accepted receipt and
   `availability_samples` shows three consecutive healthy samples. Readiness alone
   is not proof.
5. Verify the actual web and realtime Fly machine image commit and runtime
   settings, rather than the last successful deployment workflow. Verify the
   installed SDK policy separately from Sentry ingestion: force an upstream
   sampled parent and confirm suppressed check-in/health roots, middleware and
   standalone operations; ordinary traffic follows the local 1% policy. The
   probe's outgoing check-in and hourly session slide run in suppressed scopes
   and send no Sentry trace headers. Delayed or absent vendor events alone do
   not prove that policy is deployed.

The elected sampler still probes every second through the normal public route,
with a fresh command alias and a matching durable accepted receipt. It never
bypasses origin, session, account admission or seat authorization. An hourly
session read may slide a valid session, but cannot revive an expired session
and never proves health. Repair an expired synthetic session using the normal
signed-session conventions; never fabricate receipts or healthy samples.

## Rounds left active by an outage

The next maintenance pass resolves them through the ordinary paths. Never fabricate a receipt, a horizon or a ballot, and never reopen an
expired window.
