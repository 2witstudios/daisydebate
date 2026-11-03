# 0108: Audience interaction and notifications

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

- **Read:** anyone who can reach the Round, with no account, in near real time. Every
  viewer is on the same held feed, so holding chat to the release timeline only made
  every message a minute old and a poster's own message look lost (point guard,
  2026-11-03). Moderation alone stands between a post and its readers. A public read
  takes no viewer and may be cached for a second.
- **Post:** an account, not admission, through a rate-limited route. An account with
  no username has no actor and no name to post under, so it chooses one first. A ban,
  an account restriction or slow mode refuses; `decideChatPost` is that decision.
  Posting ends when the Broadcast completes or is stopped, which waits for its delay
  to pass. A Round with no Broadcast has no chat.
- **The live room does not post.** Chat is not held, so what keeps outcomes out of it
  is who may write: anyone ahead of the feed, meaning every seat, judges included, and
  a host with no seat (`round.observe.undelayed`), gets the typed refusal
  `chat-live-room`, for the whole life of the chat. An event moderator or operator has
  no account in this app. Someone with a second account is a matter for moderation.
- **An unlisted Round** answers chat, reactions, counts, watch history and a report on
  it or on its messages by `audienceAdmits`, as every other read of it does: with no
  current link it reads as missing, and those answers are never cached. Someone in its
  live room needs no link, and reads only what their place allows.
- **Seats:** during the Round a debater on a non-ranked Round reads chat unless the
  host turned it off (`broadcasts.debaters_read_chat`); a ranked debater and a judge
  do not. After the Round a seat reads like anyone.

The public read cannot recognise a debater, because it takes no identity. "Never
shown" therefore means no signed-in surface shows it and the Room sends nothing of it
to the browser; a debater who opens a private window reads what any visitor reads.
Identifying readers would end the anonymous snapshot.

**Reactions, counts and following are their own concepts.** A reaction is a closed
kind per Round, spaced to one per account in ten seconds, shown only as current totals.
A viewer count is a HyperLogLog of random tab tokens per 30 second bucket in Redis,
read from the newest whole bucket while the Broadcast is on, and no seat is shown one
during the Round. Neither is held to the timeline, for the reason chat is not.
Following is one way, private to the follower, and grants nothing.

**Retention.** Spectator messages, their retry receipts and reactions go 180 days after
posting, matching transcripts, in the retention sweep (not reviewed by counsel). The
channel and its stream counters stay, holding nothing personal, so sequences never
repeat. No DM or group is ever in reach of that sweep.

**A notification cannot hold an outcome.** It stays on the release timeline. The `notifications` table has no text,
result or score column; the words come from the kind when it is read. Rows are written
by a sweep that starts from released facts alone: `followed_debater_live` once
`released_through_at` is first set on a public Round still on air, and `recording_ready`
once the Recording is ready, any Broadcast is complete, and the outcome is released.
`notification_fanouts` records that an event has told its recipients, so Notifications
writes nothing to Broadcast or Recording. A read re-checks that the thing still stands,
so a takedown takes its notification with it. A `recording_ready` reaches the Round's
seats and, on a public Round, followers of its debaters.

## Consequences

The release timeline governs facts about the Round, and chat, reactions and counts are
not those: they are the audience talking to itself. A ranked debater in a private
window can read chat as any visitor can, as before, and could post from a second
account; that is what reports and bans are for, not a reason to hold every viewer's
chat back. Spectator chat, reactions and watch history have an adopter and a row in
[compliance](../operations/compliance.md) each. A pulse reads no session, and no cookie but an unlisted
Round's link, which names a Round and no one, so a count cannot be tied to anyone; it
can also be inflated, which is acceptable because it drives nothing.
