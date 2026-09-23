# 0036: Privacy by design

Status: accepted. Extends [ADR 0019](0019-token-secret-ownership.md) (what
must never be logged) and [ADR 0029](0029-competitive-schema-foundation.md)
(the tombstone transaction, which this ADR's erasure planner drives).
Amended by [ADR 0037](0037-error-tracking-and-product-analytics.md) for the
vendor surfaces this ADR's classification applies to.

## Context

Daisy is pre-ship (ADR 0023): every log field, database column and future
analytics event is still cheap to classify. Retrofitting privacy after
rows and dashboards exist is not. Today nothing stops a call site from
logging an email address, no column declares whether it holds personal
data, and there is no inventory, no consent model and no data-subject-rights
mechanism. The 2026-09-22 external review of this epic's spec added seven
points, all incorporated below: visibility on personal data, identifiers
scoped per telemetry surface, a non-recursive undeclared-field path, storage
and owner on every inventory entry, a durable vendor-erasure outbox, a
consent schema independent of deploy configuration, and this ADR's
`errorClass` rule (mechanism in ADR 0037).

The rule this ADR exists to enforce: every privacy rule is a **type, a
registry or a gate**, never a checklist held in someone's memory. AGENTS.md
and the PR template only point at those mechanisms; they never restate the
rules themselves.

## Decision

### 1. Data classification

Every field and column carries a **category**, one of `none | identifier |
personal | sensitive | secret`:

- `identifier`: cuid2 ids. Pseudonymous on their own.
- `personal`: email, username, name, image, IP, user agent.
- `sensitive`: GDPR special categories. None exist today; adding one needs
  its own ADR.
- `secret`: tokens, keys and hashes of secrets.

A `personal` entry also carries a **visibility**:

- `public`: shown to other users as competitive or profile identity
  (username, display name, image, and later judge bios and club
  memberships). Usually anonymized on erasure, so history stays readable.
- `private`: seen only by the subject and the system (email, IP, user
  agent, consent choices). Usually deleted on erasure.

Worked examples: `users.username` is personal/public, purpose "public
profile identity", erasure `anonymize`. `users.email` is personal/private,
purpose "authentication", erasure `delete`.

`none` and `identifier` never require a visibility. `sensitive` and
`secret` are never emitted to any telemetry surface at all, visibility
notwithstanding.

### 2. Identifiers are scoped per telemetry surface, not global

A stable id is pseudonymous only inside the surface it was issued for; nothing
lets one surface's id become a cross-context tracking key. Each surface
declares its own closed field vocabulary for identifiers:

- **Logs:** `requestId`, `traceId`, and optionally `userId` and `actorId`.
- **Errors (Sentry):** `requestId`, and optionally `userId`. Never
  `actorId` — an error report is diagnostic, not a competitive record.
- **Analytics (PostHog):** exactly one of `anonymousId` (pre-sign-in or
  no identify consent) or `userId`. `actorId` appears only on an event
  whose registry entry declares `competitive: true` (a match played, a
  ballot submitted). Nothing links an anonymous id to a user id except
  PostHog's own `identify` at sign-in, and only under analytics consent.

The types enforce this per surface; a field outside a surface's vocabulary
fails typecheck there even if another surface allows it.

### 3. The personal-data inventory

Every `table.column` (and every Redis key namespace and vendor-held record)
is declared once, with all of:

- `category` and, when `personal`, `visibility`
- `purpose`
- `lawfulBasis`
- `storage`: `postgres | redis | vendor`
- `owner`: a closed union (`auth | competitive | telemetry | privacy | …`)
  that grows with each feature area, so a gate failure names who is
  responsible
- `retention`: `{ kind: 'account-lifetime' | 'ttl' | 'legal', ms? }`
- `erasure`: `delete | anonymize | cascade | tombstone | retain`
- `exportable`

An entry with no matching column is stale and fails the gate; a column
missing from the inventory, or a `personal` entry missing `visibility`,
`retention`, `erasure`, `storage` or `owner`, fails the gate. This closes
gap 1 in the spec: `outbox.payload` (an untyped JSON column fanned out to
every browser) and every realtime topic family (`debate`,
`debate:presence`, `debate:chat`, `user:inbox`, `standings`,
`packages/protocol/src/topics.ts`) are telemetry-visible surfaces under
these same rules, not an exception — a payload kind added to
`topicFamilyPayloadKinds` classifies its fields before it may ride a
topic.

The registry and its gate (`bun privacy`) are PRIV-3's mechanism; this ADR
fixes the shape the gate enforces.

### 4. Data subject rights

Export and erasure are pure planners driven by the inventory; an adapter
executes each plan in one transaction. Local erasure is atomic and reuses
the ADR 0029 tombstone transaction: scrub private personal data, anonymize
public personal data, delete the auth rows, revoke grants, set
`deleted_at`, leave `actors` and competitive history alone.

**The `actors.user_id` link to a tombstoned account is retained, by ADR
0029's design, not this ADR's.** `actors.user_id` is `NOT NULL` for a human
actor (`actors_human_has_user`) and `ON DELETE RESTRICT`; ADR 0029's
tombstone transaction never nulls or breaks it, because a rated competitive
identity that could stop pointing at any account is a bigger integrity
problem than the FK it would need to relax. This is not a PII exposure:
`actors` holds no personal fields (`id`, `kind`, `user_id`,
`created_at`/`updated_at`/`version` only), the link is read only inside
`@daisy/db` (username-claim resolution, session revocation) and never
surfaced by a public route — every public and engine-facing identifier is
the actor id, never `user_id` — and the `users` row it points at is itself
already scrubbed to no personal fields by the same transaction. Reopening
that linkage model is ADR 0029's decision to revisit, not PRIV-1's. Per §3,
`actors.user_id` still gets its own inventory entry like any other
column — category `identifier` (never `personal`, so no `visibility`),
purpose "human actor ↔ account linkage", storage `postgres`, owner
`competitive`, retention `account-lifetime`, erasure `retain` (PRIV-3
classifies it, it is not exempt from the gate) — the point above is only
that the _link itself_, being between two PII-free rows and never exposed,
is not a PII exposure requiring erasure `delete`/`anonymize`.

**Vendor erasure is durable and asynchronous, never inline with local
erasure.** In the same local-erasure transaction, one `privacy_jobs` row is
inserted per configured vendor (`id`, `subject_ref` — the tombstoned user's
surviving cuid2 id, the key the vendors hold — `vendor`, `operation`,
`status: pending | succeeded | failed`, `attempts`, `last_error_class`,
`created_at`, `completed_at`). After commit, a worker retries each job with
backoff until the vendor acknowledges. A vendor outage never rolls back
local erasure, and a deletion request is never lost. `privacy_jobs` is not
a general job framework: it records durable deletion intent only, it is
itself classified in the inventory, and a succeeded row carries a TTL.
Jobs that keep failing past a threshold emit a registered log event so an
incident is never silent.

### 5. Consent

Three categories always exist in the stored schema — `necessary` (always
on, no consent needed), `analytics`, `replay` — independent of which are
wired up in a given deployment. Each is `granted | denied | unanswered`,
and `unanswered` is treated as denied everywhere a decision is needed. The
UI shows only the categories backed by functionality actually enabled in
the current deployment; when a category becomes enabled later, the banner
asks again only for that unanswered category and never resets an earlier
choice. A signed-in user's choice is also written to a `consent_record` row
(version, choices, timestamp), itself classified in the inventory as
personal/private.

Keeping the stored schema fixed regardless of deploy configuration is
deliberate: a consent record must mean the same thing whether or not a
vendor key happens to be set that day, or a later audit cannot tell what a
user actually agreed to from what the deployment happened to expose.

## Consequences

- PRIV-2 implements the closed per-event log field types this ADR's surface
  scoping requires, plus the non-recursive undeclared-field violation path
  (`internalTelemetryViolation`, reachable only outside `log()`, so
  `telemetry.undeclared_field` itself can never recurse).
- PRIV-3 implements `packages/db/src/schema/data-inventory.ts` and the
  `bun privacy` gate, classifies every current column, and wires the gate
  into `check`, `ci.yml` and `scripts/evidence.ts`.
- PRIV-4 implements `exportPersonalData`, `erasePersonalData`, the
  `privacy_jobs` table and migration, and the retry worker.
- PRIV-6 implements the product event registry, the consent banner and
  `consent_record` migration against this ADR's consent model.
- `docs/operations/privacy.md` is the operator-facing document; this ADR is
  the rule it points at, not a duplicate of it.
- Any new `sensitive` category needs its own ADR before a column or field
  may use it; none exists today.

## Sources

- GDPR special categories of personal data (Article 9):
  https://gdpr-info.eu/art-9-gdpr/
- Data subject rights to erasure and to access (Articles 15, 17):
  https://gdpr-info.eu/art-15-gdpr/, https://gdpr-info.eu/art-17-gdpr/
