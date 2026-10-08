# Persistence and ephemeral infrastructure

Platform and data owners maintain `@daisy/db`. Application features call its public operations; Drizzle and Bun SQL stay in the adapter. Schema files are grouped by record ownership under `packages/db/src/schema/`. `createDatabase()` composes focused operation modules, each instrumented through the package's one event wrapper. Compound writes use explicit transactions and version checks; callers re-read after conflicts. Test-only operations never enter the public API.

PostgreSQL is the durable source of competitive truth ([ADR 0058](../decisions/0058-one-round-model.md)). A Round is the one competitive occurrence, regardless of its origin, ratedness, or human or bot seats. No snapshot table or AI-only lifecycle table mirrors it. Rooms persist resolved configuration, pinned format and preset revisions, participant assembly, and optional pre-round prep before a Round exists. A Round freezes those already resolved rules and seats; PostgreSQL owns the lifecycle, segment intervals, utterances, ballots, command idempotency, and rating ledger. Redis holds only expendable presence, cache, and rate-limit state.

Identifiers are application-minted cuid2 text values, except canonical format slugs. Durations are integer milliseconds and timestamps are `timestamptz`, exposed as UTC ISO strings. Every new personal-data column follows the classification and erasure rules in [privacy](../operations/privacy.md). `users` is tombstoned on account deletion: PII is scrubbed, authentication rows are deleted, and active grants are revoked transactionally; actors and competitive history remain. Actor-owned documents require explicit deletion in the account-erasure operation because the user tombstone keeps its row.

## Competitive records

| Record                                          | Durable responsibility                                                                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actors`, `bot_profiles`                        | Human or bot identity separate from the auth account; bot persona is reference data.                                                                                                                                                           |
| `formats`, `format_revisions`, `format_presets` | Canonical format identity, immutable definitions, and approved ranked configs. Rooms and ranked Rounds pin the exact format and preset revisions with composite foreign keys.                                                                  |
| `rooms`, `room_participants`                    | Config, resolved rules and Room execution plan; assembly seats; pre-round prep anchor and remaining budget. A Room becomes ready only when its declared seats are complete. An enabled prep plan must expire before `startRound()` freezes it. |
| `rounds`, `round_participants`                  | One lifecycle and frozen rules; authoritative seats with surrogate ids and unique `(round_id, role, slot)` and `(round_id, actor_id)` keys. A scheduled Round has no active clock.                                                             |
| `round_segments`, `utterances`                  | The live interval is the one open segment row. The partial unique index allows at most one; the write path closes before opening another. Scoped composite FKs prove an utterance's segment and speaker belong to the same Round.              |
| `round_commands`                                | Command idempotency and audit: principal, SHA3-256 payload digest, result, and resulting version; not an event log.                                                                                                                            |
| `ballots`                                       | One shared contract per judge seat, written with Round completion in one transaction.                                                                                                                                                          |
| `agent_runs`, `usage_reservations`              | AI execution and budget accounting on a Round participant, not an AI-specific Round. AI practice admission serializes both limits and writes its Room, seats, Round, and reservation in one transaction.                                       |
| `documents`, `round_document_refs`              | Actor-owned prep content and references from Rounds. Removing a Round removes its references, never the owner's document.                                                                                                                      |
| `seasons`, `ratings`, `rating_changes`          | Glicko-2 seasons, current projection, and append-only ledger for ranked and quick ladders.                                                                                                                                                     |
| `role_grants`                                   | Account authority with explicit scope and revocation.                                                                                                                                                                                          |

Every status and vocabulary column is text with a CHECK derived from the protocol where one exists. JSONB writes pass the column's protocol validator and an object-shape CHECK. Foreign keys have leading-column indexes. Lifecycle and provenance constraints are tested against PostgreSQL in `packages/db/integration/`; application checks cover cross-table invariants such as complete seats and a judge ballot on its own Round.

Competitive instants come from the database clock. The application passes one database-sourced instant to the pure Round runtime, then persists its projection under the expected Round version. Segment closes precede inserts in the same transaction. An accepted completion writes the judge ballot and Round result atomically. Redis loss cannot change a result, ballot, rating, or recording reference.

## Roles and migration baseline

The single greenfield baseline ([ADR 0038](../decisions/0038-drizzle-1-baseline.md)) creates `daisy_web` with DML but no schema, `TRUNCATE`, or migration-log privilege. `daisy_realtime` gets only explicit read models and outbox access; it cannot read authentication secrets or private user fields. `daisy_e2e` is a local loopback login and member of `daisy_web`. Migrations run through a separate owner credential. A baseline squash requires the recorded policy entry and a one-time reset of local and test databases; deployed migrations are never rewritten.

Generate schema changes with `bun db:generate`, review SQL and snapshot metadata, and run `bun migrations:check`. A forward migration is required after a baseline reaches `main`. Production changes use expand/contract for rolling deployments; see [database operations](../operations/database.md).

## Auth mail, realtime, and Redis

Email diagnostics live in `email_delivery`, `email_delivery_event`, and `email_suppression`: IDs, status rank, and a keyed SHA3-256 recipient hash, never the address or provider payload. The retention sweep removes delivery events and delivery records after their documented windows, and expired verification rows after a grace period. Suppressions remain. Revoking all sessions locks the user row before deleting sessions, so concurrent session creation is serialized against the revoke.

The outbox is a transactionally written delivery log for realtime doorbells, not event sourcing. The realtime service reads its explicitly granted projection and keeps presence in expiring Redis keys. Redis keys are validated and namespaced per deployment, with expiry set atomically; tests delete only their own namespace. Rate limiting uses atomic server-side operations and an explicit outage policy. No global flush or Redis-derived competitive outcome is permitted.

Round workspaces list the reader’s owned library documents and documents referenced
by that Round. Owned scratch documents from other Rounds stay outside the workspace;
removing a reference removes scratch from that workspace without deleting it.

AI practice yield requests carry the intended segment sequence (`segmentIndex`).
After clock hydration, the application checks that the same segment is open before
executing the yield, including when one tick catches up across several segments.
