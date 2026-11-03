# 0107: Audience interaction and notifications

Status: accepted (SPECT-1.4 and WATCH-12; owner decisions on the Watch plan,
2026-11-02). Settles the contextual spectator contract
[ADR 0062](0062-messaging-context-authority-contracts.md) proposed, and replaces
its "active competitors cannot read" with the owner's rule below. Builds on
[ADR 0060](0060-persistent-authorized-messaging-channels.md) and
[ADR 0099](0099-spectator-release-authority.md).

## Decision

**Spectator chat is a Messaging channel.** A Round has one channel of kind
`round_spectator`, policy `round.spectator`, tied to the Round by a constrained
column and opened by its first post. It uses Messaging's stream, message and receipt
tables, so there is no second message store. It has no DM or group authority: every
social read treats it as absent, so no DM or group route can reach it, and it never
appears in an inbox. Its contract is the Round's:

- **Read:** anyone, with no account, once a message is released by the one rule
  (`factReleasedSql`). The read takes no viewer and may be cached.
- **Post:** an account, not admission, through a rate-limited route. An account with
  no username has no actor and no name to post under, so it chooses one first. A ban,
  an account restriction or slow mode refuses; `decideChatPost` is that decision.
  Posting ends when the Broadcast completes or is stopped. A Round with no Broadcast
  has no chat.
- **Seats:** during the Round a debater on a non-ranked Round reads chat unless the
  host turned it off (`broadcasts.debaters_read_chat`); a ranked debater and a judge
  do not. After the Round a seat reads like anyone.

The public read cannot recognise a debater, because it takes no identity. "Never
shown" therefore means no signed-in surface shows it and the Room sends nothing of it
to the browser; a debater who opens a private window reads what any visitor reads.
Identifying readers would end the anonymous snapshot.

**Reactions, counts and following are their own concepts.** A reaction is a closed
kind per Round, spaced to one per account in ten seconds, shown only as released
totals. A viewer count is a HyperLogLog of random tab tokens per 30 second bucket in
Redis, read at the timeline rather than now, and no seat is shown one during the Round.
Following is one way, private to the follower, and grants nothing.

**A notification cannot hold an outcome.** The `notifications` table has no text,
result or score column; the words come from the kind when it is read. Rows are written
by a sweep that starts from released facts alone: `followed_debater_live` once
`released_through_at` is first set on a public Round still on air, and `recording_ready`
once the Recording is ready, any Broadcast is complete, and the outcome is released.
`notification_fanouts` records that an event has told its recipients, so Notifications
writes nothing to Broadcast or Recording. A read re-checks that the thing still stands,
so a takedown takes its notification with it. A `recording_ready` reaches the Round's
seats and, on a public Round, followers of its debaters.

## Consequences

Chat runs a minute or more behind on a ranked Round, for the poster too, since
one rule covers every fact; a form says so instead of echoing the message early.
Spectator chat, reactions and watch history have an adopter and a row in
[compliance](../operations/compliance.md) each. A pulse reads no cookie, so a count
cannot be tied to anyone; it can also be inflated, which is acceptable because it
drives nothing.
