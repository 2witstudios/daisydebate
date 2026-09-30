# 0047: beehiiv as the newsletter vendor

Status: accepted. Applies [ADR 0036](0036-privacy-by-design.md) (classification,
vendor erasure) to a further vendor surface beside Sentry and PostHog
([ADR 0037](0037-error-tracking-and-product-analytics.md)), and follows the
secret rules of [ADR 0019](0019-token-secret-ownership.md). It amends ADR 0036
§4 for beehiiv in one place: beehiiv is keyed by email address, not by the
`subject_ref` cuid2 id that section calls "the key the vendors hold" (see
Erasure).

## Context

The Scoreboard, Daisy's newsletter, runs on beehiiv (owner-confirmed
2026-09-29; publication `pub_17bc7741-6112-4d0e-a646-58a1c096c540`). beehiiv
holds subscriber email addresses, so it is a subprocessor and needs a
recorded decision before any code calls it. Daisy stores no newsletter
subscription state (waitlist plan, DEC-48): beehiiv owns confirmation,
unsubscribe and `List-Unsubscribe`, and Daisy's Resend account stays
transactional-only (ADR 0025).

## Decision

### Data held

- **Subscriber email address.** Category `personal`, visibility `private`
  (ADR 0036 §1), storage `vendor`. Purpose: delivering the newsletter the
  person asked for.
- **Optional acquisition fields** the create call accepts (`utm_source`,
  `utm_medium`, `utm_campaign`): category `none`, and only Daisy-chosen
  constants such as the surface that offered the opt-in. Never a user id,
  actor id, username or other personal value.
- beehiiv also holds what it generates for its own operation (subscription
  id, status, timestamps, engagement data). Daisy neither reads nor stores
  those beyond the subscription id transiently during erasure.
- Daisy sends nothing else: no name, username, `actorId`, birth month or
  interests. The email comes from the signed-in principal's verified address,
  never from a request body.

### Lawful basis and double opt-in

Consent (GDPR Art. 6(1)(a)), given by an explicit action: the member presses
"Send me The Scoreboard" or ticks the opt-in. Daisy sends
`double_opt_override: "on"` on **every** Create Subscription request, so
confirmation never depends on the publication's default setting; the person
is not subscribed until they confirm from their inbox. The controls are
offered only to the 16-17 and adult bands (DEC-51).

### Newsletter consent is separate from ADR 0036 §5

`necessary`, `analytics` and `replay` govern telemetry and are stored in
`consent_record`. Newsletter consent is a distinct purpose, held by beehiiv
as the record of the double opt-in, and Daisy stores no copy. It adds no
consent category, and a newsletter opt-in never grants or implies an
analytics or replay choice, or the reverse.

### Configuration and inertness

`BEEHIIV_API_KEY` (a server-only secret, ADR 0019) and
`BEEHIIV_PUBLICATION_ID` are validated in `@daisy/config` and optional. The
adapter, at `apps/web/src/features/newsletter/`, is inert without both: it
reports "not configured" and makes no network call, as in ADR 0037. Calls go
only through a pure request builder and an injected `fetch` with a deadline.
A beehiiv failure, a 429 or a timeout is a typed retryable failure, never a
throw into the caller and never a blocker for onboarding.

### Retention

