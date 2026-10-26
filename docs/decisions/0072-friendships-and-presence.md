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
   rows.
5. **Friendship grants nothing else yet.** It does not open a DM channel,
   room membership or any competitive standing. When friendship starts a
   DM, messaging's own age and contact policy (ADR 0061) decides that, not
   this record.
6. **Presence is written by realtime, for the tab's presence connection
   only.** A socket holds an ADR 0033 lease only once it reports activity:
   its first `presence.activity` frame upserts the lease, later frames
   update it, it refreshes every 20 s with a 60 s TTL, and it is deleted on
   close. The shell opens one presence connection per signed-in tab and
   reports on every ready, then `idle` while the tab is hidden or has had no
   input for five minutes and `active` again on input. A room's or a
   conversation's socket never reports, so transport liveness never keeps a
   member online; several genuinely active tabs still do. A lease write that
   fails is logged by the Redis adapter and never closes a socket.
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
   template, named for the two members, and takes the challenger to it; the
   room's invite link is how the friend arrives. Sending that link to the
   friend directly is a follow-up.

## Consequences

- The mock `onlineUsers`, `onlineCount` and the Friends page's Watch action
  are deleted; the rail and tab-bar badge read `GET /api/friends/online`.
- A presence visibility preference (hide my status) is not built; until it
  is, accepted friends always see each other's presence.
- `messaging_friendships` is personal/private, deleted on subject erasure
  and exported to either member, on the same pending lawful-basis and
  retention decisions as `messaging_contact_pairs`.
