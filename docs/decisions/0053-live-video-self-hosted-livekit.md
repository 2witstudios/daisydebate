# 0053: Live video on self-hosted LiveKit

Status: proposed. Fulfils the media decision that
[ADR 0031](0031-realtime-service.md) section 1 defers to "a separate LiveKit
service with its own ADR (VIDEO-1)", and uses the `mediaSession` name that
[ADR 0049](0049-room-debate-turn.md) section 8 reserves. It amends neither,
and adds a third deployment, `apps/media-worker`, under
[ADR 0003](0003-modular-monolith.md)'s extraction seam. The decisions listed
at the end were made on the owner's behalf and confirmed by the owner.

## Context

Debates are spoken, but a human debate has no audio or video. The room epic's
first debate asks the debaters to speak over their own channel (ROOM DEC-C).
The judge can't watch the speeches. The AI judge rules every debate but has no
speech text to read. Video is also the main cost lever in the business model,
so where it runs decides whether free play is affordable.

Three facts about the rest of the system shape this record:

- Turns are computed from the debate's durable start and its rules, and no
  turn boundary is stored or announced (ADR 0049 section 5, RT-4.2). Nothing
  on the server fires when a speech ends.
- The realtime service carries no media (ADR 0031).
- Each checkout shares one local stack on fixed ports (ADR 0034).

## Decision

### 1. LiveKit, self-hosted from day one

Live video uses the LiveKit SFU (`livekit/livekit-server`, Apache-2.0), run by
Daisy in local development, CI and production. LiveKit Cloud is not used, not
even as an interim step. The reason is cost: recording through self-hosted
Egress costs about $0.03–0.06 a debate, against $0.60–0.80 on LiveKit Cloud
(BILL seed). That difference decides whether free play can include video.

The LiveKit server SDKs (`livekit-server-sdk`, and `@livekit/rtc-node` for
transcript capture) are used only inside a new adapter package, `@daisy/media`.
The browser uses `livekit-client`. Media never passes through `apps/realtime`.
Token minting, permission changes, teardown and transcript storage run in
`apps/web`; transcript capture runs in a new deployment, `apps/media-worker`
(section 9).

### 2. Media sessions and identities

- A **media session** (`mediaSession` in code) is the LiveKit room for one
  debate. It is never a Daisy room and never shares an identifier with one. Its
  LiveKit room name is a cuid2.
- Each seat gets one **media identity** per session: an opaque cuid2 stored with
  the seat and reused on every join, so the server can map a LiveKit participant
  back to its seat. A media identity is never a user id, actor id or display
  name.
- Join tokens carry an empty participant name and no metadata. Tile names come
  from Daisy's own data, so LiveKit never learns who the judge is.

### 3. The grant policy

A pure function in `@daisy/debate-engine` decides each seat's rights from the
seat, the debate phase, the current turn's speaking seats (from the timetable at
an injected `now`), and the judging window.

| Seat    | When                                                  | May publish            | Subscribes | Hidden |
| ------- | ----------------------------------------------------- | ---------------------- | ---------- | ------ |
| Debater | before the first turn, or after the last turn         | camera, microphone     | yes        | no     |
| Debater | a turn in which this seat speaks                      | camera, microphone     | yes        | no     |
| Debater | a turn in which this seat does not speak (incl. prep) | camera                 | yes        | no     |
| Judge   | any time                                              | nothing                | yes        | yes    |
| Anyone  | debate completed, or the judging window has passed    | nothing (session over) | —          | —      |

- **Never granted:** data publishing, metadata updates and screen share, each
  a side channel around mic gating or judge anonymity; and the room-level
  grants `roomCreate`, `roomAdmin`, `roomList` and `roomRecord`. A join token
  carries `roomJoin` for its own room and nothing more, so a refreshed token
  can never create, administer or record a room (section 5).
- **Cross-examination:** both debaters speak, so both mics are open.
- **Judging window:** bounds a debate stuck waiting for a ballot (ROOM DEC-K).
  It is configuration, defaulting to 30 minutes after the timetable ends.

### 4. Enforcement is LiveKit's, driven by reconcile

LiveKit enforces publish rights. When the server removes `microphone` from a
participant's `canPublishSources` (`RoomServiceClient.updateParticipant`), the
server unpublishes that track and the client cannot publish it again. A
client-side mute is never the authority.

