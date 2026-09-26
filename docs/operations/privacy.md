# Privacy

Daisy is pre-ship and US-first, built GDPR-ready. This document is the
operator-facing guide to classification, retention, data subject rights,
consent and subprocessors. The rules themselves live in
[ADR 0036](../decisions/0036-privacy-by-design.md) (classification,
inventory, retention, erasure, consent) and
[ADR 0037](../decisions/0037-error-tracking-and-product-analytics.md)
(Sentry and PostHog); this page never restates a rule the ADRs already own,
it only points at the mechanism and answers "where do I look".

## Classification

Every field, column, Redis key and vendor-held record carries a category —
`none | identifier | personal | sensitive | secret` — and, when `personal`,
a visibility — `public | private`. See ADR 0036 §1 for the full definitions
and the `users.username` / `users.email` worked examples. `sensitive` and
`secret` values never reach any telemetry surface regardless of visibility.

Identifiers are scoped per telemetry surface — logs, errors, analytics —
never global; ADR 0036 §2 is the source of truth for which identifier a
given surface may carry.

## The personal-data inventory

`packages/db/src/schema/data-inventory.ts` will be the single declaration
of every `table.column`'s category, visibility, purpose, lawful basis,
storage (`postgres | redis | vendor`), owner, retention, erasure rule and
exportability, per ADR 0036 §3, once PRIV-3 builds it. Redis key
namespaces and vendor-held records (the PostHog person, Sentry user
context) will be classified in the same inventory, not a separate one.

**Until PRIV-3 lands (DEC-11):** the file above does not exist yet, so a
personal-data column, log field, `outbox.payload` kind or realtime topic
payload field carries its classification (category, visibility, purpose,
lawful basis, retention, erasure) in the PR body instead, per the "Privacy
& telemetry" section of `.github/pull_request_template.md`. `bun privacy`
(planned, PRIV-3) will then fail the build on an unclassified column, a
stale entry, or a personal column missing `visibility`, `storage`,
`owner`, `retention` or `erasure`, and will name the owning area in every
failure; it is planned to run as part of `bun check` and the CI matrix
once it lands, and will carry the PR-body entries into the inventory.
Adding a column that holds personal data will get its own recipe in
`docs/development/extending.md` at the same time.

**`outbox.payload` and every realtime topic are telemetry-visible surfaces
under these same rules, not an exception.** `outbox.payload`
(`packages/db/src/schema/outbox.ts`) is an untyped JSON column, and two
different exposure surfaces ride it (`packages/protocol/src/realtime-
payloads.ts`):

- **Delivered to a subscribed browser** (the delivery-side rule, added to
  `@daisy/protocol` with the first `event` sender): `debate.phase-changed` on `debate`,
  `standings.updated` on `standings`, and `user.notification-delivered` on
  `user:inbox`. The first two carry only ids and a projected competitive
  state (`identifier`/`none`). `user.notification-delivered` also carries
  `notificationType` (a controlled vocabulary string, category `none` —
  never free text) and `occurredAt` (a timestamp, category `none`);
  neither is personal, but both still need their own inventory entry.
- **Storage-only, never delivered as an `event` to any client**
  (storable through `isPayloadStorableOnTopic` only): the three `user:inbox` control kinds
  (`session.revoked`, `access.revoked`,
  `actor.presence-preference-changed`), each an array of ids only. These
  are durable rows the realtime service consumes internally to close
  sockets or re-project presence; they never ride a subscribed topic as an
  `event` message, so their exposure is narrower than the delivered kinds
  above, not equivalent to them.

Both surfaces still need inventory entries — the point of this section is
that neither is an exemption, delivered or storage-only. Any payload kind
made storable (`isPayloadStorableOnTopic`) or deliverable (the delivery-side rule) must
classify every one of its fields the same way a database column would
before it can ride a topic.

## Retention

Retention today is scattered across a few ADRs and one doc, until PRIV-3's
inventory becomes the single index:

- [ADR 0025](../decisions/0025-auth-delivery-and-abuse-protection.md) and
  [docs/operations/auth-delivery.md](auth-delivery.md): expired
  `verification` rows are purged after 24 hours; `email_delivery` and
  `email_delivery_event` rows hold only keyed recipient hashes and IDs and
  are purged after 30 days; `email_suppression` rows are kept so a
  suppression survives an account. One retention sweep
  (`apps/web/src/server/retention-sweep.ts`) owns all of these.
- [ADR 0029](../decisions/0029-competitive-schema-foundation.md): account
  deletion tombstones the user (below); competitive history, actors and
  ratings are retained indefinitely as the product's own record, holding no
  PII.
