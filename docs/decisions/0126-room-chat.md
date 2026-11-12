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
"in the room" without a seat and this decision invents none. A member has one of
two standings, decided from Room facts and never from the client:

- seated: the Room's host and anyone holding a seat, debater or judge;
- visitor: a member who may read the Room and holds no seat. A public or
  unlisted Room admits any member; a private Room admits only its host and
  seats.

Both read and post. Each needs a member account that is not erased, is bound to
the principal and passes participant access (approved beta, no restriction, the
age floor). Visitors post by default, which is ADR 0062's proposed default; the
host's control over visitor posting is a later leaf and is not part of this
decision. Social DM blocks neither grant nor remove this audience.

The authority fact carries the Room's status, visibility and end instant, the
caller's standing and the channel's identity and revisions, and nothing else.
`seated` covers the host and every seat alike, so a judge is not told apart
from a debater by this fact, and no standing leaves it for a client: a thread
shows usernames only. An anonymous judge (DEC-174) is therefore
indistinguishable from a visitor in Room chat. A page that may name a seat adds
that from the Room it already reads.

Rendering and discovery are reads. A protected explicit POST creates the channel
once under the Room's lock, and concurrent opens converge on the unique
Room/kind channel. Every content operation rechecks the current account and
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
A Room is not written again once it has started or closed, so its last write is
its end. Ordinary account export and erasure apply. Visible peer messages can be
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
host.
