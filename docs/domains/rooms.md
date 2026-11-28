# Rooms and Rounds

Owner: domain engineers. This page describes the product lifecycle: where
people gather, how a contest is played and ended, how it is judged, and how
pages stay current. The runtime rules behind it are in [engine.md](engine.md);
the decisions are [ADR 0049](../decisions/0049-room-debate-turn.md) (accepted
with its amendments, DEC-217), [ADR 0058](../decisions/0058-one-round-model.md),
[ADR 0066](../decisions/0066-room-state-sync.md) and
[ADR 0067](../decisions/0067-playable-round-policy-and-acceptance.md).

## Nouns

| Noun        | What it is                                                                                 | Durability                         |
| ----------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| **Room**    | A gathering: host, seats, judges, title, topic, visibility and the pinned format and rules | PostgreSQL                         |
| **Round**   | One contest under frozen rules: seats, segments, transcript, ballots, outcome, ratings     | PostgreSQL, the competitive truth  |
| **Segment** | One speech or exchange inside a Round, with its speaking intervals                         | PostgreSQL rows (`round_segments`) |

UI copy may say "match"; the stored noun is the Round. "Lobby" is the public
browsing surface of open Rooms. A LiveKit room is a media session
(`media_sessions`), never a Daisy Room.

"Topic" has three distinct meanings, and the code keeps them apart (ISSUE-404):

- **A Room's or Round's `topic`** is the proposition being debated. The
  Formats slice owns renaming it to "resolution" on the contracts.
- **An onboarding interest category** (`InterestCategory`,
  `interestCategoryChoices`) is a subject a member says they like debating.
  Its partner, the format the member prefers, is `FormatPreference`, never a
  Round's `FormatDefinition`.
- **A realtime topic** is a routing address for doorbells, never debate
  content.

No shared "Topic" entity spans them.

Three words about watching each keep one meaning (WATCH-10):

- **Viewer** is whoever a read is for, the requester: `viewerActorId`,
  `viewerIsHost`, `WatchViewer`. A viewer may be a debater, a judge, a spectator
  or a visitor with no account.
- **Spectator** is one person watching a Round without a seat in it. Spectators
  are never `round_participants`. A count of people watching counts spectators;
  `SpectatorKind` says why a viewer is one.
- **Audience** is the group something is released to, such as the audience of a
  Broadcast or a transcript's audience policy. It is never one person.

An operator signature's `audience` is the HTTP signing term for the service it
is bound to, unrelated to watching.

"Ranked" is the competition type; "rated" says only that a rating was written,
as in `kind: 'rated'`, `lastRatedAt` or a Highest rated sort, and "Unrated" only
that a member or a tournament has no rating.

## Formats

A Room runs Freestyle, Daisy's one standard, which strikes its resolution,
or Custom (ADR 0142). Every edit to Freestyle's times or rules makes the Room
Custom, "based on" Freestyle, with the changes listed and a Back to standard
action that restores the exact preset it started from.
Custom can also start from a league template (NSDA Lincoln-Douglas, NDT
policy, Public Forum and others) whose rules Daisy runs faithfully; a template
always reads as Custom. IPDA and Team IPDA templates strike their
resolution the way the IPDA bylaws do. Daisy's own casual templates
(TAB-6.18) seat what one debater a side cannot: a three-judge panel decided
by majority, four teams ranked by the judge, a six-speaker section ranked by
speaker, and an open conversation of two with both microphones open and
nothing judged. None is ever rankable. Choosing a format that strikes its
resolution clears the topic. League-template and Custom rooms may author a
resolution. Standing is derived from the Room and its basis, never
stored. Templates set structure only, never judging (DEC-243). Ranked Rooms
run their format unchanged. See ADR 0078.

## Visibility

