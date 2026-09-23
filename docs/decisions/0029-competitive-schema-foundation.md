# 0029: Competitive schema foundation

Status: accepted. Amends [ADR 0007](0007-postgresql-source-of-truth.md)
(what PostgreSQL holds) and [ADR 0018](0018-cuid2-identifiers.md) (no
database-minted identifiers on the new tables). Amended by
[ADR 0038](0038-drizzle-1-baseline.md): the migrations below are squashed
into one baseline, `debates.format`/`created_by` are `format_id` and
`created_by_actor_id`, `debate_participants` is keyed by
`(debate_id, actor_id)` and written in every snapshot transaction, ballots
reference their seat by `judge_actor_id`, and `db:seed` no longer writes
formats.

## Context

Until now `debates` held its participants inside the `snapshot` jsonb,
`created_by` pointed at the Better Auth `users` row, and nothing else
competitive existed. Some choices are painful to retrofit once rows exist:
what competitive foreign keys point at, what happens on account deletion,
how ratings are recorded, and how command retries are deduplicated.
Everything else (tournaments, recordings, motions, agents, moderation) is
additive later with a nullable foreign key. This ADR fixes the foundation
and nothing more: tables, one migration, constraint tests, seeds. The
engine, the protocol commands and the routes keep their behaviour.

## Decision

1. **Actors, not users, own competitive history.** `actors` is the
   competitive identity (`kind` is `'human'` today; `'agent'` is a forward
   migration). Every competitive foreign key (`debates.created_by`,
   `debate_participants.actor_id`, `debate_commands.actor_id`,
   `ballots.voided_by_actor_id`, `ratings`, `rating_changes`) references
   `actors(id)` with `ON DELETE RESTRICT`. A human actor has exactly one
   user (`UNIQUE user_id`, CHECK). Actors hold no PII; public identity
   (`username`) stays on `users`. Engine snapshot participant IDs are actor
   IDs. Authority is the exception: `role_grants` attach to `users`,
   because permissions belong to the account.
2. **Account deletion tombstones the user.** `users.deleted_at` plus the
   CHECK `users_tombstone_scrubbed` (a tombstone has `email`, `username`,
   `image` NULL and `name = ''`) make a tombstone with PII unrepresentable.
   The deletion transaction, to be implemented by the account-deletion
   feature, is: scrub PII; delete the user's `session`, `account`,
   `passkey` and `verification` rows (the `users` cascades never fire,
   because the row is not deleted); revoke active `role_grants`; set
   `deleted_at`; leave `actors` and all competitive history untouched. One
   transaction. `email_delivery*` rows hold only keyed recipient hashes (ADR 0025) and are retained so a suppression survives the account. No delete
   endpoint ships with this ADR.
3. **No backfill.** Pre-ship there are no deployed consumers (ADR 0023) and
   cuid2 cannot be minted in SQL, so the migration `TRUNCATE`s `debates`
   (proof-route rows only) before re-pointing `created_by` at `actors` and
   adding the NOT NULL lifecycle columns. No compatibility mapping exists.
4. **Projections are written in the same transaction as their source.**
   The snapshot stays the domain source of truth. `debates.phase`,
   `started_at`, `completed_at` and `outcome` are projections of it, kept
   coherent by `debates_lifecycle_check` (`waiting` ⇒ nothing set;
   `active` ⇒ `started_at` only; `completed` ⇒ `completed_at` and
   `outcome`, and `started_at` unless the outcome is `abandoned`).
   `saveSnapshot` writes `phase` (read from the snapshot, never supplied
   separately), stamps `started_at` on the first save that
   becomes `active`, and `completed_at` plus the caller's `outcome` on the
   save that completes; completion leaves `started_at` as it was, so a
   debate abandoned from `waiting` keeps a NULL start. An outcome is
   required when completing and refused otherwise, before any statement
   runs. `debate_participants` is the same kind of
   projection; its writer lands with the first command consumer.
   `ratings` is a projection of `rating_changes`.
5. **Independent data only.** No per-participant result column (derive
   from `debates.outcome` and `role`), no `games_played`, `peak_rating` or
   `last_rated_at` (derive from the ledger), no stored provisional flag or
   tier.
6. **One participation table.** `debate_participants` keys a seat as
   `(role, slot)` over the one role vocabulary; judges are seats, team
   formats and judge panels are more slots. `UNIQUE (debate_id, role, slot)`
   and `UNIQUE (debate_id, actor_id)`. Which seats a format allows is
   `formats.rules.seats`, an exhaustive `Record<DebateRole, number>`; the
   domain validates it, the database enforces uniqueness.
