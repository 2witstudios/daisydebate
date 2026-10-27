# 0053: Live video on self-hosted LiveKit

Status: accepted architecture under delegated owner authority, 2026-10-22
([ADR 0067](0067-playable-round-policy-and-acceptance.md)). Architecture
reconciliation: VIDEO-0.18; shared human/bot reconciliation: VIDEO-0.19.
VIDEO-0.2 default-branch delivery and independent review remain outstanding;
no runtime, media design implementation or production acceptance is implied.
Fulfils the media seam in [ADR 0031](0031-realtime-service.md), adopts the
Round model in [ADR 0058](0058-one-round-model.md) and the target competitive
API in [ADR 0059](0059-one-competitive-api.md). Adds the proposed
`apps/media-worker` deployment through [ADR 0003](0003-modular-monolith.md).

## Context

At the delivery baseline `93500b020f220beabeaef69786c309a36b37f0a2`, the
shared Round runtime, Room launch/read projections, media adapter and local
device checks exist. Shared competitive command/ballot/media registration,
integrated browser media, capture worker, durable session/capture/freeze jobs
and complete live journeys remain outstanding. The policy below describes
the selected target, not proof that these producers are implemented.

The live call must use the same competitive authority for humans and bots:
frozen RoundRules, authoritative round participants, durable segment
intervals, and the hydrated runtime's prep and interaction floor. A
start-time-only timetable cannot describe early yield, prep consumption or
accepted interruption. Media stays outside the realtime WebSocket.

## Decision

### 1. Self-hosted LiveKit and scope

LiveKit is self-hosted from day one, locally, in CI and in production;
LiveKit Cloud is not an interim path. The confirmed reason is the planned
self-hosted recording economics; historical estimates are not current
measured costs. `@daisy/media` is the proposed adapter for token minting,
room management, permission updates and hidden PCM subscription.
`apps/web` owns authorization, competitive transitions and transcript
writes; `apps/media-worker` owns long-lived human audio capture and bot PCM
publication under the bot's Round participant identity.

Human camera/microphone and AI generated voice use one LiveKit session per
Round, under the same seat identity and runtime grants. The bot portrait is
its visual; a synthetic camera stream is not required. The common browser
controller receives the bot's microphone track through LiveKit. Human audio
is captured by a separate hidden worker participant; bot text is finalized
from the eligible published prefix, not merely from generated text.

CAP owns the existing AI prompts, generation, admission/usage, bot principal,
commands and ballots. VIDEO consumes those operations and owns media. The
selected replacement deletes browser AI playback, recorder/upload/heard
report paths with the old API at the coordinated cutover. It introduces no
second public API, fallback transport or duplicate Room/start logic.

### 2. Round-bound media sessions and identities

A Room is the durable pre-competition aggregate. `startRound()` freezes its participants and rules into a Round. All human and bot competitive occurrences use the same Round model. Participants, roles and slots come from `round_participants`; segment timing comes from `round_segments`; prep and accepted interruption floor come from the checkpoint and hydrated runtime. Media is an adapter around that authority.

A `mediaSession` is a LiveKit room for one Round, never a Daisy Room. Proposed `media_sessions` stores a unique `round_id` and a separate opaque cuid2 room name. Proposed `media_participants` maps each `round_participant_id` to one stable opaque cuid2 identity per session. Scoped foreign keys prove both belong to the same Round. Do not duplicate actor/role/slot as competing authority. Tokens have empty participant names and no metadata; display labels come from Daisy. Bots and humans use the same participant identity model when they actually join media; the capture worker is a dependent agent participant outside the competition seats.

### 3. Grants and reconciliation

A pure policy in `@daisy/debate-engine` receives authoritative participant seats, frozen `RoundRules`, hydrated runtime position, an injected instant and the judging-window end. It does not reconstruct the round from `started_at` plus a fixed schedule.

- Human debaters may publish camera throughout a non-terminal session. Human and bot microphones publish only when eligible under the current segment and interaction rules. Prep closes microphones.
- Interaction segments follow `RoundRules.interaction` and the accepted floor; do not universally assume both debaters may speak in every cross-examination.
- Before the first segment and while awaiting a ballot inside the judging window, debaters may publish camera and microphone, preserving the confirmed policy. These grants permit conversation, not competitive transcript capture; no durable segment means no capture eligibility.
- Judge seats subscribe hidden and publish nothing. Data, own metadata updates, screen sharing and room administration are never granted.
- Completed or abandoned rounds, and sessions beyond the judging window, grant nothing.

