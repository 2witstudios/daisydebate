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

### Selected live-beta configuration (owner-verified 2026-11-06)

- Organization: **2witstudios**; existing **Default** project **699106**.
- Region: **US Cloud**, ingestion origin `https://us.i.posthog.com`.
- Plan: **Free**, **1 million events/month**; selected event retention **one year**.
- Session replay: **disabled**, regardless of vendor project toggles.

These are the owner's verified setup selections, not evidence of live capture,
legal approval or deployment. The DPA is **not executed**: the legal form still
requires the human-supplied company name, registered address and signer email.
Transfer safeguards and PRIV-H sign-off remain outstanding. Do not close
PRIV-H or set ingestion/management credentials on the strength of project
selection alone. The parent activation operator handles scoped-key approval,
configuration and live verification; this code/documentation PR does none of them.

The served notice is `privacyDocument` in
`apps/web/src/features/legal/documents.ts`, version `draft-0.3` in
`versions.ts`. Publish that notice before configuring keys to enable capture.
The broader [counsel draft](../legal/privacy-policy.md) remains unpublished;
this focused notice update does not approve that draft or any unrelated legal
claim. Confirm the selected retention in the vendor project before activation;
Daisy does not enforce the vendor's retention setting. Anonymous withdrawal
cannot retroactively erase events that are no longer linked to a browser.

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

Before PRIV-H activation, repeat the bulk-delete proof for the same dedicated
staging subject after its person record has disappeared. Verify the explicit
zero-person acknowledgement as well as the first queued deletion. This
empty-match contract was checked in the upstream [PostHog server implementation](https://github.com/PostHog/posthog/blob/327ba7b2aa835f006f987ac05aa183e2fea51718/posthog/api/person.py)
and is covered by the adapter's repeat-deletion test; the live project still
needs its human activation proof.
