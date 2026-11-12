# 0126: Room chat

Status: accepted (owner, 2026-11-12).

## Decision

A Room has one conversation while it gathers: Room chat. It lets the people
gathering talk before a Round exists, whether or not they hold a seat. This
settles the pre-round part of proposed ADR 0062's Room community channel; the
rest of ADR 0062 stays proposed.

Room chat is a `room_community` Messaging channel governed by `room.community`.
It belongs to the Room, never to a Round, and is separate from the Round floor
(ADR 0120), spectator chat (ADR 0108) and social conversations. A channel names
exactly one owner: a Room channel names its Room and no Round, a Round channel
its Round and no Room, a social channel neither; a Room has at most one.

The audience is Room read access, not presence. Daisy keeps no roster of who is
"in the room" without a seat and this decision invents none. Whoever may read
the Room (`room.read`: any member for a public or unlisted Room, its host and
its seats alone for a private one) reads its chat. A member has one of three
standings, decided from Room facts and never from the client:

- seated: the Room's host and anyone holding a debater's seat. They read and
  post;
- visitor: a member who may read the Room and holds no seat. They read and
  post;
- judge: a human holding a judge's seat, the host included when the host sits
  as judge. They read and do not post.

A human judge is anonymous to the debaters (DEC-174), and a message is shown
under its author's username, so a judge's message would name them: by
elimination in a private Room, where every other author is a named seat or the
host. So a judge does not post, in any visibility, and no message can name a
judge. A bot judge has no account and is not in the chat at all. The Round
floor excludes judges for the same reason (ADR 0120).

Each standing needs a member account that is not erased, is bound to the
principal and passes participant access (approved beta, no restriction, the age
floor). Visitors post by default, which is ADR 0062's proposed default; the
host's control over visitor posting is a later leaf and is not part of this
decision. Social DM blocks neither grant nor remove this audience.

The authority fact is raw: the Room's status, visibility and end instant,
whether this caller hosts the Room, this caller's own seat, and the channel's
identity and revisions. SQL decides nothing. The pure `decideRoomCommunity`
derives the standing from it with the one `room.read` rule that Room pages use
(`roomReadable` in `@daisy/auth`), so the chat's audience cannot drift from
"everyone who may read the Room". The fact is about the caller alone and never
reaches a client. A caller is told only whether their own chat is read-only; a
thread shows usernames only, less that of an author who now sits as a judge the
reader may not name; and a page that may name a seat adds that from the Room it
already reads.

Rendering and `GET` discovery are reads and never create a channel. A protected
explicit POST creates the channel once under the Room's lock, and concurrent
opens converge on the unique Room/kind channel. That POST is sent without a
gesture: when the page of a member who may post enters an open Room and finds
no chat yet, it opens one, as the Round floor does. A Room therefore has a
channel from the first such page view, not from the first message. A judge's
page never asks to open one, and a judge's open is refused; while it has no
chat yet and is in view it repeats the discovery read about every 15 seconds,
so the judge sees the chat once someone else opens it. Every content
operation rechecks the current account and
standing under the lock order account, Room, channel, stream. Room commands hold
the Room exclusively, so Start and close serialize with every chat write.
Shared message sequencing, retry receipts, edits, author removal, read markers,
reports and `channel-messages` observation apply. This adds no attachments,
reactions, typing indicators or presence.

Room chat ends when the Room starts or closes. From that write nobody reads,
posts or observes it, the host and seats included, and there is no in-product
history afterwards: a debater must not carry a visitor conversation into play,
and the Room page is gone. A refused read is answered as not found, so a
private or ended Room's chat is never confirmed to someone without authority.
Removing one's own message remains an ADR 0075 withdrawal: it needs no
participant admission and no standing, discloses no one else's content, and
stays available until the rows are due to be purged.

Rows are retained 180 days from the Room's end for reports, export and erasure,
then swept in bounded batches: receipts, then message leaves, then read state.
The Room's end is `rooms.updated_at`, under this invariant: once a Room has
started or closed, no write moves `updated_at`. Room commands, maintenance,
account closure and a restriction's release act only on an open Room, and an
invitation or a sync signal moves only `change_version`. A later writer that
set `updated_at` on an ended Room would restart the 180-day clock, so
`packages/db/integration/room-community-end-instant.integration.ts` pins the
invariant against every such writer, and any new writer of `rooms` must keep
it. Ordinary account export and erasure apply. Visible peer messages can be
reported with the closed chat-message safety reasons; a filed report and signed
operator review and removal use the existing Content Reports boundaries and
outlive the conversation for the same window. No new personal content enters
logs.

Room chat and the Round floor share one mechanism, context chat, and neither
owns it: a Messaging channel bound to one owning resource, opened explicitly,
with history, send, edit, own removal, report, read marker and observation,
shown as an embedded thread with a composer. Each context supplies only its
authority, its address and its words.

## Consequences

Room chat text, receipts, read state and expendable observation copies enter the
compliance inventory with a retention window measured from the Room's end.
A viewer's observation permit is the standard short permit: a tab outlives the
end of its authority by at most that permit, and receives nothing new in that
time because no post is accepted. Visitor posting cannot yet be turned off by a
host. A human judge can read the Room's conversation and cannot take part in
it.

A member may post as a debater or a visitor and then take the judge's seat.
Their earlier messages stay. From that write the server gives their username to
no reader who may not name that judge: the author-label read applies the Room
view's own rule (`namesHumanJudge` in `@daisy/debate-engine`), so only the judge
themselves and a seatless host who did not inherit the Room still get it.
Everyone else sees such a message under "A member", the same words as for an
author whose account is gone. The Room page re-reads the thread's latest page
whenever the Room's version moves, so an open tab drops a username it had
already been given.

What this does not close. The builder recorded these; the owner's acceptance
of the first is asked for with the plan's open questions and is not yet given:

- The message keeps its author's actor id on the wire, as it had while they
  held a named seat. Room chat itself pairs it with no name, but the id is the
  same one a Room view shows beside a username wherever that member holds a
  named seat (another Room, or this one before the move). A reader who inspects
  the wire and makes that second read can name the author of a withheld
  message. This is the one place a judge's actor id reaches a reader the Room
  view hides it from. Closing it means giving a withheld author an id that is
  not their actor id.
- A reader who saw the username before the move has seen it. A tab that has
  lost its Room sync keeps showing it until its next read. Anyone watching the
  seats saw the same member leave a debater's seat as a judge's seat filled.
- In a private Room every other author carries a seat, so a message under "A
  member" can be read as written earlier by whoever now judges, or by someone
  who has left. It says which message, not who.