Daisy sets no retention clock for the beehiiv record and stores nothing to
expire. beehiiv's own retention is not confirmed by the pages read: its
[Delete subscription](https://developers.beehiiv.com/api-reference/subscriptions/delete)
page says deletion is permanent and recommends unsubscribing instead when
possible, and says nothing about how long an unsubscribed record, a backup
or a log is kept. That is an open question below, not an assumption.

### Erasure

When beehiiv is configured, account erasure inserts one `privacy_jobs` row
with `vendor = 'beehiiv'` in the tombstone transaction (ADR 0036 §4;
PRIV-4), with the same durable retry and failure logging as every vendor.
beehiiv documents no delete-by-email call. The job resolves the address with
[Get subscription by email](https://developers.beehiiv.com/api-reference/subscriptions/get-by-email)
(`GET /v2/publications/{publicationId}/subscriptions/by_email/{email}`,
`subscriptions:read`) and then calls
[Delete subscription](https://developers.beehiiv.com/api-reference/subscriptions/delete)
(`DELETE /v2/publications/{publicationId}/subscriptions/{subscriptionId}`,
`subscriptions:write`, `204`, permanent: "all data associated with the
subscription will also be deleted"). A `404` on lookup means nothing is held
for **that address**, and it acknowledges only an address Daisy sent to
beehiiv.

**The address beehiiv holds must be one erasure can find.** A member can
change their account email after opting in, so the address Daisy sent and the
member's current address can differ; looking up only the current address
would get a `404`, mark the job succeeded and leave the old address in
beehiiv. Requirement on WAIT-4.4 and PRIV-4a: either the subscription's
address is kept equal to the member's on every email change, or every address
sent is recorded until erasure deletes it from beehiiv, or the opt-in is
refused after a change until re-sent; an erasure job must delete every
address Daisy sent. This ADR does not choose among them, and does not assume
beehiiv offers an update-address call, since the pages read do not confirm
one (open question below). The job is filed as PRIV-4a.

The job needs the email, which the tombstone transaction deletes locally,
while `privacy_jobs.subject_ref` is the cuid2 id. How the job holds the
address until beehiiv acknowledges without becoming a second copy of
personal data is an open question for PRIV-4a's design; it is not decided
here.

### Access and export

Daisy holds no newsletter state, so `exportPersonalData` returns nothing for
beehiiv. A member's access and portability request for the subscription is
answered by beehiiv, which holds the record; the privacy policy (WAIT-6.1)
says so and names the vendor. If the requirement above leads Daisy to record
sent addresses, those addresses are exported like any other inventory column.

### Plan limits (Launch plan)

- 2,500 subscribers.
- The API allows 180 requests per minute per organization, answered with
  `429` beyond that, and reports `RateLimit-Limit`, `RateLimit-Remaining`
  and `RateLimit-Reset` headers; beehiiv advises queueing with exponential
  backoff. Erasure jobs share this budget with signups, so the worker
  retries with backoff.
- The limits belong to the vendor plan, not to Daisy. Reaching 2,500
  subscribers is a plan decision for the owner, and the adapter treats a
  vendor refusal as a retryable failure.

### Open questions, owned by WAIT-1.2

The reviewed documentation does not confirm the following, so none is
assumed. WAIT-1.2 (the owner's credentials leaf) answers each and records it
in the `docs/operations/privacy.md` subprocessor row:

- The data region where beehiiv stores and processes subscriber data.
- The DPA terms, and whether international transfers rely on standard
  contractual clauses.
- Whether an API key can be limited by permission or by publication, or
  whether the workspace must hold only this publication.
- Whether an update-address call exists, and how an unsubscribed record is retained.
- Whether a delete-by-email call exists beyond the two-step lookup and delete
  above.
- Whether beehiiv retains backups or logs of a deleted subscription, and for
  how long.

## Consequences

- `docs/operations/privacy.md` gains a beehiiv subprocessor row with region
  and DPA marked open, pending WAIT-1.2.
- `docs/dependencies.md` registers beehiiv's HTTP API as an external
  dependency with no SDK package: Daisy calls it with an injected `fetch`.
- WAIT-4.3 builds the adapter, WAIT-4.4 the member operation and PRIV-4a the
  erasure job; each reads beehiiv's current API documentation first. WAIT-6.1
  drafts the privacy policy from this record.
- Vendor account, API key, region choice and DPA stay a human-only sign-off
  (WAIT-1.2); this ADR fixes the mechanism, not the sign-off.

## Sources

- Create subscription (`double_opt_override`, `subscriptions:write`):
  https://developers.beehiiv.com/api-reference/subscriptions/create
- Get subscription by email:
  https://developers.beehiiv.com/api-reference/subscriptions/get-by-email
- Delete subscription:
  https://developers.beehiiv.com/api-reference/subscriptions/delete
- Rate limiting: https://developers.beehiiv.com/welcome/rate-limiting
- Launch plan (2,500 subscribers): https://www.beehiiv.com/pricing
