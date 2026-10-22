# Durable Round judging workers

PostgreSQL queues one job per assigned bot judge against the immutable frozen
transcript revision. Human-only and zero-judge casts create no artificial bot
job. Outbox delivery may wake a worker; startup discovery also scans durable
jobs at the explicitly configured interval, at most 500 ms.

`ROUND_BOT_WORKER_POLICY` is optional validated JSON. It supplies explicit
models, scan/lease/renewal/call bounds and process resource capacities. Without
it, job discovery stays inert. Configured application composition requires an
injected OS-CSPRNG token producer. Only the process edge supplies that producer;
the database uses the existing bounded transaction and connection pool. The
admitted Round busy cap and host allowance remain separate economic controls.

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

Production startup begins the judging lifecycle only after public ingress is
ready. Shutdown aborts and awaits it before closing owned pools. Availability
keeps its separate lifecycle and existing service identity. Configured media
recovery separately runs every 500 ms and is also stopped before pool closure.
A provider/model/media failure does not itself create competitive absence or
forfeit evidence.

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
only captured utterances in actual segment order; generated text never becomes
an utterance. TTS additionally requires an explicit model and per-seat character
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
AI-only operation tree, generated-text transcript writer, browser heard reports,
client transcription and its operation-specific tests are removed. Historical
criteria remain; storage/component evidence does not satisfy a pending played
journey.

| Retired behavior or criterion | Required shared replacement and proof owner |
| --- | --- |
| Started checkpoint and ordered RoundView hydration | Actual Room start/runtime tick and fresh contract read; retained `round-view-hydration.integration.ts`, runtime authority owner |
| Stale command versions, delayed yield, failed tick and lock waits | Shared runtime command authority and locked tick preserve atomic refusal and original segment target; runtime/D2 owners |
| One speech producer, takeover, cancellation and interrupted restart | Exact control/publication run, service, epoch and digest fences; native cancellation stops future frames, no restart credit; E1/media owners |
| Per-seat voice spend and foreign/human line refusal | Explicit TTS model and per-seat reserved characters before dispatch; generated phrases grant no durable text authority; actual generation PG proof plus E1/native journey |
| Cross-examination latest-line deduplication and turn response | Every actual debater seat eligible during free cross-examination; distinguish per-seat captured history, suppress concurrent/repeated response work, preserve floor command authority; E1 controller proof still required |
| Final buffered capture and late provider response | Authenticated capture lease, actual historical grant window, bounded native prefix, append/seal and frozen frontier; media/D2 race proofs, never browser text edits |
| One judgment, no partial completion after a race | Actual frozen revision, scoped durable job, cached response, shared locked ballot and settled-attendance gate; D1/D4 owners |
| Public/human/erased or foreign actor scope | Canonical shared account/seat/run authentication and masked public reads; runtime/privacy owners, no AI-only permission bypass |
| Allowance, concurrent reservation and vendor-failure refund | DEC183/DEC186 canonical host sponsorship and exact reservation/attempt; terminal quota settlement remains independent; E1 admission owner |

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
