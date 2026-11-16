# Persistence and ephemeral infrastructure

Platform and data owners maintain `@daisy/db`. Application features call its public operations; Drizzle and Bun SQL stay in the adapter. Schema files are grouped by record ownership under `packages/db/src/schema/`. `createDatabase()` composes focused operation modules, each instrumented through the package's one event wrapper. Compound writes use explicit transactions and version checks; callers re-read after conflicts. Test-only operations never enter the public API.

PostgreSQL is the durable source of competitive truth ([ADR 0058](../decisions/0058-one-round-model.md)). A Round is the one competitive occurrence, regardless of its origin, ratedness, or human or bot seats. No snapshot table or AI-only lifecycle table mirrors it. Rooms persist resolved configuration, pinned format and preset revisions, participant assembly, and optional pre-round prep before a Round exists. A Round freezes those already resolved rules and seats; PostgreSQL owns the lifecycle, segment intervals, utterances, ballots, command idempotency, and rating ledger. Redis holds only expendable presence, cache, and rate-limit state.

Identifiers are application-minted cuid2 text values, except canonical format slugs and the exact historical casual-judge accounting migration exception in [ADR 0018](../decisions/0018-cuid2-identifiers.md). That exception supplies predictable derived accounting IDs only; it does not permit runtime or actor ID generation in SQL. Durations are integer milliseconds and timestamps are `timestamptz`, exposed as UTC ISO strings. Personal data is recorded per data class in [compliance](../operations/compliance.md). `users` is tombstoned when an account closes: its email, name and image are cleared, authentication rows are deleted, and active grants are revoked transactionally; the username, actors and competitive history remain ([ADR 0087](../decisions/0087-compliance-from-obligations.md)). Actor-owned documents require explicit deletion in the account-erasure operation because the user tombstone keeps its row.

## Competitive records

