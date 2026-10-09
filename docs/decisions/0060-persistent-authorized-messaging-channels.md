# 0060: Persistent authorized messaging channels

Status: accepted (MSG-1.1; owner-approved revision 6 plan, 2026-10-08).
Amends [ADR 0031](0031-realtime-service.md) and
[ADR 0032](0032-transactional-outbox-delivery.md)'s messaging topic and payload
contract and [ADR 0054](0054-debate-room-workspace.md)'s communication
availability policy. Builds on [ADR 0048](0048-authorization-core.md)'s shared
authorization and [ADR 0058](0058-one-round-model.md)'s separation of contextual
authority from social affiliation.

Source: [owner-approved revision 6 plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ae984sbtpv8qqgvezyngn32y),
[MSG-1.1](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/us5mk8zd4jkq2rpzf7ctlery)
and [bounded writer handoff](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/d2tnqmyzy09xb5kuycils6et).

## Context

Daisy projects the same messaging system into an inbox, Room sidebar and
spectator surface. A screen is not a conversation identity. Room and Round
eligibility are authoritative facts from their owning domains; following and
notification preferences cannot become a competing access authority.

## Decision

A channel is the persistent communication and authorization boundary. Every
message belongs to one channel. Ordinary messages have no independent audience.
There is no extra Conversation entity, generic mutable permission JSON or
unconstrained context identifier. Constrained context associations arrive with
their existing target schemas and authoritative producers.

Entitlement and subscription are separate. ChannelActorState stores following,
read cursor and notification preferences; it never grants access. Messaging owns
explicit private-group grants and the accepted canonical unordered DM pair.
Contextual grants are not mirrored locally. Shared authorization resolves the
current actor/account and fresh authoritative facts before any protected read.
Private-group invitation/history and DM contact/age/request/block policies are
separate recorded product gates; this decision grants no unapproved defaults.

A channel pins a typed access-policy key/revision. Historical and promised future
access are explicit channel contracts, not snapshotted recipient lists. Changing
roles does not rewrite message policy. A populated policy cannot silently broaden
history; sharing with a broader boundary requires an explicit separate action.
Current authoritative loss of eligibility denies subsequent reads and writes.
Already downloaded data is outside that server guarantee.

Authorized mutations serialize with membership, block, lifecycle and producer
transitions using the owning producer's approved lock/fence contract. Denial
preserves rows, sequence, version and outbox state. Each channel has a strictly
increasing message sequence and a separate durable change version for creation,
edits, removals and reactions. Read cursors are monotonic and bounded to current
authorized committed history; timestamps are not ordering tokens.

Idempotency is scoped to actor, channel and request ID. Equal retries prevent
repeat mutations; unequal payloads conflict. Deduplication preserves no authority
to retrieve an earlier result. Every retry checks current identity/erasure,
entitlement, block state, posting lifecycle and message availability before any
protected response. Removed, blocked or erased actors receive the normal denial.
Deleted/purged content cannot be returned from a dedupe record. A minimal classified
receipt may prevent reinsertion independently of content retention. No retry
increments message sequence/change version or appends a second outbox row.
Legitimate DM history uses its independently approved history contract.

HTTP owns mutations. The existing transactional outbox announces `channel:<id>`
with a typed content-free `channel.changed` doorbell containing the channel ID
and durable change version. The topic itself is an identifier, not a credential.
Storage and delivery schemas bind the channel ID and kind to the parsed topic.
Message text, authors/typing actors, previews, filenames, membership details and
reports never ride these doorbells. Protected content is fetched through fresh
authorized HTTP. Actor-specific typing state is freshly authorized HTTP data;
realtime typing activity is a separate content-free extension contract.

Subscribe and continuing delivery compose the same shared decision. Current
HTTP access is authoritative. A realtime node invalidates on consumed revocation;
otherwise its approved RT lease/revalidation deadline bounds stale content-free
activity. Failed/unavailable rechecks close subscriptions, and lease expiry stops
emission even if a recheck hangs. A lagging node can disclose channel activity
existence/timing until that bound; it cannot disclose private content or sensitive
metadata. RT owns the precise bound and proof, not this messaging decision.
The existing commit-ordered outbox cursor, ring/catch-up and resync contract stands.

DM and team/coach communication remain technically available during play. ADR
0054's rated-round social-channel hiding requirement is superseded only for
messaging availability. This does not approve assistance: Round/tournament
producers own assistance rules, projections and adjudication. No change to AI
agent availability is implied. Contextual room/floor/spectator readership and
broadcast-delay transitions remain producer-approved gates.

Implementation proceeds through independent social and contextual vertical
slices. Working DMs do not depend on groups, files, reports, Room, Round,
broadcast or team/event producers. Shared auth, privacy, contact and RT foundations
remain real prerequisites. All branches join only for complete-system verification.
Missing producers cannot be replaced by local authority or a mock success path.

## Delivery and producer gates

MSG-1.2 adopts portable core/social contracts; MSG-1.3 adds social-only persistence
and privacy adoption; MSG-1.4 adds the channel topic/storage vocabulary. MSG-2.1
consumes the AZC evaluator/loader; MSG-2.2 proves atomic send/retry revocation;
MSG-5.1 consumes RT and MSG-5.4 proves a working DM via production commands.
Context associations are separate MSG-4 producers/delivery integrations. File,
report, typing and notification extensions add their own contracts and privacy
proofs. Explicit writer slots, approved product policies and merged producer
contracts gate Ready. Architecture approval alone is no shared-file grant.

The complete epic requires all slices, full repository/service/browser gates,
independent exact-head published review and fixes for findings. Production
provider/identity/deploy activation is human-only. This ADR changes no schema,
route, evaluator, public contract export or runtime behavior on its own.
