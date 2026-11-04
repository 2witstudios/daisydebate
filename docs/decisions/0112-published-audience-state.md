# 0112: A viewer reads published state, not web

Status: accepted, owner's point guard (DEC-350), 2026-11-03. Amends ADR 0099 and ADR 0108. Page loads amended by ADR 0116.

## Context

Every viewer polled two web routes every 2 s. Web also runs debates, so audience load was
debate load. On the rig, about 670 requests a second, mostly rate-limit refusals, saturated
the process, refused 219 debate reads and failed 28 of 29 floor passes. The audience lane
and per-Round cache protect the database's connections, not the process.

## Decision

Released public state is published like media. `apps/audience-publisher` writes one no-cache
object per Broadcast to the public bucket about once a second: the projected timeline, the audience
snapshot and a pulse rate. The player and the audience panel poll it. The anonymous
`/timeline` and `/audience` reads are gone, with no fallback.

- **Its own app and role.** `apps/audience-publisher` runs on its own small machine, and
  `daisy_audience_publisher` reads released facts. Its only reach into messaging is the view
  `spectator_chat_messages`, so it can read no DM or private group. Which ballots and captions
  are released stays the read's rule, as on web; those tables are narrowed to the columns named. The hold worker still reads no Round and
  holds no Redis (ADR 0099), and neither can slow the other.
- **Key.** SHA3-256 of the feed key and, on an unlisted Round, the current link hash. Replacing
  a link moves the object, so the old link has no address for what follows (ADR 0109). The
  page hands the address out only past admission.
- **Late, never early.** The state comes from the same horizon as before. If publishing stops,
  the object stands still and the tab, on its own clock, reports the Broadcast as interrupted.
- **Lifetime.** The object stays while a viewer may wait for the Recording: 10 minutes after the
  Round is over and its Recording has settled, so they read that final state, and 6 hours past
  the Broadcast's end at most. It then goes, and the row records that. A tab that then reads
  nothing asks the server again, which is also how a replaced link ends an old holder's page.
- **Count.** Tabs pulse web. The state carries a rate that keeps the whole audience near 20
  pulses a second. Each tab draws once and keeps its draw and sends nothing until it knows the
  rate. A restart reads the rate back from the object, and the rate at most doubles per bucket,
  since a falling count may only mean pulses were lost. The publisher scales a count by the
  rate in force while it gathered, and rounds it to two figures.
- **Live room.** Someone in the live room still reads web, signed in, because what they may see
  is their own. That read carries no count, since only the publisher knows the sampling.
- **No Broadcast.** Nothing is published, so the page renders once and offers a plain refresh.

## Consequences

- A viewer's first page load may still reach web and read the database, and so does a sampled
  pulse. ADR 0116 puts a gate and a short cache in front of that.
- A signed-in poster reads their own message from the next published state or a fresh render.
- Chat and usernames sit in a public object under an unguessable key for that lifetime.
- A host no longer sees a live viewer count in the live room.
- An unlisted link replaced while the worker is down leaves the old object until it returns, and
  a restart in that window leaves it standing, frozen. Accepted as an unusual sequence.
