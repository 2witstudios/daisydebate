# 0053: Live video on self-hosted LiveKit

Status: proposed. Fulfils the media decision that
[ADR 0031](0031-realtime-service.md) section 1 defers to "a separate LiveKit
service with its own ADR (VIDEO-1)", and uses the `mediaSession` name that
[ADR 0049](0049-room-debate-turn.md) section 8 reserves. It amends neither.
Decisions marked open at the end were made on the owner's behalf and stay
open until the owner confirms or overrules them.

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

The server SDK (`livekit-server-sdk`) is used only inside a new adapter package,
`@daisy/media`. The browser uses `livekit-client`. Media never passes through
`apps/realtime`. Token minting, permission changes, teardown and transcription
run in `apps/web`.

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

- **Never granted:** data publishing, metadata updates and screen share. Each
  would be a side channel around mic gating or judge anonymity.
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
- at each turn boundary it computes from the timetable;
- after End my turn;
- when the judging window ends.

The server then:

1. recomputes the policy for every seat at `now`;
2. compares the result with each participant's current rights;
3. updates only the participants that differ.

The route is rate-limited per actor, at a limit that tolerates three clients
calling at every boundary of the shortest turn.

This bounds a debater who never calls reconcile. The other debater wants their
own mic opened at the boundary, and their call closes this one too. The judge's
client covers prep turns and an absent opponent. When nobody is connected,
LiveKit's room `empty_timeout` and `departure_timeout` close the session.

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

### 9. Transcripts, not recordings

Every human debate gets a live transcript, because the AI judge rules every
debate:

1. The speaking debater's browser records its own microphone, but only while
   its seat speaks in the live turn. It never records the open-mic time before
   the first turn or after the last.
2. Each segment is sent with its turn index.
3. The server accepts a segment only from a seat that speaks in that turn,
   while the turn is live or within a short configured grace window after it
   ends.
4. It transcribes the segment through `@daisy/ai-voice` with zero data
   retention, and stores the text.

No audio is stored.

This supersedes the room epic's ROOM DEC-C ("no transcript stored") for
transcripts. Speech still travels over Daisy's own media session, not a
channel the debaters arrange themselves.

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
| `media_sessions.debate_id`, `.created_at`, `.ended_at`                    | none       | —          | with the debate                           |
| `media_participants.identity`                                             | identifier | —          | with the debate                           |
| `media_participants.media_session_id`, `.actor_id`, `.seat`               | identifier | —          | with the debate                           |
| `media_participants.created_at`                                           | none       | —          | with the debate                           |
| `debate_utterances.text`                                                  | personal   | private    | 180 days (DEC-101; deletion is ISSUE-322) |
| `debate_utterances.id`, `.debate_id`, `.turn_index`, `.seat`, `.sequence` | identifier | —          | with the text                             |
| `debate_utterances.created_at`                                            | none       | —          | with the text                             |

- **Who can read a transcript:** the seated debaters and the judge, and no one else.
- **Secrets:** the LiveKit API key and secret are composition-boundary secrets
  (ADR 0019). They are read through `secret()` configuration and never logged.
- **Logs:** tokens, transcript text and media identities are never logged.

## Consequences

- **What this enables:** two debaters see and hear each other, mics follow the
  turns, the judge watches unseen, and every speech becomes text the AI judge
  and the judgeable transcript snapshot (MTCH-2.2) can read.
- **Operations:** Daisy runs a media server in production, with a domain, TLS,
  TURN and open UDP ports. That is a human-only provisioning step.
- **Local stack and CI:** both gain a LiveKit container. Checkouts with a stack
  already running need a one-time `docker compose up -d`.
- **Ready without JavaScript:** a debater cannot ready up with JavaScript off.
- **Delay:** mic changes lag a turn boundary by one reconcile round trip.
  Clients are never trusted, but a speaker whose opponent and judge are both
  offline keeps an open mic until the session times out. Nobody can hear them
  then, because no one else is connected.

## Open decisions (made on the owner's behalf)

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
