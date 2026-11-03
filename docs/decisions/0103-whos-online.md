# 0103: Who's online

Status: accepted (owner, 2026-11-02; [plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/fxua745ix0t7e81oohvp8z5u)).
Supersedes [ADR 0072](0072-friendships-and-presence.md) §7 (who may see presence),
§8 (challenge) and its presence-setting consequence. Builds on
[ADR 0033](0033-presence-and-adjudication.md), [ADR 0043](0043-no-admin-surface-in-participant-app.md),
[ADR 0070](0070-one-active-room-per-user.md), [ADR 0079](0079-signed-internal-operator-api.md) and
[ADR 0089](0089-shared-resource-observation.md).

## Context

The online list is Daisy's network-effect surface: anyone can see who is here
and add or challenge them. ADR 0072 made presence friends-only, challenges
casual Freestyle between friends, and a member's only choice "hide". The owner
ruled that friends-only promise wrong: "this is a game, of course you need to
be able to see who is online."

## Decision

1. **Everyone signed in sees who is online.** `GET /api/online` lists every
   named, current human with a live lease, except the reader, anyone appearing
   offline, and anyone in a blocked pair either way. Friends first, then by
   name, keyset paged. Presence still grants nothing: everything on a row is
   already public on a profile or a ladder.
2. **One status vocabulary.** `MemberStatus` is `online`, `away`, `busy`,
   `room`, `round` or `offline`, and `displayStatus` is its one rule. A member
   chooses `online`, `busy` or `offline` (appear offline), replacing `hidden`.
   Away follows activity. Being in a room or a Round follows
   `room_active_memberships` and shows over a choice, except appearing offline.
   Status is set from the account menu at the foot of the left rail, or at the
   top of More on a phone, from any page.
3. **Live updates are a doorbell over an authorized read, not observed
   content.** Lease writes that change what anyone sees move one Redis revision.
   Each realtime node reads it once a second, also notes `room.changed`,
   `round.phase-changed` and `actor.presence-preference-changed` from its own
   drain, and rings the `online:members` topic at most once a tick. The frame,
   `online_changed`, names nobody, so a ring takes no authority read per
   recipient; a subscribe needs a live participant session. Browsers re-read
   with jitter and a floor of 20ms per person online, between 2s and 30s, which
   holds the fleet near 50 reads a second up to about 1,500 online and about 330
   a second at the 10,000 limit, and on a 30s timer if no ring comes.
   ADR 0089 observation does not fit: a body must disclose identically to every
   permit, and this list differs per viewer by blocks.
4. **Challenge is its own concept**, leaving Friends: table `challenges`,
   `db/challenges`, `features/challenges`, routes under `/api/challenges`.
   Anyone can challenge any available member, ranked or casual, in Freestyle,
   Policy or Value. An offer stands two minutes and creates nothing. Accepting
   opens a room through the one room-create route as the acceptor, unlisted when
   casual and public when ranked, so a human judge can find it and the result
   counts on both records, then names it on the offer, which accepts
   only a room matching its format and mode, and only while the challenger is
   unplaced. A debater seat stays held for each of the two for two minutes
   (`room_seat_holds`): the Room's own fact, so a listed room's seats are theirs
   while they arrive, and it never seats anyone or touches the judge seat. The
   challenger is sent there for those two minutes, once. The inbox
   doorbell `challenge.changed` reaches both members on any page, and the
   challenger follows to the room. No such member, a block, no lease, Busy,
   appearing offline or the other member being placed are one answer, so a status code never
   tells a blocked member someone is online.
5. **A row is name, status and three dots.** Right-click, three dots, long press
   or a click open one menu: the person's card, then Challenge, Add friend,
   Message, Profile, Report and Block. Hover shows the card. Without script the
   dots lead to the profile, which carries every action as a form.
6. **A card shows Freestyle by default.** Policy and Value appear only if that
   member turned them on (`rating_visibility`, in Settings). A rating left off
   reaches neither the card nor its accessible name. Ladders stay public.
7. **Reporting and moderation are their own concepts.** `reports` holds one
   reason and the surface, never a copy of any conversation, one open per
   reporter and subject. Review is in `apps/admin` through new signed operator
   routes, as ADR 0043 and ADR 0079 require. The operator API authorizes through
   four new capabilities, and `moderation.lift` is an operator action apart from
   `report.resolve`. A reviewer dismisses, warns, suspends for a set time or
   bans; `moderation_actions` records it apart from the report, and lifting keeps
   the row. Moderation has its own home (`db/moderation`, `features/moderation`,
   `/api/moderation/notices`, the `/restricted` page): Reports resolves through
   its one named write, a restriction ends offers through a reaction Challenges
   registers, and `daisy_restriction_in_force` is the one SQL rule. A suspension
   or ban in force sets `restricted` on the one account
   producer, so `participantAccess` stops web and realtime at the same check,
   and the account resolves to its own `restricted` Identity state, which goes
   straight to `/restricted` and keeps its withdrawals, Room exits included.
   Closing an account never wipes this: reports about it and its sanctions stay
   through retention, and a report it filed stays with the reporter removed.
   These defaults and the evidence retention of 12 months after a report closes
   are proposed (DEC-298) and go to counsel under COMP-4.

## Consequences

- The online list is visible to every member, which the privacy policy draft now
  says. Publishing it remains counsel's and the owner's sign-off (WHO-2).
- Friend reads carry `otherChosen` and `otherPlacement`; the `friends` feature
  no longer knows challenges. Ending a friendship leaves a challenge alone, and
  a block still ends every challenge between the pair.
- The account functions gain a `restricted` column. A release still selecting
  the old columns ignores it.
- An admin decision keeps no pending-command row: a report closes once, so a
  resend after an unknown outcome answers a refusal rather than repeating it.
- Closing an account clears its email, so a banned member can sign up again with
  the same address and nothing links to the ban. Stopping that means keeping an
  email digest, a new data class; it goes to the point guard and counsel (DEC-298).
- The list stops at `ROSTER_ACTORS_MAX`, 10,000 online. Past that, a new ADR.

## Privacy

Data classes and retention are in [compliance](../operations/compliance.md):
Social graph gains challenges; Private profile gains the chosen status and
rating visibility; Moderation is new. Rings and the revision describe no data
subject.
