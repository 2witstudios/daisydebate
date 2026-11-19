# 0150: A Youth Round's Recording is private

Status: accepted (owner decisions 79 and 81, 2026-11-18; slice PYL S3 youth
recordings, task PYL-5, decisions recorded in the
[epic plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dvjf9nlzrhaojb2vw4n5ufrw)).
Amends [ADR 0107](0107-recording-and-retention.md): a ranked Recording is
public and kept, except a Youth Round's.
Amended by [ADR 0151](0151-media-releases.md): media releases and sharing a
Youth Recording publicly. Amended by [ADR 0155](0155-linked-adults-watch-youth-live.md):
§4's "never live" admits each youth debater's linked adults to the live
Round without media.

## Context

Ranked Rounds are recorded, published and licensed to Daisy
([ADR 0147](0147-ladder-style-and-division.md)). A minor cannot agree to that
alone. Owner decision 79 records Youth Rounds like any ranked Round but keeps
them private until every youth debater holds a parent-signed or
club-confirmed media release. Decision 81 lets that code merge before counsel
answers, with publishing closed in production by a release flag.

## Decision

1. **What a Youth Round is.** A ranked Round on division `youth`
   (`rounds.ladder_division`, frozen at Start). Casual Rounds keep ADR 0107's
   host opt-in rules.
2. **Who may see it.** One pure rule, `recordingAudience(round, viewer)` in
   `features/recording/youth-audience.ts`, answers `allowed` (as debater,
   judge or linked adult) or `denied` (`signed_out`, `not_in_audience`). The
   audience is:
   - the Round's seated people, its debaters and judges;
   - each youth debater's linked adults: the owner of a school the debater
     is an active member of; an adult who is an active member of that school
     and holds a live organisation grant whose role carries
     `school.roster.manage`; and an adult with an active guardian link to the
     debater.

   The audience sees the video, transcript and result once the Round ends.
   Anyone else, including a host who did not sit and anyone with a link, gets
   the same answer as for a missing Round. The Room's visibility does not
   apply.

3. **How linked adults are read.** `readYouthRecordingPeople` reads the
   debater's own memberships and guardian links under the subject scope, and
   each school's staff under that school's scope, as the web role, so
   row-level security fences each read. It runs in its own transaction and
   restores any scope its caller set. Playback authorizes every media segment,
   so the web reuses one read per Round for 15 seconds (`youthPeopleCache`). A
   revoked grant or an ended link therefore stops admitting within about 15
   seconds. The takedown command never uses that cache: it reads the links
   fresh, because it deletes for everyone.
   Guardian links have no runtime write path yet (counsel-gated). Until one
   opens, the parent case admits nobody in production.
4. **Never on Watch, never live.** `plannedBroadcast` plans no Broadcast for a
   Youth Round, so its Recording runs its own Egress (ADR 0107, two capture
   paths) and no audience feed exists. At rollout, the broadcast sweep stops
   any Broadcast a Youth Round had already opened, running or complete, holds
   its video back (`youth_round_private`) and asks for a complete one's feed to
   go. The capture sweep keeps following that Broadcast, so no Round is
   captured twice. The trade-off: a Youth Round live across the deploy is
   recorded only up to the stop. Ending public exposure at once outweighs the
   rest of one Round's video, and Youth Rounds exist only since PR 792. As a second fence, these SQL reads leave Youth Rounds out:
   - the broadcast discovery;
   - the Live listing and its count, and a Room's link to Watch;
   - the spectator timeline (`/watch/<id>`, which answers as missing);
   - the public archive;
   - a public profile's list and record, and member cards' counts;
   - the follower notice that a Recording is ready (its seats are still told).

   A debater's own archive list and profile still hold their Youth Rounds,
   badged private.

5. **No download, no share link.** `mayDownload` refuses every Youth
   Recording (the board is stricter than "debater only"). The page offers no
   link to copy. Ranked Rooms are public, so no audience link can be issued
   for one.
6. **Takedown.** Any youth debater of the Round, or one of their linked
   adults, may take the whole Recording down for everyone through the
   participant removal path. The Recording itself says it is a Youth one: its
   eligibility is `{ kind: 'ranked', youth: true }`, fixed when it is requested
   from the Round's division. The lifecycle lifts `ranked_is_kept` only for such
   a Recording, so no caller can lift it. An open report still holds the
   Recording as evidence, as for casual removal. Unlike casual, a Youth
   Recording that moderation already took down can still be asked for: the
   removal is recorded as owed and paid when the report closes, so a restore
   cannot bring it back against the request. A judge may not take it down,
   even one who is also a debater's linked adult. A Youth Recording requested
   before this shipped carries no `youth` fact (eligibility cannot change in
   place); only moderation can take one of those down. Such Recordings exist
   only on staging, from Rounds played since PR 792.
7. **Publishing.** `youthRoundPublishable(people, releases)` is true only
   when every youth debater holds an active media release. S4 records
   releases. Until then the read returns none, so it is false. Publishing also
   needs the `youth-publishing` release flag (PYL-8): off in production until
   counsel approves the release wording, on in staging (decision 77). The page
   shows Share publicly disabled, with each debater's release state. The
   publish action arrives with S4.

## Consequences

- A Youth Recording is kept like any ranked Recording (decision 81: kept
  forever, with takedown), but only its audience can reach it.
- Every Recording read (history, playback, download) calls
  `roundEvidencePermissions`, which checks the youth rule first, and serves
  only what the answer permits. A new read must do the same; nothing enforces
  it for a read that skips the call. The takedown command has its own rule,
  `mayRequestRemoval`, and the lifecycle's `ranked_is_kept` guard sits
  behind it.
- S4 replaces the empty media-release read and wires the publish action. It
  changes neither rule.
