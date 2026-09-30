# 0048: The authorization core

Status: accepted (AZC-1.1; owner-approved plan of 2026-09-29, revision 4),
rewritten 2026-09-30 before first ship (ADR 0023): ranked play is Daisy's
alone and leagues are tournament tenants, none of which exist at launch.
Amends [ADR 0030](0030-effective-rules-and-growth-paths.md),
[ADR 0031](0031-realtime-service.md) section 5 and
[ADR 0019](0019-token-secret-ownership.md), each in its own `## Amendment`
section. Decisions marked open at the end were made on the owner's behalf and
stay open until the owner confirms or overrules them.

## Context

Daisy launches with two kinds of play: ranked play on Daisy's own ladder, and
unranked play (casual and practice debates, any format, public, unlisted or
private). Daisy owns the formats and the ladder: ranked runs a format's
canonical rules (ADR 0030) and produces the ratings everyone competes on, one
ladder per format and season, like weight classes. Every access question at
launch has to be answered by one pure function from facts loaded fresh per
request, so that HTTP pages, API reads, realtime subscribes and UI hints ask
it the same way.

Leagues, in this product, are organizers' spaces for running tournaments:
tab software with their own members, rounds and UI, sold to organizers. They
never get a ladder. The community, the rounds that matter and the ratings
live in Daisy's formats. Leagues are LEAGUE-OPS and TOURN work and none exists
at launch (section 6).

Until this record, `@daisy/auth` carries a flat permission list on every
principal, and `visibility` is stored but never read (ADR 0030). This ADR
decides the model, the evaluator and the seams between packages. The work
that builds it is the AZC leaves named below; roles, grants, audit,
tenancy and row-level security belong to a later epic (LEAGUE-OPS) and are
named as future work only.

## Decision

### 1. The model

| Concept         | What it is                                                                                       | Where it lives       |
| --------------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| Ranked debate   | `mode = 'ranked'`: a ranked-eligible format under its canonical rules, counted on Daisy's ladder | `debates.mode`       |
| Unranked debate | `mode = 'casual'` or `'practice'`, any format, public, unlisted or private                       | `debates.mode`       |
| Season, rating  | Global: one active season, ratings per `(actor, format, season)` (ADR 0029)                      | `seasons`, `ratings` |
| League          | Future tenant for tournaments. None exists at launch (section 6)                                 | LEAGUE-OPS           |
| Capability      | A closed vocabulary of things that can be asked                                                  | `@daisy/protocol`    |
| Decision        | `authorize(principal, capability, resource, context)` returns allow, or deny with a reason       | `@daisy/auth`, pure  |

The rules of the model:

- **Ranked is Daisy's.** Only ranked debates produce ratings, and ranked
  debates belong to no league and no tenant. Formats, their canonical rules
  and ranked eligibility are Daisy's rows (ADR 0030). No club, league or
  other tenant can create a ladder or a rating.
- **Anyone with an actor can host.** A user with an actor may create a ranked
  or an unranked debate, the way a chess.com seek is posted: a hosted ranked
  table is an open challenge. Who may take a seat in a hosted ranked debate
  (rating band, format eligibility) is seating policy, owned by the Ratings
  epic, not an authorization capability.
- **Creating a debate seats no one.** The engine starts every debate with no
  participants and creation, ranked or unranked, adds none. A private debate's
  creator can read it and subscribe to its presence (the creator fact) but is
  refused its chat until seated (section 7). Seating comes from lobby and
  seating flows, which are out of scope.
- **Leagues are tournament tenants and never a ladder.** They are private,
  operator-created, and get their own UI; their tournament debates are
  unranked and feed no ladder. Nothing about leagues exists in the schema or
  the evaluator at launch (section 6).
- **Identity, place and authority are separate questions.** The principal
  answers who is asking, the resource's rows answer what it is, and grants
  (none exist yet) answer what authority the principal holds.
- **No platform scope inside `apps/web`.** The operator plane is a separate
  future admin app ([ADR 0043](0043-no-admin-surface-in-participant-app.md)).
- **A provisional account has no actor,** so it can neither create nor host.
- **The resource comes from rows loaded by id,** never from client input.

### 2. Vocabulary (`@daisy/protocol`)

Capabilities are a const array with a derived zod enum and per-capability
metadata: `resourceKinds` lists what the capability can be asked of, and
`read` says whether it is a read capability.

