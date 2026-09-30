# 0049: Room, debate and turn

Status: proposed. Extends [ADR 0029](0029-competitive-schema-foundation.md)
(the debate is the durable competitive record) and
[ADR 0033](0033-presence-and-adjudication.md) (turns are computed from the
rules). Amends [ADR 0030](0030-effective-rules-and-growth-paths.md) (the lobby
becomes a named, durable concept and replaces the `source` provenance key),
[ADR 0031](0031-realtime-service.md) section 5 (one new topic family) and
[ADR 0048](0048-authorization-core.md) sections 1 and 2 (unranked creation
and the room capabilities; its 2026-09-30 amendment, members host ranked
debates, is kept), each in its own `## Amendment` section when this record is
accepted. Decisions marked open at the end were made on the owner's behalf and
stay open until the owner confirms or overrules them.

## Context

Until this record the code and the ADRs use one noun, the debate, for three
different things: the place people gather and confirm settings, the
competitive record that is judged and rated, and the speeches inside it. The
engine's `waiting` phase stands in for the gathering, so a gathering has
nowhere to live before its debate exists and nothing to outlive it. ADR 0030
and ADR 0048 already talk about a "lobby" that copies rules, overrides them
and seats people, but no record defines it, so the lobby, the realtime topics
and the authorization capabilities have nothing to build against.

The product model is the game-room model: someone creates a room, the members
confirm settings, everyone readies up, the round starts, and the room is still
there for the next one. Tournaments and tabulation need the same thing: a
pairing is a room whose seats and judges are assigned before anyone arrives,
and its result is the debate it produces.

## Decision

### 1. Three nouns, and "round" is not one of them

| Noun       | What it is                                                                  | Durability                            |
| ---------- | --------------------------------------------------------------------------- | ------------------------------------- |
| **Room**   | A gathering: host, seats, judges, draft settings, ready flags, assignments  | PostgreSQL                            |
| **Debate** | One contest played under fixed rules: the snapshot, ballots, rating changes | PostgreSQL, the competitive truth     |
| **Turn**   | One speech inside a debate, from the effective rules' `turns` (RT-4.1)      | Computed from `startedAt`, never kept |

"Round" is reserved for tournament bracket rounds (`tournament_rounds`, ADR 0030) and is not a stored or domain noun here. What users call "the round
starting" is a debate starting. UI copy may say "match"; the stored and coded
noun is `debate`.

"Lobby" names the public browsing surface of open rooms (the `/lobby` route);
a room is one entry in it.

### 2. The room is a durable row and is not competitive truth

A `rooms` row carries its cuid2 id, host actor, canonical format slug, draft
rules overrides, visibility, lifecycle (`open`, `started`, `closed`), a
nullable league and nullable creation context. A room with a league is a
hosted ranked table (section 6). Seats and judge assignments are rows keyed by
actor, with the actor's side or judge role and the ready flag. The
`sandbox` seat driver ADR 0030 placed in Redis room state is a column on the
seat row instead. One actor holds at most one seat in a room, as ADR 0029
requires of a debate.

A room row is never read as a result: ballots, ratings and standings read
debates only. Presence (who is connected, away or watching) stays advisory
Redis state under ADR 0033 and is never written to the room. Its schema
follows ADR 0029's conventions, and its columns ship with their privacy
classification (ADR 0036).

### 3. Starting a room is one atomic operation that creates the debate

The start command loads the room and the canonical rules from the format row,
applies the confirmed overrides (ADR 0030 section 1; ranked refuses overrides
through `rulesMatchFormat`), then in one transaction creates the debate, seats
every member, runs the engine's join, ready and start transitions, stamps the
debate with its room and appends the outbox event. It is idempotent on a
protocol `commandId` (ADR 0029). The engine is unchanged:
`debate.seats.within-format`, seat uniqueness and the start gate (every
offered seat filled and ready) still decide, so a room that cannot legally
start is refused with state unchanged. `waiting` remains a real engine phase,
but the room flow passes through it inside the one transaction and never
persists it.

Settings are confirmed before readiness matters: any change to the draft
settings or the seat assignment clears every ready flag in the same
transaction, so nobody starts a debate under rules they did not see. The
debate's snapshot then freezes the effective rules for good.

### 4. The room outlives the debate

A nullable `debates.room_id` points at the room that started it. A room may
start many debates. When one completes the room returns to `open` with ready
flags cleared; seats may swap sides, settings may change, and a rematch is a
new start and a new debate. Closing a room keeps the row so its debates keep
their grouping, and retention (ADR 0036) decides when an unreferenced, closed
room is purged.

### 5. Turns stay computed and no round entity is added

The turn structure is ADR 0033 section 5 and RT-4.1 and RT-4.2: a pure
timetable from `startedAt` and the rules' `turns`, with no per-turn row. This
record adds no entity between the debate and its turns.

### 6. Matchmaking and tournaments create rooms

An accepted match offer (MTCH-1.1) creates a room with both seats filled and
both members ready, then starts it through section 3, so queue-made,
invite-made and tournament-made debates take one path. A ranked offer never
exposes draft settings.

A hosted ranked table is a room with a league, posted the way ADR 0048's
2026-09-30 amendment describes: any active member of the league may host one
(`debate.create` on the league), and a non-member of an open league is joined
first through `league.join`. Hosting seats no one; who may take a seat (rating
band, eligibility) is Ratings-epic seating policy. A ranked room carries no
draft overrides: its rules are the format's canonical rules on a
`ranked_eligible` format (ADR 0030 decision 2), its seats refuse non-human
actors, and the start command refuses it through `rulesMatchFormat` otherwise.
Unranked rooms have no league and apply the host's overrides. TOURN-1 adds its own nullable context key on the room
(its pairing) when it builds; this record adds none. Pre-assigned judges sit
in the room before the start, which is what tabulation reads.

