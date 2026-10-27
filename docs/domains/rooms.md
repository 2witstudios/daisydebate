# Rooms and Rounds

Owner: domain engineers. This page describes the product lifecycle: where
people gather, how a contest is played and ended, how it is judged, and how
pages stay current. The runtime rules behind it are in [engine.md](engine.md);
the decisions are [ADR 0049](../decisions/0049-room-debate-turn.md) (accepted
with its amendments, DEC-217), [ADR 0058](../decisions/0058-one-round-model.md),
[ADR 0066](../decisions/0066-room-state-sync.md) and
[ADR 0067](../decisions/0067-playable-round-policy-and-acceptance.md).

## Nouns

| Noun        | What it is                                                                                 | Durability                         |
| ----------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| **Room**    | A gathering: host, seats, judges, title, topic, visibility and the pinned format and rules | PostgreSQL                         |
| **Round**   | One contest under frozen rules: seats, segments, transcript, ballots, outcome, ratings     | PostgreSQL, the competitive truth  |
| **Segment** | One speech or exchange inside a Round, with its speaking intervals                         | PostgreSQL rows (`round_segments`) |

UI copy may say "match"; the stored noun is the Round. "Lobby" is the public
browsing surface of open Rooms. A LiveKit room is a media session
(`media_sessions`), never a Daisy Room.

"Topic" has three distinct meanings, and the code keeps them apart (ISSUE-404):

- **A Room's or Round's `topic`** is the proposition being debated. The
  Formats slice owns renaming it to "resolution" on the contracts.
- **An onboarding interest category** (`InterestCategory`,
  `interestCategoryChoices`) is a subject a member says they like debating.
  Its partner, the format the member prefers, is `FormatPreference`, never a
  Round's `FormatDefinition`.
- **A realtime topic** is a routing address for doorbells, never debate
  content.

No shared "Topic" entity spans them.

## Assembly and Launch

A host creates a Room from the catalog or a custom definition. Members take
debater or judge seats; the host may seat bots. Changing settings or seats
clears every Ready consent, so nobody plays under rules they did not see.
Consent lives in expiring Redis behind a durable revision fence.

Launch is one atomic operation. When every required seat is filled and every
human is Ready, it freezes the seats and rules into one **scheduled** Round.
A Room has exactly one Round (ADR 0067).

## One active Room

A user is in at most one active Room at a time, as its host or in a seat
(ADR 0070). A Room is active while it assembles or its Round is scheduled or
active; the database holds one `room_active_memberships` row per human
member, keyed by actor, so a second create or join is refused as
`active-room` and the UI returns the user to their current Room. Bots hold no
membership. Every terminal state frees its members:

- **Close.** Only the host's explicit Close closes an open Room. Hosting is
  independent of seating: a host who leaves their seat (or never took one)
  still hosts, and stays a member, through the live Round.
- **Idle expiry.** With `ROOM_POLICY.idleTimeoutMs` set, maintenance closes an
  open Room with no accepted command (or running pre-round prep) for that
  long, by database time.
- **Leave.** A guest leaving their seat frees only themselves. Leaving a live
  Round forfeits it, which ends the Round.
- **The debate ends**: the last speech ends, or the Round completes, is
  forfeited or is abandoned. Judges ballot from their Round seats.

## Playing

The host's `start` command activates the Round; only the host may start it.
At or past the start horizon, the command refuses atomically, even before
maintenance sweeps the scheduled Round; maintenance then abandons it.
From then on, the runtime moves through the rules' segments and prep under the
database clock.
Only the floor holder may yield. An interrupter's yield returns the floor to
the scheduled speaker, whose segment continues (DEC-203). Humans, bots and
services all act through the one shared command operation; people reach it
through the Round command route.

The Round's room page sends each member to their own view: a debater to the
live room, the assigned judge to the judge view, and a seatless host to the
spectator view, a read-only projection of the Round (who holds the floor, the
clock and the speech order) with no controls and no media. The spectator
view is the seed of spectating: `SpectatorAudience` names why a viewer
watches, today only `host`, and later audiences join that union without a
second view. Everyone else gets the Round's public page.