**Rooms are public by default, everywhere, always** (owner, 2026-11-10). A
public Room is listed in the lobby. Unlisted (anyone with the link) and private
(by invite, not offered until ISSUE-443) exist only as explicit casual choices
the host makes. No surface ever defaults a Room to unlisted: the create
editor opens on public, and every list of choices puts public first. A Room
opened for someone, such as an accepted challenge, is public too. Ranked Rooms
are always public, enforced by the create contract and the
`rooms_ranked_public_check` constraint.

The default, the ordered choices and their words have one home,
`apps/web/src/features/rooms/room-visibility.ts`. A surface that has to pick a
visibility nobody chose, such as the create editor, a practice Room or a casual
challenge, reads `defaultRoomVisibility` and never spells out a value of its
own. The ranked lock is the one exception: code that makes a ranked Room
public writes `'public'` because it enforces the lock, not a default. The
create contract keeps `visibility` required, so the wire always carries an
explicit value. Tests pin the default, the order, the create editor, the
details form, the practice Room and the challenge room, so a regression fails
CI.

## Assembly and Launch

An unlisted Room's reusable URL can be shared before its recipient has an
account. Sign-in, email confirmation and onboarding carry that Room as the
validated local `next` destination. Sign-up remains required; during closed
beta, an unapproved account waits on the beta page with the same destination.
The link grants neither beta approval nor a seat. This continuation lasts for
the sign-up journey; later beta approval emails use their normal destination.

A host creates a Room from the catalog or a custom definition. Members take
debater or judge seats; the host may seat bots. A host assign replaces the
seat's occupant outright, person or bot, in one command (ADR 0121); removing
to empty is the separate remove command. Changing settings or seats clears
every Ready consent, so nobody plays under rules they did not see.

Debaters sit in **teams** (ADR 0145). A Room seat's role is its team's
placement: team 1 in the affirmative seats, team 2 in the negative ones, and the
Room says which side team 1 argues, or `?` for a coin flip. A debater may set
their own team and position to `?` as well. Start round resolves every `?` in
one public draw, frozen on the Round as its seat draw and shown first in the
opening. Ranked Rooms always flip; a Tab cast and teams of different sizes keep
fixed sides. Teams exist only in a format that seats the two-sided preset's
sides and no unsided speakers (TAB-6.2): a team's placement is its side seat,
and any other format's seats are its sides, with no `?` and no coin. A Tab
event Room (no host person) takes its sides from the published draw: it is
created with fixed sides, the engine refuses `set-seat` and `set-sides` there,
and its roster says the organiser seated it and offers no seat changes.
Consent lives in expiring Redis behind a durable revision fence.

A host can also **invite** a member by username, as a debater (either side) or
as the judge (ADR 0124). The invitation holds a seat of that kind for them, so
in a listed Room nobody else can take the judge seat first; it ends when they
take a seat of that kind (accepted), decline, the host withdraws it, 24 hours
pass, or the Room starts or closes. The invitee is told in the app and, unless
they turned it off, by email. Holds are per seat kind: a challenge's arrival
hold is a debater hold (ADR 0103). Only existing members can be invited; an
address with no account is preapproved by the owner first.

Start round is one atomic operation. When every required seat is filled and
every human is Ready, the host's click freezes the seats and rules into one
Round, in its **opening** when it has a strike or prep to run, otherwise
**active**. A Room has exactly one Round (ADR 0067). Everything after that runs
on its own (ADR 0104).

## One active Room

A user holds a seat in at most one active Room at a time (ADR 0070,
TAB-6). A Room is active while it assembles or its Round is opening or
active; the database holds one `active_seats` row per seated human, keyed by
actor, so a second seat is refused as `active-room` and the UI returns the
user to their current Room. A host who holds no seat is not held, and bots
hold no row. Every terminal state frees its members:

- **Close.** The host's explicit Close closes an open Room. Hosting is
  independent of seating: a host who leaves their seat (or never took one)
  still hosts, and stays a member, through the live Round.
