# Support messages

Anyone, signed in or not, can ask for help or send feedback at `/support`
(SUPP-1). It is linked from Help (its header and its closing line) and the
error and not-found pages; More links Help & support. It has no release flag. This page is the
owner's procedure for the messages that arrive. It authorizes no production
data action by itself: every write below is an owner-approved data action.

## Where a message goes

- The form asks for a topic (Something isn't working, A question, Feedback
  or an idea, My account or privacy, A safety concern), the message, an
  optional line naming the page or round, and a reply email. A signed-in
  account's reply email starts as its own address, which they may change.
- Choosing "A safety concern" says that a report about a person, message
  or round belongs in the in-product Report action, which reaches
  moderation with what it is about; the message can still be sent, and it
  does not file a report. "My account or privacy" points to Settings, where
  a member downloads or deletes their own data.
- The message is stored in `support_messages`, one row per message id: a
  resend after a lost answer is stored once and spends no allowance; a
  resend with a field changed is a new message, because a stored message
  never changes (ADR 0018). The signed-in account's id comes from the
  session, never from the form.
- It is emailed to `SUPPORT_NOTIFY_EMAIL`, or, when that is not set, to
  `BETA_NOTIFY_EMAIL`, through the shared mail path (purpose `support`).
  The email carries every field, the sender's username when they were
  signed in, and a "Reply" link that starts a reply to the reply email.
- Both addresses are personal data, so they are deploy secrets, never
  committed. To send support somewhere other than the beta owner address:
  `fly secrets set SUPPORT_NOTIFY_EMAIL=<address> -a <app>` (owner action).
  With neither set, each web process logs `support.mail.unconfigured` once
  at start, messages are still stored, and their email waits queued.
- A send that fails retries with backoff for about two hours and then
  fails for good, logged as `support.mail.failed` and reported; a
  suppressed owner address is reported the same way. The message is kept
  either way.
- Spam: a hidden trap field answers the ordinary confirmation and stores
  nothing; each client address may send 5 an hour and 20 a day, and Daisy
  takes 1,000 a day in all (Redis limiter, fails closed). The client
  address is hashed into the limiter key and never logged.

To read messages whose email did not go, use a read-only session through
`fly proxy`:

```sql
select id, created_at, topic, reply_email, member_user_id, state, last_error_code
from support_messages order by created_at desc limit 50;
```

## Retention and erasure

A message is deleted 365 days after it was sent, emailed or not
(`retention.support_messages`, [compliance](compliance.md)). A signed-in
sender's messages are in their data export and are deleted when their
account is erased. A message sent signed out carries no account, so a
deletion request to the privacy contact is an owner-approved data action:
`delete from support_messages where lower(reply_email) = lower('<address>');`

As with League requests, the database row is not the only copy: the owner
notice in the owner mailbox, the replies, and Resend's copy for its log
window are deleted by hand too ([league requests](league-requests.md)).