| Record                                          | Durable responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actors`, `bot_profiles`                        | Human or bot identity separate from the auth account; bot persona is reference data.                                                                                                                                                                                                                                                                                                                                                                                   |
| `formats`, `format_revisions`, `format_presets` | Canonical format identity, immutable definitions, and approved ranked configs. Rooms and ranked Rounds pin the exact format and preset revisions with composite foreign keys.                                                                                                                                                                                                                                                                                          |
| `rooms`, `room_participants`                    | Config, resolved rules and Room execution plan; assembly seats; pre-round prep anchor and remaining budget. A Room becomes ready only when its declared seats are complete. A Round's opening runs its strike and prep after `startRound()` freezes it (ADR 0104).                                                                                                                                                                                                     |
| `rounds`, `round_participants`                  | One lifecycle and frozen rules; authoritative seats with surrogate ids and unique `(round_id, seat_kind, side, slot)` (nulls not distinct) and `(round_id, actor_id)` keys; a seat is a side's (naming its side key), an unsided speaker's, a judge's or a moderator's. The outcome is a `winning_side` or a `ranking`'s places, never both, and `judging` freezes the ballot definition and panel rule at launch (TAB-6). A Round in its opening has no active clock. |
| `round_segments`, `utterances`                  | The live interval is the one open segment row. The partial unique index allows at most one; the write path closes before opening another. Scoped composite FKs prove an utterance's segment and speaker belong to the same Round.                                                                                                                                                                                                                                      |
| `round_incidents`                               | One row per platform incident: cause, detected, resumed or ended, airtime returned. The source of the incident rate and the receipt's cause ([platform incident](round-platform-incident.md)).                                                                                                                                                                                                                                                                         |
| `round_incident_watches`                        | The incident feature's own memory between passes: when the vendor went unreachable, and the last room retirement it took up.                                                                                                                                                                                                                                                                                                                                           |
| `round_commands`                                | Command idempotency and audit: principal, SHA3-256 payload digest, result, and resulting version; not an event log.                                                                                                                                                                                                                                                                                                                                                    |
| `ballots`                                       | One shared contract per judge seat, written with Round completion in one transaction.                                                                                                                                                                                                                                                                                                                                                                                  |
| `agent_runs`, `usage_reservations`              | Provider execution evidence and the single allowance ledger. Admission serializes the account quota and feature capacity; source, billing period, first dispatch and restoration provenance stay distinct and immutable. Ledger transitions use the pure protocol lifecycle.                                                                                                                                                                                           |
| `documents`                                     | Actor-owned documents. A Round only opens them, so removing a Round never removes one.                                                                                                                                                                                                                                                                                                                                                                                 |
| `seasons`, `ratings`, `rating_changes`          | Glicko-2 seasons, current projection, and append-only ledger for the Ranked ladder. A season belongs to an organization its writer names, Daisy's to Daisy; a rating names one of Daisy's three `ladders`.                                                                                                                                                                                                                                                             |

## Lobbies, authority and the tab record

These tables are the schema lock of Daisy Tab: later slices connect to them. The database holds isolation, identity and every rule one row or one key can prove; a rule that spans rows belongs to a command. No table has a `tournament_id`, and standings, season standings and divisions have no table.

| Record                                                                     | Durable responsibility                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`, `memberships`, `roles`, `role_permissions`, `grants`      | A league or a school, who belongs to it, named sets of permissions, and a role given to a person at one organization or one lobby. A membership grants nothing; a grant is revoked once and never deleted. Daisy is the seeded first organization and holds the preset roles. |
| `action_history`                                                           | Every command: who, under which authority, on what, when. Append-only.                                                                                                                                                                                                        |
| `guardian_links`, `restrictions`, `restriction_lobbies`                    | A guardian's link to a minor and the lobbies allowed. Closed to the runtime role until counsel answers; no consent field.                                                                                                                                                     |
| `lobbies`, `tournaments`                                                   | The one container of Rooms, `standing` or `tournament`, with one owner; a tournament is the one-to-one schedule extension of a tournament lobby. Daisy's public lobby is seeded.                                                                                              |
| `templates`, `lobby_templates`, `settings`                                 | An organization's pinned format and ballot definition; the templates a standing lobby offers; and every configurable value, one catalogue key at one scope (organization, template, lobby or event) with a hold. A setting's value is opaque to the database.                 |
| `ladders`                                                                  | A rating that belongs to one standing lobby.                                                                                                                                                                                                                                  |
| `events`, `stages`, `time_slots`, `tab_rounds`, `entries`, `entry_members` | A tournament's competitions, their preliminary and elimination parts, the slots tab rounds sit in, and who is entered with which responsible adult.                                                                                                                           |
| `tournament_judges`, `judge_availability`, `judge_events`, `judge_strikes` | Who judges, when they are available, which events they take, and whom they may not judge.                                                                                                                                                                                     |
| `resolution_pools`, `pool_resolutions`                                     | A league's or a lobby's resolutions; a wording never changes.                                                                                                                                                                                                                 |
| `draws`, `draw_fixtures`, `draw_result_inputs`                             | A version of the plan for a tab round: its fixtures, and the results and inputs it was computed from. A published draw is fixed.                                                                                                                                              |
| `fixtures`, `fixture_entries`, `fixture_judges`                            | What is scheduled for one Room in one tab round. One identity for life; who meets whom is fixed once published; one live fixture per entry and per judge in a tab round. The fixture points at its Room; nothing on a Room or a Round points back.                            |
| `conflicts`, `pending_commands`                                            | A recorded connection between a person with authority and a fixture, and a command held for a second person's confirmation.                                                                                                                                                   |
| `ballot_definitions`, `ballot_definition_versions`, `ballot_screenings`    | Versioned ballot definitions, pinned by templates, events, Rooms and ballots; and the screening of a ballot's text, which never rewrites the ballot.                                                                                                                          |
| `results`, `result_entries`, `result_speakers`                             | The outcome of a fixture and everything standings need from it. Append-only; a correction is a result that supersedes one.                                                                                                                                                    |
| `certifications`, `certification_results`, `releases`                      | Exactly which results a host confirmed, and the fact that a thing opened to an audience for a tab round. Append-only.                                                                                                                                                         |
| `sanctions`, `season_standing_rules`                                       | A league's yes to an event, and how its season counts.                                                                                                                                                                                                                        |

A Room sits in exactly one lobby (`rooms.lobby_id`) for life and has a host person exactly when that lobby is standing. Neither `rooms.lobby_id` nor `seasons.organization_id` has a default: a writer names the lobby or the organization, Daisy's writers name Daisy's, and a write that omits the key is refused rather than landing on Daisy. A Room in a tournament lobby is always casual, so with `rounds_ranked_ladder_check` no tournament can move a ladder.

**Carried keys.** Every tenant-owned row carries its isolation key, `organization_id` or `lobby_id`, and each child carries its parent's keys (`lobby_id`, then `event_id`, then `tab_round_id`), proved equal by a composite foreign key onto a unique `(id, ...)` on the parent. A parent's kind is proved the same way, through a generated constant column (`lobby_kind`, `organization_kind`) on the child.

