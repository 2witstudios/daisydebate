# Room assembly and Launch

The canonical Room HTTP producer composes through `createApp` and
`createRoutes`. Its explicit `roomPolicy` injection supplies the consent
lease duration, open Rooms per host, body bound, and create/read/command
rate limits. The ordinary process currently supplies no Room policy and
returns a masked unavailable response. Browser and durable proofs supply
explicit fixture policy through the existing `adoptProcessApp` seam. Those
fixture numbers do not approve deployment or product policy.

## Contracts and request authority

`@daisy/protocol` exports `roomCreateSchema`, `roomCommandSchema`,
`roomViewSchema`, `roomCatalogChoiceSchema`, `roomCastChoiceSchema`, and
`roundViewSchema`. JSON readers validate the complete authoritative shape;
portable types derive from the projection grammars.

The authenticated routes are:

| HTTP                           | Contract                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| `GET /api/rooms/catalog`       | `{ choices: RoomCatalogChoice[], bots: RoomCastChoice[] }` |
| `GET /api/rooms`               | `{ rooms: RoomView[] }`                                    |
| `POST /api/rooms`              | `RoomCreate` → `{ receipt, view }`                         |
| `GET /api/rooms/:id`           | `RoomView`                                                 |
| `POST /api/rooms/:id/commands` | `RoomCommand` → `{ receipt, view }`                        |
| `GET /api/rooms/:id/round`     | The Room's current persisted `roundRef`                    |
| `GET /api/rounds/:id`          | `RoundView`                                                |

Every entry executes the canonical handler's origin, session membership,
rate and input gates. Native actions forward the real incoming headers
through `inProcessFetch`; they do not invoke domain or database commands
as an alternative authorization path. The host comes from the bound session
actor. Canonical authorization reads fresh durable account facts inside
the command transaction, under ordered user locks before the Room lock.
Private denied reads and absent resources both return `NOT_FOUND`.

Public open Rooms are discoverable; private/unlisted membership discovery
also includes the host and seated caller. Catalog choices come from
publisher-owned pinned format revisions and stored presets. Bot cast
choices carry persisted identities and eligibility. A host can assign a
bot or move a human who already joined; a host cannot manufacture another
human's membership or Ready consent.

Interaction controls are null only when the pinned format forbids that
capability. An available interruption or yielding capability requires explicit
values from its declared permitted sets, including when disabled. Catalog
defaults select declared legal values. The sole compiler rejects omitted or
forbidden choices before creation or configuration changes persist any state.

## Versions, consent and commit

All commands carry `commandId` and `expectedVersion`. Ready and Unready also
carry the caller's `expectedConsentVersion`. Accepted config, topic,
visibility and cast edits increment the assembly version and invalidate
all previous consent. Every accepted mutation increments `changeVersion`
and writes exactly one `room.changed` outbox event in the same transaction.
Refusal and exact replay write none. Command receipts are principal and
payload bound, retained for the accepted DEC-81 24-hour dedupe window by
the existing bounded retention sweep.

Effective readiness is an expiring namespaced Redis lease matched against
a durable per-seat revision and command fence. The fence records which
consent event is current; it is not a durable Ready flag. Losing Redis,
expiring a lease, a stale Ready after Unready, a pruned replay, or a Redis
write whose SQL transaction rolls back cannot establish current consent.
Unready commits its replacement fence even while Redis is unavailable.
Each consent command owns its own expiring Redis key. A failed replacement
write cannot overwrite the lease matched by the previous durable fence.
Reads do not extend leases, and replay does not write Redis.

Launch requires every declared slot, eligible stored cast, current human
consent, and finished required prep. Bots require server eligibility;
local device checks never establish server consent. Prep stores its original
anchor atomically and projects remaining time from the injected clock.

The account/Room fence serializes Launch with Unready, erasure and cast
changes. One transaction freezes topic, visibility, configuration, compiler
rules and all human/bot/judge participant identities into one persisted
Round. A unique Room reference enforces one Launch. The Round is
**scheduled**, with no fabricated start clock. Active runtime, durable floor
history, media grants/capture and judging producers are subsequent work.

