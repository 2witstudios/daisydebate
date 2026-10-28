# 0089: Shared resource observation

Status: accepted (platform-capacity slice, G7 of the
[Platform plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/hf54ezcwy7d61m9463q20a1i);
[slice plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/wgm0p7u42u55700dbkfqqexu) §3E;
source of truth: the [architecture repair plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/b8yv71h2bc9pbfmbgsm2n2pe) §4).
Amends [ADR 0008](0008-redis-ephemeral.md), [ADR 0031](0031-realtime-service.md)
and [ADR 0032](0032-transactional-outbox-delivery.md). Runs on the lanes of
[ADR 0088](0088-database-workload-admission.md).

## Context

A conversation's viewers each authorized every delivered row with a
PostgreSQL read and then re-rendered the whole page with `router.refresh()`.
500 viewers and one message cost 500 authority reads and 500 page renders,
and the refresh replaced the form subtree, losing drafts (MSG-5.3-arch1).
Spectating is coming: a Round will have hundreds of viewers, and a viewer
is never assumed to be a participant.

## Decision

1. **Observable resources.** A resource kind adopts shared observation by
   declaring one `ObservableResource` (`apps/realtime/src/observation/resources.ts`):
   a batched header read, a projector, a body validator and a batched permit
   evaluator. The interest, owner, cache, fanout and browser machinery is
   generic. The first kind is `channel-messages`. A Round spectator view
   later adds one definition (projector and audience permits) and nothing
   else.
2. **Identities.** A _base_ is resource + policy-issued partition +
   durable disclosure revision. A _body_ is base + content revision, built
   once fleet-wide. A _permit_ is per viewer and never part of a cache key;
   a cached body grants nothing. For channel messages the content revision
   is the stream's `change_version` (the stream row is the header, ADR
   0088's MSG-2.2-arch1), the disclosure revision is the channel's
   `authority_revision`, and every member shares the `members` partition.
3. **Interest and demand.** Each realtime node registers one expiring
   interest per resource (not per socket) and raises demand in Redis. The
   bounds are per resource 1,024 nodes, 100,000 demanded resources, and per
   node 1,024 resources, 5,000 bindings, 32 per socket and 64MiB of encoded
   snapshots (least recently changed bodies dropped first).
4. **Owner.** An eligible process (`REALTIME_OBSERVATION_OWNER`, profile
   `realtime-observer`) claims due demand with an unguessable token and a
   2s lease, reads every owned header in one batched query per kind every
   100ms on the `headers` lane, and builds a newer snapshot once on the
   `projection` lane. It renews the lease only after a successful header
   read, so a hung database cannot pin ownership. It publishes a completed
   newer snapshot even while more changes are pending. Fleet header work is
   one query per owning process per tick, independent of viewers and of
   fanout nodes.
5. **Projection reads.** Content reaches realtime only through two
   `SECURITY DEFINER` functions that disclose exactly the window's columns
   (`daisy_observation_channel_headers`, `daisy_observation_channel_messages`).
   `daisy_realtime` has EXECUTE on them and still no table grant on
   message content. Like every other `daisy_*` read they belong to the
   migration owner: ADR 0080 forbids a migration that changes ownership or
   needs a new cluster role, so no separate projection role exists. The window is read in one statement, so its body and
   revisions agree. The same mapper (`createChannelMessagesProjector`)
   serves authorized HTTP history and snapshots: at most 50 messages and
   the 128KiB frame budget, never truncating a message, continuing after
   the last complete one.
6. **Distribution.** A guarded Lua script installs body and head together,
   only for the current owner token, cache incarnation and purge
   generation, and only forward within a base. It then publishes a
   metadata-only hint on the resource's Pub/Sub channel. A purge deletes
   bodies and advances the purge generation, so a build that began before
   it can never install. A changed cache incarnation voids every guard.
   Each node fetches a changed body once per revision, validates and
   encodes it once, and repairs from Redis heads every 500ms (Redis only,
   never SQL), so a lost hint costs one head read.
