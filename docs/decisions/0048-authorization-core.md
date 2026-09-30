# 0048: The authorization core

Status: accepted (AZC-1.1; owner-approved plan of 2026-09-29, revision 4),
amended 2026-09-30: members host ranked debates (see
[Amendment (2026-09-30)](#amendment-2026-09-30-members-host-ranked-debates)).
Amends [ADR 0029](0029-competitive-schema-foundation.md),
[ADR 0030](0030-effective-rules-and-growth-paths.md),
[ADR 0031](0031-realtime-service.md) section 5,
[ADR 0019](0019-token-secret-ownership.md) and
[ADR 0036](0036-privacy-by-design.md) section 3, each in its own
`## Amendment (2026-09-29)` section. Decisions marked open at the end were
made on the owner's behalf and stay open until the owner confirms or
overrules them.

## Context

Daisy launches with two kinds of play: ranked play on one public ladder,
the Daisy league, and unranked play (casual and practice debates, any
format, public, unlisted or private) that belongs to no ladder. Every access
question at launch has to be answered by one pure function from facts
loaded fresh per request, so that HTTP pages, API reads, realtime
subscribes and UI hints ask it the same way.

Until this record, `@daisy/auth` carries a flat permission list on every
principal, no league data exists, and `visibility` is stored but never
read (ADR 0030). This ADR decides the model, the evaluator, the schema
guard and the seams between packages. The work that builds it is the AZC
leaves named below; roles, grants, audit and row-level security belong to a
later epic (LEAGUE-OPS) and are named as future work only.

## Decision

### 1. The model

| Concept         | What it is                                                                                 | Where it lives                           |
| --------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| League          | A ranked ladder: `id`, `slug`, `name`, `visibility`, `membership_policy`, `is_default`     | `leagues`                                |
| Membership      | "Actor A is on ladder L": an active `league_members` row                                   | `league_members`                         |
| Ranked debate   | A debate with a league. `mode = 'ranked'` exactly when `league_id` is set                  | `debates.league_id`                      |
| Unranked debate | A debate with no league (`casual` or `practice`, any format)                               | `debates.league_id IS NULL`              |
| Season, rating  | Per league, per ladder                                                                     | `seasons.league_id`, `ratings.league_id` |
| Capability      | A closed vocabulary of things that can be asked                                            | `@daisy/protocol`                        |
| Decision        | `authorize(principal, capability, resource, context)` returns allow, or deny with a reason | `@daisy/auth`, pure                      |

The rules of the model:

- **A league is a ranked ladder, and ranked is a league.** Every debate in a
  league is ranked, and `mode = 'ranked'` holds exactly when `league_id` is
  set. An unranked debate has no league. Ratings and seasons are per league.
- **The Daisy league is an ordinary league row.** It is the public ranked
  ladder Daisy promotes. Its differences from any other league are
  properties (`visibility`, `membership_policy`, `is_default`), never an id
  check. The one singular fact is the constrained default pointer
  (`is_default`, read only by `getDefaultLeague()`). Other leagues are
  white-label tenants, mainly for tab software, and no league other than
  Daisy exists until the second-league guard (section 6) is lifted.
- **Membership is a plain fact, not RBAC.** An active row means "on this
  ladder" and grants no power beyond the member baseline (viewing a private
  league). Roles (owner, director, custom) add powers, ship later and all
  together in LEAGUE-OPS. The join policy (`open` or `explicit`) decides only
  how membership starts, and never grants powers.
- **Identity, place and authority are separate questions.** The principal
  answers who is asking, the resource's rows answer where it lives, and
  grants (none exist yet) answer what authority the principal holds.
- **No platform scope inside `apps/web`.** The operator plane is a separate
  future admin app ([ADR 0043](0043-no-admin-surface-in-participant-app.md)).
- **A provisional account has no actor,** so it is a member of nothing and
  can neither create nor join.
- **Members host ranked debates.** Any active member of a league, like any
  user with an actor for unranked play, may create a debate in it: a
  hosted ranked table is an open challenge, posted the way a chess.com seek
  is. Who may take a seat in a hosted ranked debate (rating band, format
  eligibility) is seating policy, owned by the Ratings epic, not an
  authorization capability.
- **Creating a debate seats no one.** The engine starts every debate with no
  participants and creation, ranked or unranked, adds none. A private debate's creator
  can read it and subscribe to its presence (the creator fact) but is
  refused its chat until seated (section 8). Seating comes from lobby and
  seating flows, which are out of scope. The scope chain of a resource (a
  debate, then its league) always comes from rows loaded by id, never from
  client input.

### 2. Vocabulary (`@daisy/protocol`)

Capabilities are a const array with a derived zod enum and per-capability
metadata: `resourceKinds` lists what the capability can be asked of, and
`read` says whether it is a read capability.

| Capability      | `resourceKinds`      | Read | Allowed by (this epic)                                                        |
| --------------- | -------------------- | ---- | ----------------------------------------------------------------------------- |
| `league.view`   | `league`, `season`   | yes  | a public league: everyone. A private league: its active members               |
| `league.join`   | `league`             | no   | an open league, for a user with an actor who is not an active member          |
| `debate.create` | `league`, `unranked` | no   | `unranked`: any user with an actor. `league`: an active member of that league |
| `debate.read`   | `debate`             | yes  | the debate's visibility rules, seating and creation (section 3)               |

- **Resource kinds:** `league | debate | season | unranked`. `unranked` is the
  resource asked when creating an unranked debate: `{ kind: 'unranked' }`.
- **Deny reasons:** `denied` (invalid resource kind), `account-erased`,
  `unauthenticated`, `not-member`, `missing-capability`. Every value has
  privacy category `none`, and the union is the `denyReason` log vocabulary
  (amendment to ADR 0019 below).
- **Grant scopes**, used only by the pure grant path until LEAGUE-OPS adds
  grant tables: `league | debate`. No tournament or round scope exists;
  TOURN-1 adds them.
- `league.join` is never grantable. Only the fixed rule in section 3 allows
  it.

The vocabulary is delivered by AZC-1.2.

### 3. The evaluator (`@daisy/auth`, pure)

```text
authorize({ principal, capability, resource, context }) →
  { allow: true } | { allow: false, reason }
authorizeInbox({ principal, inboxActorId, denyFacts }) →
  { allow: true } | { allow: false, reason }
```

**Principals:**

- `anonymous`
- `user { userId, actorId | null }`: `resolveIdentity` loads `actorId` through
  the same actor lookup the realtime ticket uses, so the two always agree
- `service { serviceId, scope: { kind: 'league', leagueId } | { kind: 'unranked' }, capabilities }`

A principal carries no permissions. A service holds a fixed capability list.

**Resources:** `league { leagueId, visibility, membershipPolicy }`,
`debate { debateId, visibility, createdByActorId, league: <league resource> | null }`,
`season { seasonId, league }` and `unranked {}`.

**Context** (loaded, section 5):

- `member`: whether the principal's actor has an active membership in the
  resource's league
- `seated`: whether the actor holds a seat in the debate
- `grants`: `{ leagueId, capabilities, scope }[]`, always empty until
  LEAGUE-OPS
- `denyFacts`: `account-erased` when the principal's user is tombstoned

**The five rules, in order, plus the resource-kind guard. The reason is
that of the first rule that decides.**

0. **Resource kind.** If `resource.kind` is not in the capability's
   `resourceKinds`, deny with `denied`. This guard sits at the top of
   `authorize`, so nothing below can allow such a request.
1. **Deny facts.** If a deny fact is present, deny with that fact
   (`account-erased`). Rule 0 runs first, so for a valid (capability,
   resource kind) pair a deny fact dominates every allowance, including
   seating and creation.
2. **Service.** For a service principal, allow if and only if its scope
   matches the resource (the same league, or `unranked` for an unranked
   debate or the `unranked` resource) and it holds the capability.
   Otherwise deny with `not-member` when the scope differs and
   `missing-capability` when it does not hold the capability. Rules 3 and 4
   never apply to services.
3. **Grant path.** Allow if a grant whose `leagueId` is the resource's
   league, and whose scope is on the resource's chain, holds the
   capability. The chain is the league, plus the debate for a debate
   resource. An unranked resource has no chain, so no grant reaches it. The
   path exists in the pure function now so that LEAGUE-OPS adds tables, not
   semantics; the loader always supplies `grants: []` in this epic.
4. **Fixed allowances** (not editable):
   - `league.view` on a public league: everyone. On a private league: its
     active members (the member baseline).
   - `league.join` on a league whose `membershipPolicy` is `open`: a user
     with an actor who is not an active member.
   - `debate.create` on `unranked`: a user with an actor.
   - `debate.create` on a league: a user with an actor who is an active
     member of that league (`context.member`).
   - `debate.read` of an unranked debate: `public` or `unlisted`, everyone;
     `private`, the creator and the seated.
   - `debate.read` of a ranked debate: `public` or `unlisted`, whoever holds
     `league.view` on its league; any visibility, the seated and the
     creator.
5. **Otherwise deny,** with `unauthenticated` for an anonymous principal;
   `not-member` for a user asking about a league-owned resource in a league
   where the user is not an active member and holds no grant; and
   `missing-capability` in every other case, including every unranked
   denial.

A creator or seated fact allows `debate.read` of **that** debate only.
`authorizeInbox` allows if and only if the principal is a user whose
`actorId` is non-null, equals `inboxActorId`, and no deny fact is present.
An inbox belongs to no league, and no capability applies to it.

**Public results.** The delivery layer maps them, and the mapping never
depends on the reason:

- A denied **read** capability (`league.view`, `debate.read`), whether asked
  as the operation's gate or later, returns `NOT_FOUND` for every principal,
  anonymous included, so no existence oracle is exposed. A resource that
  does not exist returns the same `NOT_FOUND`.
- A denied **non-read** capability (`league.join`, `debate.create`),
  including a non-read gate such as unranked creation, returns
  `AUTHENTICATION` for an anonymous principal and the existing `participant`
  redirect for a provisional user. For everyone else it returns
  `AUTHORIZATION`.
- An `unavailable` identity (the session store is down) never reaches
  `authorize`: `authorizeRequest` answers the existing 503 first, and a
  realtime subscribe fails closed with the existing unavailable error, not a
  denial.
- The reason goes only to the `denyReason` log field.

**Gates.** Every operation authorizes exactly one gate before any other
check or protected read:

| Operation                                                                          | Gate, then                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Debate read by id (page, JSON), `debate:<id>` and `debate:<id>:presence` subscribe | `debate.read` on the debate                                                                                                                                                          |
| `debate:<id>:chat` subscribe                                                       | `debate.read` on the debate, and for a `private` debate the seated fact as well (the chat family's narrowing, section 8)                                                             |
| League page                                                                        | `league.view` on the league                                                                                                                                                          |
| Join                                                                               | `league.view`, then `league.join`                                                                                                                                                    |
| Leave                                                                              | `league.view` (then the membership check in the operation)                                                                                                                           |
| Unranked creation                                                                  | `debate.create` on `unranked`                                                                                                                                                        |
| Ranked creation (hosting a ranked debate)                                          | `league.view`, then `league.join` only for a non-member of an open league (the creation operation's implicit join, section 9), then `debate.create` on the league (an active member) |
| Season read (no route in this epic) and `standings:<seasonId>` subscribe           | `league.view` on the season's league                                                                                                                                                 |
| `user:<actorId>:inbox` subscribe                                                   | `authorizeInbox`                                                                                                                                                                     |

**Properties**, proven by property tests over generated principals,
resources and contexts:

- **Foreign ancestry:** facts, grants or memberships in any league other
  than the resource's never change a decision.
- **Deny dominance:** with `account-erased` present, every capability asked
  of a resource kind in its `resourceKinds` is denied with `account-erased`.
  An invalid pair is denied by rule 0 with `denied` first.
- **Resource kinds:** no capability is ever allowed for a resource kind
  outside its `resourceKinds`.
- **Monotonicity:** for every capability except `league.join`, adding a
  grant or membership never removes an allow, and removing one never
  creates an allow. For `league.join`, an active membership always denies
  it, and it is allowed only for a non-member on an open league.
- **Fact locality:** seated and creator facts change only `debate.read` of
  their own debate.
- **Unranked isolation:** no league fact, membership or grant changes any
  decision on an unranked resource or an unranked debate.
- **Scope validity:** no grant allows a capability at a scope outside the
  capability's valid scopes.

The evaluator is delivered by AZC-1.3. `@daisy/auth` gains the edge to
`@daisy/protocol` (section 10).

### 4. Schema (one forward migration, AZC-2.1)

**`leagues`:**

- Columns: `id` (cuid2), `slug` (unique), `name`, `visibility`
  (`public|private`), `membership_policy` (`open|explicit`), `is_default`,
  `version`, `created_at`, `updated_at`. Enums are text plus CHECK.
- CHECK `membership_policy = 'open'` implies `visibility = 'public'`.
- A partial unique index on `is_default` where true.
- **`leagues_single_row`**, a unique index on the constant expression
  `((true))`. It admits at most one row: the second-league guard at the
  database (section 6).

**The Daisy row** is reference data the migration inserts: a cuid2 literal
minted at authoring time, slug `daisy`, `public`, `open`, `is_default`.
`scripts/reference-leagues.ts` holds the literal, and a test keeps it equal
to the SQL. `getDefaultLeague()` is the only reader of `is_default`.
`bun doctor`, and web and realtime startup, fail unless exactly one default
row exists.

**`league_members`:**

- Columns `league_id`, `actor_id`, `joined_at`, `left_at`. Primary key
  `(league_id, actor_id)`. CHECK `left_at IS NULL OR left_at >= joined_at`
  (a join and a leave in the same millisecond is valid under an injected
  clock).
- Active means `left_at IS NULL`. Rejoining clears `left_at` and sets a new
  `joined_at` on the existing row.
- Foreign keys go to `leagues` and `actors` with `ON DELETE RESTRICT`;
  erasure deletes rows explicitly (section 9).

**Debates, seasons and ratings:**

- **`debates.league_id`:** a nullable foreign key to `leagues`, with CHECK
  `debates_league_iff_ranked`: `(league_id IS NOT NULL) = (mode = 'ranked')`.
  An index on `(league_id)`.
- **`seasons.league_id`:** `text NOT NULL`, foreign key to `leagues`, with
  `UNIQUE (id, league_id)`. `seasons_single_active` is replaced by a unique
  index on `(league_id)` where `status = 'active'`: one active season per
  league. This closes ISSUE-86 when AZC-2.1's migration lands.
- **`ratings.league_id`:** `text NOT NULL`, with a composite foreign key
  `(season_id, league_id)` to `seasons (id, league_id)`. The primary key
  becomes `(league_id, actor_id, format_id, season_id)`.

**No TRUNCATE and no expand default.** Every existing debate row is `casual`
or `practice` (no ranked writer exists and no format is ranked-eligible), so
each satisfies `debates_league_iff_ranked` with a NULL league. `seasons` and
`ratings` have no writer outside tests, so they are empty in every deployed
environment. Adding a NOT NULL column without a default to a non-empty
table fails, so a non-empty staging database fails the migration loudly
rather than silently. Staging is expendable until first ship (owner), and
the runbook step is to reset it. The migration states this in a header
comment.

**Immutability.** The trigger function `daisy_forbid_league_reassignment()`
takes the protected column name as its trigger argument (`TG_ARGV[0]`):
`league_id` on `debates`, `seasons`, `ratings` and `league_members`, and
`id` on `leagues`. It runs `BEFORE UPDATE` and raises when that column
changes, compared with `IS DISTINCT FROM`, so it also raises on NULL to
value and value to NULL. It binds the table owner too. Its body is
schema-qualified with `SET search_path = pg_catalog, public, pg_temp`.

**Privileges.**

- `daisy_web`: on `leagues`, SELECT only (INSERT, UPDATE and DELETE are
  revoked, because no web path writes leagues); on `league_members`,
  SELECT, INSERT, UPDATE `(joined_at, left_at)` and DELETE, the last for
  erasure only (PRIV-4).
- `daisy_realtime`: SELECT on `leagues(id, visibility, membership_policy,
is_default)`, `league_members(league_id, actor_id, left_at)`,
  `seasons(id, league_id)` and `users(id, deleted_at)`. It already has
  `debates` and `debate_participants`. The `seasons` grant serves
  `standings:<seasonId>`.

The migration ends with the explicit REVOKEs that the baseline's default
privileges require ([ADR 0038](0038-drizzle-1-baseline.md)).

### 5. Loader and composition

The loader is shared by `apps/web` and `apps/realtime`, and neither app may
import the other (ADR 0031 section 12). `@daisy/db` may not import
`@daisy/auth`; its edges stay `config`, `errors` and `protocol`. So the
composition has three parts:

- **`loadAuthorizationContext(db, { actorId, userId, resourceRef })`** lives
  in `@daisy/db` (`packages/db/src/league-scoped/`). It returns a plain,
  structurally typed projection of rows and facts, with no `@daisy/auth`
  types. It reads the resource by id, and the chain from the rows it read
  (a debate, then its league row when `league_id` is set; a season, then
  its league; a league by id or slug). Then it reads the principal's facts:
  active membership in that league, seating (`debate_participants` for the
  actor) and `users.deleted_at` for the `account-erased` fact. It supplies
  `grants: []` and keeps no cross-request cache. It selects only columns
  that both `daisy_web` and `daisy_realtime` may read (section 4).
- **`toAuthorizationInput(projection, principal)`** is a pure mapper in
  `@daisy/auth` that builds the resource and context `authorize` takes. It
  ignores any league id not read from a row.
- Each app composes the two: `apps/web` in `authorizeRequest`, `apps/realtime`
  in its subscribe decision (section 8).

**`authorizeRequest(principal, capability, resourceRef)`** first answers the
existing 503 for an `unavailable` identity, without loading or deciding.
Otherwise it loads, calls `authorize`, logs a denial with `denyReason`, and
throws the public error (section 3) or returns the loaded resource. It is
the only way an operation reaches a protected read.

**Identity.** `resolveIdentity` stops producing permissions, `Principal`
loses `permissions`, and `requirePermission` and `Permission` are deleted
with their tests in the same change, a total transition (ADR 0023). The
foundation proof, which stays dev-only, becomes
`{ kind: 'service', serviceId: 'foundation-proof', scope: { kind: 'unranked' }, capabilities: ['debate.create', 'debate.read'] }`
and goes through `authorizeRequest`.

**UI capability projection.** The server runs `authorize` for the
capabilities a page needs and passes only booleans to client components (for
example `{ canJoin, canLeave, canCreateUnranked, canHostRanked }`). Membership lists,
grants, deny facts and loaded rows never reach the browser, and a page never
computes an access decision on the client.

AZC-3.1 delivers the loader, `authorizeRequest`, identity without
permissions and the foundation proof.

### 6. Query scope and isolation, and the second-league guard

Isolation at launch rests on two layers. The third, row-level security
(RLS), lands with LEAGUE-OPS before any second league can exist.

- **The required scope in the query API.** Every operation that reads or
  writes a league-owned table takes a branded
  `DebateScope = { kind: 'league', leagueId } | { kind: 'unranked' }`,
  minted only by `resolveScopeById`, `getDefaultLeague` or a test factory.
  - **`resolveScopeById(db, { debateId | seasonId })`** is the one exception:
    the only unscoped by-id read of a league-owned table. It returns the
    row's scope and nothing else, and the loader calls it first.
  - Operations on an existing record (the engine's version-checked
    lifecycle updates) take the scope from the record they loaded, never
    from input.
  - `database.inLeague(scope, fn)` and `database.inUnranked(fn)` open a
    transaction and set the transaction-local `daisy.league_id` with
    `set_config(..., true)` to the league id or the sentinel `'unranked'`,
    which a cuid2 can never equal. Queries also filter explicitly:
    `league_id = $scope`, or `league_id IS NULL` for unranked. When
    LEAGUE-OPS adds RLS policies keyed on the setting, it only adds to what
    exists.
- **The static check.** `leagueTableAccessIssue` in
  `scripts/boundaries-rules.ts` refuses any value import of a league-owned
  table's schema module outside `packages/db/src/league-scoped/`.
  Type-only imports (`import type`, and `export type` re-exports) are allowed
  anywhere, since they cannot issue a query. Four named exemptions, each
  with a fixture: schema files that declare a foreign key to a league-owned
  table, migrations, `@daisy/db` constraint tests
  (`packages/db/integration/*`) and `@daisy/db` unit tests
  (`packages/db/src/*.test.ts`). The check reads imports, not SQL text:
  test-only raw SQL on league-owned tables in `apps/web/integration/*` is
  allowed, and production code reaches league-owned tables only through the
  scoped API, which review enforces.
- **Runtime-role facts.** `daisy_web`, `daisy_realtime` and `daisy_e2e` are
  not superusers, do not have BYPASSRLS, own no table, and are not members
  of the migration owner role. Only the migrator owns tables. A catalog test
  proves it.
- **The pooled connection.** A connection reused after COMMIT or ROLLBACK
  has no `daisy.league_id` set, and a test proves it.

**The second-league guard.** No second league may exist until RLS is enabled
on every league-owned table.

- **The enforcing index** is `leagues_single_row`: the database refuses a
  second `leagues` row.
- **The enforcing check** is `secondLeagueGuardIssue`, run by `bun doctor`
  and by web and realtime startup. It finds `leagues_single_row` **by its
  definition in `pg_index`**, never by name: on `public.leagues`
  (`indrelid = 'public.leagues'::regclass`), unique, valid, a single constant
  expression and no predicate. When no such index exists, it fails unless
  every table in `leagueOwnedTables` has `relrowsecurity = true` **and** at
  least one `pg_policy` row.
- **League-owned** means a table that has a `league_id` column, or reaches a
  league-owned table through a foreign key. At launch that is `leagues`,
  `league_members`, `debates`, `seasons`, `ratings`, `debate_participants`,
  `debate_commands`, `ballots` and `rating_changes`. `@daisy/db` exports the
  list as `leagueOwnedTables`, and a test derives the same set by walking
  `pg_constraint`, seeded with `leagues` plus every table that has a
  `league_id` column, so a new table cannot slip past the guard.
- LEAGUE-OPS drops the index in the same migration that enables RLS, with
  policies, on every league-owned table. Dropping the index alone leaves the
  guard failing. Policy correctness remains that epic's review: no catalog
  check proves it. Under RLS, `resolveScopeById` becomes a hardened definer
  function, because a caller cannot see a row before it knows the scope.

AZC-2.1 delivers the migration and its `leagues_single_row` index, and
AZC-2.2 the scoped API, the static check, the catalog facts and
`secondLeagueGuardIssue`.

### 7. Join and leave (AZC-3.2)

- **Join** (`POST /leagues/[slug]/join`): the gate is `league.view`. An
  actor who is already an active member gets no write and a redirect, so
  the operation is idempotent. Otherwise it authorizes `league.join` and, in
  one transaction under `inLeague`, inserts the row or reactivates a departed
  one: `INSERT … ON CONFLICT (league_id, actor_id) DO UPDATE SET joined_at =
$now, left_at = NULL WHERE league_members.left_at IS NOT NULL`.
- **Leave** (`POST /leagues/[slug]/leave`): the gate is `league.view`. With
  no active membership the operation writes nothing and redirects.
  Otherwise it sets `left_at = $now`.
- **Forms** follow the UI conventions: the form's server action calls the
  route's handler through `inProcessFetch` and ends with `moveOn` (a 303
  without JavaScript). The route runs `requireSameOrigin` before anything
  else, so a cross-site or `Origin: null` POST is refused and writes
  nothing.
- **Who can end a membership.** There are no staff removals: no roles exist,
  so leaving is the only way a membership ends. Erasure deletes rows
  (PRIV-4).
- **No audit table and no realtime event in this epic.** The membership row
  with `joined_at` and `left_at` is the whole record; no one can act on
  another person's membership, so there is no authority to account for.
  Joining or leaving changes no read decision, because only open leagues
  accept joins and an open league is public. LEAGUE-OPS adds
  `authorization_audit` and `access.changed` together with staff adds and
  removals and with explicit leagues gaining members.
- Membership still matters now: it is the "on this ladder" fact that the
  Ratings epic's ranked seating requires.

### 8. Realtime subscribe (AZC-1.3, AZC-3.4)

`apps/realtime` declares `@daisy/auth`. `authorizeSubscribe(topic,
principal, input)` is pure, lives in `@daisy/auth`, and maps each of the five
topic families to one decision (the table is ADR 0031 section 5, amended
below). AZC-1.3 delivers the pure function; AZC-3.4 has the subscribe
registry (RT-2.5a) call it over the shared loader (section 5). A denied or
failed decision refuses the subscribe.

- Sockets require a ticket, and tickets are issued only to signed-in members
  with an actor, so an anonymous principal never subscribes. A public or
  unlisted debate's topics are open to every ticket holder.
- **`unlisted` is a listing flag, not access control.** An unlisted debate
  is left out of listings, but anyone who has its id may read it and
  subscribe to it. cuid2 ids are identifiers, never bearer secrets
  (AGENTS.md), so privacy requires `private`.
- `debate:<id>:chat` on a private debate keeps ADR 0031 section 5's "seated
  roles only" narrowing; the chat epic may redefine it.
- **Cross-epic contract with the RT epic.** RT-2.5c's periodic
  re-authorization calls the same composition and fails closed: a recheck
  that cannot run drops the subscription. Its session revalidation covers
  erasure (`session.revoked`) and ended sessions. `subscription.revoked`,
  the enforcement deadline and the revocation SLA are defined and proven in
  the RT epic. This epic changes no realtime message: at launch, access to a
  subscribed debate can change only through erasure or session end, and
  both are handled by revalidation. The visibility and seating writers for
  unranked debates arrive later, and their epics add the events they need.

### 9. Cross-epic contracts

- **PRIV-4 (privacy and telemetry).** Erasure deletes the actor's
  `league_members` rows in the erasure transaction, and the tombstone yields
  the `account-erased` deny fact through the loader. LEAGUE-OPS later
  extends erasure to grants and audit.
- **Ratings.** It owns the ranked-debate creation operation (a hosted table
  and a matchmade pairing both run through it, gated by `debate.create` on
  the league, section 3), the implicit join (hosting or queueing in an open
  ladder joins first, through `league.join`), ranked seating, the rule that a
  ranked seat requires an active membership, who may take a hosted seat
  (rating band, eligibility), rating changes and the first ranked-eligible
  format. It consumes `league.join`, `debate.create`, `inLeague` and
  `debates_league_iff_ranked`.
- **LEAGUE-OPS.** It must land RLS, and drop `leagues_single_row` in the same
  migration, before any second league exists; the guard enforces this. It
  adds roles, grants, custom roles, audit, the organizer area and league
  creation.
- **RT epic.** Revocation messaging and timing (section 8). AZC-3.4 requires
  RT-2.5a merged.
- **`role_grants`.** `authorize` never reads it. LEAGUE-OPS replaces or drops
  it when grant tables land, a total transition (ADR 0023).
- **PLAT-MIGRATE.** Its deploy-order check is a hard gate before the first
  real user. This epic's migration relies on staging being expendable.
- **FLAGS.** The flag system is a separate epic and is not part of this
  model.

### 10. Package ownership and edges

| Package           | Owns                                                                                                                                                                                    | Edge change                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `@daisy/protocol` | Capabilities, resource kinds, deny reasons, topic vocabulary and parsing                                                                                                                | none                                             |
| `@daisy/auth`     | `authorize`, `authorizeInbox`, `authorizeSubscribe`, `toAuthorizationInput`, principal and resource types                                                                               | `['errors']` becomes `['errors', 'protocol']`    |
| `@daisy/db`       | The migration, `leagues` and `league_members` schema, the scoped API, `resolveScopeById`, `loadAuthorizationContext`, `leagueOwnedTables`, `secondLeagueGuardIssue`, `getDefaultLeague` | none                                             |
| `@daisy/logger`   | `denyReason` in `loggableFields`                                                                                                                                                        | none                                             |
| `apps/web`        | `authorizeRequest`, the league page, join and leave, the unranked create and read pages and API                                                                                         | none                                             |
| `apps/realtime`   | Composes the loader and `authorizeSubscribe` for the registry                                                                                                                           | declares `@daisy/auth` (already an allowed edge) |

The `auth → protocol` edge is added by AZC-1.3 in `scripts/boundaries-rules.ts`
and `packages/auth/package.json`, and the package map in
`docs/architecture/overview.md` describes it.

### 11. Security essentials

Each essential has a test that fails when it is removed:

| Essential                                                                                                 | Test in          |
| --------------------------------------------------------------------------------------------------------- | ---------------- |
| Rule 0: resource kind checked before any allowance                                                        | AZC-1.3          |
| Ranked creation requires an active membership (a non-member is denied `not-member`)                       | AZC-1.3          |
| Scope chain only from rows loaded by id (foreign ancestry; the loader ignores client-supplied league ids) | AZC-1.3, AZC-3.1 |
| Gate before any protected read (an operation reaching a read without `authorizeRequest` fails the test)   | AZC-3.1, AZC-3.3 |
| `NOT_FOUND` for every denied read, anonymous included                                                     | AZC-3.1, AZC-3.3 |
| `debates_league_iff_ranked`                                                                               | AZC-2.1          |
| `league_id` immutability (NULL to value included)                                                         | AZC-2.1          |
| Transaction-local scope (the pooled-connection test)                                                      | AZC-2.2          |
| Runtime-role catalog facts                                                                                | AZC-2.2          |
| Second-league guard (database index plus startup check)                                                   | AZC-2.1, AZC-2.2 |
| `account-erased` dominance                                                                                | AZC-1.3, AZC-3.1 |
| Boolean-only UI projection (props test)                                                                   | AZC-3.2          |
| Same-origin refusal on every new mutating route                                                           | AZC-3.2, AZC-3.3 |
| An `unavailable` identity answers 503 (HTTP) or fails closed (realtime), never a denial                   | AZC-3.1, AZC-3.4 |
| Every topic family decided by `authorizeSubscribe`                                                        | AZC-3.4          |
| Property suite on the pure core                                                                           | AZC-1.3          |

## Amendments to earlier records

### ADR 0029

Leagues exist. `debates.league_id` is present exactly for ranked debates.
`seasons` and `ratings` carry `league_id`, and `seasons` allows one active
season per league instead of one active season product-wide. ADR 0029's
`role_grants` decision stands, and `authorize` does not read that table.
See [ADR 0029's amendment](0029-competitive-schema-foundation.md#amendment-2026-09-29-leagues-and-per-league-seasons).

### ADR 0030

- `mode = 'ranked'` holds exactly when the debate has a league (section 1).
- The growth-path bullet "League seasons are not rating seasons" is
  superseded by this model: seasons and ratings are per league.
- In "Clubs, leagues, tournaments", only the league-authority part
  (authority through `role_grants.scope_type` widening with `league`) is
  superseded. Its club and tournament guidance stands.
- The "Access enforcement" bullet is updated: `visibility` is read by
  `authorize`; `role_grants` is still unread, and LEAGUE-OPS replaces or
  drops it.
- Section 2 (ranked requires canonical rules on a ranked-eligible format)
  is unchanged.

### ADR 0031 section 5

The per-family subscribe table is replaced by section 8's rules, all five
families through `authorizeSubscribe`; `standings` is keyed by season id;
the registry sentences and `unlisted` are amended as stated in section 8.

### ADR 0019

The log field `denyReason` joins the loggable fields, with kind code and the
vocabulary of section 2's deny reasons, every value privacy category `none`.
AZC-1.2 adds it to `loggableFields`.

### ADR 0036 section 3

The `owner` union gains `authorization`, and the `retention` kind union gains
`record-lifetime`, valid only for `none` and `identifier` entries: the row
lives as long as the league or competitive record it describes. Personal
entries keep `account-lifetime`, `ttl` or `legal`. The privacy inventory
this epic adds:

| Column                                                                                                         | Category   | Visibility | Purpose           | Lawful basis | Retention        | Erasure                                |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ---------- | ----------------- | ------------ | ---------------- | -------------------------------------- |
| `leagues.id`                                                                                                   | identifier | —          | ladder record     | n/a          | record-lifetime  | retain                                 |
| `leagues.slug`, `name`, `visibility`, `membership_policy`, `is_default`, `version`, `created_at`, `updated_at` | none       | —          | ladder record     | n/a          | record-lifetime  | retain                                 |
| `debates.league_id`, `seasons.league_id`, `ratings.league_id`                                                  | identifier | —          | ladder tenancy    | n/a          | record-lifetime  | retain (competitive history, ADR 0029) |
| `league_members.league_id`, `actor_id`                                                                         | identifier | —          | ladder membership | contract     | account-lifetime | delete (PRIV-4), exportable            |
| `league_members.joined_at`, `left_at`                                                                          | none       | —          | ladder membership | contract     | account-lifetime | delete, exportable                     |

No roster is displayed in this epic: a member sees only their own
membership state.

## Amendment (2026-09-30): members host ranked debates

Owner decision. Ranked play works like chess.com: a player hosts a ranked
debate and that is how they challenge others, as well as being matched. So
`debate.create` on a `league` is a fixed allowance for an active member of
that league (sections 1 to 3, the gate table and section 9 state it). It is
not a grant or service capability.

- **What changes:** the capability table row, evaluator rule 4, the gate
  table, the UI projection (`canHostRanked`), the Ratings contract in
  section 9 and one security essential. Nothing else in the model moves.
- **What this does not decide:** the rating band a host may set, who may take
  a hosted ranked seat, and whether matchmaking and hosted tables share one
  rating pool. Those are Ratings-epic seating policy. Hosting does not seat
  the host either: seating is a separate step.
- **Who can host:** a non-member of an open league is joined by the creation
  operation through `league.join` before `debate.create` is asked
  (section 9), so in the Daisy league anyone with an actor can host.
- **Leaves:** AZC-1.3 (evaluator, property suite) and AZC-3.x (UI
  projection) deliver the rule. The lobby's ranked-host form is a Ratings
  leaf and works without JavaScript like every mutating form.

## Decisions made on the owner's behalf (open)

Recorded with `bun decision:record` and open on the drive's Pending
decisions list until the owner confirms or overrules them. The plan item
numbers are those the three records themselves name, and each list below
restates its record.

- **DEC-70, evaluator and access semantics (plan items 1, 7, 8, 12, 15, 16,
  17):** five deny reasons taken from
  the first rule that decides; unranked by-id reads get a JSON route
  (`GET /api/debates/[id]`) for the realtime refetch hook; private chat stays
  seated-only; `unlisted` is a listing flag, not access control; an
  `unavailable` identity answers 503 or fails closed; unranked creation
  seats no one; `standings` topics are keyed by season id rather than a slug,
  because seasons have no slug column (section 8, AZC-1.2).
- **DEC-71, data and isolation (plan items 2, 5, 9, 10, 11, 13, 14, 18):** no TRUNCATE in the single migration; the
  second-league guard is a constant unique index plus doctor and startup
  checks, matched by definition, that require RLS and a policy on every
  league-owned table (including those reached through foreign keys) before
  the index can go; the loader is a plain projection in
  `@daisy/db` with a pure mapper in `@daisy/auth`; `resolveScopeById` is the
  one unscoped by-id read; type-only imports of league-owned schema modules
  are allowed and `@daisy/db` unit tests are exempt from the static check;
  raw SQL is outside the static check, and test-only raw SQL in
  `apps/web/integration` is allowed; `withScratchDatabase` is the one
  scratch-database harness.
- **DEC-72, membership and naming (plan items 3, 4, 6):** join and leave write no audit row and
  emit no realtime event in this epic; join and leave are idempotent; leaf
  codes use the prefix `AZC`.

## Consequences

- Every access question has one pure answer, and a denied read is
  indistinguishable from a missing resource.
- A second league cannot exist by accident: the database refuses it, and
  the process refuses to start if the refusal is removed without RLS.
- Until the AZC leaves land, the code still carries the flat permission
  list, no league tables exist and the `standings` topic is keyed by a
  slug. Each section names the leaf that delivers it, and a leaf that
  deviates from this record updates the record first.
- The design history, including the reviewed plan for the deferred epics, is
  the PageSpace page "Plan — Authorization, leagues and entitlements"
  (Plans → Authorization, leagues and entitlements). The plan for this
  epic is "Plan — Authorization core (AUTHZ-core)" in the same folder.
