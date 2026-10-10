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
by fixtures or package defaults. Native forms, scoped search and realtime
refetch use these same operations. Remaining group management, reactions,
notifications, file controls and contextual slices are delivery work; the
committed operations do not constitute full messaging acceptance.

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

Pending own invitations also enter the inbox candidate query. A denied history
read may obtain the separate current invitation read grant; infrastructure
failures propagate instead of becoming invitation entries or empty history.
Navigation carries only the channel identifier and `incoming_invitation` kind.
The native invitation page displays no title or message history and binds its
accept/decline action to the server preview's exact generation. Removed or renewed
invitations therefore cannot be acted on through a stale form. The same protected
HTTP decision serves JavaScript and native form submissions. Browser and real
composed database evidence for this group extension remain acceptance work.

### Group creation and multi-target command privacy

Private-group creation evaluates the existing prospective creation capability
against locked real accounts, current minimal age facts and ordered contact
pairs. Proposed invitees remain intent: the creator receives the initial manager
grant and every other participant receives a pending invitation. Identifiers are
allocated only after current admission is rechecked following rate limiting.
Creation retries load current group authority and require a fresh independent
history read grant before projecting their own bound receipt; creation approval
never substitutes for current membership or reading authority.

The dedicated `messaging_social_command_subjects` table records every invitee
associated with a multi-target creation fingerprint. `actor_id`, `request_id`
and `subject_actor_id` are all personal/private command relationship columns,
owned by MSG in PostgreSQL, for subject export and erasure of the associated
command. They are exportable only within the requester's own command or subject
association. Erasure deletes the bound command and cascades its associations;
unrelated peer commands and contributions remain untouched. Lawful basis is
pending PRIV-3 (`jc0qcdvpkmqzrelpaesi3pah`); retention is pending PRIV-4
(`njiorsf64z4iqjm2dbfa3zuu`), with no retention exception or activation approval.
The fingerprint itself retains its existing personal/private declaration.

Schema input and cleanup/export source must be composed with the sole canonical
inventory update and CAP's reviewed forward migration before rights or service
acceptance. Stale inventory refuses the newly exported table. These source
changes do not establish migration application, physical cleanup proof, accepted
group policy, late-join history policy or production collection activation. The
shared title still has no durable subject-owner field; existing title locality
and privacy gaps remain explicit.

## Public username intent discovery

The account adapter exposes `lookupHumanActorByUsername(input)` for native DM
initiation. The single portable `parseUsername` rule validates and normalizes
the input before database I/O. Discovery returns only an actor ID bound to an
existing human account with verified email and no deletion tombstone, or null.
It returns no account profile, age, session or contact entitlement. The messaging
request transaction still locks both current accounts and the canonical contact
pair, then evaluates current authorization and policy before creating a request.
Discovery cannot replace that transaction or grant admission.

The participant inbox links to native username-based DM and private-group
creation forms. Both preserve draft text and the request identity on refusal,
and submit without JavaScript. The HTTP boundary requires the current signed-in
member and same origin before validated, rate-limited username discovery. Both
actor-ID and username entry points converge on the same account/pair/channel
transaction and canonical creation evaluator. Proposed usernames never install
membership or bypass current account/age/contact checks.

Group posting is a separately injected policy input alongside DM posting;
missing or mismatched evidence still refuses. The dedicated native browser
profile selects explicit isolated group admission, posting and reading fixtures,
including all-pairs block scope. These test inputs do not approve DEC127 or
activate a runtime policy. Its cases cover invitation metadata without title or
history, admission, durable member history and refusal without a member grant,
with JavaScript enabled and disabled. Actual browser acceptance is recorded only
when the hosted isolated-service runner executes the composed candidate.

Accepting or declining an invitation removes its pending-preview entitlement.
The form action returns its next destination before refreshing any preview:
an immediate server-action revalidation would render the now-unavailable
pending page before the hydrated form can navigate. Destination pages read
fresh, header-bound canonical HTTP state; native submissions use the same
destination through their redirect.

