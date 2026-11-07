# Product analytics

`apps/web/src/features/analytics` owns product event schemas, consent and
PostHog adapters (ADR 0037). Beta capture is explicit opt-in. Unconfigured
deployments do not initialize a vendor SDK or show optional controls.

## Beta event contract

| Event                | Meaning                                         | Properties                                                                                           |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `page_viewed`        | A consented browser enters a known product area | `area`, a closed enum; never a path or query                                                         |
| `room_created`       | The server successfully creates a Room          | none                                                                                                 |
| `room_rematched`     | The server successfully creates a rematch       | none                                                                                                 |
| `consent_updated`    | A signed-in account explicitly grants analytics | `replay`, false in this beta                                                                         |
| `broadcast_playback` | Consented broadcast playback quality            | `engine` (`hlsjs`/`native`), nonnegative integer `startup_ms`, `rebuffer_ms`, `watched_ms`, `height` |
| `recording_playback` | Consented recording playback quality            | Same bounded quality fields; no content or Recording ID                                              |

The adapter supplies exactly one `anonymousId` or `userId`; person
identification uses only the account's cuid2 ID. No names, emails, Room IDs,
resolutions, transcripts, DOM content, request bodies, referrers or raw URLs
are event properties. The browser's final send filter also removes SDK
enrichment. PostHog receives connection metadata as a processor; GeoIP is
disabled, but this is not a claim that an HTTP recipient cannot see an IP.
Autocapture, exceptions, session replay, feature flags and surveys are off.
Anonymous product events retain the SDK's `$process_person_profile: false`
flag so the final privacy filter preserves personless capture.
The stored replay category remains unanswered and hidden, independent of
deployment configuration. Replay activation requires its own implementation
and privacy proof; setting a remote project toggle cannot enable it.

## Consent and lifecycle

`necessary`, `analytics` and `replay` always exist in the versioned contract.
Unanswered means denied. `/analytics` exposes native form POSTs for acceptance,
refusal and withdrawal; the banner offers equally styled acceptance and
refusal. A later enabled category asks only if unanswered, preserving earlier
choices. Cookie consent lasts 180 days. Account choices live in
`consent_record` until erasure and are included in subject export. The SDK
is never initialized before opt-in; afterward it initializes from the existing cookie so native navigation preserves identity. Sign-out or account change
resets identified vendor state. A same-origin storage notification pauses
capture in other tabs and refreshes their server-owned consent and identity.

The cookie records this browser's choice, including choices made before
sign-in. Sign-out preserves that preference while resetting vendor identity.
A newly signed-in account without a consent record adopts the browser's
choice once; an existing account record always wins, including refusal.
This device-scoped adoption behavior is part of the PRIV-H counsel review
before activation.

Identified withdrawal records denied consent and a fresh vendor-deletion job in the same account-fenced transaction. Account erasure rearms that job, fencing older acknowledgements by job ID. Anonymous withdrawal stops forward capture and clears browser identity; anonymous history follows the approved vendor retention period.

Server capture runs in an analytics-owned queue (four in flight, 32 waiting), rechecks current account consent before delivery, and sheds excess optional work. Room responses never await the vendor. Shutdown discards waiting optional work and waits for bounded in-flight delivery before closing the one process-owned SDK.

Vendor erasure joins the existing durable privacy-job worker only when its
delivery port is configured. It requests person, event and recording deletion
with a project-scoped management credential. Delivery completes only after
the vendor acknowledges durable acceptance of both deletion requests without
errors, or explicitly reports an already-absent person (`persons_found: 0`, both
queue flags false, no errors), on HTTP 202. An HTTP 404 is never an acknowledgement. PostHog performs physical deletion asynchronously. Local erasure does
not wait for the vendor; outages leave jobs pending for bounded-backoff retry.

## Configuration and activation

The owner supplies these through the platform's secret/configuration store
after PRIV-H sign-off; never put credential values in this document or a PR:

- `NEXT_PUBLIC_POSTHOG_KEY`: public project ingestion token (`phc_…`).
- `NEXT_PUBLIC_POSTHOG_HOST`: `https://us.i.posthog.com` or
  `https://eu.i.posthog.com`, matching the approved project region.
- `POSTHOG_API_KEY`: server ingestion token for that same project.
- `POSTHOG_PERSONAL_API_KEY`: management credential with `person:write` for
  this project; never sent to browsers.
- `POSTHOG_PROJECT_ID`: the matching project's numeric ID.

Capture stays unavailable without the management credential and project ID,
so enabling ingestion cannot strand account erasure. The composition root
validates configuration. Public adapter configuration is explicitly rendered
from runtime server configuration; browser code never reads environment
variables or receives management credentials. CSP admits only the configured
regional ingestion origin. SDK code is bundled; external dependency loading is disabled, so no remote script or blob-worker allowances are added.

Before live activation, PRIV-H must record organization ownership, approved
region, transfer safeguards, executed DPA, the chosen event retention period
and legal-policy publication. Retention remains an owner/counsel decision;
there is no application override of the vendor project's retention setting.
The served legal text is not silently replaced by this integration.

### Live-beta activation (owner-authorized 2026-11-07)

