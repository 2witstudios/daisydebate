# 0061: Social messaging policy

Status: proposed (owner-requested messaging decision package, 2026-10-09).

Builds on [ADR 0060](0060-persistent-authorized-messaging-channels.md).
Source: [policy and producer reconciliation candidate](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/k55wkk05wod2w1oswgasijhu) and
[document-package tasking amendment](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/i7db8mk923w393p22fkaozu0).

Task: [MSG-1.1a](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/zy4jh1dvmaumu8anpbj3qcwz).
Writer: [bounded document package](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/y9ta8ogco04r0kel8kjndrpu).
Proposal review: [revision2, approved for owner consideration only](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/gr8gxo4ujncvoz9soh7ri8zj).

## Context

The owner requests concrete decisions before implementation and permits
reviewed dependencies to be integrated into the feature branch. This record
proposes policy for owner review. It supplies no delivered producer, source
writer grant, runtime permission or fabricated verification evidence.

## Proposed decision

### Contact state transitions

Contact relationship authority is one canonical unordered actor pair. An accepted friendship permits direct channel establishment, but friendship is supplied by its own explicit producer. Otherwise a sender may issue one pending text-only introduction; recipient acceptance enables normal messages/files. Self-contact and provisional/erased/unknown-age actors cannot initiate. Proposed youth policy: social requests and friendship-based starts are permitted only within the same existing AgeBand for 13–15,16–17 oradult; under 13 has no social messaging. Cross-band contact needs a separately approved guardian/official policy and cannot be enabled by client flags or a group invite. This is a product proposal, not a legal conclusion or an approved fact.

Proposed request abuse bounds:10 new pairs per actor per rolling 24 h, maximum 20 outgoing pending requests, one outstanding request per pair; declined/cancelled request cannot be renewed for 7 days. These are durable atomic constraints, not Redis-only truth. Established sends use existing atomic Redis limiter at 30/minute per actor and 10/minute per channel+actor; an outage refuses sends. These values require confirmation; exact boundaries and races must be tested. Blocking atomically prevents all new direct contact and request/accept/send in both directions; retained accepted DM history remains readable by each non-erased participant, while retry protected-send results still require current posting authority. Unblocking does not accept a request, restore friendship or send queued content. Hide/mute only change local display/notifications.

Private groups have explicit manager/member grants, invitation acceptance and no public join link. Proposed capacity 50 active actors; creator starts as manager, inviting does not grant history until acceptance; accepted members see retained full group history. Removal/leave revokes all subsequent group reads, files/search/notifications and subscriptions. Adding someone explains history access before acceptance. Cross-age contact restriction applies pairwise to new social group admission and posting, independent of contextual channels; existing history at a band change follows the explicit transition below. Managers can transfer management; last manager may leave only with transfer or group archive. Archived channels retain allowed history but refuse posting/invites. Rejoining is explicit and restores retained history under the same pinned policy, not previous preference state.

DEC-124 proposes message/edit text at most 4,000 UTF-16 code units; optional DM introduction at most 500; private-group title at most 80; search query 1–200; explicit history/change/search page limit 1–100 with no schema default; invitation/member command batches 1–50 unique actor IDs; mutating JSON stream body at most 64 KiB. Preserve input, reject whitespace-only required text and oversized data. Batch bound is not group capacity. Every retry reauthorizes. No friendship inference from frontend fixtures. Fresh facts use ordered user-row locks, canonical pair fence, then channel-row lock; all participating relationship/block/send transitions use the same order and revalidate after waits. Exact lock implementation and collision-safe pair key require producer tests before delivery.

### Authority and account facts

The existing AgeBand calculator is a pure function, not a durable eligibility
source. No birth-month persistence was found in the audited onboarding/schema.
A separately allocated account age-fact producer must supply the minimum
privacy-classified fact and revision; unknown/unavailable facts refuse contact.
At an age-band transition, new requests, accepts and sends recheck current
policy; prior accepted DM history follows the pinned history rule. A birthday
does not silently grant a new audience or accept contact. Group posting checks
current pairwise policy; admission/removal and policy changes are serialized.
Band changes do not remove an existing grant or broaden history; existing
history remains readable, while mixed-band/unknown groups cannot post or admit.
The producer must specify trusted time and transition fencing; client age
claims never authorize. Cross-band teammate/coach contextual access remains
context-authority policy and is not granted by social friendship.