The browser ticket reader validates the configured endpoint and canonical
ticket schema without dynamic parser code generation. It reports only fixed
transport, JSON, schema-field or parser-class, and endpoint-binding error names.
It never exposes rejected values, exception messages or bearer tickets, and
does not relax the production content security policy.

Contact safety has a native username form for block and unblock, available from
the inbox. Both username and actor-ID routes use the same canonical safety
operation: current subject and counterpart accounts, ordered pair fences and
fresh participant authorization remain mandatory, while age/admission/read/post
policies are not prerequisites. Unblocking grants neither request acceptance
nor content access. Refused sends keep draft text and command identity; native
browser controls exercise a blocked refusal followed by an authorized retry
once the pair is unblocked.

Private-group membership commands use one native username-intent route and the
same transactional provider as application operations. Revoke and archive use
canonical current-manager safety capabilities without age or content-policy
admission; self-leave requires the actual current grant. Transfer still uses
fresh canonical management eligibility. Removing the last manager from an
active group is refused until management transfers or the group is archived.
Grant changes increment the actual generation and scope the write to its
previous generation. Pending invitations issued by a manager losing that role
are cancelled; archiving cancels every remaining pending invitation.

Committed management retries use `channel.group.result` over the actual own
receipt and current channel core. The operation separately binds actor, request,
original operation, target digest and result channel. Replay returns only
channel ID and lifecycle and cannot renew a grant or repeat a mutation. Current
account erasure still refuses replay. Group inbox entries distinguish authorized
group conversations for membership navigation; this adds no title or member
list projection. Native membership forms preserve target and retry identity on
refusal and work with JavaScript disabled. The expanded management integration
and browser controls require execution on their exact composed candidate;
source tests alone do not establish transactional or browser acceptance.

Post-creation invitation issuance uses `channel.group.invite` over the actual
current private-group cast and proposed nonmember actors. The native username
form resolves intent only; the same transaction locks canonical accounts,
selected contact pairs, and the channel before evaluating explicit approved
admission. Issuance creates pending invitation associations, never member grants.
Closed invitations may renew with an incremented generation; an already pending
invitation refuses. Explicit injected member and pending-invitation budgets are
required for new issuance, with no production default or DEC124/DEC127 approval
inferred from isolated test values.

The `group.invite` receipt binds the original channel and sorted proposed actor
set. Every proposed actor is recorded in the existing command-subject table for
subject-local export and erasure. Committed retries use the same minimal
`channel.group.result` capability as management and cannot repeat admission or
renew invitations. Expanded both-JavaScript-mode browser controls cover declined
invitation renewal, approved late-join history, and renewed member revocation.
Their acceptance requires the exact composed hosted execution.

Native attachments use a dedicated bounded multipart POST outside the unchanged
16 KiB server-action decoder. The multipart envelope has its own explicitly
injected `maxMultipartBytes`; file size, count, charge and scan limits still come
from the injected file policy. Origin and current member checks precede body
reading. The native transport invokes the same reserve, immutable upload and
scan/finalize operations as JSON/binary clients, binding the selected message
and current file generation. Refusals retain escaped filename and request/token
intent with a fresh file chooser, never file bytes in action state or URLs.
Own pending discard calls the canonical cleanup capability independently of
posting eligibility; quota remains charged until real physical deletion ACK.

History links discover attachment metadata through the current read frame and
per-file access fence. Downloads stream private bytes through the application,
with inert attachment filenames and no object key, public vendor URL or signed
bearer URL. Deployment composition remains unavailable without explicit policy,
private-object and scanner ports. Native fixtures use real private filesystem
storage and clamd only in their validated isolated slot; fixture values do not
approve privacy, retention or numeric product policies.

The optional file runtime maintenance configuration supplies explicit cadence and
batch limits. The existing web process schedules bounded reservation expiry and
private deletion work, prevents overlapping runs, and awaits current work before
closing pools. Expiry selects at most the configured number of due reservation
rows globally, acquires canonical account→pair→channel fences for their owners,
and rereads those same rows after waits. Unfenced owner drift refuses that
selected work until a later run; a crowded channel cannot expand the batch. Only expired reserved/quarantined rows
transition to deleting. Current membership, posting or age admission does not
confer cleanup authority. Missing durable authority is never recreated.

