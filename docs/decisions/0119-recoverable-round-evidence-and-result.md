# 0119: Recoverable Round evidence and result

Status: implementation direction accepted by the point guard and architecture,
2026-11-07. Implementation and operational qualification remain in progress.
Plan: [Debate evidence and result reliability](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/d4qpxtoq02wy2ttbsq2ict4y).

## Intent and policy reconciliation

Played human and bot Rounds must survive transient platform failures without
discarding recoverable speech or a recoverable ruling. Nothing authorizes invented
speech, coverage, silence, peer hearing or a ballot.

DEC-118's missing-audio rule cannot authorize unsupported ratings. ADR 0110
already refines DEC-208: a measured small gap may be judged with its disclosure;
an unknown gap cannot be assumed small. This decision preserves that evidentiary
rule while replacing avoidable loss with protected play and durable recovery.
Human silence, unused interaction permission, unauthorized observed speech and
failed owed bot generation are different facts. Failed bot CX is service work
still owed, not evidence that a completed exchange contained silence.

This decision amends ADR 0094's memory-only capture and late-STT-loss policy,
ADR 0058/0067's terminal provider-budget policy and ADR 0110's start-anyway and
single-worker capture assumptions for the new protected path. It does not claim
that the incomplete transition has shipped: the slice must replace affected
consumers together and prove the final path before acceptance.

## One necessary-evidence home

Necessary evidence is separate from optional user Recordings. The candidate
home is bounded, application-encrypted PCM batches and original-authority
receipts committed atomically in PostgreSQL through the existing bounded
transactions and signed capture ingress. Capture's discovery database role
remains read-only. No second competitive pool or direct worker DML is introduced.
Evidence is excluded from ordinary Round reads, realtime and telemetry.

Receipt precedes release of admitted PCM, including frames still in an uncut
carry. Spooling only a WAV produced at a pause or sixty seconds is insufficient.
Allocate a stable batch identity before encryption; a lost commit acknowledgement
reuses it. Original capture epoch, seat, segment, track sequence, clock
calibration, nominal frame times and historical permission are retained. Replay
uses that receipt's authority, not the replacement worker's lease. Different runs
may establish one stream only where their original evidence actually proves
continuity; no missing frames or cross-epoch gap is bridged.

Atomic payload and receipt remove the separate object-adoption failure state.
Unknown commit, custody acquisition without a payload, transaction rollback and
deletion still need recovery. Receipt time comes from trusted custody/database
authority, never a retrying caller's new timestamp. The earliest original
accepted receipt anchors expiry even if its acknowledgement was lost.

Initial capacity candidates to qualify, not measured limits: at most 64 KiB per
batch including provenance, 32 MiB outstanding per Round, 512 MiB globally, with
serialized global admission and bounded replay/deletion batches. The declared
load is fifty simultaneous Rounds with two 16 kHz mono 16-bit streams each:
3.2 MB/s of PCM before metadata, ciphertext and WAL amplification. Measure
transaction rate, WAL, backups, storage growth and clock-path latency. A full
reservation holds vulnerable play before additional speech is accepted. These
numbers cannot be adopted as production capacity without the measurement.

## Durable key custody and privacy

DEC-369 sets a hard maximum of seven days from ORIGINAL durable receipt, without
retry extension. Delete earlier after verified durable authoritative transcript
AND adequate coverage settlement, or applicable erasure. A provider success
response alone is insufficient. Ranked Recording retention does not extend this
spool's retention.

Key custody is an injected durable authority, separate from payload database
backups and expendable Redis. Acquisition/revocation are durable and idempotent
under stable evidence identity and original expiry. Unavailable or uncertain
custody refuses admission. Revocation and expiry remain authoritative through
restart, takeover, caches and restore; possessing a previously obtained decryptor
or plaintext never authorizes a later append or submission.

There is NO asserted approved production custody implementation. Production
collection remains disabled pending REL-H, owned by the human infrastructure
and privacy owner: encryption, replica/backup/WAL retention, irreversible key
revocation across custody backups/caches/restore, restore-before-read tombstone
reconciliation and activation-refusal evidence. No new service, secret,
production deploy or production data operation is authorized by this decision.