The live Round route admits human judges through the fresh protected own-seat read, including before transcript freeze. Its judge view follows canonical Round revisions and the same media session factory, with debater tiles only, no competitive command or attendance controls, and a native ballot link. The media admission service independently derives subscribe-only grants from the current assigned seat; a client view never chooses judge authority.

VIDEO-2.2 hydrates and ticks at injected `now` before diffing grants. Segment opening/closure and runtime effects exist durably; clients receive projections, never authority to grant themselves a microphone. Reconcile is triggered by connect, another participant connecting, accepted commands (including yield and interruption), segment/prep/floor changes, projected clock expiry and judging-window expiry. A projected expiry triggers a server reread/tick; it is not a precomputed timetable for the whole Round. Client calls remain needed for token refresh/reconnect races. Do not claim that a human judge browser is present in AI practice.

Reconcile serializes across web instances using a session-scoped PostgreSQL
advisory lock on an explicit adapter connection. The worker requests a run
at least every 500 ms and each known runtime expiry; accepted commands also
trigger it. Client inactivity cannot preserve stale rights. Close all
required microphones before opening any.

Commit a durable pending mutation record before each vendor dispatch. A
response resolves it; timeout or process death before outcome recording
leaves it outstanding. Each call has a 2 s deadline, but cancellation does
not prove the vendor stopped. While any outcome is unresolved, refuse
admission and opening mutations, cancel bot output, attempt removal/deletion
and retry cleanup. Restart never clears uncertainty. Resolve the outstanding
operation and verify cleanup before reopening.

The ordinary closure bound includes polling, actual lock-queue delay and
each closure call. A universal 6.5 s bound is not established under
contention or vendor outage. Fail closed and report scrubbed recovery state
rather than claiming successful permissions or removal.

Join tokens last 60 s for initial admission, carry only current grants, and never grant room create/admin/list/record. Refreshed credentials may outlive that TTL. Daisy creates a missing LiveKit room before minting; `room.auto_create` is false. Terminal commit closes admission and durably schedules deletion; session fencing serializes creation and terminal reconciliation. Persist uncertain vendor outcomes across restart and retry until absence is verified before claiming cleanup. Reconcile also tears down terminal/expired sessions. Failure reports are scrubbed and cannot change a committed result.

The judging window is a bounded wait, default 30 minutes from actual final segment close (ADR 0067 supersedes the earlier scheduled-end alternative). It cannot be computed from a fixed total added to the initial start when prep, yields and interruption affect execution. Persist or derive an immutable final-end anchor in the owning media implementation; do not invent a second round lifecycle.

### 4. Tokens, route ownership and teardown

The target public media boundary is `/api/rounds/:roundId/media/*`, under
ADR 0059. Bind the actor to the authenticated principal and the round
participant, never a body actor claim. Refuse signed-out, unseated,
terminal-round and expired-window admission. Do not add an AI-specific
competitive API or a temporary `/api/debates/*` implementation. Integrated
routes wait for the CAP Room/Round cutover; pure policy and adapters do not
require an endpoint to exist.

Join-token expiry gates connection rather than ending a session. Refreshed
tokens may retain prior grants; reconcile-on-connect corrects those rights.
Room deletion plus `room.auto_create: false` prevents a refreshed token
recreating a terminal session. Teardown happens after the round transaction
commits, including abandonment. A media outage never rewrites the result.

### 5. Standard definition and human Ready checks

