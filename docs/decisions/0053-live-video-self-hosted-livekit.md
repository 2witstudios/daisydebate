# 0053: Live video on self-hosted LiveKit

Status: proposed. Owner-confirmed media policy (2026-10-05); architecture
reconciliation authorized 2026-10-07, VIDEO-0.18. Acceptance remains VIDEO-0.2.
Fulfils the media seam in [ADR 0031](0031-realtime-service.md), adopts the
Round model in [ADR 0058](0058-one-round-model.md) and the target competitive
API in [ADR 0059](0059-one-competitive-api.md). Adds the proposed
`apps/media-worker` deployment through [ADR 0003](0003-modular-monolith.md).

## Context

The unified round model and AI practice voice/transcript/ballot flow exist.
AI practice has a bot portrait and a placeholder human tile; no camera is
captured. The human round presentation still uses sample state. LiveKit,
media sessions, the media adapter, capture worker and stream seals are not
implemented. ADR 0059's shared HTTP surface is a target, not a shipped API
on the reconciliation baseline `6acf9733` (PR #211).

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
writes; `apps/media-worker` owns long-lived human audio capture.

AI-practice camera support displays the human's local camera beside the
existing animated bot portrait. Its working browser transcription and bot
voice playback remain in place. This does not claim the bot publishes a
camera or that browser-submitted audio is server-authoritative capture.
Synthetic video avatars and publishing AI voice through LiveKit are not
requirements of this reconciliation.

### 2. Round-bound media sessions and identities

A Room is the durable pre-competition aggregate. `startRound()` freezes its participants and rules into a Round. All human and bot competitive occurrences use the same Round model. Participants, roles and slots come from `round_participants`; segment timing comes from `round_segments`; prep and accepted interruption floor come from the checkpoint and hydrated runtime. Media is an adapter around that authority.

A `mediaSession` is a LiveKit room for one Round, never a Daisy Room. Proposed `media_sessions` stores a unique `round_id` and a separate opaque cuid2 room name. Proposed `media_participants` maps each `round_participant_id` to one stable opaque cuid2 identity per session. Scoped foreign keys prove both belong to the same Round. Do not duplicate actor/role/slot as competing authority. Tokens have empty participant names and no metadata; display labels come from Daisy. Bots and humans use the same participant identity model when they actually join media; the capture worker is a dependent agent participant outside the competition seats.

### 3. Grants and reconciliation

A pure policy in `@daisy/debate-engine` receives authoritative participant seats, frozen `RoundRules`, hydrated runtime position, an injected instant and the judging-window end. It does not reconstruct the round from `started_at` plus a fixed schedule.

- Human live-media debaters may publish camera throughout a non-terminal session, with microphone only when eligible under the current segment and interaction rules. Prep closes microphones.
- Interaction segments follow `RoundRules.interaction` and the accepted floor; do not universally assume both debaters may speak in every cross-examination.
- Before the first segment and while awaiting a ballot inside the judging window, debaters may publish camera and microphone, preserving the confirmed policy.
- Judge seats subscribe hidden and publish nothing. Data, own metadata updates, screen sharing and room administration are never granted.
- Completed or abandoned rounds, and sessions beyond the judging window, grant nothing.

VIDEO-2.2 hydrates and ticks at injected `now` before diffing grants. Segment opening/closure and runtime effects exist durably; clients receive projections, never authority to grant themselves a microphone. Reconcile is triggered by connect, another participant connecting, accepted commands (including yield and interruption), segment/prep/floor changes, projected clock expiry and judging-window expiry. A projected expiry triggers a server reread/tick; it is not a precomputed timetable for the whole Round. Client calls remain needed for token refresh/reconnect races. Do not claim that a human judge browser is present in AI practice.

Reconcile is single-flight per media session, with a minimum interval (planned default 500 ms), serving seated callers the next run rather than spending per-caller budgets. It closes microphones before opening them. Each API call has a deadline (planned default 2 s). After two failed mic closes it attempts removal; failed removal retries and reports through ErrorReporter. The 6.5 s interval-plus-three-deadlines bound assumes removal answers within its deadline; total API outage cannot promise successful removal. Missing media infrastructure must fail closed rather than fabricate successful grants.

Join tokens last 60 s for initial admission, carry only current grants, and never grant room create/admin/list/record. Refreshed credentials may outlive that TTL. Daisy creates a missing LiveKit room before minting; `room.auto_create` is false. Completion or abandonment deletes the LiveKit room after the competitive transaction commits and marks the session ended. Reconcile also tears down terminal/expired sessions. Failure reports are scrubbed and cannot change a committed result.

The judging window is a planned bounded wait, default 30 minutes from the actual final segment close or scheduled end, whichever is earlier. It cannot be computed from a fixed total added to the initial start when prep, yields and interruption affect execution. Persist or derive an immutable final-end anchor in the owning media implementation; do not invent a second round lifecycle.

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
do not need human device checks. The check sends no media and stops its
tracks. JavaScript-off Ready is disabled with an explanation, the recorded
exception in [UI conventions](../development/ui-conventions.md). The server
cannot attest that devices work.

### 6. Browser permissions and planned dependencies

Live round presentation routes, including AI practice, gain camera and
microphone permission. The Ready-check Room route also gains both. Other
routes stay restricted. CSP gains the LiveKit origin only where the browser
connects, tested against local ws and production wss in a production build.
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

### 8. Server capture for human live-media rounds

`apps/media-worker` is a proposed third Bun deployment, outside Next request lifetime and outside `apps/realtime`. Its role has SELECT on `rounds`, `round_participants`, `round_segments`, `media_sessions`, `media_participants`; only `media_worker_leases` is writable. The worker reads frozen rules and checkpoint from rounds. Every utterance and seal write goes through the signed internal `apps/web` route.

The worker leases a session, joins hidden/subscribe-only with dependent agent kind, receives 16 kHz mono PCM from human debater microphone tracks, and cuts against actual persisted segment intervals and speaking eligibility. Poll/refetch authoritative state as needed; do not assume a timetable or an unbuilt realtime event. Boundaries include actual early closure and scheduled expiry. Audio outside a permitted interval is dropped. Clips are around 60 s, preferring silence, held only in bounded memory and never on disk.

Transcription uses `@daisy/ai-voice` with zero data retention. Handoff signs method, path, timestamp and body with HMAC-SHA256 and `MEDIA_WORKER_SECRET`, validates clock skew and compares in constant time. The web boundary validates epoch, session/round/segment/participant consistency and capture-time speaking eligibility. It deduplicates retries and accepts only before sealing and within the bounded non-terminal capture window. This trusted retry path is distinct from AI-practice browser upload's existing thirty-second admission grace.

At actual segment close or expiry, seal each required human capture stream only after its counted chunks are stored. Silence seals with zero chunks only when coverage was continuous for the interval. Crash, mid-segment takeover, dropped clips and missed seals leave capture partial. The ruling waits only until the planned seal deadline (default two minutes from the same final-end anchor), then uses stored text and notes gaps; missing audio never voids or unrates ranked play. AI-generated utterances retain their existing completion/playback semantics, without a fictitious microphone seal from a bot that never published audio.

### 9. Recording is later work

REC-1 owns Egress, object storage, recording and rewatch. Confirmed policy:
ranked rounds record full video; Plus can opt in for other rounds; otherwise
keep transcript only. This is policy, not a shipped recording capability.
Spectators, HD and verified/deduplicated Egress webhooks remain later work.

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
- Browser E2E proves human camera in AI practice plus preserved voice/final
  flush, and the two-human/hidden-judge call with server capture. Service
  integration tests prove grants, dedupe, seals, leases and scoped FKs.
- Capture outage or partial text never voids or unrates a ranked round;
  permission removal cannot be promised within a fixed bound during total
  LiveKit API outage. Retry and report the outage.

## Owner-confirmed policies (2026-10-05)

DEC-97: server-enforced microphone grants and reconcile. DEC-98: hidden judge,
opaque media identities. DEC-99: shared self-hosted LiveKit and media adapter.
DEC-100: standard definition. DEC-101: private text transcripts, 180 days.
DEC-109: human Ready device check needs JavaScript. DEC-113: explicit room
create/delete, auto-create off. DEC-114 overruled: server capture for human
live-media rounds. DEC-117: hidden dependent capture subscriber and signed
internal handoff. DEC-118: missing audio never voids or unrates ranked play.

These policy confirmations do not accept the ADR, sign off the media design,
complete any implementation leaf, or provision production.