There is no server scheduler, because no turn boundary is stored. Instead, every
seated client, the judge's included, calls an idempotent reconcile route:

- when it connects;
- when any other participant connects, so a client that rejoins with an
  older token, which a self-hosted server does not invalidate when rights
  change, is corrected within one round trip by whoever is already there;
- at each turn boundary it computes from the timetable;
- after End my turn;
- when the judging window ends.

The server then:

1. recomputes the policy for every seat at `now`;
2. compares the result with each participant's current rights;
3. updates only the participants that differ.

A seated caller is never refused. Instead, reconcile runs as a single flight
per media session: at most one reconcile per minimum interval (configuration,
default 500 ms), and every call that arrives while one is pending or within the
interval receives the result of the next run, which starts at or after the
call. A client that rejoins over and over with a still-valid refreshed token
therefore cannot spend anyone else's allowance or delay a boundary call by
more than the interval, and the load on LiveKit's API is bounded per session,
not per caller. The capture worker's participant is not a seat; reconcile
never touches it.

This bounds a debater who never calls reconcile. The other debater wants their
own mic opened at the boundary, and their call closes this one too. The judge's
client covers prep turns and an absent opponent. When no seated participant is
connected, LiveKit's room `empty_timeout` and `departure_timeout` close the
room: the capture worker joins with the agent participant kind, which LiveKit
does not count when deciding a room is empty (section 9).

### 5. Tokens and teardown

- **Join tokens** last 60 seconds and carry exactly the policy's grants at
  mint time. A token's TTL gates only the initial connection. LiveKit sends
  each connected client a fresh token about every 5 minutes, valid for 10
  minutes and carrying the client's current rights. So the TTL never ends a
  session, and a client that reconnects after its token expires asks Daisy
  for a fresh one.
- **Daisy creates and deletes the LiveKit room.** The server runs with
  `room.auto_create: false`. The token route creates the session's room
  whenever it does not exist (the first join, or after LiveKit closed it
  empty), and teardown deletes it. A client holding a
  still-valid refreshed token therefore cannot rejoin, or recreate the
  room, after its debate ends.
- **Refusals:** the token route refuses a caller who is not seated, a
  signed-out caller, a completed debate, and any request past the judging
  window.
- **Teardown:** when a debate completes (its last ballot or AI ruling), the
  completing command deletes the session's LiveKit room, which disconnects
  every participant, and records the session's end after its transaction
  commits. A LiveKit failure during teardown is logged
  and never changes the debate's result. Reconcile performs the same
  teardown when it finds a completed debate or a passed judging window.

### 6. Standard definition only

Every client captures at 360p and publishes with simulcast layers at 180p and
360p. LiveKit has no server-side cap on resolution, so a resolution tier is a
client setting. HD for premium is a later billing decision.

### 7. Ready needs a working microphone and camera

Owner decision, 2026-10-05. A debater cannot ready up in a room until their
browser has confirmed:

- a live microphone level above a threshold;
- a camera preview with frames.

The check runs locally and sends nothing anywhere. It stops its tracks once it
passes. The judge seat publishes nothing and has no device check.

This is a recorded exception to the rule that mutating forms work without
JavaScript ([UI conventions](../development/ui-conventions.md)). A device check
cannot run without JavaScript, so with JavaScript off a debater's server-rendered
Ready control is disabled and the page says Ready needs a camera and microphone.
The server does not try to verify devices; the check is a client gate in front
of the room's ready command.

### 8. Browser permissions

`Permissions-Policy` stays `camera=()` on every route except these two, which
send `camera=(self) microphone=(self)`:

- the room route, for the Ready check;
- the debate route.

`microphone=()` stays on every other route except the AI debate route
(`/ai-debate/:id`), which already sends `microphone=(self)` for its voice
opponent and keeps it.

The Content-Security-Policy is global (`apps/web/src/server/proxy-handler.ts`).
On the debate route only, `connect-src` adds the LiveKit public origin as both
`wss` and `https`.

### 9. Transcripts, captured on the server

Every human debate gets a live transcript, because the AI judge rules every
debate. The owner ruled (2026-10-05, DEC-114 overruled) that it is captured on
the server from the media server's own copy of each debater's audio, never
from browser uploads, so a modified client cannot feed it other audio. The
debate page sends no audio to any Daisy route.

