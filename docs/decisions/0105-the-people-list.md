# 0105: The people list shows everyone

Status: accepted (owner, 2026-11-02). Supersedes
[ADR 0103](0103-whos-online.md) §1 (who is listed) and amends its §3 (what the
re-read floor counts). ADR 0103 §4 stands: a challenge still needs its target
available now.

## Context

ADR 0103 listed only members holding a live lease, so a quiet site looked empty
and left nobody to reach out to. The owner ruled that the list exists to drive
interaction: it shows everyone, including offline members, so they can be found
and messaged.

## Decision

1. **The list shows every admitted member.** `GET /api/people` lists every named,
   current human who could sign in now, except the reader and anyone in a blocked
   pair either way. A lease says who counts as online and no longer who is
   listed. Admission is ADR 0075's rule, age included: approval alone does not
   stand for it, because the grandfathered cohort was approved with no age check.
   The list reads the rule through one published SQL predicate with the admitted
   bands injected from `@daisy/auth`, so an account with no age record or below
   the floor is not listed. `daisy_web` gains `daisy_age_band` for this; the band
   stays inside the predicate and no age data leaves the read.
2. **Appearing offline reads as offline.** It no longer removes a member from the
   list, because absence from a list of everyone would reveal the setting.
   Nothing in the response or the cursor tells it apart from holding no lease.
3. **Order and sections.** Friends first, then online, then by name, keyset paged.
   The rail sections read Friends, Online and Offline. The Friends tab lists all
   friends.
4. **Counts.** `counts.everyone` and `counts.friends` total the list and are the
   tab numbers. `counts.online` is who is online: it is the heading's number. The re-read floor
   of ADR 0103 §3 scales with that or the rows loaded, whichever is larger, because
   a re-read walks every loaded page.
5. **Offline members can be messaged, not challenged.** Challenges stay live.
   Challenging someone offline waits for a future calendars feature, and until
   then the menu offers no Challenge on an offline row.
6. **No added limit on paging the list.** It is members-only and a row holds only
   what a profile or a ladder already shows. The read keeps its 240 per minute,
   and messages, friend requests and challenges keep their own budgets.

7. **The name is the people list.** A list that holds offline members is not an
   online list, so it reads `Person`, `PeopleList`, `readPeopleList`,
   `/api/people`, `social.people.list` and `ui/people/`. A report made from it
   names the `people` surface. "Online" stays only for real presence: leases,
   `counts.online`, `isOnline`, `ONLINE_TOPIC` and `online_changed`. ADR 0103 and
   earlier records keep the names they were written with.

## Consequences

- A member can page through every username far faster than DEC-251's lookup
  budget of 600 an hour. That budget still governs resolving a name to an actor
  for an action. This is recorded as a decision on the owner's behalf.
- Being listed no longer depends on having been active, which the privacy policy
  draft now says. Publishing it remains counsel's and the owner's sign-off
  (WHO-2, COMP-4).
- A list of everyone makes absence meaningful. A public profile whose name finds
  no one in the list tells a member that this person blocked them or is
  restricted, without trying anything, and §2 rejects absence for appearing
  offline for the same reason. ISSUE-1119 requires delisting, so they stay
  delisted. This is recorded as a decision on the owner's behalf, who can overrule
  it.
- Each read counts and sorts all members, not only those online. That is fine at
  pre-ship size and needs measuring before real scale. `ONLINE_LEASES_MAX` bounds
  only the lease scan.

## Privacy

No new data class, purpose, processor or retention period. The disclosure widens:
see [compliance](../operations/compliance.md).