Local qualification requires an isolated genuinely persistent key authority and
fresh processes. A memory fake proves no durability. A shared local directory
can prove process persistence only, not host-independent production custody.
Test old ciphertext/metadata restored against current expiry/revocation, old
custody restore attempts, stale decryptors and already-held plaintext across
erasure, lost acknowledgements, concurrent erasure and retrying revocation.
Ciphertext remaining in backups is not physically deleted by key revocation;
report physical lifecycle and cryptographic unrecoverability separately.
Every-copy privacy acceptance remains blocked until operational evidence exists.

Erasure serializes with receipt, claim, decrypt, STT append, freeze, judging cache
and ballot submission. A late effect cannot resurrect content. Deletion and
custody-orphan cleanup remain durable obligations until confirmed. The existing
ranked transcript/record retention policy remains a separate class.

Before expiry, persist a visible recovery warning and operator escalation.
Capacity/outage admission prevents new vulnerable work. At expiry, revoke and
fence all late work, retain an honest unresolved recovery state, and offer a
fresh no-charge replay/rematch opportunity. That exceptional remedy does NOT
fulfil the no-wasted-time outcome. It never invents a result or reopens a decided
Round. Finite retention is not a universal no-loss guarantee.

## Protected time and interruption evidence

Preservation progress, permission readiness and peer hearing are independent.
A silent human or CX listener may produce no PCM because of DTX. A lease or track
presence cannot advance captured coverage. Positive trusted readiness facts may
permit silence without asserting PCM receipt or that speech was heard.

Candidate receipt cadence is 250 ms and candidate maximum unprotected progress
is 1000 ms. Neither is measured. A server poll cannot establish this bound if the
server itself stalls. An expiring preservation permission must fail closed at
EVERY clock and publication consumer, including through control-plane/database
stalls. The concrete implementation must distinguish supported clock/network
failure assumptions and prove them; it cannot infer a global bound from a batch
schedule. This is a blocker before affected clock writes.

On interruption, hold the existing system-controlled incident clock and return
time from the last defensible durable checkpoint. For CX the common checkpoint
is the minimum of the parties' progress; both receive the same returned-time
opportunity. This restores TIME ONLY. A faster party's already-durable suffix,
its original authority and any pending/late STT remain canonical evidence.
Nothing supersedes, deletes or retracts it because the other party fell behind.

The resumed interval contains linked NEW authorized contributions. Both parties
see the returned interval and which speech was preserved. Absent original audio
cannot be reconstructed or proven equal to a human's restatement. Preserve the
ordered original speech, interruption and resumed speech for the unchanged
shared rubric. Once-only receipts/source offsets are mechanical properties;
avoiding duplicate argumentative credit is a judging obligation to test, not a
claim of semantic deduplication or equivalent arguments.

Bot replay needs an explicit source-offset-to-captured-receipt correlation. Source
handoff or publication credit alone proves neither that correlation nor peer
hearing. Retain the bounded source identity/audio under its declared privacy
lifecycle until correlation settles. An in-flight word/frame needs an explicit
overlap/gap rule; source text never becomes transcript evidence. ISSUE-1304's
parked WIP is context, not accepted implementation or proof.

## Settlement, scheduling and finality

Accepted recovery work settles before ONE final immutable transcript freeze.
An early partial seal or old admission cutoff cannot destroy its obligation.
Never mutate a frozen frontier or reopen a historical terminal Round.

DEC-370 separates a durable judging obligation from finite provider attempts,
lease expiry and generation deadlines. Preserve a validated response under the
same rubric/frontier, resubmit idempotently under current authority and attendance
fences, and never discard it merely because its attempt window ended.

Due STT/judging work needs bounded fair admission, not only a pending row. Order
by due time and fair Round turn with stable receipt/ID tie-breakers; release
capacity before backoff. Bound concurrent work globally and per Round. Track
unknown paid outcomes, cap automatic lifetime spending and expose exhausted
funding as blocked recovery rather than pretending an automatic eventual result.
An operator may explicitly replenish; that is not evidence of automatic progress.
Qualification must name its supported outage/funding window and demonstrate
progress through a growing backlog, crash and takeover without starvation.