1. **Where it runs.** `apps/media-worker` is a third long-lived Bun
   deployment beside `apps/web` and `apps/realtime`, through ADR 0003's
   extraction seam. A Next.js route cannot hold a media subscriber, and ADR
   0031 keeps media out of `apps/realtime`. Its database access is exact,
   under its own role: SELECT on `debates`, `debate_participants`,
   `media_sessions` and `media_participants`, and writes to
   `media_worker_leases` only. Every transcript write goes through `apps/web`.
2. **Leases.** The worker leases each active media session. Every takeover
   raises the lease's `epoch`, the worker sends its epoch with every request,
   and `apps/web` refuses a stale one, so a paused worker whose lease was
   taken cannot write.
3. **Capture.** For each leased session the worker joins the LiveKit room as a
   hidden, subscribe-only participant of the agent kind with no publish
   rights, and subscribes to each debater's microphone as 16 kHz mono PCM.
   Because it is an agent, it never holds an otherwise empty room open. It
   stays, rejoining after any disconnect, until the debate completes or the
   judging window passes. When LiveKit has closed the room empty, the worker
   waits and rejoins once a seated participant's token mint recreates it.
4. **Clips.** A pure clip cutter in `@daisy/media` takes the turn boundaries
   (from the timetable at an injected `now`) as input. It cuts at every
   boundary, drops audio from turns the seat does not speak in (the mic
   closes one reconcile round trip late), never cuts the open-mic time before
   the first turn or after the last, and splits a speech into chunks of about
   60 seconds, preferring silence. A clip's key is its track id and its start
   offset within the turn, so a resend is idempotent across a takeover.
5. **Transcription and handoff.** Each clip is transcribed through
   `@daisy/ai-voice` with zero data retention and posted to `apps/web`'s
   internal route. Requests are signed with HMAC-SHA256 over method, path,
   timestamp and body using `MEDIA_WORKER_SECRET`, within a bounded clock
   skew, compared in constant time; without the secret the route refuses with
   `INFRASTRUCTURE`. `apps/web` checks that the seat speaks in that turn and
   accepts clips until the turn is sealed or the judging window ends.
6. **Seals.** When a turn's end boundary passes, the worker posts a seal for
   each speaking seat: the number of chunks it posted for that seat across all
   of the seat's streams in the turn. A seat that published no mic all turn,
   while the worker held the lease for the whole turn, is sealed with zero
   chunks. `apps/web` seals the turn only when every counted chunk is stored.
7. **Missing audio never saves anyone (DEC-118).** A crash, a takeover
   mid-turn, a dropped clip or a missed seal leaves a turn unsealed. The
   ruling waits for every seal until a seal deadline after the timetable ends
   (configuration, default 2 minutes); then each unsealed turn counts as
   partial, using its stored chunks, with the gap noted on the ballot, and the
   ruling and its rating proceed. Dropping, staying silent or a capture
   failure never voids or unrates a rated debate.
8. **Memory.** Clips wait in memory until `apps/web` stores them, capped by
   count and age; past the cap the oldest clip is dropped and its turn cannot
   seal. Audio never touches disk, and no audio is stored anywhere.

This supersedes the room epic's ROOM DEC-C ("no transcript stored") for
transcripts.

### 10. Recording is out of scope here

Recording is built later (REC-1) with Egress and object storage, under this owner policy (2026-10-05):

- Ranked debates always record full video.
- Plus users can choose to record any other debate.
- Every other debate keeps its transcript only.

LiveKit webhooks are also deferred to REC-1, where Egress events need them.
Without them, the live call relies on reconcile at connect for the race between
minting a token and joining. A single fixed webhook URL could not reach every
worktree's server either. When webhooks arrive, they are verified, de-duplicated
by event id, stored before they are acknowledged, and treated as hints that
never decide an outcome.

### 11. Persistence and privacy