Requests show their introduction only to the addressed recipient, through a
fresh authorized read. Accept/decline/cancel are versioned pair transitions.
Concurrent reciprocal requests converge on one pair; both actors explicitly
accepting the pending relationship may establish contact, never two channels.
Request counters and cooldowns are defined over injected UTC instants. The
recipient may choose not to receive new requests. Refusal exposes no age band,
block fact, private-group membership or existence of a hidden relationship.

Fresh private-group admission must check all current actors under the same
policy. Group creation, invitations, role transfer and removal cannot bypass
contact rules. One manager's removal cannot race a send past revocation.
Author deletion authority and report retention are governed by ADR 0063, not
manager access to unrelated DMs.

### Producer adoption

Generic AZC vocabulary/evaluator/identity is independent of messaging schema.
ISSUE-302 removes league-only AZC-2.2 from the social chain. MSG-2.1 extends the
one evaluator with channel decisions and loads messaging-owned grants only
after MSG-1.3. The canonical contact producer supplies friendship/block/request
facts and the pair serialization port; its missing task ID must be allocated,
not invented. Pure fixture tests and real pair/block/send races prove adoption.

[DEC-124](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/w3wevmayklycs9nf3hlaxdba)
remains open. Its numeric proposal is included for review, not confirmed here.

### Acceptance/refusal and future proof matrix

These are required future tests, not executed implementation evidence. All
rules and numeric values in this matrix are proposed for owner review.

| Case / inputs                          | Proposed rule or owner choice                                                               | Authoritative producer                          | Observable result                                                               | Future proof                                            | Negative control                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Self / unknown target                  | No self-contact; unknown/private target concealed                                           | Account/contact producer                        | Refuse without pair/channel/counter mutation                                    | Pure actor binding + real no-row diff                   | Remove self/locality guard                         |
| Anonymous / provisional / erased       | Live member actor required, erased dominates                                                | AZC identity + PRIV tombstone                   | Normal auth refusal; no contact or protected response                           | Identity/erasure unit + integration                     | Permit provisional or tombstoned actor             |
| Missing durable age source             | Unknown/unavailable age refuses initiation/posting; calculator alone insufficient           | New account age-fact producer, ID missing       | Unavailable service or generic denial, no birth/age disclosure                  | Trusted projection/timeout/absence fixtures             | Use client age or calculator without durable input |
| Under 13 / cross-band / same-band      | Under 13 no social; same 13–15 / 16–17 / adult band only; cross-band exception unresolved   | Approved contact policy + account facts         | Same-band may request; others refuse even if friends                            | Boundary birthdays + invalid/unknown fact               | Friendship bypasses age rule                       |
| Age provenance / birthday              | Server account source and trusted time; current policy rechecked after age change           | Account producer, policy revision fence         | No newly broadened audience; post revoked; retained DM read follows pinned rule | Age-transition concurrent send                          | Use stale cached band                              |
| Friendship vs accepted DM              | Friendship is separate producer; accepted DM is explicit messaging relationship             | Contact/friendship + MSG grants                 | Friend may establish; otherwise text-only request; no mock-friend fast path     | Two real relationship facts + canonical pair uniqueness | Treat DM acceptance as universal friendship        |
| New / pending                          | One pending introduction/pair, recipient-only authorized text read                          | MSG DM state + contact pair fence               | Create one request, no rich messages/files                                      | Exact pair constraint and request/send races            | Allow attachments or second pending row            |
| Accepted                               | Both live eligible actors and recipient transition authority                                | MSG accepted canonical pair                     | One channel, normal sends permitted                                             | Actor-bound acceptance and source ID tests              | Sender accepts on recipient behalf                 |
| Declined / cancelled                   | No ongoing posting; renewal 7 day cooldown proposed                                         | MSG request/cooldown producer                   | Closed state; generic sender status, no decline reason                          | Injected time one-before/exact boundary                 | Delete cooldown on decline                         |
| Blocked / unblocked                    | Block denies bilateral request/accept/send; unblock neither accepts nor restores friendship | Contact pair fence + shared evaluator           | Denial; no send/version/outbox changes; unblock stays explicit                  | Real block/send and block/accept races                  | Only inspect block after insert                    |
| Reciprocal request / concurrent accept | Pair fence and unique unordered pair; explicit reciprocal acceptance                        | Contact + MSG pair transaction                  | One accepted pair/channel; no duplicate intro                                   | Two-connection simultaneous request/accept              | Drop unordered unique constraint                   |
| Request limits                         | 10 new pairs/24 h,20 outgoing pending, pair cooldown; owner proposals                       | Durable contact work accounting                 | Limit refuse atomically, no half-created pair                                   | Window/pending boundary + concurrent last allowance     | Redis-only request allowance                       |
| Send limits                            | 30/minute actor and 10/minute channel actor; outage refuses                                 | Existing Redis atomic limiter + approved policy | Rate refusal before durable mutation                                            | Real shared-node limiter and injected outage            | Allow on Redis failure                             |
| Group full / invite                    | 50 active actors proposed; invite not membership, same-band pairwise policy                 | MSG group grant transaction + contact policy    | No history before acceptance; overcapacity denied                               | 50th/51st and concurrent invite accept                  | Count outside transaction                          |
| Group removed / left                   | Current grant loss revokes history/files/search/subscription                                | MSG grants + AZC/RT                             | No reads/post even if preference retained                                       | Removal/send/read/notify race                           | Preference row grants access                       |
| Group rejoin                           | Explicit eligible new admission; retained full history under pinned contract                | MSG active grant + policy                       | Authorized retained history after accept only                                   | Leave/rejoin/history sequence                           | Restore grant from old subscription                |
| Last manager                           | Transfer to eligible member or archive before leave                                         | MSG manager/grant transaction                   | No active unmanaged group; archive refuses invites/posts                        | Concurrent transfers/leaves                             | Permit last-manager deletion                       |
| Blocked DM history / retry             | Retained accepted history remains readable; protected-send retry checks posting/block       | MSG pinned history + current contact auth       | History allow, send replay deny; no duplicate mutation                          | Block then history vs retry with same key               | Replay stored success without current check        |
| Removed group history                  | No history from old grant or read cursor                                                    | MSG current grants                              | Uniform NOT_FOUND, including search/files                                       | Late membership/revocation fixture                      | Allow historical former grant                      |
| Text / title / intro                   | 4,000/80/500 UTF-16 units; preserve text, reject whitespace-only                            | DEC-124 + MSG protocol                          | Exact limit accepted, excess denied                                             | Supplementary chars/one-over boundary                   | Count code points or truncate                      |
| Query / page / batch / body            | Search 1–200; explicit page 1–100;1–50 unique IDs;64 KiB JSON                               | DEC-124 + HTTP bounded reader                   | No default or excess; no parser/state work beyond bound                         | Empty/duplicate IDs/chunked escaped byte bounds         | Trust Content-Length only or add default           |

