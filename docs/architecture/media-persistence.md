# Round media persistence

The media adapter stores one opaque LiveKit room name per Round and one opaque
identity per authoritative Round participant. It does not copy actor, role or
slot authority. Composite foreign keys bind a media participant to both the
session's Round and its competitive seat. The rooted `database.mediaSessions` adapter serializes binding creation on the
Round row using the existing application pool and bounded transaction. It resolves
fresh canonical account and Round seat authority under locks, runs the shared
engine tick, and rejects terminal Rounds, expired judging windows and ended
sessions before admission.
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
to the same judge seat. A leased intent requires a SHA3-256 token digest, expiry and positive
attempt count; only a succeeded intent can carry a result. Bearer tokens use OS CSPRNG entropy, never cuid2. Only their SHA3-256
digests are persisted; neither bearer nor digest is logged. Runtime claim/renew/finish operations
must compare the supplied token digest and unexpired lease in their write transaction. Existing
`agent_runs` continues to own provider/model usage for judging attempts.

| Table                    | Columns                                                         | Category   | Purpose                                                       |
| ------------------------ | --------------------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| round_transcript_freezes | round_id                                                        | identifier | Bind the one immutable input to its Round                     |
| round_transcript_freezes | revision, frontier, frozen_at, completeness                     | none       | Pin transcript frontier, closure time and honest completeness |
| round_judging_jobs       | round_id, judge_participant_id, result_ballot_id                | identifier | Bind a durable intent and result to the Round judge           |
| round_judging_jobs       | lease_token_digest                                              | secret     | Fence the active judging attempt                              |
| round_judging_jobs       | freeze_revision, status, lease_expires_at, attempts, created_at | none       | Track the exact frozen input and retryable execution          |

Frozen inputs and jobs follow Round erasure. Jobs are deleted before their
referenced ballots/seats; freeze deletion cascades the job. These tables add no
text/audio copy and do not activate a provider or production privacy policy.
Empty speaking intervals `[t,t)` preserve accepted command provenance only;
consumer containment must require a nonempty calibrated uncertainty window.

Scoped child references use PostgreSQL `NO ACTION DEFERRABLE INITIALLY DEFERRED`, checked at transaction end,
rather than `RESTRICT` before owning-parent cascades finish. Direct deletion of a
referenced seat, command or ballot still fails. This allows a Round cascade to
remove its session/history/queued intent without depending on trigger order.

## Actual final-end anchor

`rounds.final_segment_ended_at` and `rounds.transcript_admission_cutoff` are nullable
as a pair. The cutoff is exactly 120 seconds after the actual final segment close.
Once assigned, a trigger rejects changes or clearing, including moving both
columns together. Runtime closes the actual final segment and writes this pair
atomically with accepted history. A planned schedule or a client clock cannot
assign it. Both columns have category `none`: they bound transcript admission,
contain no audio/text and follow Round erasure. The separate judging window ends
30 minutes after that same actual final-end anchor.

## Capture storage producer

Expected streams use the stable `(segment_id, round_participant_id)` key from
nonempty actual historical speaking intervals. They must be discovered from
history, never merely from seal rows that happen to exist. `transcript_segments`
stores `open`, `complete` or `partial`, with received and declared chunk counts.
A finalizer can insert a missing stream directly as partial with zero chunks.
Closed complete/partial records are immutable. Matching counts is necessary for
complete but insufficient: the sealing operation must also prove continuous
trusted observation coverage over every required interval. Missing tracks,
takeovers, dropped clips, calibration loss and stalls cannot establish silence.

