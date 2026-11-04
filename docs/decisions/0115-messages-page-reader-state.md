# 0115: The Messages page keeps a reader's own state apart from what members share

Status: accepted (owner, 2026-11-04). Amends
[ADR 0089](0089-shared-resource-observation.md). File sharing is deferred and
not covered here.

## Context

Messages becomes a full-screen page with a persistent conversation list, flat
history and reaction pills. That raises three questions the page cannot answer on
its own: what a live shared body may hold about reactions, how a list in a layout
stays current without refetching the open conversation, and what order and search
the inbox can honestly offer.

## Decision

1. **Reaction counts are shared; own reactions are not.** Observation publishes
   `{ reaction, count }` per live message through
   `daisy_observation_channel_messages`, whose return columns name no reactor. The
   resource kind, version 1 and the `members` partition are unchanged. A removed
   message carries no counts. The window's byte budget counts them, so a page ends
   at a complete message as before, and the 126 KiB window and 128 KiB frame bounds
   hold.
2. **A reader's own state is HTTP-only.** An authorized history read answers
   `viewedHistoryResult`: the shared page plus a `viewer` block holding
   `readSequence`, `firstUnreadSequence` and `ownReactions`. The shared
   `historyResult` is strict and refuses that block, and `own` inside counts. The
   browser holds its own marks as an overlay, seeded by HTTP and updated by its own
   actions. A reaction from the reader's other tab shows as a count at once and as
   their own on the next HTTP read.
3. **The divider is captured when a conversation opens.** The page reads the live
   window, so a snapshot never shrinks what it first drew. If the first unread
   message is older than that window, the page offers a jump to a page beginning at
   it, and marking read does not advance while reading that page.
4. **The list reads for itself.** A layout seeds it, and a ring asks the inbox API,
   never `router.refresh()`, which would rerender the layout and the open
   conversation and spend four reads. Rings coalesce, and a generation fence drops
   answers to an older search.
5. **The inbox orders by recency across pages.** The continuation is a composite
   cursor of activity (to the millisecond a row shows) and channel; invitations lead
   on a fixed instant, because an invitee may learn nothing of a group's activity.
   The cursor shape replaces the channel-id cursor outright (ADR 0023).
6. **Inbox search finds what a row shows.** The scan prefilter is never narrower
   than a row. The answer is rechecked on each final rendered entry, from the
   page's fenced read, so a clipped tail, a concurrent edit or a character-counting
   difference between PostgreSQL and JavaScript cannot return a row that does not
   show the query. Invitations match nothing, a pending request matches its
   introduction, hidden conversations and older history never match, and the
   fenced decision decides every match. A blocked accepted DM stays findable because
   the inbox still shows it (ADR 0061 is unchanged). The query is never logged, and
   it spends the shared read budget.

## Consequences

- A page scan reads each candidate's newest live message, using the channel and
  sequence index, per member's own conversations. A hidden or denied row still
  counts towards a page, so a page may be short while `nextAfter` continues.
- A key can move while paging; the list holds a conversation once and the next ring
  corrects its place.
- A tab open across a release stops applying snapshots until it reloads, since
  Daisy keeps no compat shape before first ship (ADR 0023).
