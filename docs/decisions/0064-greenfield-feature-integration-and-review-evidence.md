# 0064: Greenfield feature integration and review evidence

Status: proposed (owner-requested messaging decision package, 2026-10-09).

Builds on [ADR 0060](0060-persistent-authorized-messaging-channels.md).
Source: [policy and producer reconciliation candidate](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/k55wkk05wod2w1oswgasijhu) and
[document-package tasking amendment](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/i7db8mk923w393p22fkaozu0).

Task: [MSG-1.1d](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/jrmj4yn3j9cet1dc24h3izsz).
Writer: [bounded document package](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/y9ta8ogco04r0kel8kjndrpu).
Proposal review: [revision2, approved for owner consideration only](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/gr8gxo4ujncvoz9soh7ri8zj).

## Context

The owner requests concrete decisions before implementation and broad greenfield
freedom on feature branches. Protection of main and production must not become
a requirement to finish every prerequisite before building its consumer. This
record proposes policy for owner review; it supplies no delivered producer,
source writer grant, runtime authority or fabricated verification evidence.

## Proposed decision

For owner-authorized greenfield delivery, distinguish BUILD / EXPERIMENT / INTEGRATE from ACCEPT / MAIN / ACTIVATE. On the owning feature branch, builders may build and test provisional implementations and integrate actual unmerged producer commits before those producers have an independent approval or global Done status. Record the producer's exact SHA, declared contract, source owner/allocation, integration SHA, known gaps and provisional review/evidence state. A branch name or an invented stand-in is not an implemented producer. Integration reuses that implementation; it does not grant permission to edit another active writer's files or invent accepted product authority. Proposed decisions may be explored in isolated development and tests, with their provisional status explicit; they cannot be presented as accepted authorization or activated for users.

Before ACCEPT / MAIN, test the full composed candidate, reconcile its contracts and security boundaries, resolve relevant findings and obtain independent exact-head review under the applicable main checks. Producer review may be satisfied within this composed review; a prior separate producer approval is not mandatory for branch integration. ACTIVATE additionally requires accepted product/producer policy and applicable human-only identity, secret, vendor and deployment sign-offs. Recorded provisional integration is neither main acceptance nor global Done. One open vertical per builder; the integration branch holds the composed story and a reviewable PR. Resolve actual shared-file conflicts with producer owners; migration generation stays single-writer with fresh number claims and chain checks. Branch freedom does not authorize parent main writes, autonomous main merge or bypass of an explicit service hold.

Pure documentation changes require exact-head independent source/contract review plus applicable nonservice repository gates and meaningful document/contract negative controls where mechanically checkable. They do not claim integration/E2E/runtime proof. Validator must determine documentation-only eligibility from the actual PR diff, not an unchecked record assertion: allow only .md content under docs/ with no executable generation/config/AGENTS/skill/workflow/gate changes. Unknown files or uninspectable diff fail closed. Runtime, SQL, protocols, policies JSON, process scripts, frontend and build/dependency/config changes retain required tests including integration/negative controls appropriate to changed behavior. A documentation-only exception is scoped, not a no-findings bypass. Review-record exact SHA/builder/independent reviewer/verdict rules always remain. GRD's allocated validator writer adds negative tests proving docs-only eligibility and false-claim/mixed-diff refusal, and updates the review record doc together. Current PR216 remains CHANGES REQUESTED until owner accepts policy and actual validator delivery; no retroactive PASS fabricated.

RT lease enforcement proposal: maximum 60,000 ms from successful fresh authority check START, next recheck scheduled by50,000 ms, timeout5,000 ms within remaining lease; expired leases cannot send or catch up even if async work or timers stall. Deadline includes scheduling and hung-decision behavior. Every send/replay validates injected monotonic now; after a stalled event loop resumes, expire before emitting. A disconnected authority source closes subscription; signal consumption invalidates immediately on that node. Durable HTTP reads/mutations always use current authority. This proposed exact bound needs RT/owner confirmation and real two-node proof; it is independent of delayed spectator producers.

### Current decision and evidence boundary

