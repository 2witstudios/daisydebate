# 0063: Messaging content and privacy lifecycle

Status: proposed (owner-requested messaging decision package, 2026-10-09).

Builds on [ADR 0060](0060-persistent-authorized-messaging-channels.md).
Source: [policy and producer reconciliation candidate](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/k55wkk05wod2w1oswgasijhu) and
[document-package tasking amendment](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/i7db8mk923w393p22fkaozu0).

Task: [MSG-1.1c](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/fgtdrb7c1dh7o4dgaovnc8zu).
Writer: [bounded document package](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/y9ta8ogco04r0kel8kjndrpu).
Proposal review: [revision2, approved for owner consideration only](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/gr8gxo4ujncvoz9soh7ri8zj).

## Context

The owner requests concrete decisions before implementation and permits
reviewed dependencies to be integrated into the feature branch. This record
proposes policy for owner review. It supplies no delivered producer, source
writer grant, runtime permission or fabricated verification evidence.

## Proposed decision

Proposed retained message/history lifetime365 days from send, including replies and revisions. Author may edit within 15 minutes; every edit has durable change version; no hidden revision appears in ordinary history. Author can delete own content at any time; authorized contextual/group managers may remove content under explicit producer capability. Delete removes bodies/revisions/search previews and associated user-visible files, preserving only minimal unavailable marker/sequence to keep cursor continuity. Referencing replies show source unavailable, never cached source text. Retention runs through the existing bounded sweep and approved atomic deletion planner.

Dedupe receipts store actor/channel/request/message/sequence identifiers and fingerprint while content exists, all classified in inventory. After content deletion/purge discard fingerprint/content and preserve only a minimal consumed-request marker until channel deletion, preventing reinsertion without replaying text. Sender erasure deletes their personal content and receipt details; erased identity remains unable to retry. No blanket deletion of another person's shared-channel contributions. Export returns the subject's own exportable data, not an unrestricted copy of others' private content; account erasure locks subject, scrubs personal authored content/memberships/preferences/contact edges, revokes sessions/access and commits configured object deletion intents atomically. Vendor outage does not undo local erasure. Classification/purpose/lawful-basis review stays with PRIV; this proposal selects no legal basis by inference.

Proposed pending invitations/requests expire after 30 days; completed request metadata30 days; unlinked upload reservations24 h; deleted object cleanup retries until acknowledged. Pending reports retain snapshot of only reported message+necessary context with bounded reason for 180 days; authorized operator access is separate from participant routes. Any longer evidentiary hold requires explicit recorded scope/expiry, never indefinite general chat retention. Removing content may retain this separately disclosed report snapshot; erasure follows the approved PRIV/report hold contract. Moderator consumer/storage owner must be allocated before reporting delivery.

Proposed attachments: PNG/JPEG/WebP/PDF, maximum 10 MiB each,5 files/message,100 MiB stored per actor; upload admission reserves quota before bytes; finalize converts it idempotently after signature+real malware scan. Private S3-compatible object port, Bun native S3 client where version-matched docs validate capability; local isolated real object store and scanner for test proof. Provider/version/scanner selection still needs operations review before source/dependency/service writes. Objects stay quarantined until scan passes, fail closed on outage, opaque cuid2 keys, authorized server download each time, no public/presigned bearer URLs. PDF is attachment download, image rendering has bounded decoded dimensions16megapixels and removes metadata through approved adapter. Deploy credentials/provider accounts/region/DPA stay human-only. These deploy gates do not block local complete vertical testing once local services are allocated.

### Proposed inventory and legal review

The following is a proposed inventory template, not a delivered PRIV gate or
a determination that a processing activity is lawful. Service-data basis is
proposed contractual necessity for users with a valid applicable contract;
youth participation requires owner/legal confirmation of an appropriate basis
and contracting capacity. Safety/report retention proposes legitimate
interests only after a documented necessity/balancing assessment. No deployment
is authorized by a blank or unconfirmed basis. [ICO guidance on children's
lawful bases](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/how-do-the-lawful-bases-apply-to-children-s-personal-information/)
explains why child contracting capacity cannot be assumed. These proposed
choices must also be reviewed for Daisy's actual jurisdictions.

