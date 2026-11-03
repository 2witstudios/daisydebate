# 0109: The unlisted Round's link

Status: accepted, point guard ruling of 2026-11-03 on DEC-302.

## Context

An unlisted Round is reached only by its link. A Round id is a cuid2, which is never
a bearer secret, and the Broadcast bucket is public, so a link check on the page
alone would protect nothing: anyone who could work out an object key could play it.

## Decision

- **The token.** 256 CSPRNG bits, shown once to the host who holds `room.manage` on
  the Round's Room, and stored only as its SHA3-256 hash in `rounds.audience_link_hash`.
  One row holds one hash, so issuing again replaces the link in one statement.
- **One rule.** `audienceAdmits` decides for the timeline, the Round page, Stream this
  Round and every Recording read. A wrong or missing link answers exactly as a missing
  Round. The Round's seats and host read a Recording by who they are, not by a link.
- **A link becomes a cookie.** `/watch/<round>/link?token=…` sets one HttpOnly,
  SameSite=Lax cookie for that Round and moves to the clean Round page. That is the
  one request with the token in a URL. It reads nothing and answers the same for any
  link, so it says nothing about a Round. A cookie also reaches what a query string
  cannot: the relative segment reads of a Recording's HLS, with no script.
- **No cache can serve it.** The snapshot memo is keyed by Round and holds no link;
  admission runs after it, and an unlisted Round's link is never held past its read:
  a request reads it, or joins the read already running, so a crowd costs one read at a
  time and replacing a link refuses the old one on the next read. An unlisted answer is
  `no-store`, so `PUBLIC_SNAPSHOT_CACHE` applies to public Rounds alone and a CDN never
  holds one.
- **The media's name.** Every Broadcast has `broadcasts.feed_key`, 256 CSPRNG bits set
  at open, public or not, and `broadcastLivePrefix` is the one path function. The
  bucket refuses anonymous listing, so the key cannot be found except from an admitted
  read. One rule for every Broadcast means no path depends on visibility.

## Consequences

- Replacing a link stops new reads at once, including the polling of anyone already
  watching, whose page then reads as a missing Round. It cannot recall a feed address
  someone already holds: a Broadcast's key stays fixed for its life, because its objects
  are already published under it. Taking that feed down is a stop, which withdraws it.
- Query strings can reach telemetry: Next records each request's whole URL on its server
  span. `scrubTransaction` removes every query from a transaction before it leaves.
- A viewer holding only the cookie has no link to pass on, so the Recording page offers
  no Copy link on an unlisted Round. The host issues a new one.