## Required proof

Storage receipt, heard evidence, authoritative transcript and final result each
need independent evidence at the exact candidate. No source inspection is an
execution PASS. Required faults include nonempty-carry capture death and host
replacement; STT failure beyond 66.5 seconds and the old cutoff; pre-receipt media
loss and control/database stalls; asymmetric CX receipts with already committed
STT plus late original callbacks; bot CX opening-question and response failures;
source-offset publication interruption; judging crash before/after validated
cache, old budget/deadline and attendance holds; duplicate and foreign/stale
authority; concurrent capacity admission and fair backlog progress; every late
erasure/expiry seam, unknown commit, durable custody and backup/restore controls.
Real played human-vs-human and bot journeys must reach exactly one supported
result. Negative controls must fail without weakening existing timing bounds or
assertions.

## Local custody implementation boundary

The local adapter uses a separately provisioned persistent SQLite **current
identity/revocation authority** and a separate restorable key-material database.
Ordinary restart opens existing authority only; missing authority never provisions
a replacement. Every seal/open consults the injected current authority. This is
an actual capability dependency, not a caller's `restoreReconciled` boolean.
Authority reserves the original receipt/expiry and payload digest before binding
one material digest. A bound key cannot be replaced after missing material or
unknown acknowledgement. Unknown evidence IDs can be revoked before acquisition;
revocation is committed before material cleanup and retries finish that cleanup.
A bounded sweep removes expired/revoked local material without removing fences.

Acquisition precedes the payload transaction. A reserve/bind acknowledgement lost
before PostgreSQL commit must reuse the original identity, key and expiry. A
known payload rollback needs durable compensation; unknown PostgreSQL commit
must first reconcile that SAME evidence ID, never allocate replacement work.
Until the payload adapter and compensation/reconciliation worker are implemented
and tested, this custody adapter alone does not prove receipt durability or
orphan recovery. An acquisition orphan keeps its original seven-day deadline.

Old material/payload snapshots are read only through the latest independent
authority. Restoring that authority itself requires an independently current
authority; the local adapter cannot detect rollback of **all** authority copies.
That case is BLOCKED for production, not a successful local anti-rollback proof.
The SQLite files prove process persistence on one host. File mode 0600, FULL
synchronous commits and authenticated encryption do not prove host durability,
filesystem encryption, every-copy deletion or backup irreversibility. No
production composition imports this local qualification adapter.

Authority metadata contains opaque evidence IDs and original-authority/payload/key
digests, receipt/expiry and a revocation fence, without PCM, text or raw keys.
These integrity digests and tombstones have a separate minimization obligation:
retain them until every restorable old payload/material copy is retired or an
independently authoritative irreversible fence replaces them. No timer silently
purges fences while old snapshots remain. The human infrastructure/privacy owner
must specify that retirement evidence and metadata retention before activation.
Local synthetic qualification deletes its isolated directory after each test.

A caller may already hold plaintext when erasure happens. Cryptography cannot
recall it. Rechecking before plaintext release limits new dispatch, while durable
Round erasure fences must also refuse future STT commits, freeze, caches and
submissions, cancel outstanding work and clean temporary buffers. Residual
in-flight provider processing needs its own processor/erasure contract; this
adapter does not claim to erase another process's memory or provider work.

Restored ciphertext crosses a runtime envelope guard before current-authority
reads or crypto: canonical sealed kind/receipt, fixed identifier/digest shapes,
exact original seven-day expiry interval, at most 64 KiB nonempty ciphertext,
12-byte nonce and 16-byte authentication tag. Integrity rejection after decrypt
is insufficient to bound that edge.

Local material cleanup uses an immutable autoincrement insertion sequence and
persisted after/through cursor. Each pass captures its maximum sequence before
reading at most the requested bound (1–64). New arrivals lie outside that finite
pass. Completing or exhausting its captured range resets the cursor, so a key
revoked after its visit is revisited on a following pass, including after adapter
restart. Expiry is always checked against the original independent authority,
never the traversal position or a caller clock. Unavailable/uncertain entries
remain material and are revisited; refusal cannot become deletion permission.
For a finite bounded admitted population this establishes traversal progress
under repeated calls, not a wall-clock deletion promise. A running scheduler,
per-ID payload compensation, crash recovery and load qualification are still
required before claiming prompt eventual cleanup in the integrated feature.