| Capability      | `resourceKinds`      | Read | Allowed by (this epic)                                          |
| --------------- | -------------------- | ---- | --------------------------------------------------------------- |
| `debate.create` | `ranked`, `unranked` | no   | any user with an actor                                          |
| `debate.read`   | `debate`             | yes  | the debate's visibility rules, seating and creation (section 3) |

- **Resource kinds:** `debate | ranked | unranked`. `ranked` and `unranked` are
  the resources asked when creating a debate: `{ kind: 'ranked' }` and
  `{ kind: 'unranked' }`.
- **Deny reasons:** `denied` (invalid resource kind), `account-erased`,
  `unauthenticated`, `missing-capability`. Every value has privacy category
  `none`, and the union is the `denyReason` log vocabulary (amendment to ADR
  0019 below).
- **Grant scopes:** none at launch. LEAGUE-OPS adds grant tables, league
  scopes and any league capability together.

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
- `service { serviceId, scope: { kind: 'ranked' } | { kind: 'unranked' }, capabilities }`

A principal carries no permissions. A service holds a fixed capability list.

**Resources:** `debate { debateId, visibility, createdByActorId, ranked }`,
`ranked {}` and `unranked {}`.

**Context** (loaded, section 5):

- `seated`: whether the actor holds a seat in the debate
- `denyFacts`: `account-erased` when the principal's user is tombstoned

**The rules, in order. The reason is that of the first rule that decides.**

0. **Resource kind.** If `resource.kind` is not in the capability's
   `resourceKinds`, deny with `denied`. This guard sits at the top of
   `authorize`, so nothing below can allow such a request.
1. **Deny facts.** If a deny fact is present, deny with that fact
   (`account-erased`). Rule 0 runs first, so for a valid (capability,
   resource kind) pair a deny fact dominates every allowance, including
   seating and creation.
2. **Service.** For a service principal, allow if and only if its scope
   matches the resource (`ranked` for the `ranked` resource or a ranked
   debate, `unranked` for the `unranked` resource or an unranked debate) and
   it holds the capability. Otherwise deny with `missing-capability`. Rule 3
   never applies to services.
3. **Fixed allowances** (not editable):
   - `debate.create` on `ranked` or `unranked`: a user with an actor.
   - `debate.read`: `public` or `unlisted`, everyone; `private`, the creator
     and the seated. Ranked and unranked debates read the same way.
4. **Otherwise deny,** with `unauthenticated` for an anonymous principal and
   `missing-capability` in every other case.

A creator or seated fact allows `debate.read` of **that** debate only.
`authorizeInbox` allows if and only if the principal is a user whose
`actorId` is non-null, equals `inboxActorId`, and no deny fact is present.
An inbox belongs to no debate, and no capability applies to it.

**Public results.** The delivery layer maps them, and the mapping never
depends on the reason:

- A denied **read** capability (`debate.read`), whether asked as the
  operation's gate or later, returns `NOT_FOUND` for every principal,
  anonymous included, so no existence oracle is exposed. A resource that does
  not exist returns the same `NOT_FOUND`.
- A denied **non-read** capability (`debate.create`) returns `AUTHENTICATION`
  for an anonymous principal and the existing `participant` redirect for a
  provisional user. For everyone else it returns `AUTHORIZATION`.
- An `unavailable` identity (the session store is down) never reaches
  `authorize`: `authorizeRequest` answers the existing 503 first, and a
  realtime subscribe fails closed with the existing unavailable error, not a
  denial.
- The reason goes only to the `denyReason` log field.

**Gates.** Every operation authorizes exactly one gate before any other
check or protected read:

