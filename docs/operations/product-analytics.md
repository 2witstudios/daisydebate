# Product analytics

`apps/web/src/features/analytics` owns product event schemas, consent and
PostHog adapters (ADR 0037). Beta capture is explicit opt-in. Unconfigured
deployments do not initialize a vendor SDK or show optional controls.

## Beta event contract

| Event             | Meaning                                         | Properties                                   |
| ----------------- | ----------------------------------------------- | -------------------------------------------- |
| `page_viewed`     | A consented browser enters a known product area | `area`, a closed enum; never a path or query |
| `room_created`    | The server successfully creates a Room          | none                                         |
| `room_rematched`  | The server successfully creates a rematch       | none                                         |
| `consent_updated` | A signed-in account explicitly grants analytics | `replay`, false in this beta                 |

The adapter supplies exactly one `anonymousId` or `userId`; person
identification uses only the account's cuid2 ID. No names, emails, Room IDs,
resolutions, transcripts, DOM content, request bodies, referrers or raw URLs
are event properties. The browser's final send filter also removes SDK
enrichment. PostHog receives connection metadata as a processor; GeoIP is
disabled, but this is not a claim that an HTTP recipient cannot see an IP.
Autocapture, exceptions, session replay, feature flags and surveys are off.
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
uses memory before opt-in and cookies afterward. Sign-out or account change
resets identified vendor state. A same-origin storage notification pauses
capture in other tabs and refreshes their server-owned consent and identity.

Vendor erasure joins the existing durable privacy-job worker only when its
delivery port is configured. It requests person, event and recording deletion
with a project-scoped management credential. Delivery completes only after
the vendor acknowledges durable acceptance of both deletion requests without
errors. PostHog performs physical deletion asynchronously. Local erasure does
not wait for the vendor; outages leave jobs pending for bounded-backoff retry.

## Configuration and activation

The owner supplies these through the platform's secret/configuration store
after PRIV-H sign-off; never put real values in this document or a PR:

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
regional ingestion and asset origins, with no wildcard vendor domains.

Before live activation, PRIV-H must record organization ownership, approved
region, transfer safeguards, executed DPA, the chosen event retention period
and legal-policy publication. Retention remains an owner/counsel decision;
there is no application override of the vendor project's retention setting.
The served legal text is not silently replaced by this integration.

On the approved staging project, accept analytics in a dedicated test account,
visit home and Rooms, create a Room and rematch it. Verify the four registered
events, their closed properties and distinct ID in Live Events. Reject
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