## Receipt admission and erasure ordering before payload integration

Before the FIRST side-effectful custody request, commit a stable evidence intent
and cleanup-routing obligation through the existing bounded PostgreSQL pool.
Stable identity without this crash-discovery row is insufficient. Intent ownership
is leased/fenced; a successor may reconcile/retire it, never invent original PCM
or rewrite original capture authorization. The routing identity/tombstone survives
Round aggregate erasure until custody revocation and payload deletion are confirmed.
A crash after acquire but before payload commit is therefore discoverable. Reconcile
unknown payload commits under that SAME ID before revoking; never mint replacement
key/identity/expiry on lost acknowledgements. Unknown/unavailable custody keeps an
explicit bounded due-work obligation, not a silently discarded orphan.

Application privacy revocation linearizes at the committed PostgreSQL evidence
fence under the existing Round lock. EVERY application revoker commits that fence
before custody revocation. Receipt/settlement/freeze share that lock and current
fence, preventing a late callback from adopting or submitting erased content.
Sample authoritative database time AFTER relevant lock/admission waits immediately
before the accepted durable mutation; original expiry bounds that admission instant.
Do not label a pre-wait timestamp as commit time or imply a stronger distributed
transaction than exists.

A current custody read authorizes an admission/dispatch; it cannot atomically
serialize an independent out-of-band SQLite revocation with a later PostgreSQL
commit. External custody loss refuses future admission and dispatch. Already
authorized processing may still be in flight and cannot be recalled; future
application writes retain the PostgreSQL fence/receipt/expiry checks. Supported
selective restore must additionally reconcile latest independent custody before
accepting old pending rows or callbacks already holding plaintext. Test an older
PG pending/tombstone-free snapshot against current revoked/expired authority and
held-plaintext settlement. All-authority rollback remains explicitly unsupported
and BLOCKED under REL-H. No implementation/proof PASS follows from this contract.

The canonical frame clock now exposes a copied original mapping basis: raw native
sequence/callback bracket, run's original calibration and first callback, the
original predecessor and the computed window. Capture staging retains that basis
with the frame even if admission waits for newer history. Refresh does not replace
an existing run's calibration; a gap/reset retains its original predecessor and
new anchor. Invalid callbacks expose no stale basis. This is read-only observation
provenance, not a competitive receipt, admission, peer-hearing fact or independent
proof of cross-run continuity. Stored original authority/history still has to be
bound and checked at receipt before carry/WAV release and used unchanged by replay.
The old PCM-only memory accounting is not a total heap/provenance bound: include
encoded provenance, staging overhead, WAL and custody load in capacity qualification
before claiming the declared workload or protected-time targets.

The first PostgreSQL admission operation is intent-only: it validates current
original capture/window authority, serializes evidence-owned per-Round/global
byte and live-intent reservations, and commits a leased `acquiring` row before
custody is called. Its reply is `claimed` or `pending`, never a PCM durability
acknowledgement. Actual database time is resampled after waits/token creation;
first admission stamps `created_at`, while takeover preserves original scope and
advances only execution ownership. Lost intent COMMIT replies reconcile the same
ID. The existing media-worker role has column-scoped discovery only, with no
payload/lease-secret reads or DML. No second competitive pool is introduced.

The evidence-owned row also holds the future encrypted payload and receipt in
one atomic update. Aggregate Round deletion first fences rows as retiring and
clears payload/reservation, then detaches the Round FK; revocation routing remains.
Seven days in the SQL receipt constraint means 168 elapsed hours, unaffected by
session timezone or daylight saving. The optional admission capability is absent
from production composition. At this checkpoint payload commit, current subject
fences/adoption, custody compensation/retirement worker, replay/STT settlement and
freeze coordination are STILL INCOMPLETE. Intent tests do not claim any of them.
Admission limits are local candidate ceilings, not measured throughput/heap/WAL or
backlog-fairness acceptance. No source row or timer authorizes an invented result.