## Proof and remaining adoption

Real PostgreSQL/Redis suites cover exact retries after catalog advancement,
unchanged refusals, command pruning, expiry, crash/rollback, outage and
reconnect, both concurrent Start/Unready orders, asymmetric custom speech
order/timing, complete human/bot/judge cast, and frozen Round reads. A real
signed-cookie HTTP suite covers multi-account membership, masked reads,
origin refusal and native-form transport through the canonical handlers.
Walt owns composed Play/Lobby/Room/native-browser delivery.

Realtime Room authorization uses `readRoomAuthorizationFacts(roomId, caller)`
on the existing database pool. It returns the canonical current account and
Room host, visibility, status, revision and seated actor/role/slot facts;
it does not hydrate labels, topics, configuration or formats. The sole
authorization evaluator decides `room.read`. The account fence runs through
the minimal security-definer account function; realtime receives function
execution and only the Room/participant columns this projection reads.
Source grants are not production activation or proof of restricted-role delivery.

The durable `outbox_retention_boundary` singleton stores only ordering tokens.
Its initial migration transaction position refuses unknown earlier history,
including an empty previously-pruned log. Missing metadata requires resync.
The runtime producer must atomically advance this boundary with prefix deletion
and check it across catchup/authorization awaits before replay; observed ring
rows alone do not certify completeness. Role, concurrent purge/drain and socket
proof remain required before realtime acceptance.

The shipping target is an empty greenfield database; its complete forward
migration chain requires no historical Room or Round backfill. Populated
legacy database upgrades are not a delivered capability. Forward migration
integrity is required. A warm local database containing
older Rooms without trusted host metadata cannot apply the metadata
constraint; fresh-slot proof does not fix that adoption gap. Preserve that
slot and inventory its Room/participant/round/FK provenance read-only.
No fabricated host, reset, applied-history rewrite, or Round deletion is
part of this delivery. The schema epic owns a reviewed transition before
warm adoption can be accepted.

## Lobby discovery

Authenticated discovery returns a lightweight page of Room metadata and the
caller's seated flag. It includes assembling/ready Rooms and started Rooms
whose frozen authoritative Round is scheduled or active. Abandoned Rooms and
completed/abandoned Rounds do not appear. Offering View Round requires both
fresh Room and frozen Round authorization, including their respective host or
creator, visibility and only the caller's relevant seats. The canonical
account fence and authorization evaluator govern every page; discovery adds
no age or capability authority of its own.

The strict request accepts `q` (at most 100 characters), `cursor` (a Room cuid2)
and `pageSize` (default 20, maximum 50). These are delegated resource-work
choices recorded in pending DEC-129, not an accepted competition capacity
policy. Search matches title, topic or the current host label in SQL before
paging. The native GET search form resets the cursor; Next page preserves
search and page size, and First page resets pagination.

Two separately ordered and bounded SQL branches traverse partial assembly
Room-id and live Round-room-id indexes. Comparisons, branch order, global
merge order and the indexes all use bytewise `C` collation. Each branch selects
at most page size plus one; the global merge selects the same bound. Only the
first page-size Room ids and associated Rounds are locked. The fresh projection
contains no format/configuration, full cast or Redis consent reads. Historical
rows are absent from the partial indexes. Search may examine nonmatching live
index entries; it never scans historical aggregates or replenishes a page
through an unbounded hydration loop.

A lock wait can shorten a page. Continuation uses only the last returned,
authorized Room id when selection observed another candidate. A masked
page-plus-one candidate can produce a subsequent empty page. If every selected
row becomes masked or terminal, the response has no cursor and explicitly
requests retry of the same bounded query, rather than claiming the catalog
ended or disclosing a hidden id. A stable retry can then reach a remaining
accessible successor. The consumer refuses overflow, duplicate/nonprogressing
ids and substituted cursors as a whole; it never silently truncates a response.
