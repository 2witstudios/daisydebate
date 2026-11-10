# 0124: Room invitations and notification email

Status: accepted (point guard, 2026-11-10; [plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/wo00vsb8rvuper7tm86ly8ok)).
Builds on [ADR 0075](0075-beta-access-gate.md) (durable mail intents),
[ADR 0103](0103-whos-online.md) (challenges and seat holds),
[ADR 0070](0070-one-active-room-per-user.md) and DEC-331 (a seated human judge
stays). Answers the Rooms "invite path" open decision (ISSUE-443) for public and
unlisted Rooms; Private stays unoffered.

## Context

A Room could be shared only as a link, and anyone with it could take any empty
seat, the judge seat included. A seated human judge cannot be removed or
replaced, so a stranger who sits first holds the seat for good. Coaches running
practice rounds need to name their debaters and the judge. Members also missed
challenges: they appeared only on `/friends`. The notification inbox carried
only Watch's Round events, and email carried only sign-in and beta mail.

## Decision

1. **A Room invitation** is a host's named offer of one seat kind, `debater`
   (either side) or `judge`, to one member, named by username
   (`room_invitations`). It is `pending` until it is `accepted` (the invitee
   takes a seat of that kind), `declined` (invitee), `withdrawn` (host) or
   `expired` (24 hours, Start round, close, a restriction of the host or the
   invitee, or the invitee taking a seat of the other kind). One pending
   invitation per member per Room. Only the host of an open Room invites; the
   invitee must be an admitted participant (ADR 0075), unblocked either way,
   not the host, not already seated, and not already holding a seat here: a
   challenge's hold is never overwritten, so a member has one hold per Room. A
   repeat of the same invitation answers it unchanged.
2. **An invitation holds its seat.** `room_seat_holds` gains a `seat` kind, and
   the engine's held-seat rule is per kind, the judge seat included: a claim, or
   a host assign of someone else, into the last free seat of a kind held for
   another member is refused. A challenge's two-minute arrival hold is a
   `debater` hold. The hold reserves, never seats: the invitee still takes the
   seat. Settlement runs under the Room lock of every Room change and first
   ends any invitation whose time ran out; the retention sweep ends one in a
   Room nothing touched since, at its own expiry.
3. **Notifications name their subject.** A notification row names exactly the
   subject its kind requires (a Round, a Room invitation or a challenge) and
   `actor_id` is who it is about. Kinds: `followed_debater_live`,
   `recording_ready` (Watch's fan-out), `room_invitation` and
   `challenge_received`. The producer writes the row in its own transaction,
   with one content-free `user.notification-delivered` signal (kind and id) on
   the invitee's `user:inbox` topic. A read shows a row only while its subject
   stands (an invitation pending, a challenge open).
4. **Channels and preferences.** A preference is per kind and channel (`in_app`,
   `email`); a kind offers only the channels it is sent on, and no stored
   choice means on. The in-app choice hides rows from the inbox without deleting
   them.
5. **Notification email is a durable job** (`notification_emails`), written
   with the notification when the member's email channel is on. A worker in
   every web instance claims due jobs under a 60 s lease (`FOR UPDATE SKIP
LOCKED`, SHA3 lease digest), re-reads at send time and sends through the one
   suppression-honouring transport under the `notification` purpose, with the
   job id as the Resend idempotency key. It retries with ADR 0075's backoff and
   fails for good after 8 attempts. It is cancelled as `recipient-gone`,
   `preference-off`, `not-owed` (the subject ended), `suppressed` or
   `rate-limited` (20 sent per member per hour; a soft cap read without a
   lock, so instances sending at once may pass it by a batch). A host who
   withdraws and invites the same member to the same Room again within the
   hour writes a new inbox row but owes no second email once the first was
   sent. Terminal jobs are kept 30 days. It is not a beta mail
   intent: that queue is beta access's. The queue
   runner and retry policy live in `features/mail/` for both.
6. **Unsubscribe.** Every notification email links to `/unsubscribe` for its
   kind and carries `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058)
   naming `/api/notifications/unsubscribe`. The link's token is SHA3 over the
   member, the kind and a subkey derived from `RECIPIENT_HASH_SECRET` under the
   label `notification-unsubscribe`, compared as digests. It turns off only
   that kind's email, with no sign-in.
7. **Invitations name members only.** An address with no account cannot be
   invited; the owner preapproves it in private admin (ADR 0075's "Invite by
   email"), and the host then invites the member by username.

## Consequences

- A public, listed Room can hold its judge seat for the coach who will judge.
- Settings shows each kind's in-app and email switch.
- Ended invitations are kept 30 days; export and erasure cover invitations
  through the Room's competitive record and notifications, preferences and
  email jobs through the notifications adopter.