7. **Permits (DEC-130).** Admission and renewal run on their own lanes,
   batched per resource: one shared-fenced cohort read
   (`messagingChannelCohortAuthority`) loads the cast once for every viewer
   asking now, and each viewer is decided by the same channel policy the
   topic path uses (`decideChannelViewer`). A permit expires at its read
   start plus the lesser of the facts' own lifetime and 4,700ms. Every
   enqueue checks synchronously that the node is serving, the binding's
   generation, the deadline, the exact base, and the content floor.
   Renewal starts 2s before expiry. Unavailable keeps an unexpired permit;
   denial removes the binding and reports `revoked`.
8. **Control fences.** A channel authority change advances
   `authority_revision`, so the owner's next header read publishes a new
   disclosure revision. Nodes then re-admit every viewer whose permit is on
   the old base before delivering anything. Session revocation still closes
   the socket through the existing drain. Account, age and contact changes
   are bounded by the 4,700ms renewal. No separately elected relay ships
   now (DEC-262): it would be a second outbox reader next to the drain. It
   replaces the drain together with the `pg_notify` removal.
9. **Fanout.** One encoded frame per revision goes to every permitted
   local viewer. The loop yields after 128 sends or 2ms and sheds slow
   sockets.
10. **Browser.** One `ObservationProvider` per tab, on the tab's shared
    socket, owns reference counts, generation-fenced `ready`/`state`,
    monotonic snapshot application within the permit base, local permit
    deadlines (expired content is hidden) and re-observation on every
    `ready`. Disposal is final. Features call
    `useRealtime(channelMessages(id), initial, socketUrl)`. Server-rendered
    data is useful display, never a live grant. Commands, search, older
    pages and no-JS reading stay HTTP.

## Consequences

- 500 viewers of one channel cost one interest, one batched admission read,
  one body fetch and 500 sends per revision; fleet SQL is flat in viewers
  and in fanout nodes (unit cardinality tests for N viewers and R = 1, 4, 40
  owners).
- Revocation reaches the last enqueue within 4,700ms, and an authority
  change within about one header tick plus a cohort read.
- Realtime now composes the DEC-251 reading policy that web uses
  (`betaDmPolicy` moved to `@daisy/auth/social-policy`). Before this,
  production realtime had no reading policy and refused every channel
  subscription.
- Reaction counts and the inbox are not observed yet: the reactions page is
  an HTTP read, and the inbox keeps its actor-scoped doorbell.
- Redis now holds protected expendable bodies (at most 60s) and uses one
  Pub/Sub subscriber connection per process (ADR 0008, amended).

## Privacy

Under the obligations model ([ADR 0087](0087-compliance-from-obligations.md),
[compliance](../operations/compliance.md)), the Redis observation body is
part of the **Messages** data class: a live delivery copy of the latest
window (message text and author ids), purpose messaging, lawful basis
contract. It lives at most 60s. Erasure is fenced at four points:

- content erasure advances the stream revision, so the owner's next build
  overwrites the body (one header tick);
- admission and renewal carry the current stream revision as the content
  floor, so a body built before the erasure is never sent to a viewer
  admitted after it;
- an owner whose demand lapses purges the bodies, so no body outlives its
  observation;
- a purge advances each node's local epoch, so a body read or a fanout
  begun before it delivers nothing after it.

The confirmed path is a durable job (ISSUE-852), in the vendor-deletion job
pattern of `privacy_jobs`:

- a member's erasure (the messaging privacy step) upserts one
  `observation_purge_jobs` row in the erasure transaction itself;
- a short-interval web worker (`apps/web/src/server/observation-purges.ts`)
  purges every cached observation body and fences every guard
  (`purgeAllObservations`). It then marks the jobs it read `succeeded`, and
  only after Redis confirms;
- a failure keeps them `pending` with exponential backoff (1s doubling to 5
  minutes), so a Redis outage or a restart loses no job;
- a re-erasure committed during a purge stays pending for the next one.

The TTL is a backstop, never the mechanism. Claims, guards, interests, demand and
Pub/Sub hints hold only resource ids, node incarnations, claim tokens and
revisions, expire within 2 to 120s, and describe no data subject.

No body enters logs; `realtime.observation.unavailable` carries only an
operation and an error code.