Physical deletion uses the delivered trusted provider: linked deleting files and
unlinked subject-erasure intents retain their storage charge until the private
store resolves deletion acknowledgement. An outage preserves the charged row
for retry. Each selected physical deletion is attempted even when an earlier
object fails; successful acknowledgements commit independently, and any failure
still makes the batch report infrastructure failure. Logs reuse content-free
sweep counts/status; object keys and subject
associations are not logged. Missing runtime/maintenance configuration schedules
nothing. Deployment approval of vendors, cadence and policy remains outstanding;
branch composition does not activate collection or approve pending retention.

### Channel preferences and current unread metadata

The dedicated preference store reads and updates existing actor-state selections under the same ordered account, pair and channel fence as history. The canonical `channel.preferences.read` and `channel.preferences.update` capabilities require current entitlement and explicit fresh reading evidence; posting and age admission are independent. `following`, `hidden` and the `all | mentions | none` notification selection never grant access. An absent state remains null until an explicit selection is saved. Updates preserve the monotonic read marker. Unread counts include only surviving other-author messages after that marker; they contain no message body or actor-specific signal. Notification delivery and mention eligibility remain separate unfinished consumers.

Own clear first fences the current account, locks the actual scoped actor-state row, and uses `channel.preferences.clear` only for that persisted row. It deletes only that row, without upsert, membership recreation or content access. An absent row gets only current own-collection authorization and returns `cleared:false`. Removed members may clear their own saved state while preference reads remain concealed. Existing canonical actor-state privacy declarations and pending lawful-basis/retention decisions apply unchanged.

The mounted JSON read/update/clear routes and `/messages/[channelId]/preferences` native form share this store and canonical authorization. Every selection is explicit; missing selections are not product defaults. The form works before hydration and with JavaScript disabled, retaining choices after refusal. Branch PostgreSQL and browser proofs are required before this increment is accepted; no production policy is supplied.

### Ephemeral typing aggregate

Typing uses an optional injected `ttlMs`, `refetchMs` and `maxActors` configuration;
absence leaves its HTTP endpoints unavailable. The existing Redis client stores
an actor/channel lease with explicit millisecond expiry. The same PostgreSQL
account → pair → channel transaction fence rereads every current participant's
own channel fact and minimal age fact. Canonical `channel.post` qualifies each
lease; canonical `channel.read` authorizes aggregate reads. A retained Redis key
cannot confer membership, posting eligibility or reading authority. Account,
age, channel, pair/grant and policy revision changes invalidate its qualification.

The aggregate excludes the observer and exposes only `typing:boolean` plus an
explicit HTTP refresh interval. The composer sends boolean intent, never draft
text. Renewals publish nothing unless a currently readable participant's
aggregate changes. Qualifying transitions use the existing pool's separate
`daisy_realtime_hints` notification with exactly `v`, `type:typing_changed` and
the authorized channel topic. They create no outbox row or durable cursor.
Realtime delivery freshly rechecks canonical subscription authority; hints are
lossy and never extend a durable delivery lease. Reconnect, hints and bounded
HTTP expiry refetch invalidate the browser projection, so natural expiry or a
lost hint cannot leave a permanent typing indicator. Authorized conversation responses carry only the explicitly configured recovery interval to the browser; an initial or later HTTP failure clears the projection and retries on that interval, without inventing a timing default. Notification delivery is followed by a fresh canonical authority/time snapshot. The frame seals that evidence and the observed leases; after the actual transaction completes, a synchronous response fence consumes the same evidence at the current clock and recomputes remaining lease lifetimes. The same response fence consumes each sealed peer posting input at that clock, so a peer reading proof that expires before its Redis lease cannot remain visible. The refresh deadline is clipped to that peer proof as well as the lease. It does not mint policy evidence outside the transaction. Expired reading evidence stays masked, and expired mutation evidence refuses the response.