Admission separately counts ALL unconfirmed evidence obligations: acquiring,
retained AND retiring, including detached routing after aggregate erasure. Only
confirmed retirement can release that count. `maxOutstandingIntents` is an injected
bounded count ceiling; releasing current PG payload bytes cannot create unlimited
custody-cleanup debt. Byte ceilings describe live PostgreSQL payload reservations,
not the whole physical footprint of pending key material, routing, WAL, backups or
retired anti-resurrection metadata. Those need separate quantitative capacity and
retention proof; the live-byte numbers are not an all-storage bound.

The intent's stored binding is derived by the server from original Round/session/
worker/capture epoch/seat/segment/track, offset/duration/bracket, declared full-body
digest and reservation. Retrying an eligible changed window under the same opaque
digest is refused. The input is named `bodyDigest`, distinct from the resulting
original-authority binding used by custody. This independently binds the envelope;
it does NOT verify PCM/provenance authenticity. Before any payload adoption the
application MUST validate and canonically encode the full original body and derive
that body digest itself; raw worker-supplied hashes cannot substitute for it.

Current intent retry/takeover still requires the ORIGINAL live capture lease and
admission cutoff. Its proof is NOT capture-worker/session/epoch replacement or
late-cutoff recovery. A separate recovery claimant must consume already-committed
original intent/evidence authority and advance execution ownership only. An intent
remains neither audio receipt nor preserved/heard watermark. That claimant and
payload authenticity/receipt, custody compensation and late-commit fences remain
unimplemented at this checkpoint.

Local custody now serializes material creation/binding with revocation. Reserve
FIRST commits original identity/receipt/expiry. A second authority-owned immediate
transaction checks current authority, acquires the material transaction, and
supplies an authority-owned revalidation capability after any material-lock wait.
Only then may material be created/reused; expiry is checked again after its commit
before binding the key+nonce digest. A process dying between material commit and
authority binding leaves retained original material and the already committed
reservation for reconciliation, never permission to mint new key/nonce/expiry.

The lock order is authority then material. Revalidation inside the material
transaction uses the ALREADY owned authority transaction, never an independently
acquired reverse lock. Revoke commits its authority tombstone before material
cleanup; future material creation must pass that same authority lock and therefore
cannot create late rows after revocation. Sweep ends its cursor-only material
transaction before reading authority and deleting eligible material. No material
transaction independently calls an authority operation while another path owns
that authority awaiting material. Unavailable/unknown cleanup stays retryable.
`EvidenceCustodyReceipt` explicitly names a key-reservation receipt; it is NOT a
PG audio durability acknowledgement. Revoked authority, current material cleanup,
payload cleanup and whole retirement completion remain separate facts. The latter
integrated retirement worker is not implemented/proven by these local tests.

Necessary-evidence admission will reuse the canonical account authorization seam.
Discover the bounded complete original content/cast subject set, acquire sorted
`readAuthorizationActors` fences, then lock Round and revalidate the EXACT set.
A cast change refuses/retries from discovery; never acquire new subject locks
while holding Round. Existing agent and ballot writers already acquire exclusive
`lockAuthorizationActors` fences: preserve that strongest lock and never prepend
a shared fence that would require an exclusive upgrade. No second account-lock
SQL or duplicate tombstone authority is introduced. Raw necessary-evidence
privacy applies to all relevant Rounds independently of ranked transcript/result
retention and membership/entitlement. Original content subjects differ from a
successor execution worker. Their routing must survive aggregate closure until
confirmed cleanup. Canonical erasure immediately denies read/adoption/replay/
dispatch/commit even while bounded cleanup is delayed. Non-account withdrawal
serializes on the Round evidence fence. Initial raw-intent admission now takes this shared account fence before Round
and revalidates creator plus every bounded seat identity/actor/kind/role/slot.
Tombstoned or uncertain account facts refuse; a live non-member is not erased.
Existing agent/ballot exclusive paths are unchanged and never call this reader.
Original-subject durable routing, payload read/adoption/dispatch/STT/freeze fences
and delayed cleanup integration remain unimplemented at this checkpoint.

