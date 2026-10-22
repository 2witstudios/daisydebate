# Capture worker runtime

`apps/media-worker` owns the separate hidden capture deployment described by
ADR 0053. `bun run --cwd apps/media-worker start` is the supervisor. It reads
`readMediaWorkerConfig` (`MEDIA_WORKER_DATABASE_URL`, `PUBLIC_APP_URL`,
`MEDIA_WORKER_SECRET`, `OPENROUTER_API_KEY`, optional
`MEDIA_WORKER_MAX_SESSIONS` 1..64, default 8) and refuses to start when any is
missing. It then refuses a database login broader than `daisy_media_worker`
(a superuser; a login with CREATEROLE, CREATEDB, BYPASSRLS or REPLICATION; a
non-member; a member of any other role such as `pg_read_all_data`; or one
holding INSERT, UPDATE, DELETE or TRUNCATE on any table or SELECT outside the
six tables below).

That role (VIDEO-3.13) has SELECT on `rounds`, `round_participants`,
`round_segments`, `media_sessions`, `media_participants` and
`media_worker_leases`, and no write privilege. Leases, utterances,
observations and seals move only through the signed web path, under the
Round -> lease -> stream lock order. Locally `bun slot:up` provisions the
`daisy_media_worker_local` loopback login and writes the slot's
`MEDIA_WORKER_DATABASE_URL`; production provisions its own credential
(VIDEO-4.2). `bun doctor` reports `media-worker`: a warning naming the missing
fields when unconfigured, a pass for a role-scoped login, and a failure for a
broader login or an unreachable database. The worker creates no credentials and activates no production
service. STT preserves `openai/whisper-large-v3-turbo` explicitly at the
capture edge.

Every second the supervisor discovers sessions needing capture: not ended,
not unsafe, no deletion requested, Round scheduled or active, and no live
lease. Discovery is advisory; the per-session process claims the lease
through the signed path, which rechecks everything under locks. Each session
gets one capture process with a fresh worker id, so a relaunch after a crash
or exit takes the expired lease over at a new epoch instead of reusing stale
authority. A session that was just launched is never launched twice while its
lease is still pending. A failing session backs off exponentially from 1 s to
30 s without blocking other sessions. SIGTERM stops discovery, sends SIGTERM
to every capture process, kills any that are still running after 20 s, and
exits once all have exited. The supervisor logs only `server.ready`,
`server.shutdown`, `media.discovery.failed` (`errorCode`) and
`media.capture.failed` (`status`).

The supervisor isolates each capture process's native SDK stdout/stderr and passes only those three
configuration fields to its child. It returns a process exit status, never raw
vendor diagnostics, audio or text. A stop sends SIGTERM and awaits exit; a
20-second deadline kills an unresponsive child. Competitive status and bot
attendance never depend on this worker's success. Room cleanup and leave timing
still require actual service proof.

The assigned-session application claims a real lease, reads scoped history,
calibrates using the actual signed web path and joins with the actual hidden
subscribe-only broker credential. The same process monotonic clock brackets the
HTTP calibration and pre-SDK-queue native frame copies. It renews its lease at
five seconds, refreshes history/calibration at 250 ms and cancels on lost authority
or transport failure. No network/acoustic origin bound is claimed.

There are two different memory boundaries. Private ingress-validation staging
requires a known actual Round, segment, mapped seat and full calibrated bracket
inside cached historical authority before retaining any copied frame. Known
conversation, unknown identity and outside-window frames drop immediately.
Staging preserves original brackets and segment identity, caps all tracks at
4096 frames (1.25 MiB PCM), and expires frames after 500 ms. Fresh signed history
and a post-lock PG horizon must validate each remaining frame before WAV, STT or
competitive clip queue. A segment change reads that exact historical segment;
no PCM waits for a new grant or receives a different segment label. The history
reader has a 500 ms deadline and a 16,384-interval resource ceiling; exhaustion
refuses rather than truncating authority.

The competitive FIFO is capped at ten clips, 20 MiB and 120,000 ms, dropping
oldest on overflow. Clips use the shared sixty-second/silence-bound WAV encoder.
Before provider dispatch, the worker rereads the full historical bracket and PG
horizon; the actual AI adapter receives a cancellation signal. A returned result
is appended through signed same-pool ingress. A retry retains the exact result
and clip identity; no generated phrase or estimated text is an utterance.
Cancellation cannot append a later queued provider response. The stream tracker
stores bounded counts, not unbounded text/clip-key histories; its ceiling is
16,384 actual segment/seat streams. A common ten-second cleanup budget attempts
seals. Open grants, cutoff/freeze and lost leases remain honestly unsealed.

The worker emits no guaranteed coverage observations from possible clock windows.
Missing observations and dropped frames therefore preserve the genuine partial
classification under the unchanged seal predicate; the worker does not set a
fake completeness flag. Genuine complete storage proof remains separate under
DEC190. Current source/unit/transport/native foundations do not establish real
STT, full signed worker pipeline, browser, finalization/judging, soak or cleanup
acceptance until their actual composed service proofs run.

Privacy: native PCM, WAV, transcribed text and bearer credentials remain memory
only. Transcribed text persists solely through the declared private utterance
storage purpose, existing human PRIV-H basis gate and 180-day/owning-Round erasure
policy. Scope identifiers do not leave this process through diagnostics. Queue,
cadence and test proof counts have category `none`; no personal content is logged.

The explicit `bun --env-file=.env run proof:media-worker` CLI creates and drops an
isolated, fully migrated run database and fails when the configured provider
capability is absent. It uses a real custom Room with two legal forty-second
speeches, the shared engine's actual clock, a connected publishing peer, actual
Aura PCM, hidden native capture, Whisper transcription and signed durable ingress.
The worker runs as the supervisor under the worker login and discovers the
session itself. It passes only when the supervisor drains cleanly (exit 0,
logging exactly `server.ready` then `server.shutdown`) and the finalized
transcript is frozen, `incomplete`, has at least one captured utterance and no
`open` coverage stream. Chunk counts vary per run and are not part of the
predicate. Expected streams come from `createStreamTracker` (unit-tested in
`capture-streams.test.ts`): every committed nonempty in-segment speaking
interval is expected, so a silent seat seals partial instead of staying open,
and no nominal/possible window becomes coverage. A seal below the stored chunk
count is refused, so a takeover worker that knows only its own epoch's chunks
leaves that stream open for finalization rather than under-reporting it. This
scoped result does not claim human browser recording, bot generation admission,
judging, soak or all race acceptance. The publishing peer stays
connected until the actual Round end so normal empty-room departure does not
prematurely end the fixture's capture process.
