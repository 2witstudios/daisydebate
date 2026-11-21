# 0161: Youth Rounds follow Open's visibility; Youth content is not licensed

Status: accepted (owner decision 89, 2026-11-19, recorded on
[10 — Direction and build order](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/jro30yyuynd11e7qzjfdby0u);
slice yls-youth-like-open, tasks YLS-18 to YLS-26,
[plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/sx084dlo5atipstfk4sbs2jf)).
Replaces [ADR 0150](0150-youth-recordings-private.md) §1, §2 and §4's
"never broadcast", [ADR 0151](0151-media-releases.md) §1's publish scope and
§6 (Share publicly, no profiles or cards), and
[ADR 0157](0157-every-youth-room-round-is-a-youth-round.md) §2's use of one
Youth predicate as a privacy fence. Generalises
[ADR 0155](0155-linked-adults-watch-youth-live.md) and
[ADR 0158](0158-linked-adults-in-one-registered-function.md): linked adults see
through private and unlisted.

## Context

ADRs 0150, 0151 and 0157 made every Youth Round private whatever its Room
said, and a public Youth Round needed every youth debater's media release, a
debater's Share publicly and the `youth-publishing` release flag. The owner
reviewed Youth as a member sees it (decision 89): ranked is the opt-in, as on
chess.com, so ranked Youth is public; casual Youth is up to its host exactly
as Open. The protection a minor needs is not from being watched but from
being reused: Daisy's ranked waiver licensed ownership, clips, likeness and
an open stream-and-earn grant, which a minor cannot give alone.

## Decision

1. **Viewing is Open's, in both lobbies.** Every read decides who may view a
   Round by Open's rules only: the Room's visibility (public, unlisted with
   its current link, private), ranked forced public and recorded for
   everyone, casual by the host's broadcast and recording choices, and a
   casual Round's public audience seeing its video but not its transcript or
   ballots. That covers live Watch and its count and listing, broadcast
   discovery, the spectator timeline and audience (chat, reactions,
   snapshot), watch history, the archive, profiles, member cards, follower
   notices and the Recording's page. `isYouthRound` and `youthRoundSql` stay,
   meaning only "this Round's debaters are minors"; no visibility read asks
   them. `canWatchLive` retires: without a division it was Open's rule, which
   every listed lobby row follows (the Round's own page decides).
2. **The one viewing difference: linked adults see through private.** A youth
   debater's linked coach or parent (`daisy_linked_adult_users`, ADR 0158)
   sees that Round whatever the Room's visibility: live through
   `round.observe.undelayed` without media (ADR 0155, unchanged), and its
   Recording as a seated debater does once it ends, never past an operator's
   stop. Under the officials policy they keep the record but not the video.
   The bypass sits beside the seat and host branches of Open's permissions;
   there is no Youth permission path.
3. **The reuse fence.** A Round's content leaves Daisy (download, Stream this
   Round and its official feed, the ranked content policy's stream-and-earn
   grant) only when it is not fenced. `reuseFenced` in
   `@daisy/protocol/media-release` fences a Youth Round unless every youth
   debater (a person in a current debating seat) holds an active release, and
   fences no other Round; a Youth Round with no youth debater fails closed.
   `youthReuseFencedSql` in `@daisy/db` is its SQL mirror, held to it by an
   integration test over every release standing. Download reads the same SQL fence when deciding whether to offer or issue a
   download; the Watch page reads it beside the shared
   spectator read (the audience publisher's role never reads releases) and
   passes it to the viewer, which hides Stream this Round. If the release
   read fails, the view stays available and the reuse action is withheld. The
   page checks at render: a release withdrawn mid-broadcast takes effect for a
   viewer at their next load, which is acceptable because the feed is the
   one viewers already play. The Watch page still plays the same feed: viewing
   is not reuse.
4. **The release is the reuse licence.** A media release (stored scope
   `publish`, unchanged) now allows Daisy and others to clip, download and
   reuse the minor's Rounds; paid ads stay a separate opt-in. Its wording is
   version `2026-11-v2`. Older wording granted permission to publish and leaves
   the reuse fence in place. A parent or club must accept the displayed reuse
   wording before the write records the new consent and supersedes the older
   release. The earlier consent evidence is retained. The release flow is live
   everywhere: the `youth-publishing` flag retires (kept as retired in `policy/flag-keys.json`).
5. **A Youth waiver.** A ranked Ready by a member under 18, in any Room
   (debater or judge), asks for the Youth ranked content waiver (`youth-draft-1`, `docs/legal/youth-ranked-content-waiver.md`),
   picked by the signer's current age band in `requiredContentWaiver`, and an
   adult judging a Youth Room signs the Open one: ranked Rounds are
   public, watched and kept, and it grants no ownership, clips, likeness or
   streaming licence. A Youth member signs it once per season, so members who
   signed the Open waiver are asked once more. The ranked content policy
   (`draft-4`) carves out Youth rounds without releases.
6. **Takedown stays.** Any youth debater of a Youth Round, or their linked
   adult, may take its Recording down (ADR 0150 §3); a takedown never touches
   the live Round, its result or the rating.
7. **Retired.** `youthPermissions`; `plannedBroadcast`'s Youth null; the
   `endYouthBroadcasts` sweep and the `youth_round_private` stop reason
   (stored stops read as `technical`, still stopped); Share publicly, the
   `youth_round_publications` table and its `youth_round_published` notices
   and preferences (migration `20261121020535_youth_like_open_and_reuse`, proven on
   seeded rows); the Recording page's Private badge and Youth panel; the
   waiting-for-release Round counts.
8. **Kept.** Lobby-bound debater seats (ADR 0156), Youth ladders and seasons
   (ADR 0147), Youth Room chat for its own people (decision 84).

## Consequences

- No flag and no backfill: past Youth Rounds follow their Room's rules from
  deploy, because every predicate is computed. A ranked Youth Round played
  under ADR 0150 becomes public, and a Broadcast the old sweep stopped stays
  stopped.
- A public Youth Round discloses that its debaters are in the Youth lobby
  (compliance.md, Children). Counsel's questions move from "may we publish" to
  "is public, unlicensed viewing under Open's rules acceptable, and is the
  release valid for reuse" (counsel brief vhrvzv5jwqtfj1bzc5ze364h).
- Youth now runs on Open's code: a change to Open's visibility changes Youth
  with it, except the two named differences above.
