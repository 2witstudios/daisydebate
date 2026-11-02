# Attendance probe repair

Human-only. Never run this from an agent, and never against production without
sign-off. It repairs future evidence: no sample is ever backfilled, and no past
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
2. Replace the `ATTENDANCE_PUBLIC_PROBE` secret. Never paste it into a page, log
   or task.
3. Confirm `availability.probe_invalid` stops at the next hourly check or restart.
4. Confirm the real boundary: the probe gets an accepted receipt and
   `availability_samples` shows three consecutive healthy samples. Readiness alone
   is not proof.

## Rounds left active by an outage

Deploying ADR 0095 resolves them on the next maintenance pass, through the
ordinary paths. Merging to main deploys staging, so this comes before the merge.
Run the dry run and get human sign-off first:

```sh
DATABASE_URL=<target> bun apps/web/scripts/round-completion-dry-run.ts <roundId>...
```

It reads metadata inside a READ ONLY transaction, so PostgreSQL refuses any write,
and prints no text. It treats every scheduled speaker as still eligible to attend. Never fabricate a receipt, a horizon or a ballot, and never reopen an
expired window.
