# 0062: Messaging context authority contracts

Status: proposed (owner-requested messaging decision package, 2026-10-09).

Builds on [ADR 0060](0060-persistent-authorized-messaging-channels.md).
Source: [policy and producer reconciliation candidate](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/k55wkk05wod2w1oswgasijhu) and
[document-package tasking amendment](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/i7db8mk923w393p22fkaozu0).

Task: [MSG-1.1b](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/n2ykye29i322c3r5oyozh5lx).
Writer: [bounded document package](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/y9ta8ogco04r0kel8kjndrpu).
Proposal review: [revision2, approved for owner consideration only](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/gr8gxo4ujncvoz9soh7ri8zj).

## Context

The owner requests concrete decisions before implementation and permits
reviewed dependencies to be integrated into the feature branch. This record
proposes policy for owner review. It supplies no delivered producer, source
writer grant, runtime permission or fabricated verification evidence.

## Proposed decision

Room community channel is distinct from every Round spectator/official boundary. Before play, admitted participants may read; host toggles spectator posting independently of reading. Proposed default spectator posting is enabled. Each Round creates its own spectator channel; active competitors cannot read it, and oversight is explicit producer-granted access. Former participation-of-record remains the competitive boundary, so leaving a seat cannot acquire delayed spectator access. Proposed privacy contract: spectator history is never later opened to competitors automatically, including after broadcast or Round completion; an explicit new sharing action/channel is required. This preserves0060's immutable access policy.

Proposed Room channel posting pauses for everyone except authorized issue-resolution officials while its Round is live; existing history remains readable only to admitted Room actors. Competitor teammates/coaches use approved team/social channels and DMs; official Round channel admits producer-designated competitors/officials for logistics/issues. Posting resume is tied to producer-confirmed Round completion, while spectator posting/archive follows distinct broadcast completion. No messaging timer infers delayed completion. Context producer exposes typed IDs/current entitlement, authoritative revision/lifecycle, posting setting, assistance-rule projection and a mutation lock/fence witness; protected content is not in that projection. Admission/role removal/setting/lifecycle transitions emit atomic content-free access-change signals through existing outbox. Revalidation version cannot itself grant authority.

Broadcast producer must define durable completion over all relevant streams, delay changes and final media end plus delay; failure/abandonment explicitly closes or declares completion under approved policy, never silently grants readership. No-broadcast outcome is explicit. Team/coach and event entitlement uses durable memberships and organizer grants owned by their respective producers, constrained FKs plus tenant isolation before first tenant. Cross-tournament team identity persists; contextual side channels are explicitly scoped and granted, without private-group grants bypassing event admission. CAP owns competitively customizable speech count/order/durations and Round authority; Walt's new setting canvas is a producer contract gap, not part of this ADR's writer allocation.

### Accepted decisions and proposed authority

ADR 0058 and ADR 0059 are accepted. ADR 0049 remains proposed; its room resource
and topic table is not accepted authority. CAP reconciles Room listing,
admission, canonical Round references and view topics under the accepted API.
Channel topics project messaging; they never replace CAP Room/Round view topics
or use an old debate-chat authorization rule as a fallback.

A constrained association identifies its exact Room, Round, team or event FK.
Producer results are typed per context, never arbitrary context IDs or mutable
permission JSON. The shared evaluator consumes current context facts, explicit
principal and channel policy; subscription, HTTP and mutation decisions share
that composition. Current-authorized retries, source-scoped replies/files and
monotonic channel versions retain ADR 0060's contract.

The RT producer's proposed 60,000 ms lease and 5,000 ms decision timeout in ADR 0064
are pending acceptance. Neither channel policy nor Round lifecycle can prolong
a subscription lease. No contextual access or assistance rule is inferred
from a channel switcher being visible.

CAP/ROOM own spectator admission/posting settings and Round participation.
Broadcast/VIDEO/CAP coordination owns durable completion; team/event owners
own affiliations and tenant grants. No delivery IDs are supplied by this ADR.
Producer adoption tests must race entitlement/setting/lifecycle changes against
send, history, catch-up and notifications, proving either serial ordering
and no private data in stale doorbells. Spectator-to-competitor and former-seat
transitions explicitly test that past or delayed commentary stays isolated.

### Acceptance/refusal and future proof matrix

These are required future tests, not executed implementation evidence. All
rules and numeric values in this matrix are proposed for owner review.