[DEC-125](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/h4qaxbwe3is4q7hdaysx5y5g)
is open; this ADR neither confirms it nor changes the review validator.
ISSUE-386 remains owner checkout reconciliation; restoring the old parent
launcher would undo owner-directed merged PR215 config. No parent mutation or
doctor/service-hold bypass is granted. Review credentials are not provisioned
by this ADR. Machine identities, secrets and production rails remain human-only.

PR216 was independently reviewed at 8931f229d0a445f70ff2532b92aff0677c076fd3:
zero ADR defects, bounded MSG-1.1 criterion satisfied; CHANGES REQUESTED solely
for missing required evidence under the hold. Integration/E2E/verify/negative
control were NOT RUN. review:check failed for absent PAGESPACE_TOKEN; pure
validator refused non-approval. That historical result remains accurate.

A provisional prerequisite integrated on a feature branch must have its actual source commit, declared API, source owner and current evidence/review state recorded. Missing independent approval is an explicit provisional gap, not a reason to stop branch integration. Consumer proof runs against the composed candidate, not merely the separate producer SHA. Changes after review require delta review and relevant reruns before main acceptance; source ownership persists through conflict resolution. No prior exact review is claimed for changed code.

Task/prompt prerequisites distinguish availability needed to build from acceptance needed to close or merge. A producer implemented at a pinned unmerged SHA can satisfy a branch build dependency without being globally Done or on the default branch. Plan review records unmerged dependencies as provisional risks instead of automatically refusing experimentation. Documentation review applicability remains the separate proposed DEC-125 policy below. Doctor should distinguish current-checkout service safety from unrelated parent checkout/config state; any decoupling needs a separately allocated tooling change and its tests. This proposal itself changes no task command, prompt, validator or doctor behavior, and releases no existing ISSUE-386 hold.

The GRD/tooling writer must implement diff classification and documentation
review-gate changes separately, with tests for forged doc-only claims, mixed
SQL/runtime/config diffs, unknown/unavailable diff, nonregular or executable file modes, stale head, same builder
and missing independent contract evidence. Exact file allowlists and check
runner are declared in that leaf, not an ad hoc PR label. Applicable negative
controls for documents may mechanically prove link/number/status/contract
validation; they never masquerade as mutation or integration tests. All
changed runtime/security behavior retains meaningful failure proofs.

### Acceptance/refusal and future proof matrix

These are required future tests, not executed implementation evidence. All
rules and numeric values in this matrix are proposed for owner review.

