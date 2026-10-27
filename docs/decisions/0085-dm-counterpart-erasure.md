# 0085: Erasing one member of a DM

Status: accepted (privacy design reviewed by astra, APPROVE WITH MINORS,
2026-10-27; ISSUE-644). Implements [DEC-126](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/nenxmi5cjoewx1degq1ysicz).
Amends [ADR 0063](0063-messaging-content-and-privacy-lifecycle.md) for
direct messages; private groups keep 0063's tombstones (ISSUE-734).

## Context

Erasing an account used to scrub the subject's messages in place and delete
the DM pair. With the pair gone the survivor lost the whole conversation,
their own messages included, which is stricter than DEC-126. The scrubbed
rows also kept the subject's author id and timestamps, which are the
subject's data. Survivor replies kept pointers to them.

## Decision

1. **The subject's DM rows are deleted, not tombstoned.** Inside the one
   erasure transaction, under the canonical lock order (account, pair,
   channel), and only after every version advance has succeeded:
   - survivor replies to subject messages lose `reply_to_message_id`;
   - a survivor receipt on a subject message becomes 0063's consumed
     marker (no `message_id`, no `payload_digest`), so a retry never
     re-discloses or reinserts anything;
   - the survivor's read cursor and preferences for the channel go, since a
     retained channel has no unread state and its sequence never surfaces;
   - the subject's files go through file deletion intents;
   - then the subject's rows are deleted, with every reaction on them.
2. **`retained` lifecycle and an explicit grant.** If the survivor still has
   a live message of their own, the channel becomes `lifecycle='retained'`
   and gets one `messaging_retained_authors(channel_id, actor_id)` row for
   them. That row is the only grant: it is written only by erasure and is
   never derived from authorship. The survivor keeps their attached files;
   an upload of theirs still reserved or quarantined goes through a file
   deletion intent, since nothing could finish or expire it without channel
   authority. A survivor with no live message keeps nothing, and the
   channel is deleted with its rows and files.
3. **Retained is refused everywhere else.** `MessagingChannelLifecycle` is
   an exhaustive union in `@daisy/protocol`. `authorize` refuses every
   channel capability on a retained channel. Its DM pair is gone, so no
   channel fact loads for posting, editing, reacting, replying, typing,
   read cursors, file uploads, invitations or a DM re-request, and every
   such write is refused as absent. Realtime subscription and resubscription
   fail the same way, because the subscriber's fact no longer loads.
4. **The survivor's view is HTTP only and owner-bound.**
   `channel.retained.read` lists and reads only rows the survivor authored
   that are not removed. It shows no counterpart, username, membership,
   reactions, receipts, unread state or sequence. A survivor may always use
   `channel.retained.delete`, a withdrawal under ADR 0075, to delete the
   conversation: their rows, their files through intents, and their grant.
   The channel goes once no retained author remains. Anyone else, the erased
   subject included, is refused as absent.
5. **Erasing the survivor** deletes their retained rows, files and grant
   the same way. Erasing both members at once serializes on the pair lock
   and leaves no channel, message, grant, receipt or file.

## Classification and retention

`messaging_retained_authors`:

- `channel_id` is an identifier.
- `actor_id` and `created_at` are personal/private. The purpose is survivor
  access to their own retained messages.
- Lawful basis and retention are those of `messaging_messages` bodies, with
  no exemption from ordinary messaging retention.
- Erasure: delete.

The subject's export is taken before erasure. Afterwards the survivor's
export contains only their own rows and their grant.

## Out of scope

The survivor's own free text may mention the subject. It is the survivor's
personal data, not a derived copy (astra R3).

## Consequences

`packages/db/src/messaging/retained-dm.ts` carries the erasure steps, and
`retained-store.ts` carries the survivor's reads and deletion. Proofs:

- `messaging-retained-dm.integration.ts`, on real PostgreSQL: sanitization,
  owner-only reads, deletion, a survivor with nothing kept, and concurrent
  erasure of both members.
- `retained-channel.test.ts`: every channel capability refuses a retained
  channel.
