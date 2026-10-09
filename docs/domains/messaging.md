# Messaging runtime

Messaging uses a persistent channel as its authorization boundary. The current
social adapter supports DM pairs and private-group grants. Actor preferences,
following and read cursors do not grant access. Other contextual channel kinds
require their owning producers before admission.

`@daisy/db/messaging` supplies a transaction frame over the application's existing
pool. It discovers authority identities, locks current users in sorted order,
then locks the canonical DM pair and channel. Membership is reread after waits;
a changed actor set refuses the operation. The application injects the canonical
account and policy composition, keeping raw birth data outside messaging.
Protected reads and writes reevaluate that composition while the locks remain
held, including after limiter waits and before receipt replay.

Message sequence orders creation. Change version orders content changes and
reconnect reads. History pages are descending by sequence; reconnect pages are
ascending by current message change version. Removed content is represented by
a minimal unavailable marker. Read cursors advance monotonically and cannot
exceed committed channel sequence. Marking read does not follow the channel or
enable notifications.

Sends atomically persist message, actor/channel/request receipt, counters and a
content-free `channel.changed` outbox event. Equal concurrent requests commit
one message; a different live payload conflicts. A consumed unavailable result
refuses before comparing its fingerprint and cannot reinsert content. The
provisional unavailable-result precedence follows ADR 0063 and does not confer
owner approval of its pending product policy.

The same-transaction `messaging` privacy adopter runs before canonical account
scrubbing. It deletes subject receipts, reactions, preferences, grants, contact
pairs and DM pair authority, scrubs only subject-authored text, and preserves
other authors' contributions. Shared titles lack subject attribution and are
preserved; export returns no channel title rows. Missing DM pair authority denies
reads and posting. DEC126 governs any future survivor-history continuity; no
continuity permission is inferred. Export includes subject-owned declared fields
only, excludes the other actor's directional block flag, and serializes dates as
UTC ISO values.

The web composition accepts an explicit `MessagingRuntimePolicy`. It wires the
same operations to authenticated, same-origin HTTP send/edit/remove/history/change/read
handlers and the canonical limiter. An absent policy returns unavailable (503).
No production size, contact, reading, legal-basis or retention approval is supplied
by fixtures or package defaults. Native forms, reaction/search,
social lifecycle commands, realtime subscriptions and the remaining contextual
slices are still delivery work; these primitives do not constitute full messaging
acceptance.

Author edits keep their creation sequence and allocate an independent change
version. The edit deadline is injected policy, rechecked after limiter waits.
Equal retries read the current available result after current authorization;
conflicting payloads leave state unchanged. Own removal uses the canonical
`channel.message.remove` capability and a separate operation authorship check,
so posting restrictions do not prevent removal under explicit retained-history
permission. Removal scrubs text and all message-linked receipt fingerprints in
the same transaction, emits a content-free doorbell and returns only an
unavailable cursor. Retries never resurrect removed content.

DM requests enter dedicated recipient preview/decision and sender status/cancel
operations. Closed retries project an actor/request/channel/digest/original-operation
bound receipt through current `channel.request.result`; they never replay a write
or use ordinary history as a mutation grant. Native recipient and sender forms
use these same authenticated HTTP operations and retain their idempotency ID on
refusal.

The inbox first authorizes the caller's own messaging collection and discovers
association IDs only. Each entry then obtains a fresh channel read, recipient
request read, or sender status grant while canonical account/pair/channel fences
are held. A removed entitlement omits its entry; an infrastructure refusal does
not become empty history. Pagination and transport limits are explicit injected
policy inputs.

DM creation and authority changes append an owner-only `messaging.inbox.changed`
bell in their transaction. Its payload is only `kind`; it contains no actor/channel association, request
content or fabricated entity revision. The existing owner inbox topic provides
the routing address, selected from the current locked DM pair. The
browser clears its stale snapshot and refetches the protected inbox. Generic
outbox position orders delivery; an uncertifiable reconnect requires HTTP
resynchronization. The kind marker has privacy category `none`. No personal/private payload
exception is inferred from an owner-only topic. Existing messaging collection
lawful-basis and retention choices remain pending canonical PRIV-3/PRIV-4
decisions; this bell supplies no activation or retention exception.

The native routes, inbox and realtime reader are delivered source. Current
browser, JavaScript-disabled, current-role and final composed service evidence
must be recorded separately; these additions do not establish whole messaging
acceptance. Private-group and contextual producer obligations remain open.

### Scoped search

`GET /api/messaging/channels/:channelId/messages/search` accepts one literal
`query`, a configured page limit and an optional channel-bound `before` cursor.
It uses the same ordered account/pair/channel transaction and canonical current
`channel.read` decision as history. Search text is bound SQL data, including `%`
and `_`; it is not a wildcard expression. Removed/scrubbed message text cannot
match or return a message identifier. Results carry the existing validated
history envelope and preserve the query when following an earlier-page cursor.

The conversation's GET search form works without JavaScript. Search text stays
in the request/browser navigation; this implementation adds no query log,
durable search record, event payload or analytics field. Existing message and
relationship privacy declarations, current reading-policy holds and erasure
rules remain applicable. Contract and protected-refusal tests are branch proof;
the new real database/HTTP and browser controls remain scheduled acceptance.

### Private-group invitation decisions

Invitation metadata uses `channel.invitation.read` and returns only the channel
identifier, invitation generation and pending state. It does not disclose the
shared title or history. Invited participants may decline, and the original
inviter may cancel, without an age, posting or reading admission grant. Acceptance
requires the canonical current inviter manager grant, complete fenced account
and age facts, and an explicitly approved group admission policy and block
scope. Missing approval makes the HTTP acceptance operation unavailable.

The transaction locks the current account cast plus both invitation participants,
then the selected ordered contact pairs, then the channel. It rereads the cast
and invitation before evaluating canonical authorization. Acceptance installs one
new member grant generation; refusal installs none. Every write rechecks current
authority after limiter waits and advances channel authority with thin channel
and own-inbox doorbells.

Closed retries use `channel.invitation.result` only after binding the actor's
original request receipt to its operation, digest, channel, actual counterpart
and invitation generation. They return minimal closed state and never repeat a
grant or mutation. Group creation, invitation issuance, management and self-leave
remain separate operations; these decision bindings do not complete their
acceptance or approve pending product, privacy or retention choices.
