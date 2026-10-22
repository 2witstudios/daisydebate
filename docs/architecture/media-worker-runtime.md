# Capture worker runtime

`apps/media-worker` owns the separate hidden capture process described by ADR 0053. `bun run --cwd apps/media-worker start -- ROUND_ID SESSION_ID WORKER_ID`
starts one assigned session. IDs are scope, never credentials. The process edge
requires the existing `PUBLIC_APP_URL`, `MEDIA_WORKER_SECRET` and
`OPENROUTER_API_KEY` capabilities; it creates no credentials and activates no
production service. STT preserves `openai/whisper-large-v3-turbo` explicitly at
that edge. The app calls public media and AI adapters; it opens no database or
Redis connection. Discovery/supervision across sessions remains a separate
incomplete implementation obligation, not an implied deployed scheduler.

The launcher isolates native SDK stdout/stderr and passes only those three
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
The observed run committed fifteen captured chunks and froze incomplete at
frontier seventeen. Empty/missing required streams close partial from committed
nonempty speaking history; no nominal/possible window becomes coverage. This
scoped result does not claim human browser recording, bot generation admission,
judging, discovery, soak or all race acceptance. The publishing peer stays
connected until the actual Round end so normal empty-room departure does not
prematurely end the fixture's capture process.
