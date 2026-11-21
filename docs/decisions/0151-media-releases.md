# 0151: Media releases for Youth Rounds

Status: accepted (owner decisions 79 and 81, 2026-11-18; slice PYL S4 media
releases, tasks PYL-6 and PYL-7, decisions recorded as S4 decisions in the
[epic plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dvjf9nlzrhaojb2vw4n5ufrw)).
Builds on [ADR 0150](0150-youth-recordings-private.md), which keeps a Youth
Round's Recording private until every youth debater holds a media release.
Amended by [ADR 0161](0161-youth-rounds-follow-open-visibility.md): a release is now the reuse licence (clip, download, reuse); Share publicly, `youth_round_publications` and the `youth-publishing` flag retire (§1's publish meaning and §6).

## Context

A minor's Youth Rounds are recorded but private (ADR 0150). Owner decision 79
lets them be published once every youth debater holds a parent-signed or
club-confirmed media release. Decision 81 merges the code before counsel
answers and keeps publishing closed in production until counsel approves the
release wording (PYL-8).

## Decision

1. **A release is a durable, revocable record.** `media_releases` holds one
   row per scope for one minor: `publish` (publish Rounds and make clips) or
   `paid_ads` (a separate opt-in, never without an active `publish`). Each
   row records who gave it, under which wording version, when it was signed,
   and when and by whom it was withdrawn (`parent`, `club` or `erasure`). A
   unique partial index holds one active release per minor per scope. A
   parent's signature (name, relation, the address signed from) is on the
   row. A club's attestation is its own organisation-owned row,
   `media_release_club_attestations`, under row-level security like the club
   tables, and readable by the minor it names.
2. **The rules are pure and live once.** `@daisy/protocol/media-release`
   holds the vocabulary and every rule: a request's standing
   (`open → signed | declined | not_me | cancelled | superseded | expired`,
   with expiry 14 days after it was made), a minor's standing (none, waiting,
   on file, or withdrawn by a parent), the minor's ask, resend and cancel, a
   link's verdict, the parent's signature, withdrawal and paid-ads change, the
   club's confirmation, and `everyDebaterReleased`, which
   `youthRoundPublishable` and the publish command both use. Commands in
   `packages/db` load their facts under the minor's account lock, ask these
   rules, and write what they decided, with notices and mail, in one
   transaction.
3. **A parent signs without an account, through single-use links** (ADR
   0019). A link is 32 CSPRNG bytes, base64url; only its purpose-prefixed
   SHA3-256 digest is stored (`media_release_links`), so a sign token can
   never act as a manage token. The token rides the query string; GET only
   renders (referrer policy `same-origin`, not indexed); every change is a
   same-origin POST carrying the token in its body. A link is minted when its
   email is sent, in the mail worker, and stored before the provider is
   called, so a retried send never kills a link already delivered. A request
   may hold several sign links (the request, its one reminder 3 days later, a
   resend); all die when it ends. A manage link (in the signed copy) is single
   use and lasts 30 days; a paid-ads change mails a fresh one. A used sign
   link, or `/release/manage` with the signer's address, mails a new manage
   link, with the same answer whether or not a release was found.
   A signed-in adult with a confirmed guardian link ([ADR 0163](0163-guardian-links-and-consent-evidence.md))
   can also sign in Parental controls › More. The same attestation, scope
   decision and durable signature use the guardian's verified account address.
   The signed delivery record supports the existing copy and withdrawal link.
   This path issues no request email or sign token.
4. **Mail.** `media_release_mails` is the parent's mail job table (the
   request, the reminder, the signed copy, a manage link), sent through the
   one suppression-honouring path under the transport purpose
   `media-release`. "Don't send me release requests" stores the address's
   keyed recipient hash in `media_release_stops`; a later request to it is
   refused with that reason. The opt-out works whatever the flag says.
5. **A club confirms releases it holds.** A club's owner, or for a school a
   member holding a live grant whose role carries `school.roster.manage`,
   confirms releases for active members on Youth – Freestyle, with the
   warranty, a paid-ads yes or no, and their name and role. A selection is
   confirmed whole or not at all. A student whose last release a parent
   withdrew is refused: only the parent can sign again. A confirmation
   supersedes the student's open parent request. "Ask my club" records an ask
   (`media_release_club_asks`, exempt from the tenant manifest: it holds no
   release and is read only by its recipients' inboxes) and tells the club's
   owner and staff, at most once a week per club.
6. **Publishing is a debater's choice.** Share publicly on a Youth
   Recording is offered to its debaters once every youth debater holds an
   active publish release and the flag is open; the command rechecks the
   releases under lock and records a `youth_round_publications` row. A
   withdrawal ends, in its own transaction, every publication of a Round the
   minor debated. A Youth Recording is public only while its publication
   stands and the flag is open: its page admits anyone
   (`roundEvidencePermissions`), and the public archive and its count list it
   (the reads take the flag as a parameter). It is still never live, never
   downloadable and never given a share link, and it stays off public
   profiles and member cards.
7. **One counsel gate.** The whole flow (the minor's Settings section, the
   parent's pages, the club's pages, Share publicly) sits behind the
   existing `youth-publishing` release flag: off in production until counsel
   approves the wording (PYL-8), on in staging (decision 77). The [COUNSEL]
   wording ships as drafted behind it. The wording version shown and
   recorded is `2026-11-v1`.
8. **Pages name a ladder, never an age** (compliance, Children): the boards'
   "16" and "17" read as Youth – Freestyle, and the minor is named by
   username.

## Consequences

- The release record outlives the request: a request and its links and mail
  are deleted 30 days after it ends or lapses (a signed one stays while a
  release it produced is active, since the parent's manage links hang from
  it); a withdrawn release is kept three years as consent evidence.
- Seven notification kinds join the catalogue (ADR 0144).
- The coach view lists the club's Youth students, not tournaments: tournament
  divisions arrive with the host tiers slice (PR 796), and Youth events admit
  no minors until the guardian gate opens.
- Not built here, and filed: a parent's email when a Round is first made
  public, publishing to profiles and member cards, a downloadable PDF copy of
  the release, withdrawing a club's confirmation from Daisy, and the
  tournament grouping of the coach view.