| Surface                                                                | Category / visibility                                 | Purpose and proposed basis                                       | Retention / erasure / export                                                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Bodies, revisions, reply excerpts, search content                      | personal/private                                      | Requested communication; service basis above                     | 365 days from original send; explicit delete/erasure scrubs all derived copies; own exportable contributions                               |
| Actor/channel/message/request references, sequence, change version     | identifier; relationship projection remains protected | Referential integrity and reconnect/deduplication; service basis | Minimal continuity/consumed markers only while channel exists; own identifiers exported without other subjects' private data               |
| Grants, invitations, accepted contacts, blocks, preferences/read state | personal/private                                      | Access and user-directed social settings; service basis          | Active relationship/account lifetime; pending 30 days/completed requests30 days; subject erasure deletes personal associations; own export |
| Age-fact projection and revision                                       | personal/private                                      | Contact eligibility; child-specific basis needs approval         | Account producer selects minimum source/retention; erasure deletes; own export; no raw birth data in messaging rows                        |
| Receipt fingerprint                                                    | personal/private                                      | Detect unequal retries; service basis                            | Only while source content retained; deletion/erasure removes; never logs/socket/search                                                     |
| Filenames, MIME/scan metadata, objects/quota reservations              | personal/private                                      | Requested files and safe delivery; service/safety basis          | Follow content lifetime; unlinked24 h; local deletion commits durable object delete intent; own export only after fresh authority          |
| Report reason and minimal evidentiary snapshot                         | personal/private, sensitive if supplied               | Handle abuse; proposed assessed legitimate interests             | 180 days unless separately approved scoped hold; erasure/hold decision explicitly supplied by PRIV/operator; no automatic legal exception  |
| Privacy deletion intent / object IDs / retry state                     | identifier/none; no file name or body                 | Fulfil erasure and deletion; same approved purpose               | Pending until acknowledgement; proposed succeeded TTL30 days; no raw vendor error; own export per PRIV                                     |
| channel.changed topic/payload ID+version, access controls              | identifier/none                                       | Authorized activity and revocation                               | Existing ADR 0032 outbox retention; no text/actors/typing/membership/report details; field-level inventory before storage/delivery         |
| Typing Redis lease and freshly fetched actor list                      | personal/private                                      | Requested ephemeral interaction; service basis                   | Proposed 5,000 ms TTL, renew no faster than every 2,000 ms; expiry/erasure; no actor data in socket doorbell                               |
| Logs/errors/analytics                                                  | none or per-surface scoped identifier only            | Registered operations/consented analytics                        | Existing policy; no body/name/contact/age/membership/report fields or raw exceptions                                                       |

Report erasure must not silently contradict ADR 0036's private-data deletion.
A report hold, if accepted, explicitly amends its relevant rule for the scoped
evidence and expires; absent that accepted exception, subject erasure removes
personal report content too. Privacy proof includes replies, revisions, cached
previews, search/change representations, quarantine and deletion receipts.

### Storage/scanner and minimum canonical privacy seam

