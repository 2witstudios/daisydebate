# 0030: Effective rules and growth paths

Status: accepted. Extends [ADR 0029](0029-competitive-schema-foundation.md).

## Context

Custom lobbies are a launch feature: a player may start Foundation with
eight-minute speeches, no judge and unlimited prep. If every such lobby
created a `formats` row, format identity would fragment and, since ratings
key on `(actor, format, season)`, every rule permutation would open a new
ladder. At the same time the owner asked how the foundation copes with
clubs, leagues, tournaments, more standard formats, one user driving both
sides of a practice room, and growth. Most of those are additive; two are
not, and this ADR decides them now.

## Decision

1. **Effective rules live in the debate snapshot; `formats` holds the
   canonical identity and the canonical rules.** `debateSnapshotSchema` carries `rules: formatRulesSchema`,
   the exact rules the debate runs under, and `format` is any canonical slug
   (`^[a-z0-9][a-z0-9-]{0,63}$`), no longer the `'foundation'` literal. A
   lobby copies the canonical rules from `formats.rules` and applies its
   overrides in the snapshot. `debates.format` keeps pointing at the
   canonical row, so history, filtering and ladders stay grouped by format,
   and a debate stays replayable under its own rules after the canonical
   ruleset changes. No custom lobby ever writes a `formats` row.
2. **Ranked requires canonical rules.** A ranked debate must run under rules
   equal to its format's canonical rules on a `ranked_eligible` format.
   `rulesMatchFormat(rules, canonical)` in `@daisy/debate-engine` is the
   pure, key-order-independent check; the debate-creation command handler
   enforces it as a domain invariant. Casual and practice may override.
   Results of overridden debates never reach `rating_changes`.
3. **Seat capacity comes from the rules.** The engine rejects a join onto a
   side for which the rules offer no seat (`debate.seats.within-format`,
   registered in `spec/invariants.json`), and a debate starts only when
   every offered seat is filled and ready — so a one-seat practice format
   starts with one participant. Uniqueness of identities and seats is
   checked first, so a duplicate seat is reported as such. The engine seats
   at most one participant per side and says so
   (`debate.seats.capacity-supported`) rather than seating one and refusing
   the rest; team formats need slot modelling in the engine and are a later
   epic, not a schema change.
4. **Callers load rules from the format row.** `createDebateRuntime` takes
   `format` and `rules`; `@daisy/db` exposes `getFormat(id)` (validated with
   `formatRulesSchema`, refusing a stored value that no longer parses). The
   Scripts (the seeds, the scenario runner, the invariant fixtures) share
   the one definition in `scripts/format-seed.ts`; runtime code (the proof
   route, later the lobby) reads the seeded `formats` row that definition
   produced, so both sides agree on the same rules.

## Recorded paths (additive; decided, not built)

- **Sandbox actors, not relaxed uniqueness.** The one-actor-one-seat rule
  (`UNIQUE (debate_id, actor_id)`) stays: ballots and rating changes are
  keyed through that seat, and history must never read "Jono vs Jono". One user driving several lobby
  seats gets a `sandbox` value in `actors.kind` (text + CHECK; `user_id` may
  be NULL for non-humans), one sandbox actor per extra seat; who controls a
  seat is Redis room state (ADR 0008). Ranked refuses non-human actors.
- **`mode` versus provenance.** `mode` stays `casual | ranked | practice`
  and names competitive semantics. Where a debate came from (matchmaking,
  lobby, tournament, challenge) is a nullable context key or a `source`
  column added when a query needs it. Neither `lobby` nor `tournament` ever
  becomes a mode.
- **Format versions.** When a canonical ruleset changes, add
  `format_versions` and a nullable `debates.format_version_id`. The snapshot
  already preserves the rules every past debate ran under, so this is
  bookkeeping, not a migration of history. `rules.version` is the shape
  version of the rules object, not the ruleset version.
- **Clubs, leagues, tournaments.** New tables with nullable foreign keys onto
  `debates` and `actors` (`clubs`, `club_members(actor_id)`, `tournaments`,
  `tournament_entries(actor_id)`, `tournament_rounds`,
  `debates.tournament_id`). Membership and competition attach to actors;
  authority attaches to users by widening `role_grants.scope_type` with
  `club` and `league` (one CHECK swap). Expand-only.
- **League seasons are not rating seasons.** `seasons` is the rating epoch.
  A league calendar is its own table; a league may use the global ladder,
  its own standings, or none.
- **Retention and scale.** The growth tables are `debates`,
  `debate_participants`, `debate_commands`, `ballots` and `rating_changes`;
  every hot read is a single-index lookup. `debate_commands` is a dedupe and
  audit record and is pruned after the retry window, in the pattern of the
  verification purge (ADR 0025). `rating_changes` is history: partition by
  season when it reaches many millions of rows; never prune.
- **Access enforcement.** `visibility` and `role_grants` are stored but not
  yet read. The first reader (lobby listing, judge assignment) must enforce
  them.

## Consequences

- `formats.id` is a canonical slug (`foundation`, `ipda`), the one documented
  exception to cuid2 application identifiers (ADR 0018, ADR 0023): a format
  is a human-chosen name that must read the same in URLs, seeds and rating
  ladders, and it is never a bearer of anything.

- Protocol snapshot version stays 1 (pre-ship, ADR 0023): the `rules` field
  is required and the agent seed advances to `agent-seed-v4`.
- `createDebateRuntime` callers must supply `format` and `rules`; there is no
  default format.
- The PageSpace record is "Decision record — lobby rules and growth paths"
  in Plans → Lobby rules and growth paths.
