# 0059: one competitive API

Status: accepted (owner request, 2026-10-06; plan approved 2026-10-07).
Extends [ADR 0058](0058-one-round-model.md) (the one Round model) and
[ADR 0057](0057-planned-readers.md) (declared planned readers). Amends
[ADR 0031](0031-realtime-service.md) section 5 in its own `## Amendment`
section below. The cutover this record directs is governed by
[ADR 0023](0023-greenfield-baseline.md).

The phased build is the approved plan **One competitive API** (revision 3,
2026-10-06) in the `Daisy Debate` drive. This record states the decision the
plan's phases enact; an implementation agent should read both.

## Context

The owner's directive of 2026-10-06: the nine `/api/ai-debate/*` routes —
`start`, `command`, `view`, `speech`, `speak`, `heard`, `cross-examine`,
`transcribe`, `ballot` — are deleted, and Room/Round becomes the only public
competitive API. The surface exposes implementation mechanics as product: the
bot's turn loop (`command`), its audio plumbing (`speak`, `heard`,
`transcribe`), its private state fold (`view`). The Stockfish test, applied
to endpoints: nobody ships `/computer-games/move` beside `/games/move`. Daisy
shipped the equivalent.

[ADR 0058](0058-one-round-model.md) removed the second data model — one
Round, shared seats, one ballot contract. It left the second API standing: a
bot debate is still created, played and judged through routes a human debate
never touches, so the fork the schema closed survives in the surface. This
record closes it there as well. Human and bot become two callers of one
command/read protocol, and "AI debate" stops being an API product. The bot
keeps its runtime, its voice pipeline and its prompts; it loses its API.

## Decision

### 1. Two APIs, one boundary

The Room API is the pre-competition surface — seats, readiness, config,
sanctioned preset selection, pre-round prep, `startRound`. The Round API is
the competitive surface — in-round prep, segments, floor, yield and
interrupt, forfeits, completion, ballots.

```
POST /api/rooms                      → create a room
GET  /api/rooms/:roomId              → RoomView
POST /api/rooms/:roomId/commands     → claim-seat · leave-seat · ready ·
                                       unready · update-config (casual and
                                       practice only) · start-prep ·
                                       finish-prep · start-round
GET  /api/rooms/:roomId/round        → the Round ref once start-round ran

GET  /api/rounds/:roundId            → RoundView
POST /api/rounds/:roundId/commands   → start · start-prep · end-prep ·
                                       start-speech · yield · interrupt ·
                                       forfeit · complete
GET  /api/rounds/:roundId/participants         → seats
GET  /api/rounds/:roundId/segments             → segment history
GET  /api/rounds/:roundId/segments/:segmentId/utterances → transcript
POST /api/rounds/:roundId/ballots    → submit a ballot (judge seats, one
                                       contract)
GET  /api/rounds/:roundId/ballots    → ballots
POST /api/rounds/:roundId/media/*    → audio/transcript against the
                                       caller's open segment
                                       (RoundParticipant-scoped)
```

There are no nested participant mutations.
`/rounds/:id/participants/:pid/speech` is wrong: speech is not a participant
subresource, it is a legal operation on the Round runtime performed by a
participant. Commands name the participant; the route does not.

`start-round` is the hinge, and it is why it sits in the Room API: it is the
single moment values move between Room and Round (ADR 0058 §7), it writes the
round core's first row, and everything after it is Round API.

### 2. Commands are typed, and the actor is the principal

Commands are typed envelopes — `{ type, participantId?, ... }` — validated at
the boundary by `@daisy/protocol` schemas, one discriminated union per
surface, each surface carrying its command and refusal contracts.

The acting actor is bound to the authenticated principal, never to a body
claim. A human command takes its actor from the session. A bot command is
submitted server-side by the agent runtime under the run's own principal —
ADR 0058 §2's `AgentRun`, operating its seat — and passes the same legality
check. A command whose body claims an actor that does not match the
principal is refused, whatever the claim asks for. Zero trust at the
boundary: the session or the run is the only actor evidence there is.

Round commands dedupe through `round_commands`; room commands through
`room_commands`, within that decision's 24-hour window (DEC-81). Both are
idempotent on the protocol command id. Both are persistence for dedupe and
audit — never a client-replayable history. The client does not fold a command
log; it reads projections.

### 3. Reads return server-owned projections

`RoomView`: id, status, seats, config, preRoundPrep, readyState, canStart,
roundRef. `RoundView`: id, status, stage, participants, rules,
currentSegment, clockAnchors, prepRemaining, floor, outcome.

`projectRoom` and `projectRound` compose the durable rows with the expendable
Redis state — ready flags keyed to the room version — and the hydrated engine
runtime is authoritative for what is happening now (ADR 0058 §6). The runtime
checkpoint is internal: `RoundView` exposes the derived `prepRemaining`,
never the checkpoint itself.

