# Recordings

Operator runbook for Recordings ([ADR 0105](../decisions/0105-recording-and-retention.md)).
Retention and lawful basis are in [compliance](compliance.md), and are proposed
until counsel reviews them.

## Storage

Objects live in a private Tigris bucket, set by `RECORDING_BUCKET_ENDPOINT`,
`RECORDING_BUCKET_NAME`, `RECORDING_BUCKET_ACCESS_KEY_ID`,
`RECORDING_BUCKET_SECRET_ACCESS_KEY` and optionally `RECORDING_BUCKET_REGION`. It has
no public access. Every object of a Recording sits under `recordings/<id>/`, which
is what lets deletion reach all of it. Without these settings the app serves no
object and the sweep deletes nothing: intents wait, and are logged as failures.

Creating the bucket and its secrets is a deploy-rail change with human sign-off.

## States

`requested`, `capturing`, `processing`, `ready`, `failed`, `taken_down`, `removing`,
`removed`. `recordings.lifecycle` is the whole state; `status` repeats its tag.

## Takedown

A takedown hides the Recording from everyone at once. Every new playback or download
request is refused, and a signed read already issued lasts at most 60 seconds. The
objects stay, as evidence for disputes and integrity review, until moderation
removes them. A Recording taken down while ready can be restored as it was.

## Removal and erasure

A participant's removal of a casual Recording, an account's erasure and a moderator's
removal all write `removing`, a durable intent. The sweep runs every minute. It
lists the Recording's prefix, deletes a bounded batch, and marks it `removed` only
when the prefix lists empty and at least an hour has passed since the request, so
a capture still writing cannot leave an object behind. Ranked Recordings cannot be
removed by a participant or by erasure.

## When deletion is stuck

Look for rows that stay in `removing`:

```sql
select id, deletion_attempts, deletion_due_at
from recordings where status = 'removing' order by deletion_due_at;
```

A failed attempt doubles its wait, from one minute to at most one hour, and keeps
retrying. Fix the storage credentials or outage and the sweep catches up by itself.
Never edit `lifecycle` by hand to `removed`: the objects would stay in the bucket
with no intent left to delete them.

## Downloads

A subscriber gets a link signed for 60 seconds, ten per hour per account. A copy
already downloaded is outside Daisy and nothing here reaches it.