### Age authority and band changes

AgeBand is a pure calculator, not durable account authority. The new account age-fact producer is required before age-dependent MSG-2.1/2.2/contact Ready; no actual producer ID exists yet. It must deliver validated durable provenance, correction/erasure/unknown semantics, a server-derived band plus revision and validUntil from trusted time, PRIV classification/export/erasure, and a mutation fence shared by contact checks. Client/fixture/cached bands never authorize. Proposed transition policy: a band change invalidates pending request admission/intro reads and acceptance immediately under current facts; renewal is a new eligible request subject to cooldown. Established DM posting must still satisfy current same-band policy; previously granted retained DM history remains readable by live participants under its original contract. Existing group membership is not silently deleted or expanded by a birthday: current eligible grants retain historical reads, but any mixed-band or unknown-age group refuses all new posting/admission until explicitly reconciled or archived. Removed members still lose reads. Fresh contact policy/version is rechecked at invitation acceptance, manager transfer, send and retry after lock waits. Age fact expiry can shorten RT authority leases. Account correction triggers atomic access-change signals; computed time transitions are enforced by fact validity and lease expiration, not a client timer. These are owner-review proposals, not a chosen age verification method or lawful basis.

Contact/block and age-fact producers precede MSG-2.1/2.2, not only MSG-3.1.

## Adoption and proof

The owner accepts or revises product and producer policy before runtime
adoption. The orchestrator reconciles existing leaves and records exact
writer files, source commits and reader proofs. Later source changes follow
TDD and independent exact-head review. Human-only identities, vendor accounts,
secrets and production activation remain human actions. A proposed record is
not proof that any implementation leaf is complete.