- **Restriction.** A suspension or ban frees the member's seats in every open
  Room and it stays open for the others (DEC-331). A restricted host passes the
  Room to the first eligible human still seated, debaters by side and slot and
  then judges, who gets the whole idle time to act. A host-written resolution
  list is that member's own text and does not pass: the draw reads the bank. With
  none left the Room closes. No human judge is named to an heir, in the Room
  or the Round they start (`host_inherited`, frozen on the Round), nor to a host
  who holds a seat, because a seat gains nothing from hosting (WATCH-6). A seated
  judge answers `assign-seat` from either as a member not in the Room does. So
  neither can remove or replace a human judge; closing the Room is their answer
  to a stuck judge seat. A closed Room's
  status is `closed` (ISSUE-770); `abandoned` belongs to a Round alone. A started
  Room also reads `closed` to anyone outside it, with no drawn resolution, so the
  Room read never says a Round began before the spectator timeline does (WATCH-6).
- **Idle expiry.** With `ROOM_POLICY.idleTimeoutMs` set, the Room maintenance
  sweep (its own worker, apart from Round maintenance) closes an open Room
  with no accepted command for that long, by database time.
- **Leave.** A guest leaving their seat frees only themselves. Leaving a live
  Round forfeits it, which ends the Round, until the last speech ends. After
  that the debate is over: leaving forfeits nothing, the engine refuses a
  forfeit, and the Round waits for its ballot.
- **The debate ends**: the last speech ends, or the Round completes, is
  forfeited or is abandoned. Judges ballot from their Round seats.

## Choosing the resolution

Creation offers Strike and Custom. Freestyle always strikes; only Custom
asks for host-authored wording. Strike exposes no custom draw settings in
creation. See [ADR 0092](../decisions/0092-room-creation-resolution-selection.md)
as amended by [ADR 0142](../decisions/0142-freestyle-the-one-standard-and-ladder.md).

A Room either names its resolution (its topic) or a Round draws one in its
opening ([ADR 0104](../decisions/0104-round-owns-its-opening.md)). Start round
draws N resolutions from Daisy's curated bank, or from the host's own list in a
casual Room. The debaters strike alternately, Negative first in Freestyle, each
strike within its window; a missed turn strikes the first resolution still in
the draw, and a side of only bots strikes on its own. The last one left becomes
the Round's resolution, and any pre-round prep starts at that moment. Until then
only the seated debaters see the drawn texts; judges, spectators and the Lobby
see progress.

## Playing

A Round leaves its opening at the instant its last step ended, by the sweep, a
command or the strike that finished it, never at the processing time. Pre-round
prep always runs its full length, with every mic and camera closed and the
countdown following at once. From then on, the runtime moves through the rules'
segments and in-round prep under the database clock.
Only the scheduled speaker ends a speech early. Cross-examination keeps every
seated debater's microphone open for the whole segment (ADR 0096); its asker may
end it early, and so may a person answering a bot asker, and no time returns to
prep. Either partner on a side may call prep during the segment before their
speech; it starts the moment that segment ends (ADR 0936). Humans, bots and
services all act through the one shared command operation; people reach it
through the Round command route.

The Round's room page sends each member to their own view: a debater to the
live room, the assigned judge to the judge view, and a seatless host to the
spectator view, a read-only projection of the Round (who holds the floor, the
clock and the speech order) with no controls and no media. That read is undelayed:
a seatless host acts as an event host (`round.observe.undelayed`, ADR 0099), on
any Round, ranked included. A seated host gains nothing from hosting. On a Youth
Round the same view, labelled "Watching", opens to each youth debater's linked
adults, whatever the Room's visibility, who also read the transcript and read the floor chat without posting
(`liveAudience`, ADR 0155); they reach it from the student's Room or Round link
and from Watch's "Your students, live". The spectator view is the seed of
spectating: `SpectatorKind` names why a viewer watches (`host`,
`linked-adult`), and later kinds join that union without a second view. Everyone else gets the Round's public page.