| Column                                                                    | Category   | Visibility | Retention                                 |
| ------------------------------------------------------------------------- | ---------- | ---------- | ----------------------------------------- |
| `media_sessions.id`, `.room_name`                                         | identifier | —          | with the debate                           |
| `media_sessions.debate_id`                                                | identifier | —          | with the debate                           |
| `media_sessions.created_at`, `.ended_at`                                  | none       | —          | with the debate                           |
| `media_participants.identity`                                             | identifier | —          | with the debate                           |
| `media_participants.media_session_id`, `.actor_id`, `.seat`               | identifier | —          | with the debate                           |
| `media_participants.created_at`                                           | none       | —          | with the debate                           |
| `debate_utterances.text`                                                  | personal   | private    | 180 days (DEC-101; deletion is ISSUE-322) |
| `debate_utterances.id`, `.debate_id`, `.turn_index`, `.seat`, `.sequence` | identifier | —          | with the text                             |
| `debate_utterances.created_at`                                            | none       | —          | with the text                             |
| `debate_utterances.clip_key`                                              | identifier | —          | with the text                             |
| `transcript_turns.debate_id`, `.turn_index`, `.seat`                      | identifier | —          | with the text                             |
| `transcript_turns.chunk_count`, `.sealed_at`                              | none       | —          | with the text                             |
| `media_worker_leases.media_session_id`, `.worker_id`                      | identifier | —          | until the session ends                    |
| `media_worker_leases.epoch`, `.expires_at`                                | none       | —          | until the session ends                    |

- **Who can read a transcript:** the seated debaters and the judge, and no one else.
- **Secrets:** the LiveKit API key and secret are composition-boundary secrets
  (ADR 0019), now held by two deployments, `apps/web` and `apps/media-worker`.
  `MEDIA_WORKER_SECRET`, which signs the worker's requests, is held by the
  same two. All are read through `secret()` configuration and never logged.
- **Logs:** tokens, transcript text, audio and media identities are never
  logged, by either deployment.
- **Vendor processing:** each clip's audio goes from `apps/media-worker` to
  OpenRouter and its speech-to-text provider for transcription. It is personal and private,
  processed for transcribing the debate, and sent with zero data retention,
  so the vendor keeps nothing. The OpenRouter subprocessor entry in
  `docs/operations/privacy.md`, which the AI debates already need, is
  ISSUE-333.

## Consequences

- **What this enables:** two debaters see and hear each other, mics follow the
  turns, the judge watches unseen, and every speech becomes server-captured
  text that the AI judge and the judgeable transcript snapshot (MTCH-2.2) read
  once the transcript is ready: every turn sealed, or partial after the seal
  deadline.
- **Operations:** Daisy runs a media server in production, with a domain, TLS,
  TURN and open UDP ports, and a third deployment, `apps/media-worker`, under
  its own database role with a health signal. That is a human-only
  provisioning step.
- **Worker locally and in CI:** `bun dev` starts the worker, and the e2e
  workflow runs it with a fake speech-to-text.
- **Local stack and CI:** both gain a LiveKit container. Checkouts with a stack
  already running need a one-time `docker compose -f infra/compose.yaml up -d`,
  because `bun slot:up` never recreates a running stack.
- **Ready without JavaScript:** a debater cannot ready up with JavaScript off.
- **Delay:** mic changes lag a turn boundary by one reconcile round trip.
  Clients are never trusted, but a speaker whose opponent and judge are both
  offline keeps an open mic until the session times out. Nobody can hear them
  then, because no one else is connected.

## Decisions confirmed by the owner (2026-10-05)

1. DEC-97: mics follow turns through `canPublishSources`, set by client-driven
   reconcile with no scheduler. Both debater mics are open before the first
   turn and after the last.
2. DEC-98: the judge joins hidden and subscribe-only with no camera. Every
   media identity is an opaque per-seat cuid2.
3. DEC-99: one shared LiveKit server in `infra/compose.yaml` on fixed loopback
   ports, behind the `@daisy/media` adapter package.
4. DEC-100: standard definition only. HD and a Tech issue control are deferred.
5. DEC-101: transcripts are text only, personal and private, and kept 180 days
   until the owner sets the recording and transcript retention policy.
6. DEC-109: the Ready check covers debater seats only, and Ready needs
   JavaScript.
7. DEC-113: LiveKit runs with `room.auto_create` off. Daisy creates a debate's
   room on mint when it is missing and deletes it at teardown (section 5).
8. DEC-114, overruled: transcripts are captured on the server in this record's
   scope, not from browser uploads (section 9).
9. DEC-117: capture is a hidden, subscribe-only `@livekit/rtc-node`
   participant in `apps/media-worker` that hands text to `apps/web` over a
   signed internal route (section 9).
10. DEC-118: missing audio never voids or unrates a rated debate; unsealed
    turns are ruled as partial after the seal deadline (section 9).