Capture/publish is standard definition, with 180p and 360p simulcast layers.
Resolution is a client setting, not a server-enforced cap. Human debaters
need local microphone level and camera frames before Ready; bots and judges
do not need human device checks. Preview is local `getUserMedia` only until
CAP commits a Round: no preview token or LiveKit join. Camera and microphone
independently expose unchecked/checking/passed/denied/unavailable, with
selected device identity kept local and results bound to a check generation.
Passed camera and microphone IDs carry across the Room-to-Round document load
in tab-scoped session storage, keyed by Room ID, and expire when the tab
closes. They never enter server requests, logs, analytics or vendor metadata.
Round capture uses exact device constraints, including the warm microphone;
a disappeared checked input is reported as missing rather than replaced by a
default input (ISSUE-573).
Retain checked preview tracks until departure or deliberate Round transition.
Selection changes, track ending, disappearance or revoked permission
synchronously invalidate the relevant pass. Intentional teardown is not a
failure; floor-muted publication is distinct from capture/device health.

VIDEO supplies the local controller and reasoned events. ROOM renders the
checks, blocks local Ready/Start on invalidation and dispatches latest-version
deduplicated CAP unready intents. Ready remains pending/unconfirmed until
authoritative acknowledgement/reread; disconnect/conflict recovery never
restores stale readiness. CAP owns version-bound server readiness, bot
eligibility and atomic start. Passing local checks never establishes server
Ready. Debater Ready requires JavaScript with an explanation; judge Ready
retains native no-JavaScript support. See
[UI conventions](../development/ui-conventions.md).

### 6. Browser permissions and planned dependencies

Live round presentation routes, including AI practice, gain camera and
microphone permission. The Ready-check Room route also gains both. Other
routes stay restricted. CSP gains the LiveKit origin only where the browser
connects. The HTTPS production-build proof uses a per-run local WSS edge
with real HTTP/WebSocket forwarding and the matching CSP origins, as well
as production WSS. Plain WS under HTTPS, disabled browser security and CSP
stripping do not satisfy this proof.
No-JavaScript states do not imply AI practice's existing voice loop works
without JavaScript.

Existing version candidates are LiveKit server v1.13.7, server SDK 2.19,
browser client 2.22 and rtc-node 1.1. They are planned pins, not installed
dependencies or proven Bun compatibility. Dependency leaves must read
version-matched official docs, prove runtime support, and record actual
adopted versions in [dependencies](../dependencies.md).

### 7. Reuse the transcript model

Reuse `utterances(round_id, segment_id, round_participant_id, sequence, text, complete, ...)` and its scoped foreign keys. The table already exists and serves AI practice; VIDEO-3.1 extends capture metadata and deduplication instead of creating `debate_utterances` or a parallel transcript store. Utterance completeness and AI generation claims are not media stream seals or capture-worker fencing.

Proposed capture metadata identifies a clip by segment, participant, track and offset within the segment. Proposed `transcript_segments` stores seals per durable segment and speaking participant, with counted capture chunks and seal time. Proposed `media_worker_leases` has worker, expiry and a rising epoch. All names here describe unbuilt storage extensions, not existing rows. Forward migrations and exact storage design are owned by their leaves, with scoped consistency constraints, reviewed SQL and privacy classification for every new column. Migration generation remains single-writer.

Read transcripts ordered by durable segment sequence and then utterance sequence. Access stays private to seated debaters and judges. Text is personal/private, retained 180 days (DEC-101; erasure ISSUE-322). IDs are identifiers; counts/timestamps are none; classify every added capture, seal and lease field in the migration PR. Do not claim the retention job or a data-inventory gate exists merely because the retention policy is specified.

### 8. Human capture and bot publication accounting

`apps/media-worker` is a proposed third Bun deployment, outside Next request lifetime and outside `apps/realtime`. Its role has SELECT on `rounds`, `round_participants`, `round_segments`, `media_sessions`, `media_participants`; only `media_worker_leases` is writable. The worker reads frozen rules and checkpoint from rounds. Every utterance and seal write goes through the signed internal `apps/web` route.

The worker leases a session and joins hidden/subscribe-only outside the
competition seats. It receives 16 kHz mono human microphone PCM. Capture is
cut against capture-eligible intervals: the intersection of legal speaking
permission and an actual durable segment open at the frame observation time.
Publication permission alone never authorizes capture. CAP materializes
those intervals
atomically with accepted runtime transitions/ticks and exposes a signed
worker reader; command payload digests cannot reconstruct them. Both worker
and web ingress validate the same interval history. This is a derived read
model, not event sourcing or another lifecycle.