Unranked Custom rules can take points of information (POI, ADR 0936). During
a one-speaker speech, outside its protected start and end, a debater of another
side offers; the speaker accepts one offer or declines. While a point is given
both the speaker's and the holder's microphones are live, and the floor returns
when either ends it or its limit runs out. Offers lapse unanswered. Bots never
offer, and no one offers to a bot speaker. Ranked presets take none.

Media is a scoped LiveKit session. The capture worker turns each person's
published audio into the transcript. A bot's transcript is authored from its
own words as it speaks them, never recovered by speech-to-text, and its voice
is still published into the same session, so people, recording and broadcast
hear it ([ADR 0122](../decisions/0122-authored-bot-speech.md)). No bot text is
credited past its segment's end, and a cut-off line keeps only the words that
played. When the final
segment ends and the admission cutoff passes, round maintenance freezes the
transcript once. The freeze is immutable, and it is recorded as complete or
incomplete.

## How a Round ends

A Round reaches one terminal state, and only once:

- **Judged.** The judges' ballots decide the outcome.
- **Unjudged.** A Round with no judges completes at the freeze. A judged
  Round whose judges have not all ruled completes at its persisted ballot
  deadline, by default 30 minutes after the freeze (DEC-201, DEC-207). The
  submitted ballots decide; with none, or with a tie, there is no outcome.
- **Forfeit or abandoned by attendance.** A missing speaker against a present
  opponent forfeits. Both missing abandons. A bot worker's loss abandons and
  never forfeits (ADR 0067). Media, capture or speech-to-text failure is
  never evidence of absence.
- **Forfeit by command.** A debater can forfeit from Start round until the last
  speech ends. In the opening it stands as a result, and before a reveal the
  Round has no resolution.

There is no winner, draw, forfeit or rating for an absent ruling. Ratings
apply only to ranked Rounds; ranked play is out of this goal's scope
(DEC-204).

## The post-round call

A casual host can tick "Post-round feedback" when creating the Room
([ADR 0127](../decisions/0127-post-round-call.md)); a ranked Room cannot have
it. The choice freezes onto the Round at Start round, unless the Round has
fewer than two human seats, and every seat is told before Ready.

When such a Round completes, its call stays open for the people in it: the
debaters and any human judge, who is now seen and heard and shown as "Judge",
never by name. It is never transcribed, recorded or broadcast. The Round's own
vendor room is deleted and proven gone first; only then does the media session
take a fresh room, which only human seats can join. The call ends 30 minutes
after the Round completed, or once its room has stood empty for a minute. An
abandoned Round has no call.

The call is a phase of the Round's media session (`mediaPhase` in
`packages/debate-engine/src/media-window.ts`), not a Round stage: the Round's
terminal status is unchanged.

## Judging

Human judges submit the shared rubric ballot against the frozen transcript
revision, through native or enhanced forms. AI judges are real shared-rubric
judges, never placeholders or random rulings. When the transcript freezes,
round maintenance queues one durable judging job per eligible AI judge. A
leased server worker then calls the model and commits through the same
ballot operation.

Seating an AI judge is free on a ranked Round and premium on a casual one
(WATCH-16). On casual, the assign-seat and create commands refuse the seat with
`ai-judge-premium` unless the host holds their own `casual_ai_judge` grant, read
under the host's account fence, and Launch rechecks it. Beta approval writes
the grant until billing exists, and `PREMIUM_BETA_GRANT` says whether a
beta-sourced grant counts. A host without it is offered a person, Train's
practice Rounds included. The gate is on seating only: a ballot that exists is
read the same with or without premium.

A casual host can opt a Room into a Broadcast, with its release choice, and a
Recording, as two separate choices (WATCH-8). The `set-capture` command refuses
with `capture-premium` unless the host holds their own `casual_capture` grant,
read under the host's account fence, and Launch rechecks it, so a host who lost
the grant captures nothing. Beta approval writes the grant until billing exists.
It is separate from `casual_ai_judge`. A private Room can record but not
broadcast. A change asks every seat to Ready again, and each seat is told the
opted-in notice and the exact choice before Ready. Launch freezes the choice on
the Round. A casual create that chose a recording shows its host the same notice
and records it with the Room. A Ready or a create that states a notice the Room
does not show is refused with `capture-notice-changed`. A signature keeps the
exact words, so a superseded notice stays readable.