7. **One role vocabulary.** `debateRoles` (`affirmative`, `negative`,
   `judge`) lives once in `@daisy/protocol`, with the derived `DebateRole`
   type and zod enum. The `role` CHECK and the seat map derive from it.
   Spectators are Redis presence, not a durable role.
8. **Glicko-2, one debate is one rating period.** `ratings` holds
   `rating`, `deviation`, `volatility` (double precision, bounded by CHECK)
   per `(actor, format, season)`. `rating_changes` is the append-only
   ledger with before/after triples, `UNIQUE (debate_id, actor_id)` and a
   `calculation_version` naming the formula, so a formula change never
   rewrites history. Composite keys tie each change to a participant of the
   debate (`(debate_id, actor_id)` → `debate_participants`) and to the
   debate's own format (`(debate_id, format_id)` → `debates(id, format)`).
   Deviation and volatility must be positive **and finite**: PostgreSQL
   orders `NaN` and `+infinity` above every number, so `> 0` alone would let
   one unstable calculation poison the ledger. A `rating_period_id` would be
   an additive column later. `seasons` allows at most one `active` row
   (partial unique index).
9. **Command idempotency is durable.** `debate_commands` is keyed by the
   protocol `commandId`, stores a SHA3-256 `payload_digest` (so a retry with
   a different body is detected), the replayable `result`, the
   `resulting_version`, and exactly one principal (`actor_id` xor
   `service_id`). It is a dedupe and audit record, not event sourcing.
10. **Text plus CHECK, never `pgEnum`.** Every status column is `text` with
    `CHECK (col IN (...))`; widening a vocabulary is a forward migration
    that alters one constraint, not a type.
11. **Foreign-key actions.** Competitive rows → `RESTRICT`; children of a
    debate (`debate_participants`, `debate_commands`, `ballots`) →
    `CASCADE` from `debates`; only the auth tables cascade from `users`.
    `rating_changes.debate_id` is `RESTRICT`: a rated debate is history.
12. **`@daisy/db` may depend on `@daisy/protocol`.** The only new package
    edge; protocol stays pure zod and never imports db. The
    `formats.rules` type, the role and phase CHECKs and the `phase`
    projection all come from protocol. The root workspace (not a package)
    also declares protocol so `scripts/seed.ts` can validate format rules.
13. **Children are keyed to their debate.** `ballots(debate_id,
participant_id)` references `debate_participants(debate_id, id)`, so a
    ballot can never name one debate and a seat from another; the same
    pattern couples `rating_changes` (item 8). Two independent foreign keys
    would have accepted the mismatch and let either cascade remove the row.
14. **Reference data ships with the schema.** `debates.format` is a foreign
    key, so migration 0002 inserts the `foundation` format (`ON CONFLICT DO
NOTHING`); its slug id is deterministic, so ADR 0018 is not in conflict.
    `scripts/seed.ts` is a development fixture (agent users, actors, a seed
    debate) that also refreshes the row; it never runs in production.

## Consequences

- Migration `0002_sad_wendell_vaughn.sql` adds `actors`, `formats`,
  `debate_participants`, `debate_commands`, `ballots`, `seasons`, `ratings`,
  `rating_changes`, `role_grants`, the `users` tombstone and the `debates`
  lifecycle columns; it truncates `debates` first.
- `createDebate` requires `mode` and `visibility`; `DebateRecord` exposes
  `mode`, `phase`, `visibility`, `startedAt`, `completedAt` and `outcome`.
  The proof route creates `casual` + `unlisted` debates with no author.
- The `foundation` format ships in migration 0002 and is refreshed by
  `scripts/seed.ts` (`seed_versions` marker `formats`); it is deliberately
  unjudged (`judge: 0`) because the engine has no judge operation.
  `scripts/agent-seed.ts` seeds one actor per agent user and the seed
  debate's author is an actor (`agent-seed-v3`); reseeding resets a
  progressed seed debate's lifecycle projections to `waiting`.
- Five suites under `packages/db/integration/` prove a rejecting and an
  accepting case for every CHECK, UNIQUE and FK named here:
  `competitive-constraints` (tombstone, actors, formats, role grants),
  `competitive-debate-constraints` (debates, participants),
  `competitive-command-constraints`, `competitive-judging-constraints`
  (ballots, cascade graph) and `competitive-rating-constraints` (seasons,
  ratings, ledger), sharing `constraint-helpers.ts`, whose `rejectedBy`
  reports the constraint PostgreSQL named.
- The engine's `participantSchema.side` (`affirmative | negative`) is the
  competitive side of a debater and remains narrower than `DebateRole`;
  widening the engine to judges is a domain change, not a schema one.
