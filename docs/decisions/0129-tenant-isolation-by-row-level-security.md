# 0129: Tenant isolation by row-level security

Status: accepted (owner direction, 2026-11-13; built in the Daisy Tab schema
slice, TAB-4, on the parent branch `pu/daisy-tab`,
[ADR 0128](0128-feature-parent-branch.md)). Amends section 6 of
[ADR 0048](0048-authorization-core.md): a league is self-serve, not
operator-created, and holds seasons and a ladder; the isolation requirement
of that section stands and this record is how it is met.

## Context

ADR 0048 section 6 required row-level security on every tenant-owned table
before the first league row, a start-up and `bun doctor` check, and scope
from rows loaded by id. No policy existed. Daisy Tab
([the architecture](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/lrp9sdclvjac1h76c3yxiob3)) adds organizations and lobbies, and a
tournament may be owned by a person or by a league, so one key has to serve
both.

## Decision

1. **Two isolation keys, `organization_id` and `lobby_id`.** There is no
   `tournament_id`: a tournament is a lobby. A tenant-owned row carries its
   key on every row, grandchildren included, and a composite foreign key
   onto the parent's unique `(id, key)` proves it equal to the parent's. A
   lobby's rows are keyed by `lobby_id` even when a league owns the lobby;
   holding the organization's scope does not open its lobbies' rows.
2. **A fence, not a second evaluator.** `authorize` still decides. After it
   allows, the operation opens its transaction through `withScope` in
   `@daisy/db`, the only code that sets the three transaction-local scope
   settings (organization, lobby, subject), from rows loaded by id. With no
   scope every policy predicate is null and the runtime role reads and
   writes no fenced row. The fence stops a query that forgot its `WHERE`.
   It does not stop SQL injection: the runtime role can set the same
   settings.
3. **A closed set of policy shapes.** Scope (all commands: the row's key is
   in scope); subject (`SELECT`: the row is about the person in the subject
   scope, across tenants); open read (`SELECT`: every row). Open read
   covers identity rows, which are listed across tenants, and definitions
   (templates, settings, ballot definitions), because one event's settings
   chain crosses up to three tenants and one transaction has one
   organization scope. Nothing private goes in a setting's value.
4. **A manifest and one mechanical check.** The manifest in `@daisy/db`
   names every tenant-owned table, its key and its shapes, and every exempt
   table with a reason. `tenantIsolationProblems` compares the catalog with
   it and reports a tenant-owned table without row-level security or with a
   policy that differs from its shape, an undeclared table that carries a key
   or references a tenant-owned table, a nullable key outside the one-of-two
   CHECK, any `tournament_id` column, and a privilege held by `PUBLIC` or
   the realtime role. It runs in an integration test, in `bun doctor` and at
   production start-up, which refuses to serve. The runtime-role check also
   refuses a role with `BYPASSRLS`.
5. **`ENABLE`, not `FORCE`.** The migration owner keeps access for
   migrations and fixtures; the runtime roles own no table, so the policies
   bind them.
6. **Exempt by name:** `rooms`, `ballots`, `seasons`, `ratings`,
   `rating_changes`, `formats` and `agreement_signatures`. An event Room and
   its ballots are protected by the evaluator alone, as a private Room is
   today, and a lobby's Room listing filters by `lobby_id` in the query.

## Consequences

- A read across tenants ("my tournaments", a directory, a league's season)
  goes through the subject shape, the open read shape or a registered
  `SECURITY DEFINER` function. Widening a policy by hand fails the check, by
  design. None of those functions exists yet; a league's read of certified
  results will be the first.
- Scope is transaction-local, so a fenced read outside a transaction sees
  nothing. That is safe, and it will surprise the first reader.
- A migration that adds a tenant-owned table adds its manifest entry and its
  policies in the same folder, so the check passes after every folder.