Ranked needs no grant and holds no choice: it is always captured. A ranked Room
has no capture notice, at create or before Ready, and records none: the ranked
content waiver, signed once per season, is the ranked agreement, and it alone
fences a ranked Ready (`content-waiver-required`, or `ranked-unavailable` with
no season open).

A Room belongs to the lobby it was created in. In a standing lobby,
`mayDebate` applies the lobby's age rule to the member's competition age band and any permission
from an active guardian link for that exact lobby
([ADR 0162](../decisions/0162-daisy-is-a-league-open-and-youth-are-lobbies.md)).
Members can create in an eligible lobby, club staff can also host in an
under-18 lobby, and a challenge opens a Room in the pair's lobby. The member's
age band still uses the stored birth month and the existing season anchor
and carry rules ([ADR 0147](../decisions/0147-ladder-style-and-division.md) §3).

- **Debater seats.** Claiming or assigning a debater seat uses the Room's
  age rule. A minor can claim an adult lobby’s debater seat after their guardian
  signs that lobby’s ranked content waiver. A member without an age record may debate casually in an adults
  or anyone lobby. A bot debates only casually, and only for a host with
  the `bot-debates` release ([ADR 0921](../decisions/0921-bot-debates-release.md)):
  create, rematch and assign-seat refuse a bot debater with
  `bot-debates-coming-soon`, cast choices offer none, and the start-round
  freeze rechecks the release on the charged host's account inside the
  transaction that reserves the bot allowance, whatever entitlement the host
  holds. A Round already running is never stopped by it.
- **Judges.** Judge seats take anyone: minors judge Open Rooms, adults Youth.
- **Start.** Start checks seated debaters again. A ranked Round uses the
  existing rating and season keys, and Start answers `ranked-unavailable`
  when there is no active season for the required ladder.
- **Watching** ([ADR 0161](../decisions/0161-youth-rounds-follow-open-visibility.md)).
  A Youth Room's Round is watched, listed, broadcast and recorded exactly as
  an Open Room's: ranked is public, casual follows the Room's visibility and
  its host's broadcast and recording choices. The one difference: each youth
  debater's linked coach or parent sees through an unlisted or private Room,
  live (the "Watching" view above) and its Recording. A Youth Round's content
  is reused (download, Stream this Round) only once every youth debater holds
  a media release (`reuseFenced`, `youthReuseFencedSql`). A guardian signs
  the adult lobby's ranked waiver when that lobby's season age carries the
  debater as youth. A member signing personally uses their current age to
  select the waiver, including a judge under 18 who signs the Youth waiver.