Capture requires a real segment scoped to the same Round and a valid speaking
participant. Its actual opening/closure instants, including early closure,
bound the eligible interval. Before the first segment, between segments and
while awaiting a ballot, a microphone may be publication-enabled but PCM has
no competitive segment. Discard that PCM before clip assembly, transcription,
queueing or handoff; bot consumption in those windows also creates no
competitive utterance or publication-accounting update. Never buffer it for
the next segment, assign it to the last segment, synthesize a segment or
create a segmentless utterance. No competitive capture/seal stream is created
for those conversation windows. Discarding conversation outside competitive
intervals is not itself a gap in required segment coverage or a silence seal;
missing observation inside a required capture interval still makes it partial.

“Open segment” refers to the observation/consumption interval, not whether
the segment is still open when a delayed valid clip reaches ingress. A clip
observed entirely within a historically open durable segment may still be
flushed after closure while its transcript stream remains write-open, before
cutoff/freeze, subject to the existing fencing and identity checks. Ingress
independently verifies both segment membership/timing and historical speaking
permission; a supplied segment ID cannot relabel pre/post-segment PCM.

Map monotonic frame observations to PostgreSQL time using a bracketed
`clock_timestamp()` calibration. The plan requires at most 100 ms round
trips, refresh within 30 s and 100 ppm drift widening. Admit only frames
whose full mapped observation interval including uncertainty lies inside
both the durable segment's actual open interval and its speaking-permission
interval. Boundary uncertainty, reconnect, stale calibration or cadence
stall creates a coverage gap; buffered frames are not retimestamped after
reset. Exact source/acoustic time and network transit are not claimed.

Clips are at most 60,000 ms, preferring silence in the final 5,000 ms.
Queues are bounded by 10 clips, 20 MiB and 120,000 ms; drop oldest on overflow
and mark coverage partial. Audio stays in memory and is never written to
disk. The soak proof bounds post-warmup RSS growth to 64 MiB over 30 minutes
(local; one-minute CI smoke).

Transcription uses `@daisy/ai-voice` with zero data retention. Sign method,
path, timestamp and body with HMAC-SHA256 and `MEDIA_WORKER_SECRET`; validate
clock skew and compare signatures in constant time. In one PostgreSQL
transaction, ingress locks Round, session lease and stream rows in stable
order, checks unexpired worker/job/epoch and scoped identities, validates
durable segment identity/open interval and historical speaking eligibility,
deduplicates and writes only to an open stream before
cutoff and freeze. Takeover locks only the lease and never requests Round
afterward. Expired leases are refused even without takeover.

Complete coverage requires timely discovery/subscription, continuous frames
and no dropped clips or observation gaps. Lease ownership or chunk count
alone proves nothing. Zero chunks may mean complete silence only with that
coverage evidence; crashes, takeover and missing discovery remain partial.
Streams explicitly become open, closed-complete or closed-partial. Both
closed states refuse writes; presentation shows early partial closure
immediately instead of leaving it labelled capturing.

Bot publication uses a separate leased seat identity and current authority.
The existing configured TTS model/voice must provide a validated PCM
sample-rate/channel/layout envelope; the provider probe must establish the
actual format rather than guess it or change voices. A real Bun/LiveKit
proof must establish the native consumption-progress primitive, cumulative
sample counts, monotonic timing brackets and cancellation under queues and
stalls. Subscriber totals or AudioSource drain alone are insufficient. If
that evidence is unavailable, publication accounting has a feasibility
blocker, not an invented implementation.

Count only a phrase's contiguous consumed prefix whose full calibrated
consumption bounds lie in both its actual durable segment open interval and
historical speaking interval. Segmentless publication contributes no judged
text, even if its microphone grant is enabled. At the first
ineligible/uncertain sample, cancel the remainder; reopening the floor
cannot stitch it into the old phrase. Queued audio does not count. Reuse the
pure `heardText` prefix estimate against eligible published duration; it is
neither word alignment nor proof a listener heard it. Generated text alone
never becomes a completed transcript. Ingress applies the same lease,
identity, history, closure, cutoff and freeze checks as human capture.

#### Write closure, transcript freeze and judging recovery