- **AUTH-7.5**: an expired `session` row (`ip_address` and `user_agent`
  travel with it) is purged 24 hours after `expires_at`, the same grace and
  the same sweep as `verification`. A revoked session is deleted
  immediately by the revoking operation (`revokeOtherSessions`,
  `revokeSessionUnlessAddressHeld`) and is never seen by the sweep; neither
  path ever logs `ip_address`, `user_agent` or a token.

## Data subject rights

`exportPersonalData(principal)` and `erasePersonalData(principal)`
(`apps/web/src/features/privacy/`, PRIV-4) are pure planners driven by the
inventory; an adapter executes each plan in one transaction.

**Export** returns every exportable inventory column for the requesting
principal, and nothing for any other principal.

**Erasure** runs the ADR 0029 tombstone transaction: private personal data
is deleted, public personal data is scrubbed per its own inventory entry
(today `delete` — `users.username` is set `NULL`, matching
`users_tombstone_scrubbed`, not replaced with a placeholder), the auth
rows are deleted, grants are revoked, `deleted_at` is set, and `actors`
plus all competitive history are left untouched. In the same transaction,
one `privacy_jobs`
row is inserted per vendor currently configured (none, if no vendor key is
set). After commit, a worker retries each vendor deletion with backoff
until the vendor acknowledges (ADR 0036 §4); a vendor outage never blocks
or reverts the local erasure that already committed. A job that keeps
failing past a threshold emits a registered log event, so an unfulfilled
vendor deletion is never silently lost.

`actors.user_id` keeps pointing at the tombstoned `users` row after
erasure (ADR 0029, unchanged by this epic): see ADR 0036 §4 for why that
retained, internal-only link between two rows that both hold no personal
fields is not itself a privacy gap.

## Consent

`necessary`, `analytics` and `replay` always exist in the stored consent
schema, independent of which vendors are configured in a given deployment
(ADR 0036 §5). `unanswered` counts as denied everywhere a decision is
needed. The UI shows only the categories backed by functionality actually
enabled in the running deployment, and asks again only for a category that
becomes enabled later and that the user left unanswered — an earlier
answer is never reset. A signed-in user's choices are additionally recorded
in `consent_record` (version, choices, timestamp) as durable proof of
consent.

## Subprocessors

| Subprocessor     | Purpose                                                       | Data                                                                                                                          | Region                                 | DPA status                   |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------- |
| Sentry           | Error tracking (ADR 0037)                                     | Scrubbed error events; `user.id` (cuid2) only, no PII                                                                         | Deploy-time host/DSN setting           | PRIV-H, human-only           |
| PostHog          | Product analytics and consent-gated session replay (ADR 0037) | Event properties classified `none`/`identifier` only; `anonymousId` or `userId`, `actorId` only on `competitive: true` events | Deploy-time `NEXT_PUBLIC_POSTHOG_HOST` | PRIV-H, human-only           |
| Resend           | Transactional auth email delivery (ADR 0025)                  | Recipient email (delivery only); webhook events retain a keyed SHA3-256 recipient hash, never the raw address                 | Configured at the sending domain       | Existing, predates this epic |
| Hosting provider | Application hosting                                           | Whatever the deployment platform's own subprocessor terms cover                                                               | Deploy-time                            | PRIV-H, human-only           |

Vendor account creation, region choice, DPA execution and deploy secrets are
a human-only sign-off leaf (PRIV-H); no agent self-approves them.

## DPA checklist (PRIV-H)

Before a subprocessor goes live in a real deployment:

- [ ] Vendor account created under the organization, not a personal login.
- [ ] Data processing region confirmed and recorded against this table.
- [ ] DPA (or equivalent data processing terms) executed and filed.
- [ ] Deploy secrets (`SENTRY_DSN`, `POSTHOG_API_KEY`, etc.) set only in the
      deployment platform's secret store, never committed.
- [ ] Sentry source-map upload configured, without a token that needs a
      broader scope than source-map write.
- [ ] Subprocessor row above updated with the confirmed region and DPA
      status.

## What is not built yet

Export and erasure (PRIV-4), the closed log-field types and `errorClass`
(PRIV-2), the inventory and its gate (PRIV-3), the Sentry adapter (PRIV-5)
and the PostHog adapter and consent banner (PRIV-6) are separate leaves of
the privacy and telemetry epic, tracked on the epic's PageSpace plan page.
This document describes the rules those leaves implement, not their
current implementation status.