The full original evidence body has one strict canonical JSON encoding covering
PCM, original run calibration/sequence/callback windows, history/grant identity,
original worker epoch and segment/seat scope. The server must derive the digest
from that encoding; caller hashes do not authenticate payloads. A batch contains
only adjacent observed frames from one original run; gaps/resets require separate
units and cannot be credited by their elapsed bounding span. Original mapping
verification uses the same unchanged frame-clock equations and exact retained
inputs, never a replacement calibration. Shape, math and byte binding remain
separate from actual occurrence, capture authority, durable receipt and hearing.
No decoder or equation check can prove those independent facts. Their receipt/
replay integration and supported-failure proof are still required before use.

Restore admission also needs current privacy-fact lineage. A key that is still
live does not prove an account tombstone absent: that tombstone may have committed
in PostgreSQL while bounded retirement has not propagated revocation to custody.
Restoring older PG metadata cannot erase that obligation. Selective-restore tests
must identify the independently current revocation/expiry fact they actually
exercise; current key liveness is not current account/withdrawal authority.
Missing or uncertain current privacy lineage blocks restore admission. Local
process persistence and revoked-key restore tests do not establish this wider
operational capability; production restore/privacy acceptance remains REL-H.

## Owner refinement: provisional captions and recognition reconciliation

The mission now explicitly includes live captions as provisional output, separate
from the final judging transcript. Preservation/coverage, recognition quality and
judging readiness are independent facts. Provider success, fluent text, an empty
answer, confidence/agreement or a model's opinion cannot prove all spoken words
were retained. A questionable recognition remains recoverable work under a named
reconciliation policy, not observed silence or fabricated completion.

Preserve admitted PCM before energy/voice classification or downstream clip cuts.
Current `capture-clips.ts` excludes low RMS and runs below100ms from paid STT;
`capture-consumer.ts` can credit observed coverage after audible empty recognition;
the OpenRouter transcription adapter returns trimmed text alone. These source
facts motivate separate recognition uncertainty; they are not accuracy or physical
measurements. Assess short/quiet speech, clipping and boundaries at their owning
seams. Durable batch cadence is independent of paid recognition context length.

Caption candidates carry explicit provisional status and version. Final segments
reference original audio receipts, speaker/run/sequence/time provenance, attempts,
model/configuration/version and a reconciliation decision. Reprocessing preserves
original evidence and idempotence, with current erasure/claim/frontier fences on
candidate display, dispatch and settlement. Before freeze, a later accepted
candidate may correct provisional display. The single immutable freeze uses only
a durably settled authoritative frontier; no later recognition mutates it or
reopens a decided result.

Settlement requires an explicit policy decision over actual coverage and retained
recognition risk signals, including transport gaps, boundary/clipping risk,
low-volume/short utterances, audible empty/implausible output and provider failures.
Bound context overlap to original speaker and authority; retain original offsets
and canonical once-only ingestion instead of concatenating repeated boundary text.
Model confidence and agreement remain signals, never ground truth. Persist fair,
bounded due review/retranscription work with backoff, finite spending, escalation
and visible blocked recovery. Declare the supported outage/funding window and
qualification thresholds before enabling its default. Exhaustion, an absent corpus
or the seven-day cap cannot silently manufacture settlement or a result.

Delete-on-transcript now explicitly requires durably accepted selected text,
adequate actual coverage AND recognition settlement under the declared policy.
DEC369's original seven-day ceiling, current erasure and exceptional-expiry remedy
remain unchanged. Provisional/candidate text is personal/private, absent from
telemetry and ordinary realtime payloads; minimize its lifecycle with the original
evidence independently of final transcript retention. Production collection and
new processors/secrets remain under REL-H and existing human gates.

