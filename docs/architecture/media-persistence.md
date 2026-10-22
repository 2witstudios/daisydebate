# Round media persistence

The media adapter stores one opaque LiveKit room name per Round and one opaque
identity per authoritative Round participant. It does not copy actor, role or
slot authority. Composite foreign keys bind a media participant to both the
session's Round and its competitive seat. `createMediaSessionStore` in
`@daisy/db/media-session` serializes binding creation on the Round row; terminal
Rounds and ended sessions refuse admission. Its caller must resolve fresh
application authorization and the judging window before requesting a binding.
This storage operation alone neither creates a vendor room nor mints credentials.

## Privacy classification

Every column introduced by VIDEO-1.3 is listed below. Identifiers are not bearer
credentials. These rows exist only for live media routing; no audio, display name
or vendor token is stored. Media failures never determine a competitive result.

| Table              | Columns                                                  | Category   | Purpose                                                |
| ------------------ | -------------------------------------------------------- | ---------- | ------------------------------------------------------ |
| media_sessions     | id, round_id, room_name                                  | identifier | Bind a Round to an opaque media room                   |
| media_sessions     | created_at, ended_at                                     | none       | Bound session lifecycle                                |
| media_participants | id, session_id, round_id, round_participant_id, identity | identifier | Resolve opaque media identities to authoritative seats |

The participant bindings follow Round erasure and are deleted with their session.
Round participant deletion is restricted until media bindings are removed, so
subject erasure must remove dependent media routing records first. Production
privacy policy activation remains human-held. Transcript text remains personal,
private to seated debaters/judges and retained for 180 days under DEC-101;
retention deletion is tracked by ISSUE-322. This change stores no transcript text.

## Historical speaking authority

`round_speaking_intervals` records accepted eligibility as half-open
`[started_at, ended_at)` intervals for a durable segment and Round seat. A null
end remains open. Simultaneous cross-examination seats are allowed; overlapping
intervals for the same segment and seat are rejected by a PostgreSQL GiST
exclusion constraint. This uses PostgreSQL 18's bundled trusted `btree_gist`
extension for text equality. The SQL constraint is handwritten alongside the
generated migration because Drizzle 1.0.0-rc.4 has no exclusion schema builder.

The command executor must close/open intervals in the same transaction as its
accepted checkpoint/version and segment writes, using the authoritative accepted
instant. Positive start versions and paired end/version fields prevent partly
closed rows. Optional start/end command IDs carry scoped Round foreign keys;
automatic clock transitions use versions without inventing client commands.
The history is competitive authority, not proof that any audio was observed.
Calibrated capture coverage and uncertainty are separate producer obligations.

| Table                    | Columns                                                                              | Category   | Purpose                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------- |
| round_speaking_intervals | id, round_id, segment_id, round_participant_id, started_command_id, ended_command_id | identifier | Bind accepted speaking authority to its segment, seat and optional command |
| round_speaking_intervals | started_at, ended_at, started_version, ended_version                                 | none       | Reconstruct accepted eligibility boundaries and versions                   |

These rows follow Round erasure. Seat deletion is restricted until dependent
intervals are removed; segment deletion cascades its intervals. They contain
neither transcript text nor raw audio. Runtime accepted-command atomicity,
coverage, freeze and judging integration require their own real-service proof.

## Frozen transcript and judging intent

`round_transcript_freezes` has one immutable row per Round. Its positive
`revision` identifies the frozen input; `frontier` is the nonnegative committed
transcript revision, never a timestamp. `completeness` is `complete` or
`incomplete`. A database trigger rejects updates; subject erasure may delete the
row. The finalizer must lock the owning Round, close admission, establish terminal
speaking history and classify every required stream before inserting the freeze.
`frozen_at` uses the database clock at insertion. Storage alone does not prove
coverage or authorize freezing on silence.

`round_judging_jobs` binds one durable intent to that exact Round/revision. Its
judge seat has a scoped Round foreign key; its optional result ballot is scoped
to the same judge seat. A leased intent requires a token, expiry and positive
attempt count; only a succeeded intent can carry a result. Tokens are secret
fencing values and must never be logged. Runtime claim/renew/finish operations
must compare the token and unexpired lease in their write transaction. Existing
`agent_runs` continues to own provider/model usage for judging attempts.

| Table                    | Columns                                                         | Category   | Purpose                                                       |
| ------------------------ | --------------------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| round_transcript_freezes | round_id                                                        | identifier | Bind the one immutable input to its Round                     |
| round_transcript_freezes | revision, frontier, frozen_at, completeness                     | none       | Pin transcript frontier, closure time and honest completeness |
| round_judging_jobs       | round_id, judge_participant_id, result_ballot_id                | identifier | Bind a durable intent and result to the Round judge           |
| round_judging_jobs       | lease_token                                                     | secret     | Fence the active judging attempt                              |
| round_judging_jobs       | freeze_revision, status, lease_expires_at, attempts, created_at | none       | Track the exact frozen input and retryable execution          |

Frozen inputs and jobs follow Round erasure. Jobs are deleted before their
referenced ballots/seats; freeze deletion cascades the job. These tables add no
text/audio copy and do not activate a provider or production privacy policy.
Empty speaking intervals `[t,t)` preserve accepted command provenance only;
consumer containment must require a nonempty calibrated uncertainty window.