The admission cutoff is actual final-segment end plus 120,000 ms, measured
by PostgreSQL. Check fresh `clock_timestamp()` after acquiring locks and
immediately before mutation. Starting a transaction before cutoff does not
admit a request whose locks are acquired afterward. A pre-cutoff admitted
write may commit within its bounded transaction budget; the finalizer waits
and includes that committed result.

CAP owns idempotent finalization: when all required streams close or cutoff
arrives, lock in the same order, close unresolved streams partial, and
atomically store a unique immutable transcript revision over the existing
utterance frontier and coverage statuses. No raw transcript is duplicated.
Every judged-text write path honors this freeze even while Round remains
non-terminal. The judge reads that revision outside the transaction;
ballot/completion validates the same revision.

All mutating/freeze transactions have a 3,000 ms whole-transaction budget,
with no provider work while holding locks. Cancellation/rollback destroys
the connection; unconfirmed cancellation requires a separate verified
backend termination within another 1,000 ms. Statement, lock and idle
transaction timeouts of at most 2,000 ms are backstops, not a transaction
budget. CAP's allocated adapter writer owns this, without granting VIDEO
additional database privileges.

Under healthy database/control connections, available processes/capacity
and a successful bounded freeze attempt, discovery (500 ms), maximum
remaining writer lock tenure (4,000 ms) and freeze (3,000 ms) bound
cutoff-to-freeze at 7,500 ms. Dispatch discovery adds at most 500 ms to judge
attempt/human availability, not completed model output. Outage or failed
termination leaves finalization visibly pending and retries on recovery;
it never fabricates immutable input or an outage-time guarantee.

The worker requests due finalization at startup/recovery and at most every
500 ms for every cast, independent of an active capture lease or media
session. Missing streams close partial. The freeze transaction creates one
CAP-owned durable bot-judging intent keyed by Round/revision/judge seat;
human judges receive that same frozen projection. CAP's dispatcher recovers
queued or lease-expired jobs, applies existing usage policy and accepts only
the current attempt's result through the common ballot operation. Outbox is
a wakeup, and `agent_runs` bookkeeping is not an existing job queue. A crash
between freeze and invocation cannot strand judging. External model execution
is not promised exactly once; one committed ballot is.

### 9. Recording is later work

REC-1 owns Egress, object storage, recording and rewatch. Confirmed policy:
ranked rounds record full video; Plus can opt in for other rounds; otherwise
keep transcript only. This is policy, not a shipped recording capability.
Spectators, HD and verified/deduplicated Egress webhooks remain later work.
Authoritative delayed-broadcast completion is a separate unbuilt producer
contract. Round completion, transcript freeze and media teardown do not
establish it or authorize messaging to resume Room posting.

### 10. Privacy and secret ownership

Every migration adds a privacy classification for every new column. Proposed
media session and participant IDs, round/segment/participant foreign keys,
opaque identities, clip keys and worker IDs are identifiers; timestamps,
epochs and counts are none. Utterance text is personal/private with 180-day
retention (DEC-101). Seals and capture metadata inherit the text's retention;
leases expire and end with their media session. Transcript reads remain
private to seated debaters and judges. Scoped FK witnesses must be classified
along with their primary references, not omitted from the inventory.

LiveKit keys and secrets and `MEDIA_WORKER_SECRET` are validated composition
secrets owned by web and worker, never logged. Audio and transcript text do
not enter logs. Raw exceptions go only to the scrubbed ErrorReporter. Human
capture audio is processed through OpenRouter and its transcription provider
with zero data retention, held in bounded memory and never stored on disk.
The privacy processor inventory and retention erasure obligations remain
tracked work (ISSUE-333 and ISSUE-322); this ADR does not claim either shipped.

## Native publication adapter

