# 0135: Leagues are organizations

Status: accepted (owner direction, 2026-11-13: decisions 19, 33 and 35 of
the Daisy Tab direction page; recorded by the Daisy Tab commands-and-reads
slice, TAB-5.16). Supersedes section 6 of
[ADR 0048](0048-authorization-core.md) ("Leagues are future tenants"), and
extends its sections 2 and 3. Builds on
[ADR 0129](0129-tenant-isolation-by-row-level-security.md) (isolation),
[ADR 0130](0130-organizations-grants-and-action-history.md) (grants),
[ADR 0131](0131-the-lobby-is-the-one-container.md) (lobbies) and
[ADR 0132](0132-settings-and-templates.md) (settings).

## Context

ADR 0048 section 6 described a league as an operator-created tournament
tenant that never holds a season or a ladder, with no table, scope or
evaluator rule until a later epic built them. The Daisy Tab direction
reversed three of those statements: a league is an organization a person
creates, a league owns a standing lobby with its own ladder and seasons, and
a league's season counts tournament results through sanctions. The schema
(ADR 0129 to 0133) and the evaluator now carry leagues, so section 6 no
longer describes the system.

## Decision

1. **A league is an organization of kind `league`.** It is created by the
   `create-organization` command, by an adult account. Hosting a league is
   paid; the command surface carries the paid-hosting fact and nothing else
   about payment. It is not made by the operator, though the operator gives
   Daisy's first grants (ADR 0130).
2. **A league owns standing lobbies, a ladder over its own lobby, and
   seasons.** A ladder belongs to a standing lobby; a tournament never owns
   one, and an event Room never posts to a ladder itself. A league's ladder
   rates only its own lobby's rated Rooms; Daisy's ladders take nothing from
   a league or a tournament.
3. **A league's season counts certified results of sanctioned events**, and,
   where the league chooses, its own lobby's Rooms. A sanction is a league's
   yes to an event that meets everything the league's template enforces; it
   gives the league no authority over the tournament.
4. **Authority is grants read by the one evaluator** (ADR 0130), at an
   organization or a lobby. ADR 0048 section 2's per-capability metadata now
   lives in `@daisy/protocol` (`capability-metadata.ts`: resource kinds, lobby
   and organization kind, read, grantable, conflict-sensitive, reach), and an
   allowed decision names the authority it was allowed under (fixed, owner,
   grant, relationship) and any conflict. Section 3's rule stands: a denied
   read answers as a missing resource.
5. **What section 6 required and still holds.** Isolation comes first: row
   level security on every tenant-owned table (ADR 0129). Tenant scope comes
   from rows loaded by id, never client input. A league's own formats are
   templates of that organization and are never `ranked_eligible`. Daisy's
   public lobby, Watch and Daisy's leaderboards read only Daisy's lobbies.

## Consequences

- `role_grants` stays dropped; grants are the only authority rows.
- The league lobby, ladder, season and sanction commands are part of the
  lobby command surface; their contracts are in `@daisy/protocol/lobby/*`.
- Whether a tournament on a Daisy template counts toward a Daisy ladder is
  answered: it does not.