| Operation                                                                          | Gate, then                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Debate read by id (page, JSON), `debate:<id>` and `debate:<id>:presence` subscribe | `debate.read` on the debate                                                                                              |
| `debate:<id>:chat` subscribe                                                       | `debate.read` on the debate, and for a `private` debate the seated fact as well (the chat family's narrowing, section 7) |
| Ranked creation (hosting a ranked debate)                                          | `debate.create` on `ranked`                                                                                              |
| Unranked creation                                                                  | `debate.create` on `unranked`                                                                                            |
| `standings:<seasonId>` subscribe                                                   | a valid ticket (the ladder is public)                                                                                    |
| `user:<actorId>:inbox` subscribe                                                   | `authorizeInbox`                                                                                                         |

**Properties**, proven by property tests over generated principals,
resources and contexts:

- **Deny dominance:** with `account-erased` present, every capability asked
  of a resource kind in its `resourceKinds` is denied with `account-erased`.
  An invalid pair is denied by rule 0 with `denied` first.
- **Resource kinds:** no capability is ever allowed for a resource kind
  outside its `resourceKinds`.
- **Fact locality:** seated and creator facts change only `debate.read` of
  their own debate.
- **Service scope:** a service scoped to `ranked` is never allowed on an
  unranked resource or debate, and the reverse.

The evaluator is delivered by AZC-1.3. `@daisy/auth` gains the edge to
`@daisy/protocol` (section 9).

### 4. Schema

**No migration.** Ranked and unranked debates, seasons and ratings already
exist (ADR 0029): `debates.mode` names the competitive semantics, `seasons`
keeps its one active season, and `ratings` stays keyed by
`(actor, format, season)`. This epic adds no table and no column. Ranked
rules (canonical rules on a ranked-eligible format, ADR 0030) stay the
debate-creation command's domain invariant.

### 5. Loader and composition

The loader is shared by `apps/web` and `apps/realtime`, and neither app may
import the other (ADR 0031 section 12). `@daisy/db` may not import
`@daisy/auth`; its edges stay `config`, `errors` and `protocol`. So the
composition has three parts:

- **`loadAuthorizationContext(db, { actorId, userId, resourceRef })`** lives
  in `@daisy/db` (`packages/db/src/authorization/`). It returns a plain,
  structurally typed projection of rows and facts, with no `@daisy/auth`
  types. It reads the debate by id (visibility, creator, whether it is ranked),
  then the principal's facts: seating (`debate_participants` for the actor)
  and `users.deleted_at` for the `account-erased` fact. It keeps no
  cross-request cache and selects only columns that both `daisy_web` and
  `daisy_realtime` may read; `daisy_realtime` gains SELECT on
  `users(id, deleted_at)`, and already has `debates` and
  `debate_participants`.
- **`toAuthorizationInput(projection, principal)`** is a pure mapper in
  `@daisy/auth` that builds the resource and context `authorize` takes.
- Each app composes the two: `apps/web` in `authorizeRequest`, `apps/realtime`
  in its subscribe decision (section 7).

**`authorizeRequest(principal, capability, resourceRef)`** first answers the
existing 503 for an `unavailable` identity, without loading or deciding.
Otherwise it loads, calls `authorize`, logs a denial with `denyReason`, and
throws the public error (section 3) or returns the loaded resource. It is the
only way an operation reaches a protected read.

**Identity.** `resolveIdentity` stops producing permissions, `Principal`
loses `permissions`, and `requirePermission` and `Permission` are deleted
with their tests in the same change, a total transition (ADR 0023). The
foundation proof, which stays dev-only, becomes
`{ kind: 'service', serviceId: 'foundation-proof', scope: { kind: 'unranked' }, capabilities: ['debate.create', 'debate.read'] }`
and goes through `authorizeRequest`.

**UI capability projection.** The server runs `authorize` for the
capabilities a page needs and passes only booleans to client components (for
example `{ canCreateRanked, canCreateUnranked }`). Loaded rows and deny facts
never reach the browser, and a page never computes an access decision on the
client.

AZC-3.1 delivers the loader, `authorizeRequest`, identity without
permissions and the foundation proof.

### 6. Leagues are future tenants, and what they must satisfy

A league is a tournament tenant: an organizer's private space with its own
members, rounds and UI. It is operator-created and sold (the operator plane
is ADR 0043's separate admin app), and it never owns a ladder. None exists
at launch, and no table, column, scope or evaluator rule for leagues exists
until LEAGUE-OPS and TOURN build them. When they do, this record fixes the
constraints so the ladder stays Daisy's:

- **Isolation first.** Row-level security, with policies, is in place on
  every tenant-owned table before the first league row can exist, and a
  startup and `bun doctor` check refuses a league without it. Tenant scope
  comes from rows loaded by id, never from client input, and a foreign
  tenant's facts never change a decision.
- **No ladder, no ratings.** A league's debates are unranked. A league holds
  no season and no rating. LEAGUE-OPS adds a constraint that a ranked debate
  carries no league. Whether a tournament on a Daisy format may count toward
  the Daisy ladder is an open owner decision, and the default is that it does
  not.
- **Tenant formats.** A tenant may train and run tournaments on formats of
  its own. Such a format is a tenant-owned row that is never
  `ranked_eligible`, so it can never produce a rating. Daisy's formats and
  canonical rules stay Daisy's (ADR 0030).
- **Public surfaces stay Daisy's.** The public lobby, Watch and leaderboards
  read only league-less debates. A league's rooms appear in the league's own
  UI.
- **Authority through grants.** LEAGUE-OPS replaces or drops `role_grants`,
  adds roles, grants, audit and the organizer area, and adds its own
  capabilities (league view, join, and tenant-scoped creation) to the
  vocabulary. `authorize` never reads `role_grants` before then.

### 7. Realtime subscribe (AZC-1.3, AZC-3.4)

`apps/realtime` declares `@daisy/auth`. `authorizeSubscribe(topic,
principal, input)` is pure, lives in `@daisy/auth`, and maps each of the five
topic families to one decision (the table is ADR 0031 section 5, amended
below). AZC-1.3 delivers the pure function; AZC-3.4 has the subscribe
registry (RT-2.5a) call it over the shared loader (section 5). A denied or
failed decision refuses the subscribe.

- Sockets require a ticket, and tickets are issued only to signed-in members
  with an actor, so an anonymous principal never subscribes. A public or
  unlisted debate's topics are open to every ticket holder, and so is
  `standings:<seasonId>`, because the ladder is public.
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
  debates arrive later, and their epics add the events they need.

### 8. Cross-epic contracts

- **PRIV-4 (privacy and telemetry).** The erasure tombstone yields the
  `account-erased` deny fact through the loader. No league data exists to
  erase at launch; LEAGUE-OPS extends erasure to membership, grants and
  audit.
- **Ratings.** It owns the debate-creation operation (a hosted table and a
  matchmade pairing both run through it, gated by `debate.create` on
  `ranked`), ranked seating, who may take a hosted seat (rating band,
  eligibility, no non-human actors), rating changes and the first
  ranked-eligible format.
- **LEAGUE-OPS and TOURN.** They build tenancy under section 6: isolation
  before the first league, no ladder, no ratings, tenant formats that are
  never ranked-eligible, and the tournament tables.
- **RT epic.** Revocation messaging and timing (section 7). AZC-3.4 requires
  RT-2.5a merged.
- **`role_grants`.** `authorize` never reads it. LEAGUE-OPS replaces or drops
  it when grant tables land, a total transition (ADR 0023).
- **FLAGS.** The flag system is a separate epic and is not part of this
  model.

### 9. Package ownership and edges

| Package           | Owns                                                                                                      | Edge change                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `@daisy/protocol` | Capabilities, resource kinds, deny reasons, topic vocabulary and parsing                                  | none                                             |
| `@daisy/auth`     | `authorize`, `authorizeInbox`, `authorizeSubscribe`, `toAuthorizationInput`, principal and resource types | `['errors']` becomes `['errors', 'protocol']`    |
| `@daisy/db`       | `loadAuthorizationContext` (`packages/db/src/authorization/`)                                             | none                                             |
| `@daisy/logger`   | `denyReason` in `loggableFields`                                                                          | none                                             |
| `apps/web`        | `authorizeRequest`, the ranked and unranked create and read pages and API                                 | none                                             |
| `apps/realtime`   | Composes the loader and `authorizeSubscribe` for the registry                                             | declares `@daisy/auth` (already an allowed edge) |

The `auth → protocol` edge is added by AZC-1.3 in `scripts/boundaries-rules.ts`
and `packages/auth/package.json`, and the package map in
`docs/architecture/overview.md` describes it.

### 10. Security essentials

Each essential has a test that fails when it is removed:

| Essential                                                                                                | Test in          |
| -------------------------------------------------------------------------------------------------------- | ---------------- |
| Rule 0: resource kind checked before any allowance                                                       | AZC-1.3          |
| The resource comes from rows loaded by id (the loader ignores client-supplied visibility or ranked flag) | AZC-1.3, AZC-3.1 |
| Gate before any protected read (an operation reaching a read without `authorizeRequest` fails the test)  | AZC-3.1, AZC-3.3 |
| `NOT_FOUND` for every denied read, anonymous included                                                    | AZC-3.1, AZC-3.3 |
| `account-erased` dominance                                                                               | AZC-1.3, AZC-3.1 |
| Service scope never crosses ranked and unranked                                                          | AZC-1.3          |
| Boolean-only UI projection (props test)                                                                  | AZC-3.3          |
| Same-origin refusal on every new mutating route                                                          | AZC-3.3          |
| An `unavailable` identity answers 503 (HTTP) or fails closed (realtime), never a denial                  | AZC-3.1, AZC-3.4 |
| Every topic family decided by `authorizeSubscribe`                                                       | AZC-3.4          |
| Property suite on the pure core                                                                          | AZC-1.3          |

## Amendments to earlier records

### ADR 0030

- Decision item 2 is unchanged and now carries more weight: ranked requires
  canonical rules on a `ranked_eligible` format, and ranked belongs to Daisy.
- The "Clubs, leagues, tournaments" bullet's league authority, that is,
  authority through `role_grants.scope_type` widened with `league`, is
  superseded: LEAGUE-OPS decides league authority (section 6). The club and
  tournament guidance in that bullet stands.
- The "League seasons are not rating seasons" bullet is refined: a league's
  debates never create ratings, and tournament standings are the
  tournament's, not the ladder's.
- The "Access enforcement" bullet is updated: `visibility` is read by
  `authorize`; `role_grants` is still unread, and LEAGUE-OPS replaces or
  drops it.

### ADR 0031 section 5

The per-family subscribe table is replaced by section 7's rules, all five
families through `authorizeSubscribe`; `standings` is keyed by season id and
open to every ticket holder; the registry sentences and `unlisted` are
amended as stated in section 7.

### ADR 0019

The log field `denyReason` joins the loggable fields, with kind code and the
vocabulary of section 2's deny reasons, every value privacy category `none`.
AZC-1.2 adds it to `loggableFields`.

## Decisions made on the owner's behalf (open)

Made in the 2026-09-30 rewrite, each to be recorded with `bun decision:record`
and open on the drive's Pending decisions list until the owner confirms or
overrules them:

- **Tournaments are unrated by default.** A tournament run in a league on a
  Daisy ranked-eligible format does not count on Daisy's ladder. A paid
  "Daisy-rated tournament" is a later product decision.
- **Tenant formats are never ranked-eligible.** When tenants gain formats of
  their own (LEAGUE-OPS, TOURN), those rows can never produce a rating.
- **No Daisy league row.** Daisy's ladder is the unqualified ranked mode, not
  a league. A league is only ever a tenant.
- **No leagues at launch.** The league tables, membership, scoped query API,
  second-league guard, join and leave that the earlier record placed in AZC-2
  and AZC-3.2 move to LEAGUE-OPS. The AZC leaves that delivered them have no
  work under this record, and replanning them is the owner's (`/task replan`).

The evaluator and access semantics of the earlier record stand, less the
league items: five deny reasons became four, `unranked` creation gained a
`ranked` sibling, unranked by-id reads get a JSON route
(`GET /api/debates/[id]`) for the realtime refetch hook, private chat stays
seated-only, `unlisted` is a listing flag, an `unavailable` identity answers
503 or fails closed, creation seats no one, and `standings` topics are keyed
by season id. The earlier decisions about league data and isolation, and
about join and leave, described the model this rewrite removes.

## Consequences

- Every access question has one pure answer, and a denied read is
  indistinguishable from a missing resource.
- Daisy keeps the ladder, the formats and the narrative: a league can run
  tournaments but can never mint ratings, because no league data exists to
  hold them and LEAGUE-OPS must add tenancy under section 6.
- There is no migration in this epic and no league surface to build, so the
  epic is smaller than the record it replaces.
- Until the AZC leaves land, the code still carries the flat permission
  list. Each section names the leaf that delivers it, and a leaf that
  deviates from this record updates the record first.
- The design history, including the reviewed plan for the deferred epics, is
  the PageSpace page "Plan — Authorization, leagues and entitlements"
  (Plans → Authorization, leagues and entitlements). The plan for this
  epic is "Plan — Authorization core (AUTHZ-core)" in the same folder. Both
  predate this rewrite and need the owner's replan.
