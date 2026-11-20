# 0155: A youth debater's linked adults watch their live Youth Round

Status: accepted (owner decision 86, 2026-11-18; epic YLS, slice S4 linked
adults live, task YLS-7, decisions recorded on
[10 — Direction and build order](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/jro30yyuynd11e7qzjfdby0u)).
Amends [ADR 0150](0150-youth-recordings-private.md) §4 ("never live"):
nobody outside a Youth Round watches it live, except its youth debaters'
linked adults, without media. Extends [ADR 0099](0099-spectator-release-authority.md)'s
undelayed observer.

## Context

ADR 0150 keeps a Youth Round off Watch and off every Broadcast: once it
starts, only its seats and its seatless host see it. The Recording's audience
is wider: each youth debater's linked adults (their school's owner, staff
holding `school.roster.manage` for that school, an adult with an active
guardian link) see the video, transcript and result once the Round ends. A
coach therefore learns how their student's Round went minutes later, but
cannot follow it while it runs. Discovery (lobby spectating, 2026-11-18,
"Linked adults live") found that live access for exactly those people adds
timing, not audience. Owner decision 86 takes it, without media.

## Decision

1. **One rule.** `liveAudience(round, viewer)` in `@daisy/auth/live-audience`
   answers `undelayed_no_media` (as `host` or `linked_adult`) or `denied`
   (`signed_out`, `seated`, `not_live`, `not_in_audience`). A seat comes
   first: anyone seated (a debater, a judge, a seated host) keeps their own
   seat's view. Then the seatless host, on any Round, as ADR 0099 had it.
   Then, on a Youth Round only and only while it runs (`opening` or
   `active`), an actor among its youth debaters' linked adults. The rule
   works out the viewer's `LiveStanding` and asks [ADR 0156](0156-room-division-from-its-lobby.md)'s
   `canWatchLive`, so the Lobby's live rows and the live room decide alike. A
   Round is a Youth one here by its Room's division (ADR 0156), the division
   `canWatchLive` reads, so a casual Youth Room's Round counts too; ADR
   0150's Recording rules still read the ranked Round's ladder division.
   On an event (tournament) Round, `round.observe.undelayed` stays with the
   holders of `tournament.rooms.officiate`; without that grant, only this
   rule's `linked_adult` answer admits, while the Round runs. An event Room
   has no host person, so there is no seatless-host fallback. Once the
   Round ends they are refused like anyone outside it and see it through its
   Recording, under ADR 0150's rules; their live view says so and links the
   Recording.
   `round.observe.undelayed` is this rule. The linked adult also holds
   `round.transcript.read`, since the Recording's audience reads the
   transcript; the seatless host still does not. Neither gains `round.read`,
   so ballots and every other host read stay as they were.
2. **The same people, the same fences.** The linked adults are
   `readYouthRecordingPeople` (ADR 0150 §3), one call to the registered
   function `daisy_round_linked_adult_actors` ([ADR 0158](0158-linked-adults-in-one-registered-function.md)),
   through the 15-second people cache. `@daisy/db/youth-live` keeps one cache and one
   resolver per set of reads (`youthPeopleFor`, `linkedAdultsFor`), so in the
   web the Recording's audience and the live audience share one cache; the
   realtime server keeps its own. Whether a Round is a Youth one is frozen at
   Start, so the resolver reads it once per Round and reads nobody's links
   for any other Round. A revoked grant or ended link
   stops admitting within about 15 seconds. In production this is school staff
   only. The active guardian links it reads are established by ADR 0163.
3. **Read lazily.** Every read that may admit a linked adult (the Round read,
   the transcript, the floor's HTTP routes, the realtime Round topic and the
   floor's realtime permits) runs without the linked adults first and reads
   them only after the read's own audience decision refuses (`withLinkedAdults`; a missing Round or an error from the read's own work never triggers it), so a seated debater's
   reads never wait on or pay for anyone's links. A watcher whose Round's
   people the cache already holds (`peek`) reads once, with them. The floor's
   realtime permits take the Round from the cohort's own facts. Watch's
   student list proposes at most the 12 newest running Rounds, reads at most four at once, and its failure
   leaves the section out instead of failing the hub.
   The live audience's reads have their own module,
   `youthLiveReadOperations` (`readRoundYouth`, `readYouthRoundPeople`,
   `readStudentLiveRounds`); the people read is ADR 0150's, taken as a named
   input.
4. **What they see.** The Round read says why a viewer watches
   (`viewerWatchesAs`: `host`, which also covers an event's officials, or
   `linked_adult`), from the rule's own answer. A linked adult gets the
   seatless host's `LiveSpectatorRoom`, labelled "Watching": the clock, the speech order, the transcript and the floor chat,
   undelayed. No media: no Broadcast exists for a Youth Round and the room
   asks for no media session. The floor fact names them `linked_adult`
   (`withLinkedAdultAudience`, only when the Round seats them nowhere); its
   decision allows only `read` while the Round runs, and its metadata is
   read-only, so they post, react and remove nothing. They take no part in
   audience chat, which a Youth Round never has.
5. **How they reach it.** The student's Room link: the Room read's `watch`
   (a union, replacing `watchRoundId`) is `{ kind: 'live_room' }` for a
   linked adult once the Round has started and until it ends, so the page
   sends them to `/rounds/<id>/room` (every ranked Room is public,
   `rooms_ranked_public_check`, so a Youth Room's read always reaches this); a public Round's released Broadcast
   stays `{ kind: 'broadcast' }`. The Youth lobby's live row: [ADR 0156](0156-room-division-from-its-lobby.md)
   §6's `canWatchLive` gains the `linked-adult` standing, so a live Youth row
   offers its debaters' linked coach or parent Watch into the live room (the
   same candidate read as below proposes the Rounds; the room decides). The Round link itself. And Watch's "Your
   students, live": `readStudentLiveRoundCandidates` proposes the running
   Youth Rounds seating a minor the adult is a guardian of or a member of a
   school they own or staff (the forward rule's own staff test), under the
   same scopes; each is then read as the adult, so the rule above alone
   decides which they see. Nothing changes
   on the public Live listing or its count.
6. **Unchanged.** Open Rounds, every seated person's view, the seatless
   host's view, ADR 0150's SQL fences (Broadcast discovery, Live listing,
   spectator timeline, archive, profiles), and every Recording rule.

7. **Realtime.** The realtime role may hold no privilege on a tenant-owned
   table ([ADR 0129](0129-tenant-isolation-by-row-level-security.md) §4). It
   holds `SELECT (division) ON rooms` (exempt, §6) and reads the people
   through the registered function `daisy_round_linked_adult_actors`, so the
   Round topic and the floor's permits admit linked adults while the Round
   runs, and the floor chat shows to them read-only
   ([ADR 0158](0158-linked-adults-in-one-registered-function.md), amending the
   interim refusal this section first recorded). A links lookup that fails
   still admits nobody: the Round topic refuses a linked adult, and floor
   permits keep the first pass.

## Consequences

- Media for linked adults (a private, signed-URL feed of a Youth Round) is
  not built and needs a capture-path decision of its own.
- Releasing Youth Rounds live to the public remains out: it contradicts ADR
  0151 §6 and needs counsel.
- A new read that admits watchers must take the Youth fact through
  `withLinkedAdults` or `linkedAdultsFor`; nothing enforces it for a read that
  builds its own Round fact without it, and such a read simply admits no
  linked adult.
