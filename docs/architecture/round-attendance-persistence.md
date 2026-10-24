# Round attendance persistence

PostgreSQL owns service availability and attendance evidence. The runtime
producer supplies authenticated receipts and competitive projections; schema
integrity does not authorize a participant request or declare a forfeit.

`service_instances` stores an opaque `instance_id`, role `web | realtime`, fresh
PG `renewed_at` and the complete delivery position `(delivered_through_txid,
delivered_through)`. The txid uses PostgreSQL xid8 retained as decimal text at
raw SQL boundaries; sequence uses bigint, never an unsafe JavaScript number.
Web leases have both cursor fields null; realtime leases have both present.
Sequence alone cannot prove delivery because transactions may commit out of
sequence order. A renewed-time index supports lease inspection and pruning.

The actual runtime roles may insert and renew only their own role's leases.
Instance and role identity cannot change on UPDATE. `daisy_realtime` has SELECT,
INSERT and UPDATE on this table, without DELETE or any new attendance/sample
write grant. Tests reserve one actual connection for SET ROLE and all probes;
SET ROLE on a pool is not sufficient to establish the query principal.

`availability_samples` has an immutable timestamp primary key, health boolean
and a cause null exactly when healthy. Unhealthy causes are bounded to
`web_stale`, `realtime_stale`, `delivery_lag`, `public_probe_failed` and
`check_in_pending`. Bot worker control is not an availability cause; the evaluator
treats a bot seat's missing receipt as worker loss, never absence (ADR 0067). A sampler holds session advisory
lock 59003; the insert trigger takes the same transaction lock reentrantly and
requires time strictly greater than the committed maximum. The producer uses
PG statement time and a monotone insert predicate; history is not rewritten.
The timestamp key supports the 24-hour prune. Pending check-ins override current
peer health and gate the owning Round evaluator conservatively.

Every web peer renews its own lease each second. Before public probing, the
sampler checks lock ownership on that same reserved PostgreSQL session; only
the elected producer performs the synthetic route check and inserts a sample.
The insert independently rechecks election. This prevents rolling web peers
from multiplying requests against the probe member's ordinary shared rate
limit. No probe bypasses session, origin, seat or receipt authorization. Each
probe uses a new global command alias while preserving the operation's first
receipt stamp. Missing configuration or unsuccessful probing remains unhealthy.

The probe resource (`ATTENDANCE_PUBLIC_PROBE`) is a synthetic Round whose
two speeches ended with on-time receipts, awaiting its judge. Its receipt
stays valid only while that Round is active, so competitive maintenance
leaves the configured probe Round out of discovery and never freezes,
judges or completes it (ISSUE-530, DEC-231). Without that, maintenance would
complete it about half an hour after its last speech, and every later probe
would answer `attendance-terminal`, leaving a long-lived deployment with no
healthy availability evidence and no Round able to finalize.

## Receipts, facts and uncertain attempts

`round_check_ins` retains one first stamp per Round/segment/participant, with a
command ID scoped to the existing global `round_commands` receipt. Principal
XOR, digest and receipt outcome remain in that ledger. `check_in` does not by
itself advance competitive runtime version. `round_attendance_adjudications`
retains one immutable decision per segment, including `none`, with scoped ledger
receipt, effective deadline and settled horizon. `adjudicate` requires the
service principal `round-attendance:<instance cuid2>`; an actor cannot submit it.
All fact updates and direct deletions are refused. Owning Round erasure cascades
through an independent Round FK; scoped child/receipt references use deferred
NO ACTION so direct receipt pruning still fails at commit and rolls back.
The receipt sweeper must preserve referenced check-in/adjudication ledgers.

`round_check_in_attempts` is persisted before the writer BEGIN. Its command ID
intentionally has no ledger FK: uncertain work can exist before any accepted
receipt. Each attempt records immutable Round/command/digest/principal, canonical
first PG receipt, and exact backend PID plus backend-start incarnation. Read and
write `backend_start::text` directly; Date/ISO millisecond conversion loses PG
microseconds. Attendance deadline authority likewise compares native PG stamps
or preserves their full precision, never a rounded browser instant.

Attempts start pending with no resolution timestamp, then close once as
committed or aborted with a resolution timestamp. Closed outcomes cannot reopen
or flip. Pending markers cannot be directly pruned and persist indefinitely,
including beyond 24 hours, until confirmed resolution. Resolved markers have
24-hour retention. Owning Round erasure may remove its aggregate. Unknown COMMIT
cleanup must prove exact backend absence first, then perform a separate fresh
READ COMMITTED ledger identity read matching command, Round, digest, principal
and `check_in` type. A lease timeout or single MVCC statement does not prove an
abort. The actual same-pool D3 lifecycle producer owns that sequence.

## Classification and evidence

Instance, Round, command, segment, participant, actor, service and attempt IDs
are category identifier, scoped per telemetry surface. Backend PID and command
payload digest are internal identifiers. Timestamp, delivery cursor, epoch,
health/cause, decision and attempt-state fields are category none. There are no
credentials, serialized request bodies, generated phrases or transcript text in
these tables. Production identity, secrets and deployment remain human gates.

Real PostgreSQL schema proof covers role-bound lease writes, complete delivery
positions, monotone immutable samples, pending-before-ledger storage, exact
backend incarnation retention, first-stamp/decision immutability, receipt
retention refusal and owning Round cascades. Actual sampler, control lifecycle,
authenticated receipt, outage evaluation and competitive adjudication require
their separate composed service proofs; schema tests do not establish them.