### 4. Realtime stays thin

Commands go over HTTP; the socket carries subscription, invalidation and
pushed view events — the doorbell channel ADR 0031 already fixed, never a
command channel. A client that loses the socket loses nothing competitive,
because every command and every read is HTTP. Adding a WebSocket command
protocol supersedes this record. The one topic family this record adds is
the Amendment below.

### 5. The bot is a caller, not a product

When the engine says participant X may act and X's actor kind is bot, the
agent runtime performs the work — speech generation, cross-examination,
judging, speech-to-text, text-to-speech — and submits the same legal Round
command a human would (ADR 0058 §6). A bot ballot validates against the one
ballot contract. There is no bot-shaped command, no bot-shaped view, and no
AI route. `@daisy/ai-voice` keeps its responsibility — implementation detail
of a bot participant, behind the agent runtime — and gains no HTTP surface.

### 6. Deletion in one move

The nine routes leave in one change, with every API abstraction that existed
only for the AI stack: the routes, their handlers, the feature clients
rewired onto Room/Round, and the engine and protocol exports that served only
them. ADR 0023 governs: the replacement is a rewrite, not a phased removal —
no dual surface, no window in which both APIs answer. Earlier slices may land
routes that are not yet publicly reachable; the cutover slice deletes the old
surface and rewires its clients in the same move.

| Deleted route                             | Replaced by                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/ai-debate/start`               | `POST /api/rooms`, then room command `start-round`                                            |
| `POST /api/ai-debate/command`             | `POST /api/rounds/:roundId/commands`                                                          |
| `GET /api/ai-debate/view`                 | `GET /api/rounds/:roundId` (RoundView)                                                        |
| `POST /api/ai-debate/speech`              | round command `start-speech`, then media upload against the speaker's open segment            |
| `POST /api/ai-debate/speak`               | media audio retrieval for an utterance (participant-scoped, cacheable)                        |
| `POST /api/ai-debate/heard`, `transcribe` | media transcript against the caller's own open segment → utterances                           |
| `POST /api/ai-debate/cross-examine`       | `interrupt` / `start-speech` inside a cross-examination segment, per `RoundRules.interaction` |
| `POST /api/ai-debate/ballot`              | `POST /api/rounds/:roundId/ballots`                                                           |

Knip and duplication are the mechanical proof of the deletion: no orphaned
export and no clone of the old handlers survives `bun check`.

### 7. Contracts before readers are declared

The contract slice lands view, command and refusal schemas whose first
readers are later phases of the same epic. Per
[ADR 0057](0057-planned-readers.md) each is declared in
`policy/planned-readers.json`, naming the phase that reads it and a
`reviewBy` date. The declaration names the reader; a test reading the schema
is not the reader anyone means.

## Amendment to ADR 0031 section 5: the round-view topic family

[ADR 0049](0049-room-debate-turn.md) section 7 grants only the `room:<id>`
families — `room:<id>`, its presence mirror and its chat topic. The
round-view family is new authority, recorded here. Section 5's table gains:

| Topic family | `authorizeSubscribe` rule                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `round:<id>` | `authorize(round.read)` on the round row — the debate rule's shape: a public or unlisted round is open to every ticket holder, a private round to its creator and the seated participants |

The family carries round-view change doorbells through the outbox
(ADR 0032). A client that receives one refetches `GET /api/rounds/:roundId`;
the invalidation carries no view payload, so a client can never render a
staler view than its last refetch proved. `round.read` is the round-read
capability; until the capability vocabulary adopts the round noun, the
decision runs against `debate.read` and renames with it. Presence on a round
is the existing debate presence family under ADR 0033 and needs no new grant
here; whether its name follows the round noun when the schema epic's rename
lands is that adoption's business. Everything else in ADR 0031 — envelope,
tickets, close codes, slow-consumer bounds, re-authorization — is unchanged.

## Consequences

- The public competitive surface is exactly §1's routes.
  `/api/debate-room/documents/*` is untouched: documents belong to the
  one-Round-model plan's Phase F, and this epic adds no document endpoints.
- This epic generates no migrations. The schema epic owns the tables and the
  baseline squash; a column this epic discovers it needs is filed back there,
  never generated here.
- Declared contracts are dated liabilities: a planned reader whose phase has
  not landed goes red the day after its `reviewBy` (ADR 0057).
- The old surface's acceptance test becomes the new surface's: a full debate
  plays end to end through Room/Round commands and ends in a submitted
  ballot, and the refusal paths — a non-judge ballot, a mismatched actor
  claim, a second start — leave state unchanged.
- Not decided here: matchmaking, ranked entry, tournaments and the watch and
  train surfaces converge on Room/Round later; this record builds the surface
  they will call. Whether an abandoned ranked round rates stays with
  ADR 0058's open questions.