**Tenant isolation.** Row-level security fences every tenant-owned table ([database operations](../operations/database.md#tenant-isolation)). It is a fence, not the decision: `authorize` decides, then the operation opens its transaction through `withScope` (`packages/db/src/tenant-scope.ts`), the only code that sets the scope. With no scope a fenced table shows the runtime role no row.

Tab organization, lobby, season, settings, tournament setup, adult enrollment and judge registration commands run through `database.tabCommands`
in one fenced transaction: authoritative facts and versions are loaded under
the aggregate lock, then the pure decision's writes and its action-history
receipt are committed together. Creating a lobby serializes its public handle
before checking availability, so a concurrent retry can replay its receipt.
Account fences are acquired before aggregate locks. Settings and setup writers
serialize changes to consuming chains before checking their current definitions;
private competition facts are visited under each lobby’s own scope, then the
command’s scope is restored. The authorization instant is sampled after the
fenced facts have loaded, and is shared by decision and audit; a grant that
expires during the lock wait cannot authorize at the earlier arrival instant.
Accepted membership, grant, entry and judge changes invalidate the affected
account revision once; replay and refusal do not. Counterpart boundary facts
are read under the counterpart’s own subject scope. Guardian-dependent entry
additions remain closed while their audit/provenance decisions and counsel
release are unresolved. Room assembly is a separate operation.

The host Results read and completion commands consume the same retained event
sources under the event/lobby fence. Readiness and manual-opening eligibility
share the pure command predicates; reads never mint probe commands or
certificates. The result guard is one plus the retained event result and
certification row counts. Stage reads preserve every published fixture's
actual ordered entry list and result-owned outcome, using the first published
stage snapshot for elimination seeds. Openings remain per tab round, part and
audience, and sanctions remain a list. This read exposes no private ballot
words, screening holds or video authority; those remain with their own readers.

Entry requests address the actual lobby and event and read only that event's
setting chain. Shared locks on its real parent definitions let unrelated
consumers proceed while a parent writer waits; a changed parent reference after
a wait refuses the obsolete request before any entry or audit write.
Parent policies are selected by scope kind as well as tenant id: a template's
organization id and an event's lobby id are isolation keys, not a reason to
include unoffered sibling templates or other events in the addressed chain.

Each new entry captures its authenticated submitter's account id atomically
with the entry, members and command receipt. Approval does not replace it; a
database trigger refuses changing or clearing it. The fenced enrollment loader
reads that immutable field directly. Existing unknown makers remain explicit
nulls and cannot be reconstructed from current guardians or event history.
This adds no minor activation, consent or retention policy; those remain closed.

The same action history has exactly one organization, lobby or protected-person
scope. The protected subject is separate from its actor; organization/lobby
contexts cannot expose person rows through a matching subject account. Family
commands fence their current people before relationship/school metadata and
append one atomic person-scoped receipt. History reads authorize the actual
current relationship and subject inside shared account fences, including the
ward fence shared across guardians. Family command/read composition stays
closed with no approved notice, and the web role still cannot write guardian
links or restrictions. No family retention/export/erasure policy is inferred.
The command's person address is explicit, like the lobby address on entry
commands: its named link must belong to that subject, and a new link's ward must
match it. Actor-based lookup and an implicit organization or privileged global
relationship locator are unnecessary.

Organization people are authorized and projected inside the store's transaction,
under shared canonical viewer-account, organization and actual owned-lobby fences.
Each lobby is visited under its own tenant scope before its shared lock is taken.
Readers coexist; authority writers wait. The same snapshot supplies organization
and lobby versions for role controls; a submission retains its target's displayed
guard instead of replacing it with a fresh one.

Grant commands address either an organization or a lobby. Lobby scope resolves
its optional owning organization; personal tournaments need no synthetic
organization or membership. Preset-role ownership supplies provenance, never a
policy parent. Giver and holder accounts are fenced before parent and target
locks; subset, seniority and current membership checks retain their canonical
meaning. Lobby grants move the lobby guard and journal at that lobby, while
organization grants use the organization guard and history scope. Staff minimum
age comes from the actual owning organization's policy, or the catalogue default
when there is no organization. A normal lobby loader reads only its grants and
its actual parent's organization grants, without visiting sibling lobbies.

Standing Room drafts likewise retain shared account and actual parent fences
through authorization and projection. The read addresses one lobby, loads only
its offered templates, their actual owners and exact preset pins, and the
settings in that Room chain. Offers and ownership are checked again after lock
waits; a changed chain returns no obsolete draft. This consumer does not take
the global settings-writer fence or enumerate unrelated tournament branches.

The tournament setup host read likewise keeps authorization and projection in
its shared-fenced transaction. It selects only the addressed tournament's pins,
schedule and available pool metadata; pool sizes count active wording rows
without selecting their text. The setup contract permits a real zero-event tournament and exposes every
authorized sanction on each event. Neither case fabricates an event or selects
one league in place of the full collection.

The host's resolved event-settings read uses the same bounded event context as
entry/draft commands, with shared lobby/event metadata locks. Commands keep
their existing exclusive aggregate default. The view comes from the canonical
resolver, including source names and enforced locks, inside that transaction;
the HTTP release gate runs before query parsing and returns no-store answers.

The host Draw read uses the addressed draw context with shared account, actual
setting-parent, slot, fixture, Room and Round fences; commands use the same
context with exclusive aggregate locks. Reads construct no commands or IDs.
Record groups consume the pairing engine's exact records and labels from the
draw's retained result IDs and frozen bye policy, preserving rational values
and the existing engine coordinates. Native Round and segment rows distinguish
waiting for start, preparing, speaking, judging and awaiting a Tab result.
Start and lateness remain null without their actual source; a fixture's Room
reference is its stored Room, never a synthetic address.

Submitted ballots cannot be updated or directly deleted by the runtime role.
A database trigger pins a canonical SHA-256 content digest for every ballot a
Round finalization consumes; the recorded-ending read treats a mismatch as
unrecorded, so it cannot silently enter ratings. Owning-Round aggregate erasure
still cascades through ballots and finalization membership. Event Rooms and
hosted Rooms use one assembly writer for their rows, initial cast and active
seats; accepted event participation never creates a person's Ready consent.

Every status and vocabulary column is text with a CHECK derived from the protocol where one exists. JSONB writes pass the column's protocol validator and an object-shape CHECK. Foreign keys have leading-column indexes. Lifecycle and provenance constraints are tested against PostgreSQL in `packages/db/integration/`; application checks cover cross-table invariants such as complete seats and a judge ballot on its own Round.

Competitive instants come from the database clock. The application passes one database-sourced instant to the pure Round runtime, then persists its projection under the expected Round version. Segment closes precede inserts in the same transaction. An accepted completion writes the judge ballot and Round result atomically. Redis loss cannot change a result, ballot, rating, or recording reference.

The internal Round tick operation locks and hydrates the current Round before
sampling `clock_timestamp()` separately. It runs the same pure engine as participant
commands and atomically persists segment closes/openings, speaking grants, the
Round revision and its outbox signal. A reconciler can advance a silent Round;
HTTP reads remain side-effect free. The final segment closes at its actual elapsed
deadline or accepted early yield while the Round remains active awaiting judging.
That close fixes `final_segment_ended_at` and the immutable
`transcript_admission_cutoff` 120 seconds later. Ballot arrival never moves the
capture deadline. Historical speaking eligibility remains a separate requirement
from admission cutoff and transcript freeze.

Round persistence factories accept an explicit trusted `RoundTimeSource` for
committed deterministic proofs (DEC426). Production omits it and samples the
database after the required locks. Requests, tenant settings and environment
flags cannot choose time. The proof resource applies only to Round execution,
attendance and judging; Room Ready, Start, immutable audit creation and physical
capture funding/settlement retain their production clocks. Check-in production
receipts keep the first writer-identity timestamp, including its microseconds;
a controlled proof uses the same explicit UTC source for the attempt, receipt
and closure. A freeze stores its freshly sampled instant and derives its one
ballot deadline from it. Controlled time proves owner composition, never native
capture or staging acceptance.

## Roles and migration baseline

The single greenfield baseline ([ADR 0038](../decisions/0038-drizzle-1-baseline.md)) creates `daisy_web` with DML but no schema, `TRUNCATE`, or migration-log privilege. `daisy_realtime` gets only explicit read models and outbox access; it cannot read authentication secrets or private user fields. `daisy_e2e` is a local loopback login and member of `daisy_web`. Migrations run through a separate owner credential. A baseline squash requires the recorded policy entry and a one-time reset of local and test databases; deployed migrations are never rewritten.

Generate schema changes with `bun db:generate`, review SQL and snapshot metadata, and run `bun migrations:check`. A forward migration is required after a baseline reaches `main`. Once Daisy has real users, production changes use expand/contract for rolling deployments (DEC-304); see [database operations](../operations/database.md).

## Auth mail, realtime, and Redis

Email diagnostics live in `email_delivery`, `email_delivery_event`, and `email_suppression`: IDs, status rank, and a keyed SHA3-256 recipient hash, never the address or provider payload. The retention sweep removes delivery events and delivery records after their documented windows, and expired verification rows after a grace period. Suppressions remain. Revoking all sessions locks the user row before deleting sessions, so concurrent session creation is serialized against the revoke.

Queued mail is one lifecycle in two tables: `mail_intents` (beta access, ADR 0075) and `notification_emails` (ADR 0124) take their state columns and CHECKs from `mailJobColumns` and `mailJobChecks`, and `mailQueue` (`packages/db/src/mail-queue.ts`) is the only writer of that state for both. A job is queued, leased to one worker, and ends sent, failed or cancelled; the lease, completion and cancellation instants are `clock_timestamp()` at the write, and a retry's next attempt is the instant the worker's backoff names. A claim ends a job failed when it has already been claimed the caller's `maxAttempts` times, so a worker that keeps dying after its claim cannot hold a job in the queue. A lapsed lease may have reached the provider: for an invitation and for every notification email the job says `delivery-unknown` from then on, whatever ends it short of a confirmed send, and any job ended at the claim's cap says it too, because its last holder never settled. Work that stops being owed is cancelled through `cancelOwed`, held or not.

The outbox is a transactionally written delivery log for realtime doorbells, not event sourcing. The realtime service reads its explicitly granted projection and keeps presence in expiring Redis keys. Redis keys are validated and namespaced per deployment, with expiry set atomically; tests delete only their own namespace. Rate limiting uses atomic server-side operations and an explicit outage policy. No global flush or Redis-derived competitive outcome is permitted.

A Round workspace lists the reader’s own documents. A Round holds no document
references, so ending or deleting a Round never changes a document.

AI practice yield requests carry the intended segment sequence (`segmentIndex`).
After clock hydration, the application checks that the same segment is open before
executing the yield, including when one tick catches up across several segments.

Room template pins reference an existing template in every lobby. Standing
Rooms additionally reference an offer by their own lobby; tournament event
Rooms follow their event template without a standing offer. The generated
`rooms.standing_template_id` is an internal foreign-key projection of
`template_id` for standing Rooms only, never a second product pin (DEC403).

A membership invitation cancelled by its manager ends with `joined_at` still
null and a real `ended_at`. Active membership requires a join; invited and
declined membership forbid one. Ending an accepted membership preserves its
actual join. The named cancellation command checks the displayed membership
version, records its own action and leaves grants untouched (DEC406).

A Round's stored ballot-definition FK is integrity provenance, separate from
catalogue ownership and read authority. Only `freezeRoomBallot`, inside the
current authorized Room transaction, admits an exact version owned by the
Room's lobby, its owning organization or its actual template organization;
a foreign lobby's version is refused before any Start writes. The Round then
owns its immutable frozen body and never resolves private content by following
the FK during a read. As with `ballots`, `rounds` remains the existing aggregate
protected by current Round/ballot evaluators rather than acquiring catalogue
RLS. A caller knowing every source and judge identifier gains no private Round
read or ballot-submission authority; actual private custom-source proofs cover
both admitted judge reads and unrelated-account refusal without writes.

Tournament capture freezes a separate private admission with the actual Room,
fixture, accepted Start receipt, funding version and acting-official authority.
A Recording references that exact admission and Round through a generated
internal composite FK. Its capture worker consumes only the named admission id
and finite deadline, never the payer/issuer/official identity and never a
`createdByActorId` host surrogate. This integrity reference supplies no audience,
media-read or download authority; those remain the Recording and current Round
read decisions. Dispatch is durable before vendor I/O. Once work is dispatched, its physical reservation
survives logical Round end and expiry until a confirmed terminal Egress and
withdrawn observer permit settlement. A terminal Round with no Recording,
capture or Broadcast may settle its never-opened admission immediately at the
actual database clock under that admission's lock (DEC429). Terminal status is
absorbing, and every Recording insert over an admitted Round takes that same
fence and validates the exact open source, so later use cannot reopen released
capacity. An existing recorder still uses its close/revocation/egress owner; an unknown response or missing ambiguous
attempt listing cannot free it or authorize another start.

## Startup across forward migrations

The production tenant gate accepts a database ahead of its image only when the
image migration hashes and instants form the exact prefix of the live journal.
The image snapshot still requires all its tables/columns, and its declared
tenant policies remain strict. Unused additions from later migrations do not
block an older machine restart. Exact whole-schema authoring validation remains
in doctor and integration tests. The release runner maintains read-only
journal provenance for the web role; startup has no DDL or grants. This does
not make destructive schema or contract rewrites reversible. Details and role
permissions are in [database operations](../operations/database.md#tenant-isolation).

### School judge obligations

`entry.judge_obligation` uses the canonical organization → template → lobby →
event settings chain and its settings-version command guard. Its catalogue
default is explicitly unconfigured. A configured ratio owes `judgesPerGroup`
judges for each `entriesPerJudge` accepted school entries, rounding each school's
partial group up independently. Zero judges per group explicitly means no
obligation. Pending and withdrawn entries do not contribute.

The host Entries editor writes that setting through the existing setting command;
inherited enforced values stay locked. The roster reads the fenced event chain
and shows each school's obligation alongside its accepted, eligible judges
cleared for the selected event. Affiliation identifies the school group; it does
not assert who furnished a judge. These obligations are distinct from panel
demand and carry no payment behavior.
## Tournament inbox notifications

Tournament assignments and publication use the existing Notifications inbox,
preferences and content-free `user:inbox` signals. A notification references its
actual fixture, lobby and applied command; it stores no result, score, wording
or recipient snapshot. Composite foreign keys preserve tenant provenance, and
one `(user, kind, fixture, command)` subject makes replay harmless. Direct and
confirmed officiating share the same writer, so a pending proposal owes no
notification until its original command is applied. Publication, Room assembly,
panel changes, result availability and recorded audience openings write their
notifications in the owner's transaction. Failure of any notification or signal
rolls the command back too.

Recipients come from accepted entry members and accepted fixture judges. An
assignment or removal tells only its affected judge; a published draw change or
ready Room tells that fixture's actual cast. Result openings tell only affected
people in the recorded audience; an opening before any result exists owes no
result notification until the result writer records one. Wider audiences never
turn delivery into a tournament-wide broadcast. These kinds use in-app delivery
and its existing per-kind switches, with no email channel.

The inbox reassembles current canonical account and guardian-boundary facts
under the ordinary Tab read fences. It also checks the current accepted fixture
relationship, Room readiness, recorded release and saved preference. Removed
judges receive a generic removal linked to the tournament, with no former Room
or result access. Notification destinations are protected reads; inbox text and
signals contain no outcome. Privacy export and erasure include these subjects,
and the existing read-retention policy applies.

### League member schools

`league_schools` is the explicit relation between a league and a school.
`organization_id` is the league's isolation key; composite foreign keys prove
that its two organizations have kinds `league` and `school`. It grants no
person permissions and is never inferred from a person's membership.

The league controller invites through `invite-league-school`; only a school
controller can activate that invitation through `accept-league-school`. Both
commands evaluate `organization.manage` at their own organization. An invitation
is not active membership. Either controller can explicitly end the relation or
cancel an invitation through `end-league-school`, naming their side. Rejoining
requires a fresh invitation and fresh school assent.

All commands run through `/api/tab/league-school-command`, the canonical command
runner and the single action history. Invitations carry the league's displayed
organization version; acceptance and ending carry the relation's membership
version. Account fences precede both organization fences in sorted id order.
Every accepted transition increments the relation and league versions atomically
with a journal entry identifying the exact `league_school` aggregate, acting
account and evaluated authority. The relation retains invitation, joining and
ending times and acting accounts; only `status = 'active'` supplies member-school
ids to the season fold.

### Certified league season inputs

A sanction is requested by the current tournament controller and accepted by
the league controller. Both decisions recheck the pinned format, ballot and
every enforced template value inside the fenced transaction; the approval
does not grant tournament authority. Reads fold received certified result ids,
so a later correction stays local until a certification names it.

A membership-counting season admits events owned by the league or an active
personal league member, only when the event follows a league template. Only
direct league members and entrants whose responsible school has an active
two-sided league relation score. Invited/ended schools and unrelated hosts do
not qualify. The same pure season fold computes both admission modes; no
standings projection is stored. `standings.read` on the actual league
organization authorizes active members and organization managers through the
evaluator and its minor boundary; public organization identity is not season
read authority.