| Case / inputs                           | Proposed rule or owner choice                                                                          | Authoritative producer                         | Observable result                                                             | Future proof                                      | Negative control                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Canonical DM/private group              | Only messaging explicit pair/grants; context facts cannot replace them                                 | MSG + contact/AZC                              | Private access per pinned policy only                                         | DM/group evaluator parity                         | Use room admission as DM grant                    |
| Room admission / host setting           | CAP fresh admission and host authority; spectator posting proposed enabled before play                 | CAP + ROOM, delivery IDs absent                | Host update serialized; admitted spectator read distinct from post            | Host/nonhost and setting/send race                | Client supplies host flag                         |
| Round competitor / spectator            | Separate spectator channel; participation-of-record excludes competitors forever under proposed policy | CAP Round + spectator producer                 | Competitor cannot read/replay spectator history                               | Spectator→competitor→former competitor tests      | Leave seat to gain spectator eligibility          |
| Round judge / oversight                 | Producer-granted official boundary; judge deliberation separate from competitor logistics              | CAP official capabilities                      | Only designated actors read/post own boundary                                 | Judge/competitor/oversight cross-channel fixtures | Generic room member gains official grant          |
| Broadcast absent / incomplete / failed  | Explicit no-broadcast/failure/completion fact; no clock or teardown inference                          | Broadcast owner missing, coordinated VIDEO/CAP | Cannot infer archive/read expansion; fail closed on unknown                   | Delay edit/end/failure/no-stream fixtures         | Treat live media teardown as delivered completion |
| Completion / Room posting               | Proposed Room live posting pause except issue officials; resume on canonical completion                | CAP lifecycle/setting fence                    | Denied live send leaves state unchanged; old Room history stays admitted-only | Start/completion/send two-connection races        | Client phase pauses or resumes                    |
| Spectator completion history            | No automatic later competitor audience; explicit separate sharing action required                      | Pinned MSG policy + CAP participation          | Same immutable channel audience across completion                             | Bob spectator→competitor/history fixture          | Completion flips hidden history public            |
| Team member / coach / removal           | Durable affiliation; persistent channel across events, no chat mirror                                  | Team producer missing + AZC                    | Affiliated read/post; removal deny regardless follow state                    | Cross-event continuity and removal race           | Cached team UI drives entitlement                 |
| Event member / organizer / side channel | Tenant-scoped canonical grants/FKs/RLS; channel grant cannot bypass event admission                    | Event/LEAGUE-OPS producer missing              | Foreign-tenant refusal; authorized side boundaries only                       | Real tenant RLS and source-scoped grant fixtures  | Foreign event grant authorizes channel            |
| Floor / assistance                      | Official logistics/issues separate; technical DM/team availability not assistance permission           | CAP/tournament rule projection                 | Display rule revision separately; no fabricated permitted badge               | Unavailable/prohibited rule UI fixtures           | Available button implies coaching allowed         |
| Principal/resource/fact binding         | Principal from session; row-derived typed resource/context ID; current fact snapshot/revision/fence    | AZC loader + exact contextual producer         | Foreign actor/context input cannot select another authority                   | HTTP/body-spoof and stale revision race           | Accept client actor/context revision as authority |
| Fresh read vs RT lag                    | Fresh authority denies now; RT proposed lease bound includes timeout/scheduling                        | AZC + RT pending bound in 0064                 | No content fetch after revocation; only minimal activity until expiry         | Signal-lagged multi-node/clock-hang tests         | Emit after expired lease                          |
| Denied / missing / unavailable          | Read denial NOT_FOUND uniformly; unavailable503/fail-closed, no content load                           | Shared request mapper                          | No existence/role detail or private read before allow                         | All denied principal kinds + unavailable spy      | Different response for hidden existing channel    |
| Retry revoked / blocked / deleted       | Current entitlement/posting/message availability; marker prevents duplicate without resurrection       | MSG transaction + AZC/contact/PRIV             | Denial/unavailable result, unchanged sequence/version/outbox                  | Same key after revocation/delete/purge            | Return serialized original content                |
| Topic/list/status reconciliation        | 0049 proposed,0058/59 accepted; CAP owns canonical Room/Round view topics/listing                      | CAP; MSG-1.4 channel topic only                | No old debate-chat fallback/duplicate projection authority                    | Topic binding and own-domain adoption tests       | Label proposed 0049 policy accepted               |

Generic AZC owns one pure evaluator and identity path. Existing rounds and
RoundParticipant persistence remains canonical; do not recreate debates or an
authorization fork. CAP owns coordinated Round capability/resource/list/view
and topic adoption under ADR 0058/0059. Accepted0059 permits the debate.read
capability name until coordinated Round-noun adoption, without restoring old
storage. Social channel authorization extends the same evaluator independently
of CAP contextual delivery; competitive readers need CAP projections.

## Adoption and proof

The owner accepts or revises product and producer policy before runtime
adoption. The orchestrator reconciles existing leaves and records exact
writer files, source commits and reader proofs. Later source changes follow
TDD and independent exact-head review. Human-only identities, vendor accounts,
secrets and production activation remain human actions. A proposed record is
not proof that any implementation leaf is complete.