### 7. Realtime and authorization

- A new topic family `room:<id>` carries room changes as outbox doorbells
  (ADR 0032). Its subscribe rule is `authorize(room.read)`, decided from rows
  loaded by `@daisy/db` exactly like the debate rules, so ADR 0031's table
  gains a row and nothing else changes. `room:<id>:presence` mirrors
  `debate:<id>:presence`.
- New capabilities `room.create`, `room.join` and `room.read` with resource
  kind `room` (vocabulary owned by `@daisy/protocol`). An unranked room is
  created under `room.create`, replacing the `unranked` resource kind of
  `debate.create`. A ranked room is created under `debate.create` on its
  league, which ADR 0048's 2026-09-30 amendment allows to any active member;
  nothing in this record changes that rule. `debate.read` is unchanged.
- `debate:<id>` topics begin at start. Room chat is `room:<id>:chat`; its
  persistence belongs to the chat epic. `debate:<id>:chat` stays reserved.

### 8. The LiveKit "room" is a media session

The VIDEO-1 backlog item's "room tokens" mean tokens for a media session bound
to a debate and its turns. It is not the Daisy room and needs its own name in
code (`mediaSession`) so the two never share an identifier.

## Consequences

- The engine, the snapshot, ballots, ratings and the ADR 0033 adjudication
  model are untouched; one nullable column is added to `debates`.
- Room creation is the new flood surface, so ISSUE-205's rate limit applies to
  it, plus a cap on rooms per host.
- Every ready toggle and seat change is a database write and an outbox row.
  Room traffic is small compared with turns and presence, but the room epic
  must bound it.
- There is one source of authorization facts and one store, so the subscribe
  rules, tab views and tournament assignments are plain queries.

## Conflicts checked on the board and in the ADRs

Nothing in merged code implements the conflicting pieces yet (no unranked
create; `/lobby` and `/play` are placeholder shells), so each item is a plan
correction, which `docs/development/parallel-work.md` requires before anyone
builds against it.

| Where                                                      | Conflict                                                                                                                                                  | Resolution                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AZC-3.3 (unranked create and by-id read), ADR 0048 sect. 1 | Creates a durable debate that seats no one, with seating "out of scope"                                                                                   | Create becomes room create plus start (sections 3 and 7); by-id read is unaffected         |
| ADR 0048 sect. 2 vocabulary                                | `debate.create` with resource kind `unranked`; no room kind or capability                                                                                 | Add `room` kind and the three room capabilities; `debate.create` on a league is kept       |
| ADR 0048 amendment of 2026-09-30, sect. 9 Ratings contract | One ranked-debate creation operation for hosted tables and matchmade pairings; seating is a separate step                                                 | The room is that operation's durable table (section 6); seat policy stays with Ratings     |
| ADR 0031 sect. 5, RT-2.5a                                  | No room topic family                                                                                                                                      | Add `room:<id>` and its presence topic, decided from Postgres rows                         |
| ADR 0030 (lobby, `source` key, sandbox control in Redis)   | Lobby undefined; provenance was to be a nullable `source` key; sandbox seat control placed in Redis                                                       | `debates.room_id` replaces the `source` key for rooms; sandbox driver is a seat column     |
| MTCH-2.1, MTCH-2.2 (Ranked match loop)                     | "Speech order and timeboxes" and a "judgeable transcript snapshot" duplicate RT-4.1 and RT-4.2 (turn structure and deterministic clocks)                  | MTCH-2.1 folds into RT-4.1/4.2; MTCH-2.2 (transcript snapshot) stays, the RT epic has none |
| MTCH-3.1 "open a match shell route"; `/lobby`, `/play`     | "Match" and "lobby" undefined next to "debate"                                                                                                            | Section 1 names them; the shells become room browse and room pages                         |
| RATE-2.1 and MTCH-1.1 (queue, match offer)                 | The offer has no defined destination                                                                                                                      | Section 6                                                                                  |
| CHAT-1, VIDEO-1, TOURN-1 (Backlog)                         | CHAT-1 "debate and lobby chat" assumes a room; VIDEO-1 "room tokens" collides by name; TOURN-1 bracket "rounds" collides with "round" and needs a pairing | Sections 1, 6, 7 and 8 fix the names and the pairing link; no scope change                 |
| ISSUE-205 (rate-limit unranked debate creation)            | Targets the flow this record replaces                                                                                                                     | Re-aim at room creation                                                                    |

No conflict was found with the Privacy (beyond classifying the new columns),
Waitlist, Brand, Dashboard shell, Realtime delivery (outbox, tickets) or
Turns and adjudication (ADR 0033) work beyond the rows above. ADR 0008 is not
affected: rooms are not Redis state.

## Open decisions (made on the owner's behalf)

1. Room member cap, per-host room cap and closed-room retention are left to the
   room epic.
2. Private rooms are invite-only. Because a cuid2 id is an identifier and not a
   bearer secret (ADR 0018), joining a private room needs an invite token, which
   the room epic decides under ADR 0019.
3. The engine's `waiting` phase is kept rather than removed, to avoid
   rewriting the engine and its invariants for a transient state.
4. Ready flags are persisted with the seat. If write volume proves a problem,
   moving them to Redis is an additive change that touches no result.
