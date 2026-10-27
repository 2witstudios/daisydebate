# 0072: Friendships and who's online

Status: accepted (owner GO for the MVP beta, 2026-10-26; ISSUE-607).
Builds on [ADR 0033](0033-presence-and-adjudication.md) §1 (presence
leases), [ADR 0048](0048-authorization-core.md) (one pure decision point),
[ADR 0060](0060-persistent-authorized-messaging-channels.md) and
[ADR 0061](0061-messaging-social-policy.md) (the contact pair and blocks).

## Context

The beta needs real friends and a real "who's online". Until now the
Friends page, the rail badge and an `onlineCount` of 1248 were sample data,
the presence leases of ADR 0033 had no writer, and ADR 0061 named friendship
as a separate producer that did not exist. Messaging already owns the one
contact pair per unordered actor pair, its block flags and the ordered lock
fence (accounts, then the pair, then a channel).

## Decision

1. **Friendship is a messaging-social producer, not a second relationship
   store.** `messaging_friendships` holds one row per asked or accepted
   pair (`low_actor_id < high_actor_id`, `requester_actor_id`, `state`
   `pending | accepted`, `requested_at`, `accepted_at`). It references the
   contact pair row and cascades with it. Every change runs in the social
   store's `withContacts` frame, so it takes the same account and pair
   locks as blocks and DM requests and reads the pair and both members'
   counts under them.
2. **One decision point.** `authorize` gains `social.friend.request`
   (ask or accept: both accounts current members and no block either way)
   and `social.friend.end` (decline, cancel or remove: always open to a
   pair member, even across a block) on the `contact_pair` resource. The
   pure transition rules (`decideFriendship` in
   `apps/web/src/features/messaging/friends`) decide the next pair state:
   a request to someone who already asked you accepts it, so reciprocal
   requests converge on one friendship; declining or removing deletes the
   row; a repeat changes nothing.
3. **Blocks win.** A block refuses new requests and acceptances, and the
   block writer deletes the pair's friendship, so unblocking never restores
   one (ADR 0061). Every refusal for a block, an erased member or an unknown
   username answers the same `NOT_FOUND`, so a refusal never says which.
4. **Bounds.** At most 250 friends per member and 20 outgoing pending
   requests, counted under the account locks; 30 friend changes per member
   per minute through the shared limiter. A member's list reads at most 500
   rows. _Amended 2026-10-27 (DEC-251, #479):_ a friend request is also a
   DEC-251 social request. It spends the same budgets as a DM request, which
   are counted from the append-only `messaging_social_commands` ledger: 20
   per day, and 5 per hour to an account with no accepted friendship or
   accepted DM, judged when asked; a pending or declined request relates
   nobody. Three declines by one person, counted per direction in
   `messaging_social_declines`, block further requests to them for 30 days.
   The block is refused exactly as a block is, and acceptance clears both
   directions. Each decline row expires 30 days after its last decline,
   and the retention sweep deletes it then.
5. **Friendship grants nothing else yet.** It does not open a DM channel,
   room membership or any competitive standing. When friendship starts a
   DM, messaging's own age and contact policy (ADR 0061) decides that, not
   this record.
6. **Presence is written by realtime, from one activity source per tab.**
   A socket holds an ADR 0033 lease only once it reports activity: its
   first `presence.activity` frame upserts the lease, later frames update
   it, it refreshes every 20 s with a 60 s TTL, and it is deleted on close.
   In the browser every realtime connection of a tab attaches to the tab's
   one presence: it reports on every ready and on each change of the tab's
   activity, `idle` while the tab is hidden or has had no input for five
   minutes and `active` again on input. So a hidden tab goes idle on all of
   its sockets at once, and transport liveness never keeps a member online;
   several genuinely active tabs still do. The shell opens its own presence
   connection only while the tab has no other (a page with a conversation
   or room socket carries the tab's presence) and closes it when one
   appears, so a tab normally holds one socket. Each connection takes one of
   the actor's `maxPerActor` slots, and its `presence.activity` frames spend
   the same per-socket inbound budget as any other frame; a tab sends a few
   per five minutes, while a socket that floods presence is closed `4004`
   like any other. A lease write that fails is logged by the Redis adapter
   and never closes a socket.
7. **Who may see presence.** Only accepted friends see a member's status.
   `GET /api/friends` first passes `authorize` (`social.friend.list` over the
   reader's own `messaging_collection`, on their freshly locked account),
   lists only unblocked pairs, then reads each friend's leases in one bounded Lua op
   (`readActorsPresence`) and shows `online` (any active connection), `away`
   (only idle ones) or `offline`. The member count online
   (`countOnlinePresence`) is an aggregate with no identities. Presence
   never grants a relationship, channel, room or attendance fact, and an
   expired lease changes no relationship.
8. **Challenge** creates an unlisted casual room on the catalog's default
   template, named for the two members, delivers the challenge to the
   friend, and takes the challenger to the room. Delivery is a
   `messaging_friend_challenges` row (room, challenger, challenged), written
   in the same contact-fenced transaction that confirms the pair is an
   accepted friendship and that the challenger hosts the room while it
   assembles. The friend's `/friends` lists it with Join (the room) and
   Decline (which deletes it); it shows only while the room assembles or is
   ready, only from an accepted, unblocked friend, and it goes with its
   room. A Challenge that cannot be delivered still opens the room, whose
   invite link reaches the friend.

## Consequences

- The mock `onlineUsers`, `onlineCount` and the Friends page's Watch action
  are deleted; the rail and tab-bar badge read `GET /api/friends/online`.
- A member may hide their online status (`messaging_presence_settings`,
  set from `/friends` through `social.presence.update` on their own
  collection). Hidden, every friend sees them offline and no friend's badge
  counts them; their leases are never read for a friend list, and nothing
  tells a friend they chose to hide. The members-online aggregate still
  counts them, since it names no one. The row is personal/private, deleted
  on subject erasure and exported to its member.
- `messaging_friend_challenges` is personal/private like the friendship
  row, deleted on subject erasure and exported to either member.
- `messaging_friendships` is personal/private, deleted on subject erasure
  and exported to either member, on the same pending lawful-basis and
  retention decisions as `messaging_contact_pairs`.