Round writers keep their own eligibility, so a running Round is never changed
by any of this. See [compliance](../operations/compliance.md#children).

A seated human judge reads their own ballot, and once the Round has completed,
every ballot of it. Only the Round's seats and its seatless host read a Round at
all (ADR 0099), and a Youth Round's linked adults watch it (ADR 0155) without
reading any ballot. Anyone else reads no ballot here: signing in opens nothing. The
audience of a ranked Round gets the winner, scores and reason on the spectator
timeline, once the Broadcast's watermark has passed them, and never a side's
feedback; a casual Round's audience gets no ballot.

ADR 0110 refines DEC-208: an incomplete freeze may dispatch AI judging only
when the measured unheard share is within the judging limit, with gaps stated.
Unknown loss is never assumed small. An unsupported freeze queues no AI job;
with no human judge it has no outcome and reads "Transcript incomplete".
Under DEC-370 and ADR 0119, a dispatched AI job's finite provider window can
pause into durable recovery without completing the Round. Validated replies
survive deadlines and takeover; finite automatic spending exhaustion is visible
as recovery needing attention, never an invented ruling.
Human judges still rule. On an unsupported freeze with no dispatched AI job,
completed human rulings can finish the Round and the receipt records the AI seats
that gave no ruling. A dispatched AI judge remains part of the shared panel:
generating, held-ballot, recovering and blocked obligations still hold completion,
including on a judgeable incomplete freeze. Human rulings do not discard that
recoverable seated judgment or reopen a later decided result.

## Another match

A started Room is never reopened. After its Round completes or is abandoned,
the host can open a fresh-Room form. That creates a new Room with empty seats
and no consent, and the source Room and Round stay unchanged (ADR 0067).

## Staying current

Room and Round pages sync as resources, not routes (ADR 0066). Every accepted
change rings a thin doorbell on the resource's realtime topic. The page's
sync driver then rereads the resource, and resyncs on refusal, on reconnect
and when the tab becomes visible. Doorbells carry no delivery guarantee, so
the driver also polls: every 30 seconds while realtime is connected, and every
5 seconds without a connection or while stale. A hydrated command adopts the
server's answer instead of navigating.

Room persistence has one command path: `createRoomCommand` and
`executeRoomCommand` atomically persist the engine's member set with every
accepted Room mutation. Seating and Start round use that path; there is
no separate low-level seat or freeze writer.

## Lobby discovery and eligibility

A Room belongs to one lobby for its lifetime. The Lobby and Watch switches
list open standing lobbies owned by official leagues. A member's initial
lobby follows their competition age band. Search, page anchors, and results
use the selected lobby id. Visibility and link access still use the Room or
Round's own audience policy.

A challenge binds both parties and its acceptance Room to one lobby.
Linked-adult and recording protections follow the Room's lobby classification.
In an anyone lobby, they apply to minors in debating seats. Historical
tournament Rooms keep their recorded youth privacy classification. Watch's
public listing stays in the selected standing lobby. An authorized guardian
or coach can still reach their student's live tournament Round from Students
live. Missing age evidence in an anyone lobby keeps reuse fenced even after
erasure, without granting additional access to the Round.
Tournament entries and the stored rating and season keys continue to follow
their existing contracts while those areas migrate
([ADR 0162](../decisions/0162-daisy-is-a-league-open-and-youth-are-lobbies.md)).

### Ordering

The discovery query accepts `sort=newest` (also the omitted default) or
`sort=longest-waiting`. Both use the Room's immutable `(created_at, id)`
tuple, descending for newest and ascending for longest waiting. The id
uses PostgreSQL's C collation to break timestamp ties. Waiting longest is
creation order across discovery, including a Room that has already launched;
it never sorts on the nullable waiting display field or mutable occupancy.

The string cursor is the last returned accessible Room's id. PostgreSQL
resolves that anchor's creation instant at full stored precision, even if
its Room has since launched or left the selected status; no JavaScript
Date rounding or offset is involved. An invisible, missing, or out-of-lobby anchor yields
no page. The same keyset/order applies before each bounded assembly/live
branch limit, to the combined candidates and to the final projection.
Authorization and bounded retry after lock races remain unchanged.

New Rooms before the anchor appear on refresh; those after it can appear
on subsequent pages. Launching does not move the key. Clients restart from
page one when changing the lobby, sort, status, mode or search. The query/URL helper
preserves sort on subsequent pages; interactive controls are owned by the
separate Lobby design lane.

### Start commitment

Start round atomically validates a complete, eligible, Ready cast and creates
the Round. That commits readiness: Ready and Not ready commands are refused
afterward, including submissions from stale tabs, because the Room is no longer
open. Ready is asked once.
Synced seated clients enter the same opening or active Round when `roundRef`
appears, using a document navigation where media permissions require it. Completed
and abandoned Round references leave the Room and its rematch action accessible.
An observed terminal Round cannot trigger entry again through delayed snapshots,
even when its status changes independently of the Room revision. Navigation and
rematch presentation share that terminal observation, scoped to Room and Round
identity; current ownership and all server-side mutation authorization remain
authoritative. A distinct rematch Room starts with fresh observation state.