Privacy declaration: the namespaced Redis key
`<namespace>:v1:messaging-typing:<actorId>:<channelId>` and its actor/channel
association are personal/private. Serialized `actorId`, `channelId`,
`authorityRevision`, `relationshipRevision`, `accountRevision`, `ageRevision`,
`policyRevision` and `expiresAt` remain personal/private as one associated
lease; `version` is nonpersonal format metadata. Purpose is current authorized
typing projection; owner is MSG. Lawful basis is pending PRIV3
`jc0qcdvpkmqzrelpaesi3pah`, retention pending PRIV4
`njiorsf64z4iqjm2dbfa3zuu`. The explicit lease TTL is bounded by current policy
proof expiry and is not an approved product retention rule. No lease, actor,
draft, Redis key or raw failure is logged or placed in a notification payload.
The canonical opaque `database.messagingTypingPrivacyPort` resolves durable
user/actor binding before export and validates every own lease. Physical subject
deletion walks the exact namespace/actor key prefix through Redis cursor zero,
including channels no longer accessible; malformed/foreign keys and invalid
deletion acknowledgements refuse. It runs outside PostgreSQL adopters after
local erasure commits, through the existing `messaging-typing` vendor job.
Outage retains a pending job for retry; TTL expiration never substitutes for
physical deletion acknowledgement. The composed real PostgreSQL/Redis job,
export and foreign-subject locality proof remains required. Isolated fixtures
do not activate collection, settle those decisions or establish deployment
acceptance; no production privacy-worker scheduling is claimed.

### Own reaction removal authority

Addition uses current `channel.post`. Removal uses distinct `channel.reaction.remove` with `MessagingReactionAuthorizationFact` (`kind:channel_reaction`, current `channel`, and existing locked `reaction:{actorId,channelId,messageId,reaction}`). MSG must project this from the persisted reaction joined to its same-channel message; a request intent or absent row is not an association fact. The evaluator requires the caller's current bound non-erased member account, caller-owned association, matching channel, valid message identifier and nonempty canonical reaction value, plus current channel entitlement and approved fresh reading evidence. Archived or posting-ineligible channels may permit this cleanup; it grants no read, post or message-text removal. MSG retains scoped deletion, message/reaction binding, change-version and own receipt checks under the same transaction. No reaction choice or size default is introduced; existing reaction inventory and pending policy declarations apply.

The mounted reaction consumer accepts explicit deployment-injected size and addition choices; missing configuration is unavailable. Native reaction forms work with and without JavaScript. The current scoped summary exposes only choice/count/own status, never actor lists. A channel doorbell invalidates that summary and the existing authorized HTTP reader rebuilds it; the doorbell contains no reaction choice or actor. Each actual association change advances the channel and message change versions without consuming message sequence or marking text edited. Changes remain current message snapshots, while reaction metadata is read separately from the scoped summary endpoint.

Own actor/channel/request receipts bind the message and canonical operation fingerprint. A matching retry reads the current aggregate and never restores an association deleted since the original request. Conflicting payloads refuse; an absent own row cannot mint cleanup authority. Actual removals scope actor/channel/message/choice, preserve other participants' associations, and use the canonical removal capability after the locked row is read. Existing reaction associations and values remain personal/private under the canonical inventory and pending PRIV3/PRIV4 declarations; no new schema or retention exception is introduced. New mounted/native assertions require exact-candidate service/browser proof before acceptance.

Own-message native controls select the existing authorized history snapshot by channel/message/cursor, then require current author identity before displaying the draft. They use the existing edit operation (posting and edit-window admission) or distinct own-text removal operation (current entitlement/reading and author check, independent of posting admission). Native forms preserve the draft on refusal and verify the returned message identifier before navigating. Both JavaScript modes have authored edit and blocked-posting removal controls; real hosted proof for this new consumer remains required. Live invalidation uses the existing channel subscription and authorized history re-read, never the draft as authority.