Media is a scoped LiveKit session. The capture worker turns the published
audio of every debater, human or bot, into the transcript; bot speech enters
the transcript only this way (DEC-212, DEC-213, DEC-215). When the final
segment ends and the admission cutoff passes, round maintenance freezes the
transcript once. The freeze is immutable, and it is recorded as complete or
incomplete.

## How a Round ends

A Round reaches one terminal state, and only once:

- **Judged.** The judges' ballots decide the outcome.
- **Unjudged.** A Round with no judges completes at the freeze. A judged
  Round whose judges have not all ruled completes at its persisted ballot
  deadline, by default 30 minutes after the freeze (DEC-201, DEC-207). The
  submitted ballots decide; with none, or with a tie, there is no outcome.
- **Forfeit or abandoned by attendance.** A missing speaker against a present
  opponent forfeits. Both missing abandons. A bot worker's loss abandons and
  never forfeits (ADR 0067). Media, capture or speech-to-text failure is
  never evidence of absence.
- **Forfeit by command.** A debater can forfeit.
- **Abandoned before start.** A Round still scheduled past its start horizon
  (default 15 minutes after Launch) is abandoned (DEC-214).

There is no winner, draw, forfeit or rating for an absent ruling. Ratings
apply only to ranked Rounds; ranked play is out of this goal's scope
(DEC-204).

## Judging

Human judges submit the shared rubric ballot against the frozen transcript
revision, through native or enhanced forms. AI judges are real shared-rubric
judges, never placeholders or random rulings. When the transcript freezes,
round maintenance queues one durable judging job per eligible AI judge. A
leased server worker then calls the model and commits through the same
ballot operation.

An AI judge never rules on a transcript frozen incomplete (DEC-208). No AI
job is queued for such a freeze. With no human judge, the Round completes at
the freeze with no outcome, and its result reads "Transcript incomplete".
Human judges still rule. Once every human judge has ruled decisively, the
Round completes without waiting for the AI seats. The receipt records each
judge seat that gave no ruling.

## Another match

A started Room is never reopened. After its Round completes or is abandoned,
the host can open a fresh-Room form. That creates a new Room with empty seats
and no consent, and the source Room and Round stay unchanged (ADR 0067).

## Staying current

Room and Round pages sync as resources, not routes (ADR 0066). Every accepted
change rings a thin doorbell on the resource's realtime topic. The page's
sync driver then rereads the resource, and resyncs on refusal, on reconnect
and when the tab becomes visible. Doorbells carry no delivery guarantee, so
the driver also polls: every 30 seconds while realtime is connected, and every
5 seconds without a connection or while stale. A hydrated command adopts the
server's answer instead of navigating.

Room persistence has one command path: `createRoomCommand` and
`executeRoomCommand` atomically persist the engine's member set with every
accepted Room mutation. Seating, prep and Launch all use that path; there is
no separate low-level seat or freeze writer.

## Lobby discovery ordering

The discovery query accepts `sort=newest` (also the omitted default) or
`sort=longest-waiting`. Both use the Room's immutable `(created_at, id)`
tuple, descending for newest and ascending for longest waiting. The id
uses PostgreSQL's C collation to break timestamp ties. Waiting longest is
creation order across discovery, including a Room that has already launched;
it never sorts on the nullable waiting display field or mutable occupancy.

The string cursor is the last returned accessible Room's id. PostgreSQL
resolves that anchor's creation instant at full stored precision, even if
its Room has since launched or left the selected status; no JavaScript
Date rounding or offset is involved. An invisible or missing anchor yields
no page. The same keyset/order applies before each bounded assembly/live
branch limit, to the combined candidates and to the final projection.
Authorization and bounded retry after lock races remain unchanged.

New Rooms before the anchor appear on refresh; those after it can appear
on subsequent pages. Launching does not move the key. Clients restart from
page one when changing sort, status, mode or search. The query/URL helper
preserves sort on subsequent pages; interactive controls are owned by the
separate Lobby design lane.