Proposed scanner is private clamd INSTREAM through a bounded transport adapter;
real clean and EICAR test samples prove it, including outage and stream-limit
refusal. [ClamAV's protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)
defines chunked INSTREAM and size-limit errors; an inconclusive response is
never clean. Signature updates/readiness and service version/digest are
operations-owned before the producer is Ready. Object access uses the native
[Bun S3 API](https://bun.sh/docs/runtime/s3); the builder verifies installed
Bun 1.4.2 types/docs and the chosen service version before configuring it. The
proposed service ports do not introduce a second SDK/package framework.

PRIV-3 owns the canonical discovered inventory/gate. Its stale14-schema count,
anonymize wording and outbox classification require owning-plan reconciliation.
PRIV-4's minimum local export/erasure/intent seam precedes MSG personal storage,
independent of the full analytics/banner UI. MSG adopts typed subject cleanup
through this port; retention uses the existing bounded sweep and short
SKIP LOCKED transactions. The subject user-row lock is first in mutation order,
so erasure and sends cannot commit in an invalid order. Real database proof
checks rollback preservation, export locality and erasure/vendor-outage races.
Provider accounts, credentials, legal bases and deploy activation remain
explicit human decisions; local tests never substitute for those approvals.

### Acceptance/refusal and future proof matrix

These are required future tests, not executed implementation evidence. All
rules and numeric values in this matrix are proposed for owner review.

| Case / inputs                      | Proposed rule or owner choice                                                                               | Authoritative producer                     | Observable result                                                    | Future proof                                          | Negative control                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Request/message/revision/reply     | Retained 365 days original send; delete/erasure scrubs bodies/revisions/excerpts                            | MSG content + PRIV registry                | Unavailable markers, no cached source resurrection                   | SQL all-derived-copy scan and read tests              | Leave revision/search excerpt after delete            |
| Reaction / grants / contacts       | Classify reaction choice and actor affiliation personal/private; remove revoked/erased subject associations | MSG schema + canonical PRIV cleanup        | No activity projection of erased or inaccessible relationship        | Foreign-channel reaction and erase integration        | Retain actor reaction on erase                        |
| Receipt / deleted retry            | Remove content/fingerprint; consumed-key marker prevents reinsertion until channel deletion                 | MSG dedupe + PRIV inventory                | Unavailable result only; no sequence/outbox increment                | Delete/purge then same/different payload retry        | Purge receipt then reinsert content                   |
| Read/preference/search             | Personal/private read/activity state, current entitlement never preferences                                 | MSG state + PRIV                           | Removed subject cannot read derived data; erased states removed      | Preference/revoked search and export fixture          | Search bypasses main channel gate                     |
| Typing / lease / body              | Private actor list via authorized HTTP; proposed 5 s TTL/2 s renewal, content-free doorbell                 | Redis lease + MSG auth + PRIV inventory    | Expires; no actor data in stale WS                                   | Injected TTL and real Redis outage                    | Publish typing identity to stale topic                |
| Report snapshot / hold             | 180 days proposed; no erasure exception without explicit accepted scoped amendment                          | PRIV + operator/report producer missing    | Normal erasure scrubs subject report text absent approved hold       | Held/unheld and expiry/subject erasure tests          | Indefinite report retention by default                |
| File/quota/vendor metadata         | 10 MiB/5 files/100 MiB actor; private signature+scan+quarantine, unlinked24 h                               | MSG files + operations + PRIV              | No linked reads until real clean scan; denied quota unchanged        | Real store/clamd EICAR/outage and concurrent finalize | Fake scanner clean or public bucket                   |
| Local account erasure              | Subject lock then atomic tombstone/local scrub/revoke/deletion intents                                      | PRIV-4 canonical executor + MSG adopter    | Immediate server denial; all-or-nothing local state                  | Real sends vs erasure, injected transaction failure   | Commit tombstone without cleanup or intents           |
| Shared-channel others              | Erase subject contributions/associations, retain others per pinned policy                                   | PRIV subject ownership + MSG policy        | No deletion/export of unrelated contributions                        | Two-subject shared channel/export proof               | Delete entire conversation because one account erased |
| Own export / other private content | Own exportable data only; channel read API is a separate entitlement contract                               | PRIV inventory/export projection           | No other-user private columns or hidden channels                     | Real two-subject export projection                    | Export whole raw joined conversation                  |
| Exact retention expiry             | Cutoff original-send365 days, edit does not reset; bounded repeated sweep                                   | PRIV retention + existing sweep            | One-before retained; expiry deleted with derived files/revisions     | Injected cutoff + real SKIP LOCKED/multiple sweeps    | Edit extends TTL or unbounded long transaction        |
| Age facts                          | Minimal account-producer source only, personal/private, missing source stays missing                        | Account/PRIV new producer ID required      | No raw birth fact in messaging/telemetry/RT                          | Inventory and client-supplied age refusal             | Persist client age in channel preferences             |
| Blocked / revoked subject          | Read policy separately pinned; every mutation/retry reauthorizes                                            | Contact/grant fact + AZC                   | DM read may persist, revoked group denied; no protected replay       | Per-policy role/block tests                           | Treat idempotency as entitlement                      |
| Object/vendor outage               | Local cleanup + durable intent commits; retries until acknowledged; succeeded TTL30 days proposed           | PRIV deletion executor; existing scheduler | Outage never reverses erasure; failure observable with no raw errors | Real object outage/resume and fault-after-commit      | Rollback local erase on vendor failure                |
| Outbox / logs / analytics          | Classify every field; IDs/version only doorbells; telemetry scopedIDs/none                                  | PRIV inventory + protocol rules            | Private/sensitive data cannot be stored/delivered/logged             | Schema/payload privacy negatives and log capture      | Include filename/preview/membership in payload        |

### Upload admission and deleted retry precedence

Before any upload bytes, atomically reserve declared bytes and pending count; proposed 10 pending objects/actor within 100 MiB total. Stream cannot exceed reserved length or 10 MiB. Finalize converts existing reservation idempotently. Quarantine/partial/expired/unlinked objects remain charged until deletion acknowledgement. Never-finalized uploads cannot bypass quota.

Retry precedence: first current principal/account, entitlement/contact/posting authorization; then consumed request key and current original-message availability; only for an available original compare canonical payload fingerprint. Thus an authorized retry of a deleted/purged consumed key, whether same or different payload, returns the same typed MESSAGE_UNAVAILABLE refusal, never content, insertion, sequence/version increment or outbox row. This availability-first refusal narrows the live-message unequal-payload conflict guarantee in 0060 for the deleted case and requires owner acceptance of this explicit clarification before MSG-2.2; it is not a silent runtime exception. For a live original, unequal payload returns the existing conflict and equal payload returns the currently authorized original result. No comparison is attempted from discarded proof. Dedupe receipts store actor/channel/request/message/sequence identifiers and fingerprint while content exists, all classified in inventory.

### Remaining per-surface choices

Reactions and reply links follow the original message retention cutoff;
subject erasure removes their personal actor associations. Group/contact
relationships and preferences are account-lifetime while active; completed
requests expire 30 days after the terminal transition. Report 180-day retention
starts at submission and is not extended by resolution. Proposed report reason
bound is 2,000 UTF-16 units; snapshot contains the reported message and at most
one currently readable same-channel parent, never an unrestricted transcript.
File evidence needs a separately authorized private snapshot under that same
report retention/erasure policy; ordinary file references confer no hold.
Notification pointers never contain previews and reauthorize on selection/read.
Channel change rows preserve ordering with unavailable IDs/versions while
retained; their private derived data is scrubbed alongside message content.
Orphan scan state and metadata never extend the object's quota reservation
lifetime silently. Body/fingerprint/receipt erasure and a deletion hold require
explicit separate owner/PRIV review; no undeclared private field is exempt.

Deletion intents adopt PRIV-owned privacy_jobs; this is durable deletion
intent, not a second general job framework.

## Adoption and proof

The owner accepts or revises product and producer policy before runtime
adoption. The orchestrator reconciles existing leaves and records exact
writer files, source commits and reader proofs. Later source changes follow
TDD and independent exact-head review. Human-only identities, vendor accounts,
secrets and production activation remain human actions. A proposed record is
not proof that any implementation leaf is complete.