Recognition qualification is independent of storage and fault-to-result proof.
Use authorized human debate audio and human reference text covering fast speech,
accents, low volume, overlap/CX, short answers/negation, names/numbers/citations,
clip boundaries and noise/silence. Pin corpus/license/consent provenance, exact
audio/reference hashes, model/configuration/version and measurement scripts.
Report word errors plus consequential omissions/substitutions, attribution,
hallucinations on silence, boundary loss, latency and downstream judging stability.
Synthetic controls do not qualify representative human recognition. Compare models
only through approved interfaces with official version-matched documentation and
authorized test capabilities; no arbitrary blanket substitution. Corpus intake,
provisional/final implementation and quality qualification remain NOT RUN.

Original content subjects are an evidence-owned durable admission fact, not a
query against a successor cast. Initial intent admission persists the exact
server-derived, sorted, bounded subject actor set under its account→Round fence,
and includes that set in the custody binding digest before the first acquisition.
The set and cleanup routing survive Round aggregate erasure. A successor worker,
seat change or account closure never rewrites that original authority. Recovery
must discover the stored original set, acquire its canonical account fences before
Round and revalidate the exact stored set after waits; it must not acquire new
subjects after Round or reauthorize old PCM against replacement capture rights.

A nullable original-subject field explicitly means UNPROVEN, not an empty set.
There is no migration backfill from current cast and no invented original
membership/history. New admission always writes a proven set, including an actual
empty set when there were no human subjects. Unknown-subject routing is retained
for safe reconciliation/retirement; it cannot authorize payload adoption, replay,
STT or judging. Do not silently delete recoverable work because metadata is
uncertain. The worker's discovery role receives neither subject identities nor
payload/lease secrets. Subject routing is private/linkable metadata, minimized
only after confirmed retirement under the declared anti-resurrection lifecycle.
This storage step alone is not an audio receipt or a working retirement/replay
scheduler, and does not prove late held-plaintext settlement fences.

The acquisition metadata path now has its own execution claimant. It reads the
persisted original subjects, takes canonical shared account fences before Round,
then locks/revalidates the exact immutable stored scope. A successor advances only
execution worker/epoch/token; original capture worker/epoch/binding never changes.
It may reconcile an already committed acquisition intent after capture replacement,
closed session or the original cutoff. This is explicitly `reconcile-acquisition`,
not fresh capture permission, audio receipt, STT dispatch or final-result authority.
Initial capture admission still requires its original live capture lease/window.

A private evidence-owned Round marker makes withdrawal sticky/idempotent under
Round lock, with its first timestamp sampled by PostgreSQL after the lock wait.
New initial admission and acquisition reconciliation refuse withdrawn scope before
custody. Missing marker is unknown for existing evidence: only a genuinely new
scope with no prior original-Round evidence can establish its initial open marker.
No current-cast/account backfill establishes lost withdrawal history. The marker
commits without looping through/deleting every payload; immediate refusal and
bounded later cleanup are separate responsibilities. Current marker checks assume
current canonical PostgreSQL, not proof of freshness after restoring an old open
snapshot. Actual independent privacy-lineage capability below remains necessary
before payload activation. No new method is mounted in signed capture routes and
production evidence capability remains absent. Current known-expiry admission is
sampled after row/account waits and again after token acquisition; execution lease
and original data expiry remain different concepts.

For the remaining restore gap, the integration candidate is independent durable
original Round/subject scope bindings and sticky accepted privacy intents. The
owning authenticated workflow prepares exact authorized scope outside PostgreSQL,
then commits the canonical subject/optional Round fence and adopters, and only then
finalizes independent revocation/key cleanup. Pending authority refuses raw use;
it does not claim completed account closure or delete keys before the PG fence.
A crash or lost acknowledgement resumes the SAME accepted privacy service work,
never treats an absent old-PG event as permission to cancel/un-revoke. No vendor
call occurs inside canonical closure. This avoids mistaking a still-live key for
an unpropagated tombstone and does not claim an atomic cross-store commit.
Persistent/fresh-process/preparation-versus-bind/old-open-PG/live-key/late-plaintext
and public-closure workflow proofs are NOT RUN; this candidate is not implemented.
All-authority rollback and production restore/privacy remain REL-H. Scope/intent
metadata needs minimized anti-resurrection retention while old snapshots exist.