- Organization: **2witstudios**; existing **Default** project **699106**.
- Region: **US Cloud**, ingestion origin `https://us.i.posthog.com`.
- Plan: **Free**, **1 million events/month**; selected event retention **one year**.
- Session replay: **disabled**, regardless of vendor project toggles.

The owner explicitly authorized signing and enabling PostHog. The activation
operator completed the DPA signature; PostHog Legal shows **Signed**, and the
canonical signed copy is retained in PandaDoc and PostHog. The agreement
includes transfer provisions (DPF and applicable standard contractual clauses).
This records the executed PostHog agreement, not approval of the broader
counsel draft or completion of global PRIV-H.

The operator verified a management credential restricted to project **699106**
and `person:write`, then imported all five required values through Fly secrets
into `daisy-debate-staging`. The rolling update succeeded and readiness
returned HTTP 200. The served `privacyDocument`, version `draft-0.3`, was
verified live with the PostHog disclosure **before** capture was enabled.
The project showed the organization-default **one-year** event retention;
Daisy does not enforce the vendor's retention setting. Anonymous withdrawal
cannot retroactively erase events no longer linked to a browser. No credential,
private address or document access token belongs in this record.

The nonsecret activation receipt is recorded in the
[PostHog plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/dknkvlneixdawuf77avw9p61)
and [PRIV-H](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/s05ydlaxww9iccvyznjn9jjh).
PRIV-H remains open for other processors and obligations. The broader
[counsel draft](../legal/privacy-policy.md) remains unpublished.

### Observed live proof and its limits

The activation operator used a separate anonymous incognito browser, opted in
at `/analytics`, and observed three `page_viewed` events from home and
leaderboard navigation in PostHog Activity. An inspected US regional `/e/`
POST returned HTTP 200 with status `Ok`. Its properties contained only bounded
area, browser identity and required protocol/privacy fields; GeoIP was disabled
and `$process_person_profile` was false. No raw URL, referrer, content, name or
email properties appeared.

After refusing analytics in that browser, the checkbox was false and a product
page reload produced **zero PostHog requests** among 56 observed requests after
the SDK flush window. The test incognito window was then closed.

A random synthetic absent-subject bulk-delete returned HTTP 202,
`persons_found: 0`, both deletion queue flags false and no `deletion_errors`.
This verifies the scoped credential and the empty-subject acknowledgement
contract; it does not prove queued or physical deletion of a linked person.
No participant was deleted.

Signed-in, cross-tab and linked-person deletion behavior and the six admitted
journey kinds have integration/browser coverage. This live activation session
**did not exercise** the full signed-in Room/rematch/erasure journey or every
event kind. Keep that distinction when repeating or extending the proof.
Replay remains disabled. The following is the broader verification checklist,
not a claim that every step was executed in this live session.

On the approved staging project, accept analytics in a dedicated test account,
visit home and Rooms, create a Room and rematch it. Verify the registered page, consent and Room
events, their closed properties and distinct ID in Live Events. Play a
broadcast and a recording to verify both playback-quality events against the
registry, without content identities or media URLs. Reject
analytics, repeat the journey, and confirm no further capture. Verify
cross-tab withdrawal, sign-out identity reset and the existing subject-erasure
job reaching vendor acknowledgement. Never perform this proof with participant
data or unapproved production credentials.

Create a **Beta product use** dashboard with: daily distinct consented people
by `page_viewed.area`; a home → Rooms → `room_created` funnel; daily
`room_created` and `room_rematched` counts; and seven-day returning consented
people. Name the consented population in every chart: these are not total
traffic or authoritative competitive statistics. The event registry, rather
than dashboard-generated instrumentation, is the source of truth.

PostHog's SDK-generated anonymous device IDs and event-deduplication UUIDs
are vendor protocol identifiers, not Daisy application IDs or bearer secrets.
Daisy account IDs remain cuid2. Cross-subdomain SDK cookies are disabled;
this analytics identity is scoped to the current participant-app origin.

The configured native browser proof runs with
`bun run --cwd apps/web test:e2e:analytics`. Its separate Playwright config
uses synthetic vendor credentials, intercepts browser capture locally and
answers management deletion in the test server's explicit fixture transport.
It exercises the production app and CSP, real sign-in and consent persistence,
Settings withdrawal, document reload, cross-tab refresh and JavaScript-disabled
native forms. CI runs it after the ordinary browser suite.

Anonymous consent POSTs are same-origin and bounded to 1 KiB. They change only
the response cookie, so they perform no durable write, vendor call or shared
missing-identity rate-limit lookup. Account mutations retain their own
principal-keyed 30/minute budget.

For live linked-person deletion verification, repeat the bulk-delete proof for the same dedicated
staging subject after its person record has disappeared. Verify the explicit
zero-person acknowledgement as well as the first queued deletion. This
empty-match contract was checked in the upstream [PostHog server implementation](https://github.com/PostHog/posthog/blob/327ba7b2aa835f006f987ac05aa183e2fea51718/posthog/api/person.py)
and is covered by the adapter's repeat-deletion test. The activation receipt
above proves a synthetic empty match only; it does not establish the complete
linked-person deletion and repeat-deletion journey.
