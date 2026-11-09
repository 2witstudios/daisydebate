# Durable Round judging workers

PostgreSQL queues one job per assigned bot judge against the immutable frozen
transcript revision. Human-only and zero-judge casts create no artificial bot
job. Outbox delivery may wake a worker; startup discovery also scans durable
jobs at the explicitly configured interval, at most 500 ms.

Each worker has its own optional validated JSON policy (ISSUE-749):
`ROUND_JUDGING_POLICY` for AI judging (scan/lease/renewal/call bounds and its
model) and `ROUND_BOT_WORKER_POLICY` for bot debaters (controllers, bounds and
speech, cross-ex and TTS models). AI judging and live bot speech share one
competitive provider budget, `COMPETITIVE_PROVIDER_CONCURRENCY`. Without a
worker's policy and that budget, its discovery stays inert. The AI judge is
not a bot debater: it has its own `ai_judge_profiles` row and may hold only
the judge seat, while a `bot_profiles` debater may hold only a side
(ISSUE-750). Round analysis is a separate product with its own policy and
budget ([round analysis](round-analysis.md)). Configured application composition requires an
injected OS-CSPRNG token producer. Only the process edge supplies that producer;
the database uses the existing bounded transaction and connection pool. The
busy cap on live bot-debater Rounds and bot-debate allowance remain separate
economic controls. An AI judge does not use bot-debater capacity or decide its
refund; casual judging has its own entitlement and shared-ledger usage
accounting under [ADR 0117](../decisions/0117-premium-billing.md)
([rooms](../domains/rooms.md#judging)).

A worker claims a scoped job/run/epoch with a memory-only bearer. Stored lease
secrets are SHA3-256 digests. Renewal runs independently of provider calls and
attendance settlement. Provider capacity is an explicit process-local bound
with no waiting queue; cancellation holds its slot until the actual call
settles. Discovery and lease renewal never wait behind the model operation.

The feature maps only the actual frozen coverage and captured utterances into
the canonical rubric prompt. It strips actor identity/kind metadata and keeps
incomplete evidence explicit. Before dispatch it records the existing admitted
reservation and durable request intent atomically. The external call runs
outside transaction locks. A valid response and actual token usage are stored
before shared ballot submission.

Each submission freshly verifies the job and prepares the actual shared ballot
operation. The shared writer reacquires its canonical fences, checks the current
job lease in that same transaction, and gates final completion on actual settled
attendance. Success, result witness, cache clearing and run end commit together.
An attendance refusal retains the cached response across retries and lease
takeover. Unknown external outcomes remain recorded uncertainty; external
exactly-once execution is not promised.

Known response accounting authenticates the original dispatched run and exact
scope with its immutable SHA3-256 execution-token digest. It settles counters
independently of ballot parsing, current job ownership and Round lifecycle.
An ended run or lease takeover cannot discard known vendor usage. Exact repeated
counters are idempotent; altered counters, foreign capabilities and runs without
a dispatch intent are refused. This accounting transaction grants no ballot,
cache, publication or Round mutation authority. Result caching and submission
still require their fresh competitive fences. A provider failure with unknown
usage retains zero known counters rather than fabricating vendor usage.

For judging runs, the execution digest is secret/private, retained and erased
with its AgentRun solely to authenticate usage settlement. Scope fields are
private identifiers and provider outcome/counters are operational metadata.
The bearer stays in memory; neither it nor the digest enters prompts, public
responses, participant exports or telemetry. No new collection authority or
production activation is asserted.

Production startup begins the judging lifecycle only after public ingress is
ready. Shutdown aborts and awaits it before closing owned pools. Availability
keeps its separate lifecycle and existing service identity. Configured media
recovery separately runs every 500 ms and is also stopped before pool closure.
A provider/model/media failure does not itself create competitive absence or
forfeit evidence.

## Competitive provider budget

The competitive budget is a process-local bound (`server/provider-budget.ts`)
with no waiting queue, shared by AI judging and live bot speech. It is not a
fleet-wide quota and guarantees no eventual judging under arbitrary realtime
load.

Judging reserves admission **before** claiming its durable lease. A full budget
therefore leaves the job unclaimed for the next scan, rather than stranding it
until lease expiry. The reservation covers saved-ballot retries and remains
occupied until actual execution settles, even after cancellation. An old lease
renewal can release only its own entry, never a replacement claim.

If shutdown begins while a durable claim is in flight and that claim succeeds,
the service returns its local reservation without starting execution. Another
process recovers the job after normal lease expiry, not immediately. Prompt
durable release would require a separate token-fenced operation; this service
never clears a lease without fencing.

## Local provider recovery proof

With this checkout's isolated test services and an authorized configured
OpenRouter capability, run from the repository root:

```sh
bun --env-file=.env run proof:round-judging anthropic/claude-sonnet-5.5
```

The model argument is explicit. The script creates and drops a migrated per-run
test database, creates a real shared Room and assigned bot judge, and freezes
its silent transcript honestly incomplete. It calls the real provider once,
then proves cached-response takeover and repeated actual attendance refusal
without redispatch. Its output contains model/request/token counts and proof
labels only. This is provider/cache recovery evidence; the script does not
claim full played-Round, browser, media, or final-completion acceptance.

Worker failure events contain only operation and error code (privacy `none`).
No credential, bearer, raw exception, response text, transcript, or PCM is
written to logs or proof artifacts.

## Idle bot control and attendance

The control lifecycle claims each actual non-judge bot seat independently of
model and media work. Its pulse renews the current worker lease, asks the shared
attendance feature for actual unresolved targets, and records shared check-ins
using the exact service/run/seat/epoch principal. Targets may include historical
unresolved speech; the target is not required to equal the control segment or
the bot's speaking window. Receipt authorization remains the canonical same-pool
attendance verifier and first PostgreSQL receipt time.

Control discovery and pulses have separate timers from judging/provider work.
A changed actual segment rotates the owned claim; a media or model failure does
not revoke it. Startup uses the existing availability instance identity rather
than creating another service lease. Shutdown awaits pulses and revokes only
its own current claims before pools close. Worker control is not floor-command,
media-publication or transcript authority and does not consume a model allowance.

## Scoped generation dispatch and settlement

The bot publication factory also owns generation admission. `beginGeneration`
requires the current memory bearer, fresh scoped control claim and current
speaking authority. It counts the existing admitted Round reservation and
creates a separate child AgentRun with one uncertain provider request. It reads
only spoken utterances in actual segment order: captured from a microphone, or
authored by a bot as it played. A generated answer becomes an utterance only
phrase by phrase, as each phrase starts playing
([ADR 0122](../decisions/0122-authored-bot-speech.md)). TTS additionally requires an explicit model and per-seat character
budget. It reserves the input character count before the external call; unknown
provider outcomes retain that reservation.

The returned execution capability settles only usage. Its OS-CSPRNG bearer
stays in memory; `configuration_snapshot.executionTokenDigest` stores SHA3-256
(secret, private) solely to authenticate usage settlement. The scope and parent
run fields are private identifiers; `providerOutcome` and counters are operational
metadata. These inherit AgentRun retention and owning Round erasure, and no new
legal collection authority is asserted. Neither bearer nor digest is exposed in
participant exports, telemetry, prompts or public responses. `finishGeneration`
authenticates the exact execution and scope even after lease rotation or Round
termination. An exact repeated outcome/counter tuple is idempotent; a changed
repeat is refused. Settlement cannot reopen a Round, publish audio, command a
seat or write transcript text. This storage producer alone does not establish
actual provider-to-native publication or full played-Round acceptance.

## Retired AI orchestration replacement obligations

The shared Room/runtime and scoped workers own these requirements. The retired
AI-only operation tree, its whole-answer transcript writer, browser heard
reports, client transcription and its operation-specific tests are removed;
a bot's lines are authored per played phrase under the shared fences instead
(ADR 0122). Historical
criteria remain; storage/component evidence does not satisfy a pending played
journey.

| Retired behavior or criterion                                       | Required shared replacement and proof owner                                                                                                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Started checkpoint and ordered RoundView hydration                  | Actual Room start/runtime tick and fresh contract read; retained `round-view-hydration.integration.ts`, runtime authority owner                                                                                      |
| Stale command versions, delayed yield, failed tick and lock waits   | Shared runtime command authority and locked tick preserve atomic refusal and original segment target; runtime/D2 owners                                                                                              |
| One speech producer, takeover, cancellation and interrupted restart | Exact control/publication run, service, epoch and digest fences; native cancellation stops future frames, no restart credit; E1/media owners                                                                         |
| Per-seat voice spend and foreign/human line refusal                 | Explicit TTS model and per-seat reserved characters before dispatch; generated phrases grant no durable text authority; actual generation PG proof plus E1/native journey                                            |
| Cross-examination latest-line deduplication and turn response       | Every actual debater seat eligible during cross-examination; distinguish per-seat captured history, suppress concurrent/repeated response work, preserve floor command authority; E1 controller proof still required |
| Final buffered capture and late provider response                   | Authenticated capture lease, actual historical grant window, bounded native prefix, append/seal and frozen frontier; media/D2 race proofs, never browser text edits                                                  |
| One judgment, no partial completion after a race                    | Actual frozen revision, scoped durable job, cached response, shared locked ballot and settled-attendance gate; D1/D4 owners                                                                                          |
| Public/human/erased or foreign actor scope                          | Canonical shared account/seat/run authentication and masked public reads; runtime/privacy owners, no AI-only permission bypass                                                                                       |
| Allowance, concurrent reservation and vendor-failure refund         | ADR0117 frozen sponsor/source/period and exact shared-ledger reservation/attempt; terminal quota settlement remains independent; E1 admission owner                                                                  |

## Ephemeral activity routing (DEC192)

Only the existing Redis command connection carries a private scoped activity
batch between web peers. Before any PCM transport activation, the adapter must
verify the actual Redis capability reports `appendonly=no` and empty `save`;
unavailable or unreadable capability refuses transport. TTL does not prevent disk persistence. The local compose configuration supplies both settings;
production identity, data and deployment activation remain human-owned.

Each versioned batch holds at most 20 original 160-sample signed PCM16 frames
and at most 64 KiB. Keys are validated per Round/seat and expire in one second;
controllers poll at 50 ms and reject frames older than 250 ms against fresh
PostgreSQL time before delivery. PCM is sensitive/private; scoped identities
are identifier/private. No bearer, judge identity, transcript, credential or
raw exception enters the batch, logs or exports. Native callback brackets,
calibrated server bounds and the authentic PostgreSQL receipt remain unchanged.
The authenticated media lease and actual non-judge seat binding precede relay
admission; Redis conveys no publication or competitive authority. Missing,
gapped, stale or unavailable activity becomes unknown and cancels only the
active phrase. It cannot stop control receipts or adjudicate absence, floor,
transcript credit or outcomes. Cross-peer Redis and actual cancellation proof
remain required before this transport is accepted.

## Speaking turns

When media is configured, each owned control claim also gets one speaker
(`round-bots/speaking.ts`). The control pulse wakes the speaker but never awaits
it, so receipts continue through model, voice or media failure. One turn runs
at a time per claim. A turn generates text, reads its segment's due time once
(calibrated against the database clock, off the audio path), then voices and
plays its phrases in order. The next two phrases are voiced while the
current one plays, so sentences follow each other with no gap even when a
long phrase follows a short one; each is bought and settled once and kept
across retries, so nothing is bought twice ([ADR 0122](../decisions/0122-authored-bot-speech.md)).

Each phrase's authored utterance is written before any of its audio
(`beginRoundBotPhrase`): for every phrase after the first, while the phrase
before it still plays, dated by when its own audio will start, so no phrase
waits on its start. One transaction checks the claim, its vendor room, the
floor, the segment and the incident state, refuses a phrase that would end
past its segment, and writes the line still arriving. A refusal plays
nothing. A line written ahead is read by no one until its audio starts: live
reads leave out lines dated after now, and the previous line's close at that
instant rings the transcript doorbell. The phrase then streams into a buffered native source in real time,
and its floor is re-read about every 250 ms beside the audio. Its line closes
(`endRoundBotPhrase`) in order beside the next phrase's audio, once its
queued tail has played: complete, or interrupted with only the whole words
that played (samples sent less samples still queued). A line written ahead
for a phrase not then said is withdrawn. The writer stops locally at the
segment's due time, so no audio plays past the cutoff; a phrase that cannot
finish in time is never started, and the speech ends at its last whole
phrase. A seat's takeover, and the freeze, close any line a lost worker left
open to the words that could have played.

Each claim joins one native publication when its seat starts, ahead of
generation and synthesis, and every attempt reuses it (DEC-225). A refused
phrase start or a lost floor (`CONFLICT`) waits for the next wake and consumes
no attempt; a changed vendor room rejoins the session's fresh room. Other
failures (a provider call, a connect or a native handoff) count toward a
bound of two attempts per claim and log `round.speaking.failed`; a phrase cut
by one is said again whole, as a new line. A speech claim delivers its speech
once. Bots issue no floor commands; the runtime clock opens and closes
segments.

In cross-examination the scheduled seat opens the exchange once, and every
other seat stays silent until a question ends. After that each answers once per
ended peer turn, and repeated end-of-turn reports for the same
turn start nothing. It reads its peers' activity from the seat's own hearing
(below), polled every 50 ms in memory; audio older than 250 ms, an unbound
peer, a closed track and a dropped connection read as unknown. A barge-in or
unknown aborts only the active turn. A changed, invalid or shut-down claim
stops its speaker before the lease is revoked or abandoned.

The claim returns its segment type and the other non-judge seats. These are
activity peers only and grant no authority over those seats.

## The bot's own hearing

A cross-examination bot hears its peers itself (ISSUE-764). There is no
capture worker, relay route or Redis key in the path, so neither a capture
refusal nor a full capture fleet deafens a bot Round.

- **Identity.** In a cross-ex claim, the seat's listener
  (`round-bots/listening.ts`) asks the media broker for a listen grant
  (`botListenToken`), under the session's reconcile hold. Every bot media
  request needs its live claim (`verifyBotMediaPrincipal`); publishing also
  needs the speaking window. Who may hear is one projected rule,
  `mediaHearingSeats`: base seat eligibility and a live claim within its
  live segment, read by both the token and room creation. Hearing needs no
  floor, since a bot hears most while its opponent holds it. The grant signs an identity bound to no seat: hidden,
  subscribe-only, with `canPublish` and `canPublishData` false, for that one
  room. Reconciliation never grants it a floor. The identity is derived from
  the seat's own (`round-media/listen-identity.ts`), so a takeover's or a
  rejoin's listener evicts any earlier connection under it, including a
  wedged one.
- **Lifetime.** The listener joins with the seat and ends with it, after the
  publication. A dropped connection (or a failed cleanup) rejoins with a
  fresh grant after a pause that starts at 1 s and doubles to 30 s. A refused
  rejoin backs off the same way, since many refusals (a revocation still
  settling) clear on their own. An unexpected join failure is reported as
  `round.hearing.failed` (`round.hearing.join`); a routine refusal
  (`CONFLICT`, `AUTHORIZATION`) is reported only once it persists, every
  fifth join in a row. A Round end or a revoked seat rotates or deletes the
  vendor room, which drops it, and the admission refuses every rejoin until
  the claim's own end closes the listener.
- **Hearing.** It subscribes only its peers' microphones, from the
  admission's peer list, re-reading the bindings for a peer that binds
  later. A refused or unanswered subscription is asked again after a pause
  doubling to 30 s (`@daisy/media` `createSubscriptionRequests`). Media
  grants decide who may publish, so only a seat holding the floor is heard
  at all. It times each frame with the neutral frame clock
  (`@daisy/media/observation` `createTrackClocks`), calibrated against
  PostgreSQL time once a second. A read whose round trip exceeds 100 ms is
  discarded: retried within 200 ms until a first calibration lands, then
  the next second. It feeds the bot's turn-taking (`round-bots/activity.ts`)
  in memory. Stale, missing or dropped audio is unknown, never silence.
- **No storage.** PCM stays in that process's memory, frame by frame.