`transcript_observations` stores trusted server observation intervals per stream,
track and lease epoch; raw PCM remains in worker memory. A current worker lease
is identified by `media_worker_leases.session_id`, `worker_id` and rising `epoch`.
`worker_id` is an identifier, never a bearer credential. Ingress must verify its
signed principal and active epoch under the same locks as append/seal.
Every capture read, append, observation, seal and worker-token verification
also applies one session rule, `captureSessionAdmits`. Ending, turning unsafe
and a vendor-room deletion request (`deletion_requested_at`, which is not data
erasure) each close the session. After the earliest close a write is admitted
only if its audio was captured strictly before that instant (an append's clip
end, an observation's end) and it reaches the database within the injected
(`sttLagMs`, which web composition sets to `CAPTURE_STT_LAG_MS`: the worker's history read, speech-to-text timeout and an append with its one retry, 66.5 s, from `@daisy/protocol` `capture-timing`, which also sets the 120 s transcript admission window that must cover it), so lagging transcription of earlier audio still lands and a
worker stamp alone never admits late audio. Reads and seals carry no capture
time and are admitted.

`utterances` remains the only transcript text store. Capture metadata identifies
a clip by its segment, seat, track and start offset, plus a deterministic clip
key. A body digest detects conflicting retries. `round_transcripts.revision`
records the committed transcript frontier under the owning Round lock. Duplicate
clips must not advance it. Every transcript writer, including bot publication,
must adopt the same bounded transaction and freeze/cutoff fences before full
acceptance. These schema tables alone do not prove a working capture producer.

| Table                         | Columns                                                            | Category         | Purpose                                                  |
| ----------------------------- | ------------------------------------------------------------------ | ---------------- | -------------------------------------------------------- |
| round_transcripts             | round_id                                                           | identifier       | Bind the committed frontier to its Round                 |
| round_transcripts             | revision                                                           | none             | Monotonic committed transcript frontier                  |
| transcript_segments           | round_id, segment_id, round_participant_id                         | identifier       | Bind a stream to authoritative segment and seat          |
| transcript_segments           | state, chunk_count, sealed_chunk_count, sealed_at                  | none             | Preserve honest complete/partial write closure           |
| transcript_observations       | id, round_id, segment_id, round_participant_id, track_id           | identifier       | Bind trusted observation coverage to the media stream    |
| transcript_observations       | worker_epoch, observed_from, observed_until                        | none             | Prove continuous coverage without persisting PCM         |
| round_bot_publication_windows | id, round_id, segment_id, round_participant_id                     | identifier       | Bind a bot's credited publication time to its seat       |
| round_bot_publication_windows | credited_from, credited_until                                      | none             | The time a bot stream must cover to seal complete        |
| media_worker_leases           | session_id, worker_id                                              | identifier       | Identify the active capture worker                       |
| media_worker_leases           | epoch, expires_at                                                  | none             | Fence takeover and stale ingress                         |
| utterances                    | clip_key, capture_track_id                                         | identifier       | Deduplicate the captured clip                            |
| utterances                    | capture_start_offset_ms, capture_duration_ms, capture_worker_epoch | none             | Bind clip placement and worker epoch                     |
| utterances                    | capture_body_digest                                                | personal/private | Detect conflicting retries of private transcript content |

Capture body digests follow transcript retention of 180 days and subject erasure;
hashing does not anonymize transcript-derived data. Raw transcript text remains
personal/private under DEC-101. The retention sweep deletes an utterance row 180
days after `created_at` (`retention.utterances`, `utterances_created_at_idx`), and
the `round-transcript` privacy adopter (`packages/db/src/round-transcript-privacy.ts`)
deletes an erased subject's own rows and exports them on request (ISSUE-498). These rows
follow Round/segment erasure; the scoped seat reference checks at transaction end
so aggregate deletion can cascade without allowing orphan references. No new
legal basis, production consent or provider activation is inferred.

The `utterances.capture_body_digest` declaration is category `personal`, visibility
`private`, purpose detecting conflicting captured-transcript retries. Lawful basis
is **pending** the existing PRIV-H human production sign-off; synthetic local
proof does not grant legal approval. Retention is 180 days alongside transcript
text; subject erasure and owning Round erasure delete it. It is derived personal
transcript data and is not anonymized.

### Frozen ballot witness

Every ballot carries `ballots.round_id` (category identifier) and a positive
`freeze_revision` (category none), both NOT NULL. Composite references bind the
judge seat to that Round and bind the revision to its immutable transcript
freeze. Both fields are immutable on every UPDATE. Voiding preserves the pair.
No new transcript content is copied into the ballot witness. Existing ballot
privacy, retention and erasure policy applies to the owning record.

The shared human/bot submit writer is the only ballot writer. Command deduplication uses
the existing global `round_commands.command_id` key with type `submit_ballot`.

The freeze witness uses `NO ACTION DEFERRABLE INITIALLY DEFERRED`; deleting a
freeze alone cannot erase submitted ballots. Judge-seat references use deferred
NO ACTION rather than immediate RESTRICT semantics so the owning Round's
`ballots_round_fk ON DELETE CASCADE` can finish all child cascades. Direct seat
or freeze deletion is refused at commit and rolls back. This changes technical
constraint timing, not ballot voiding or replacement policy. Real PostgreSQL
proof checks both commit refusals and zero remaining ballots, jobs, freezes,
participants and utterances after owning Round erasure.

`round_judging_jobs` is keyed by `(round_id, judge_participant_id)`, preserving
one independent lease/attempt/result per actual judge seat. Its freeze revision
remains scoped to the Round's one immutable freeze. Enqueuers must insert every
eligible bot judge; selecting only the first judge is invalid for admitted
multi-judge formats. The table module is `schema/round-judging-jobs.ts`; the
freeze module has no ballot import, avoiding a schema import cycle.

A judging job's nullable `command_id` (category identifier) is allocated once
with an actual cuid2 at first claim. Queued intent creation may omit it. A unique
index prevents sharing it with another intent; the UPDATE trigger refuses later
replacement or clearing, and refuses changing the Round/judge/freeze identity.
Retries and takeovers preserve that identifier and reuse the shared global
command receipt. It is an identifier, never a bearer token. Provider uncertainty
belongs in the actual AgentRun configuration snapshot before dispatch, separately
from job scheduling status; no provider result is inferred from a lease timeout.

### Bot publication claim

`round_bot_publications` stores one current claim per `(round_id,
round_participant_id)`, independent of utterance rows. `round_id`,
`round_participant_id`, `segment_id`, `agent_run_id` and `service_id` have category
identifier; `publication_epoch` and `lease_expires_at` have category none;
`lease_token_digest` has category secret. The digest stores SHA3-256 of an OS
CSPRNG bearer, never a cuid2 or raw token, and must never enter logs. Canonical
service identity is exactly `agent-run:<agent_run_id>`. Scoped segment/seat/run
references prevent cross-Round or cross-seat claims and have leading indexes.
Claim records remain through revocation to preserve epochs, then erase with the
owning Round. They contain no PCM, generated phrase or transcript text.

The schema refuses seat identity mutation, epoch decrease or skipped epochs,
and identity replacement at the same epoch. A takeover advances exactly once
with a new AgentRun and token digest. Same-epoch renewal cannot resurrect an
expired or revoked lease; revocation shortens the expiry and preserves the row.
CAP-E.1's actual bounded adapter still owns bot-seat admission, active-run and
fresh historical floor verification, ending the previous run, secret comparison,
usage recording and output cancellation. Schema integrity alone authorizes no
provider call, source frame or transcript credit.

### Authoritative AI allowance periods

DEC-183 uses `ai_allowance_grants` as durable READ authority, with no participant,
admin, billing or public grant setter. `id` and `actor_id` are category identifier;
`period_start`, `period_end` and `revoked_at` are category none. Actor deletion is
restricted while grants reference it. A positive exact period and a partial GiST
exclusion prevent overlapping nonrevoked periods for one actor. The admission
adapter still selects current authority using fresh PostgreSQL time under its
actor lock; premium allowance is the fixed ten from DEC-183, never inferred from
a username or role. Revoked or absent authority cannot grant premium capacity.

`usage_reservations.reserved_at` and `refunded_at` are category none.
`reserved_at` is NOT NULL with a PostgreSQL `clock_timestamp()` default; no
admission time is ever invented, and Round creation time is not one. A refund
requires a recorded first vendor call and cannot predate it; the reservation
time cannot follow its first call. Actor/kind/reservation-time indexing
supports serialized actor/period accounting. These records add no generated text or PCM. Production
identity, entitlement provisioning and legal activation remain human gates.

### Bounded capture producer

`mediaCaptureOperations` in `packages/db/src/media-capture.ts` accepts the actual
same-pool bounded transaction, injected IDs and the shared runtime tick projection
builder. Its lease, append, observation and seal methods take validated server
capture inputs. The signed ingress/worker edge must authenticate the worker;
opaque identifiers are not credentials. No HTTP ingress authentication is
established by the persistence factory alone.

Every mutation locks the Round and runs the actual shared locked tick, then
locks the current session lease and stable segment/seat stream. It samples fresh
PostgreSQL time after evidence reads before mutation, checking lease expiry,
immutable freeze and actual final-end cutoff. Null cutoff on a terminal Round
fails closed. The same bounded transaction owns all transcript writes; no
provider call or additional pool is opened inside it.

Clip identity is SHA3-256 over Round, segment, seat, track and start offset. The
body digest binds duration, text and the entire uncertainty window. Exact retries
add no utterance or revision; conflicting bodies fail. Full closed uncertainty
windows must fit actual historical grants and actual segment bounds. Coverage
observations are trusted server evidence, not text presence or lease possession.
A complete seal requires a closed timeline, matching committed chunk count and
continuous observation coverage of the required time. Otherwise closure is
partial. A human's required time is each nonempty grant, from its first
observed frame when that arrives within the join tolerance of the grant's
opening (a microphone cannot publish before its grant), else from the opening.
A bot's required time is its credited publication windows (DEC-212), from its
first observed frame within relay tolerance; silence outside them is not
speech (DEC-218). Each required interval ends at its last observed frame when
that ends within relay tolerance of its close, since speech stops before a
yield reaches the server (DEC-220), else at the close. Gaps inside the required
time stay partial. Both tolerances are injected policy
(`coverageTolerance`, which web composition sets to
`CAPTURE_COVERAGE_TOLERANCE`, 4 s to join and 1 s for relay, from
`@daisy/protocol` `capture-timing`). Missing expected streams are still discovered from historical grants by
the finalizer, never inferred absent from the seal table.

Real bounded PostgreSQL component proof covers duplicate/conflicting clips,
coverage gaps and count mismatch, epoch expiry/takeover, cutoff/freeze refusal
and unchanged state after rejected writes. Native worker observation production,
signed ingress, paused-scheduler engine composition and append/finalizer races
remain separate required integration evidence.

### Round maintenance

The web startup composes `createRoundMaintenanceOperations` with the existing
availability instance ID and the database's bound maintenance methods. A 500ms
injected timer discovers all active Rounds using stable keyset pages, including
human-only Rounds and Rounds without media sessions. Each Round runs the shared
engine tick, attendance evaluation and transcript finalization in order. Work
for one Round cannot block discovery or committed attendance-rating recovery.
An ordered, deduplicated queue admits at most two Rounds concurrently, leaving
capacity in the default pool for public receipts, media and availability work.
Discovery removes obsolete queued candidates and preserves waiting candidates'
order. Shutdown drops queued work and drains admitted work before the application
closes the existing pool.

Maintenance mutations require a current durable web lease, canonical Round
locking, and a fresh lease check after lock waits and before commit. Finalization
also rechecks after stream waits. No second clock model, SQL pool or media lease
is introduced. Attendance terminal races stop that Round's maintenance cycle;
unexpected failures remain observable. Completed ranked attendance forfeits have
a separate durable unrated scan using the existing idempotent rating operation.

Casual Rounds without a full set of ballots finish through the same maintenance
path after immutable transcript freeze and settled attendance: zero-judge Rounds
at once, judged Rounds once their ballot deadline passes. The freeze persists
that deadline (`rounds.ballot_deadline_at`, default 30 minutes after the freeze,
DEC-201 and DEC-207); it is immutable, the ballot path refuses a ballot at or
after it, and the deferred `rounds_unjudged_participants_check` triggers refuse
a null-outcome completion of a judged Round before it. `completeUnjudgedRound` holds the global command fence,
canonical account and Round fences, reads the stored ballots and freeze time, and
consumes the shared engine's `completeUnjudged` projection, whose
`decideUnjudgedCompletion` decides eligibility and outcome. It refuses
incomplete play, pending check-in attempts, inconsistent cast facts, ranked or
practice inputs, existing ratings and judged Rounds inside their deadline. The
existing command ledger stores one internal service receipt bound to the exact
frozen revision, with its ruling (`unjudged`, `judges-did-not-rule`,
`transcript-incomplete` or `partial`) and the judge seats that gave no ruling;
concurrent attempts and a new service instance replay that original receipt. Open judging jobs become
`failed`. Submitted ballots decide a winner; with none or a tie the outcome is
NULL; no ballot, draw or rating is fabricated.
Existing forfeit and abandonment decisions remain terminal. This operation has
no public completion-mode envelope and performs no model work.

An `incomplete` freeze queues no AI judging job (DEC-208, the engine's
`freezeJudgingPlan`). When the Round has no human judge, the freeze persists
the deadline at `frozen_at`, and the same finalizer completes the Round with a
null outcome and the `transcript-incomplete` ruling. Human judges keep the
ordinary deadline; once every human judge has ruled decisively, the finalizer
completes without waiting for the AI seats, which record no ruling.

Attendance evaluation enforces the same current web service authority inside its
own transaction. It checks after the Round fence and control waits, before
competitive writes, and again before commit. An expired lease rolls back the
projection, speaking history, outbox, receipt and adjudication together; a prior
successful maintenance tick cannot authorize a later evaluator transaction.

The database root exposes transcript readers and bound authenticated capture
operations. Per-seat model and voice usage is recorded by scoped generation
executions; Round admission owns reservations and initial-call accounting.
Application code receives no general transcript-edit, speech-claim, execution
recording or voice-budget writer. Root-surface tests enforce that boundary while
ordered transcript reader tests and actual capture/private-read integrations
retain their behavioral assertions.

Transcript rows store captured content, ordering and scoped clip provenance;
execution bearer credentials do not belong in transcript storage. Scoped bot
publication/generation authority lives in its dedicated lease and execution
producers. This separation adds no personal-data field, retention extension or
production/legal activation. Captured text and retry digests retain the declared
private transcript purpose, human basis gate and owning-Round erasure contract.

## Live transcript reads

`GET /api/rounds/:id/transcript` is the single round-wide live text read. It
samples the current account and Round under the shared read fences and applies
`round.transcript.read`, the same audience policy used for completed result
transcripts. Current policy admits the Round's debaters and judges; public
visibility and a seatless host confer no transcript right. Persistence and the
viewer consume the authorization decision without another seat requirement,
so a future approved audience producer can extend that policy alone.

The read reuses ordered `utterances`, explicit `transcript_segments` states and
the immutable freeze marker. Its revision follows capture independently of
competitive Round version, with one additional revision at freeze. Text append,
stream seal and freeze transactionally append a `debate.transcript-changed`
doorbell to the existing Round topic. It contains only the Round id and the
transcript revision. The viewer refetches the protected read on that doorbell
and reconnect/visibility recovery; clients without a connected socket use a
30-second fallback. Refused reads remove the displayed text. Native page reloads
use the identical read and the shared transcript disclosure works without
JavaScript. Capturing requires an explicit open, unfrozen stream; partial
closure and incomplete freeze never wait for a client deadline to show Partial.