Use the pinned prebuilt `@livekit/rtc-node` 1.2.0 / FFI 0.13.1 zero-buffer
source path for exact 10ms PCM frames. Official version sources and dependency
rationale are recorded in [the dependency registry](../dependencies.md#round-media-vendor-adapter).
Its native acknowledgement follows synchronous source sink handoff. Buffered
queue duration, drain timers and subscriber totals provide no publication
eligibility evidence. No repository Rust implementation is introduced.

The actual Bun consumer paces frames and requires their complete conservative
server-clock uncertainty window to fit committed historical speaking authority.
[Native publication timing](../architecture/native-audio-publication.md) defines
the calibration endpoint extrema, 100ppm drift, refresh bounds, gaps and
cancellation rules. Raw handoff progress never directly creates transcript
credit. Independent clock-delta branch feedback is zero findings at edfc3038;
full capture, provider composition, browser and worker acceptance remain separate.

## Consequences

- Media sessions extend the existing Round model. No second lifecycle,
  participant authority, fixed timetable or transcript store is created.
- Foundation, policy and local camera work can use the merged schema/runtime;
  shared competitive HTTP integration waits for CAP's atomic cutover.
- Local and CI LiveKit, adapter, storage extensions, worker launch/health,
  capture fencing and soak tooling are implementation leaves, not existing
  infrastructure. Migrations are forward and single-writer.
- Production LiveKit needs domain, TLS, TURN and media ports; the worker needs
  its own database role and secrets. VIDEO-4.2 is human-only provisioning.
- Integrated proof uses durable human/bot/judge casts and actual CAP start:
  human camera, bot portrait/LiveKit voice, runtime grants, human capture,
  eligible bot transcript, frozen input and real ballot, then media teardown.
  Under [DEC-190](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/plem8tqexq7oonyq0jnwpfap),
  genuine complete storage/seal proof is separate from native integration proof.
  Native integration must carry real retained eligible audio and honest partial
  coverage through immutable freeze and real shared judging. The exact replacement
  obligations and retained historical clause are in
  [ADR 0067](0067-playable-round-policy-and-acceptance.md#capture-proof-applicability-dec-190).
- Capture-policy proofs distinguish grants from segment membership: pre-first,
  inter-segment and awaiting-ballot microphones may publish but never produce
  clips, STT calls or utterances. Reject forged adjacent segment IDs and
  uncertain boundary frames; accept delayed flushing only for PCM wholly
  inside the actual historical open segment, with all stream/lease guards.
- Real services prove grant crash recovery, stale/expired lease refusal,
  append-versus-takeover/freeze/cutoff races, bounded stalled-writer recovery
  and durable judging recovery. Removing those protections must fail tests.
- Earlier consumers may be prepared unreachable on a feature branch, and
  local proofs may run provisionally. Main acceptance composes actual CAP
  producers and VIDEO consumers in one public cutover that deletes the old
  path. Experiments never satisfy a missing producer or human decision.
- Capture outage or partial text never voids or unrates a ranked round;
  permission removal cannot be promised within a fixed bound during total
  LiveKit API outage. Retry and report the outage.

## Policy provenance

DEC-97: server-enforced microphone grants and reconcile. DEC-98: hidden judge,
opaque media identities. DEC-99: shared self-hosted LiveKit and media adapter.
DEC-100: standard definition. DEC-101: private text transcripts, 180 days.
DEC-109: human Ready device check needs JavaScript. DEC-113 was pending in
PageSpace despite earlier wording here; ADR 0067 now selects explicit room
create/delete and auto-create off under delegated authority. DEC-114 overruled: server capture for human
live-media rounds. DEC-117: hidden dependent capture subscriber and signed
internal handoff. DEC-118: missing audio never voids or unrates ranked play.

The reconciled 52-row VIDEO plan (revision 13) received independent external
APPROVE on 2026-10-09. Its durable review is `wo8twx3qz96ll28yoi9ovuar` in
PageSpace, linked from `d4qxik9my86gwhcymmppmafx` and VIDEO-0.19. The agreed
device seam is `jbwazos3l1kh6w0jmcptwn8u`; room-first prerequisites are
`qkfwh6u8zwvo2ln20a1vf94r`. These artifacts establish design/task direction,
not an implemented contract or shared-resource writer handoff.

VIDEO-3.6's browser-recorder criteria remain historical: server capture and
publication accounting replace that transport, with shared-browser proof
carried by VIDEO-4.1 and ROOM-6.2. No obsolete recorder fallback is retained.
ADR 0067 maps the replacement obligations and honest capture/freeze states.
Architecture and delegated design selection permit building; independent
exact-candidate review and real service/browser/provider evidence still
decide implementation acceptance. Production provisioning remains human-only.