| Case / inputs                             | Proposed rule or owner choice                                                                                                           | Authoritative producer                          | Observable result                                                            | Future proof                                                                | Negative control                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Provisional producer integration          | Pin actual unmerged SHA, contract, source owner, known gaps and review/evidence state; prior approval not required                      | Producer + feature builder                      | Actual producer integrated provisionally without claiming accepted authority | Ancestry/API checks at composed SHA                                         | Require globally Done or a separate approval merely to integrate                                          |
| BUILD / EXPERIMENT / INTEGRATE            | Isolated branch development may explore Proposed policy; preserve writer boundaries and record provisional assumptions                  | Feature builder + producer owner                | One composed candidate with explicit provisional state                       | Inspect source lineage and assumptions                                      | Treat experiment as accepted product authority or edit another writer's files                             |
| Same-file collision / migration           | Coordinate one writer per shared resource, migrations single-writer/reclaim each generation                                             | Root shared allocation + DB writer              | No conflicting mutation/journal rewrite                                      | Conflict audit and migrations:check                                         | Concurrent schema generation or silently edit producer file                                               |
| Stale upstream/head / conflicts           | Reconcile owner API/accepted decisions; record resolution commit and re-review affected proof                                           | Builder + independent reviewer                  | Prior exact review not used for changed source                               | Injected changed head/API lineage refusal                                   | Claim old review for conflict-edited new code                                                             |
| Merged vs branch dependency               | Merged is main state; Integrated is candidate adoption, neither self-Done                                                               | Root board/integration record                   | Honest state/prerequisite evidence at feature SHA                            | Board/readback vs actual git ancestry                                       | Set globallyDone on cherry-pick                                                                           |
| ACCEPT / MAIN                             | Composed tests, contract/security reconciliation and independent exact-head review before main acceptance                               | Builder + independent reviewer + main checks    | Relevant producer/consumer changes reviewed together at exact composed SHA   | Full applicable check/verify and failure proofs with cache/hold disclosures | Claim producer approval alone proves composed consumer or forbid build until every acceptance gate passes |
| ACTIVATE / protected main                 | Main merge follows its rules and operating mode; deployment, identities, secrets and product authority retain explicit activation gates | Owner/human leaves + main rules                 | No self-approval, parent mutation or credential copying                      | Allocation/activation audit                                                 | Branch integration treated as production approval                                                         |
| Build dependency vs completion            | Pinned actual producer can satisfy branch build availability while task stays honestly provisional; Done retains acceptance proof       | Task/prompt tooling owner                       | No default-branch/global-Done bottleneck for experimentation                 | Branch dependency and status readback fixtures                              | Self-Done on cherry-pick or silently change task criteria                                                 |
| Plan and environment applicability        | Unmerged source is a recorded risk; future doctor decoupling tests current-checkout safety separately from parent state                 | Plan/tooling owner                              | Proposed process improvements recorded without bypassing existing holds      | Unmerged-plan and parent-dirty/current-slot safety fixtures                 | Ignore an explicit service hold or mutate parent config                                                   |
| Doc-only .md allowlist                    | Inspect actual livePR diff, underdocs only and no executed/generation/instruction config                                                | Allocated GRD validator, pendingDEC125          | Eligible docs review after adopted policy only                               | All allowed/refused path fixtures                                           | Trust reviewer flag or PR label                                                                           |
| Executable/config/AGENTS/skills/workflows | Never docs-only even when extension.md; executable/instruction files excluded                                                           | GRD diff classifier                             | Require normal runtime/security evidence                                     | AGENTS/skill/script/build fixtures                                          | Extension-only classifier                                                                                 |
| Mixed/unknown/uninspectable diff          | Any noneligible/unknown diff fails closed                                                                                               | GRD live diff reader                            | No doc-only approval                                                         | MixedSQL/docs, missing API/diff and unknownstatus tests                     | Treat network failure as empty docs diff                                                                  |
| Candidate drift / reviewer equals builder | FullSHA/livehead and distinct identities mandatory                                                                                      | Existing review-record validator                | Refuse stale or self review                                                  | Current validator negatives plus newclassifier cases                        | Mint approval with old head or sameidentity                                                               |
| False PASS / NOT RUN                      | Actual applicability/results explicit; no faux serviceproof                                                                             | Reviewer and validated record shape             | No green from held or denied evidence                                        | Malformed/pass-with-notrun/falseclaim fixtures                              | Parse substringPASS as success                                                                            |
| Validator adoption absent                 | Proposed 0064/DEC-125 alone changes no current check                                                                                    | GRD separately tasked writer + owner acceptance | Current216 nonapproval remains truthful                                      | Existing validator refuses proposed exception                               | Use ProposedADR as active exception                                                                       |
| Bounded RT lease                          | 60 s from check START, next 50 s,5 s timeout within lease; check eachsend/replay                                                        | RT owner/policy and revalidation producer       | Expire before enqueue/send after hang; immediate local signal denial         | Injected time plus lagged two-node integration                              | Renew lease from end of slowcheck                                                                         |

### Authorization attempt generation

Each authorization attempt captures socket/session/subscription generation, authoritative resource revision and check-start monotonic instant. Consumed revocation, timeout, lease expiry, unsubscribe, socket close or replacement increments/invalidates generation. Apply an allow result only if attempt generation, principal/session, resource revision and deadline still match the active attempt; publish lease+attachment atomically with that check. Late results cannot renew, attach, replay or emit after invalidation, regardless of AbortSignal success. Restoring eligibility requires a new fresh attempt in a new generation, not a rejected promise completion. Catch-up rechecks this fence after each asynchronous read and immediately before replay/attach; signal invalidation also discards queued doorbells. Controlled promise tests resolve allow after signal/timeout/expiry/unsubscribe/session replacement and prove unchanged expired state; real two-node signal lag supplies later enforcement proof.

## Adoption and proof

The owner accepts or revises product and producer policy before runtime
adoption. The orchestrator reconciles existing leaves and records exact
writer files, source commits and reader proofs. Later source changes follow
TDD and independent exact-head review. Human-only identities, vendor accounts,
secrets and production activation remain human actions. A proposed record is
not proof that any implementation leaf is complete.
