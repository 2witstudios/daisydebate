# 0144: The notification catalogue and its delivery

Status: accepted (owner, 2026-11-16;
[plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/vpy1crnd8v2r3qtixw5a0pv2)).
Extends [ADR 0124](0124-room-invitations-and-notification-email.md) and
supersedes its per-notification email jobs and per-kind unsubscribe link.
Builds on [ADR 0032](0032-transactional-outbox-delivery.md) (the outbox and the owner-only
`user:inbox` delta) and [ADR 0033](0033-presence-and-adjudication.md) (presence leases).

## Context

Daisy stored notifications (ADR 0124), but nothing in the browser listened to
them, there were no unread badges, most events produced none, the Watch sweep
rang no one, and the inbox had no cursor. Each new kind was spelled by hand in
about eight places. A second writer and reader had begun on the Tab branch for
tournament events: two notification systems for one member. A public beta
needs people to know when something needs them, and to be pulled back.

## Decision

1. **One catalogue.** `packages/protocol/src/notifications.ts` holds one entry
   per kind: the subject it names, its urgency (`urgent`: it needs the member
   now; `durable`: it can wait) and, for a durable kind, whether it is gathered
   into email (`none` | `batched`). An urgent kind is never emailed, and the
   type refuses one that says otherwise. Kind lists, channels, the choices
   schema, defaults, the stored kind, subject and preference checks all derive
   from it.
2. **A subject, and who owns its standing.** A notification names exactly the
   subject its kind requires (`notificationSubjectColumns`: a Round, a Room
   invitation, a challenge, or a friendship by its composite key). Whether a
   subject still stands is its owner's published read beside its status words
   (`challengeOpen`, `challengeAccepted`, `invitationOpen`, `broadcastOnAir`,
   `recordingReady`, `friendRequestOpen`, `friendshipAccepted`, and Rounds'
   own), composed by one exhaustive switch in `notifications/standing.ts`. A
   new kind adds its owner's read there and nowhere else; there is no registry.
3. **One writer.** Every producer calls `oweNotifications` in the transaction
   that recorded its event: one bulk insert, one content-free
   `user.notification-delivered` signal on the member's `user:inbox` per row
   written, and, for a batched kind, the row gathered into the member's digest.
   A recipient already told of the subject, or with no live account, writes
   nothing. The Watch sweep, Rooms, Challenges, Friends and Rounds call it; Tab
   adopts it (NTF-15) rather than keeping its own.
4. **One inbox read.** Newest first by `(surfaced_at, id)` with a keyset
   cursor, each row shown while its subject stands and the member's in-app
   channel for its kind is on; the unread count is over the same rows. Marking
   read names some ids or all, and rings `user.notifications-read` only when
   something changed, so every tab's badge follows. `surfaced_at` is when a row
   last reached the member: a Round's decision row comes back unread when its
   analysis is published.
5. **The digest.** Per-notification email jobs give way to one
   `notification_digests` job per member on the shared mail recipe. Each
   emailed notification links to the member's one queued digest and pushes its
   send to 15 minutes after itself, never past an hour after the first. At send
   time the digest re-reads which of its notifications are unread, still stand
   and are still wanted by email, and is cancelled `not-owed` when none are.
   While the member has a live presence connection it waits again
   (`mailQueue.postpone`: no attempt spent); when presence cannot be read it
   sends. The email lists the inbox's own words and links the inbox once
   (AUTH-3.9). Its unsubscribe, the RFC 8058 one-click header and the footer
   link, stops all notification email; which kinds are emailed is chosen in
   Settings.
6. **Presentation choices.** A member-level record (`notification_presentation`)
   holds toasts, the sound, desktop alerts and the master email switch; no row
   is everything on. None of them changes what the inbox stores.
7. **The shell.** One shell-level listener on the member's `user:inbox` reads
   `GET /api/notifications/shell` (the unread count, the newest unread rows in
   the inbox's words, and the presentation) when a notification is delivered or
   read, with a backstop. It drives the rail's and the tab bar's badges ("9+"),
   the document title, and toasts after the designed canvas: a toast is a view
   of a stored row, never a source; the first read interrupts no one; a row the
   current page shows is not toasted but marked read; a challenge is not toasted either, since its own cards show it on every page (it still chimes and alerts); one that asks for an
   answer stays until dismissed, an informational one goes after ten seconds,
   held while hovered or focused. An urgent kind also chimes, and raises a
   desktop alert while Daisy is in another tab, with permission asked only when
   the member turns desktop alerts on.
8. **Kinds now.** `followed_debater_live` and `recording_ready` (durable,
   in-app), `room_invitation` and `friend_request_received` (durable, emailed),
   `friend_request_accepted` (durable, in-app), `challenge_received` and
   `challenge_accepted` (urgent: a challenge stands two minutes),
   `round_started` (urgent: the Round goes active and its timer runs; prep and a
   topic draw are not a start) and `round_decision_released` (durable, emailed;
   a Round frozen with `decision_release = 'held'` waits for its owner's
   release, which names its recipients). Media releases
   ([ADR 0151](0151-media-releases.md)) add seven durable, in-app kinds:
   `media_release_requested` and `media_release_declined` (about a request),
   `media_release_signed`, `media_release_club_confirmed` and
   `media_release_withdrawn` (about a release; a withdrawal also tells the
   minor's school staff), `media_release_club_asked` (to a club's owner and
   staff) and `youth_round_published` (to a shared Youth Round's other
   debaters).
9. **Kept apart.** Messages stay Messaging's: their badge and unread email are
   Messaging's, and they never toast. Tab's judge assignments, draws and room
   readiness stay Tab's concepts and adopt this writer and standing when the
   league branch meets main.

## Consequences

- A new kind is one catalogue entry; the exhaustive switches name every place
  it must be read, worded and presented.
- Dropping `notification_emails` drops any job still queued in it; the digest
  owes those notifications only when the next one arrives. A stored
  challenge email choice is deleted, since that channel no longer exists.
- An unsubscribe link in an email sent before this change named one kind and
  no longer verifies: it answers "not valid" and points to Settings. Daisy is
  pre-launch and keeps no compatibility path (ADR 0023).
- A conversation read before this change keeps its stored notification level
  `none`, so it sends no unread-messages email until the member chooses All;
  the stored value cannot tell a default from a choice. Only read state
  written from now on starts at All.
- The unread count is shown on the title, not the favicon: a drawn favicon is
  left for a later change.
- Web push is not decided here; it is a later slice with its own ADR.
- On the Tab parent (main-sync-3), Tab adopts this model (NTF-15). Its six
  kinds (`judge_assigned`, `judge_replaced`, `judge_unassigned`,
  `tournament_draw_changed`, `tournament_room_ready`,
  `tournament_results_released`) are catalogue entries on a `fixture`
  subject (the fixture, its lobby and the applied command), durable and
  in-app only, written by `oweNotifications`. Their standing is Tab's own
  read: Tab's rows sit behind lobby-scoped row security, so Tab reads each
  lobby the member may read now in its own scope, under the ordinary Tab read
  fences, and hands the standing ids to the one standing switch.
