# 0067: Playable Round policy and acceptance

Status: accepted decision under explicit delegated owner authority, 2026-10-22.
Implementation and independent exact-candidate acceptance remain outstanding.
Extends [ADR 0058](0058-one-round-model.md) and
[ADR 0059](0059-one-competitive-api.md); accepts the architecture in
[ADR 0053](0053-live-video-self-hosted-livekit.md).

Authority and historical criteria: [decision and acceptance reconciliation](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/mv8tej0of9dovpy4n23hgd6t),
[reviewed execution manifest](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/d0v3a4d2fgazxg2zz6dxxfwc),
and [delegated prompt](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/n3ri8wn7hlau03kncbeh4nie).
The owner expressly delegated non-production product, design and architecture
decisions for the complete playable Round. These decisions permit implementation;
they neither grant implementation Done nor approve production identity, secrets,
vendor activation, deployment/data actions, legal attestations or consent.

## Shared media and terminal cleanup

Adopt ADR 0053's self-hosted LiveKit, one media session per Round, stable opaque
participant identities, hidden subscribe-only judge and separate capture worker.
Human/human and human/bot use the same competitive model, runtime authority and
media controller. Human camera/microphone and bot voice are real media; the bot's
portrait does not imply a synthetic camera. Server capture, historical speaking
intervals, bounded in-memory audio, partial coverage and immutable transcript
revision remain mandatory. Accepting architecture does not prove Bun/native PCM
support, provider format, consumption accounting or any real service journey.

Select DEC-113: LiveKit `room.auto_create` is false. Only fresh authenticated,
eligible, nonterminal, judging-window-valid admission explicitly creates a missing
opaque Round room and mints a least-privilege token. A 60-second initial token
does not revoke a connected client or a refreshed credential. Serialize admission,
creation and terminal reconciliation with the same session fence; a stale creation
response must never reopen admission after terminal commit.

Completion or abandonment commits competitive state independently, closes new
admission and durably schedules idempotent room deletion. Retry until provider
absence is verified, including after process death and ambiguous timeout. Never
record successful vendor cleanup from an attempted dispatch. Outstanding mutations
survive restart; refuse opening grants/admission while their outcome is uncertain.
Close required microphones before opening others. A media outage changes neither
a committed result nor competitive attendance. Report scrubbed failure/recovery
state; do not promise a fixed removal bound during provider outage or contention.

The bounded judging conversation window defaults to 30 minutes after actual final
segment end; no fixed start-time schedule substitutes for that durable anchor.
Competitive capture ends at the final segment. Its admission cutoff is actual
final end plus 120,000 ms; all judged writes honor the single immutable freeze,
including late historically eligible clips and bot publication prefixes.

## Live timing and separate access boundaries

Resolve DEC-179 and RRD-11: checkpoint, segment history, phase and clock in
`GET /api/rounds/:id` are **live, undelayed timing** for callers already entitled
to `round.read`. This changes no admission, private-Round readership, participation,
transcript, media, document, ballot or judge-identity authorization. Never describe
that timing as delayed. Hidden human judge identity remains redacted under the
existing review/reveal rules across HTTP, SSR, reconnect and realtime projections.

A future delayed spectator media/broadcast producer has a separate authorization
and completion contract. Live timing, Round completion, transcript freeze and
media deletion cannot establish delayed-broadcast completion or expand messaging
history access. This decision ships no spectator media audience by inference.

## A started Room stays immutable

Supersede ADR 0049 section 4's automatic same-Room reopening and ROOM-6.2's
"see the room open again" clause. One started Room retains its one frozen Round
reference and history. Completion never resets its assembly/version/readiness or
allows a second launch. The next match uses the existing create-Room journey and
a new cuid2 Room, new command identities, current legal configuration/eligible
cast and fresh human Ready consent. This preserves another-match capability
without mutating competitive provenance or reusing old leases. No automatic
copy of membership, judge assignment, private access or consent is authorized.

ROOM-6.2's placeholder AI judge is replaced by a real shared-rubric AI judge over
the frozen transcript revision. A random result or simulated ballot is not proof.
Keep the original criteria in PageSpace as history; link this replacement rather
than silently editing their meaning or declaring the historical behavior passed.

## Attendance and durable outage horizon

Retain [ADR 0033](0033-presence-and-adjudication.md)'s fairness and settled-prefix
rules, adapted to actual persisted Round segments and runtime transitions.
Its fixed start-time timetable and snapshot participant collection are superseded
by ADR 0058; never reconstruct actual starts after prep, yields or interrupts
from a static timetable. Derive attendance eligibility from authoritative actual
speech openings and participants, with injected time/resources and database receipt
timestamps. Do not adjudicate prep, interaction-only segments or the last speech.

Keep `checkInGraceMs >= heartbeatMs * 2 + reconnectBudgetMs`, speech duration
covering grace, and `finalizationBufferMs > checkInCommitBudgetMs`. Existing defaults
are 15,000 ms heartbeat, 10,000 ms nominal reconnect allowance and 40,000 ms grace;
the reconnect allowance is not a proven socket recovery bound. Preserve approved
formats and launch styles; prove custom timing rather than truncating it to a
convenient test schedule. Conflicting format/grace requirements must be reconciled
in the format compiler and attendance producers before acceptance.

Use durable database-time service leases and strictly ordered availability samples.
A missing history prefix, unhealthy evidence or gap over 2,000 ms postpones only.
Close an outage after three consecutive healthy samples. A later sample cannot
change availability at or before the previous settled horizon; gap intervals start
strictly after that horizon. Never finalize while the effective deadline remains
undetermined, a relevant outage is open, or settled horizon is earlier than effective
deadline plus finalization buffer. A check-in's database receipt timestamp decides
its timeliness; evaluator arrival order does not. With those gates satisfied, missing
speaker/present opponent forfeits the speaker, both missing abandons, and missing
only the non-speaker does nothing. Final outcomes are irreversible. Media/PCM/STT
failure is never outage evidence sufficient to assign a competitive loss.

RT-4.3d's real public-path check-in probe remains required for the full recovery
journey: process leases alone cannot prove public ingress reachability. Do not
claim the historical accepted lease-only risk as proof of ingress-outage fairness.

## Capture proof applicability (DEC-190)

[DEC-190](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/plem8tqexq7oonyq0jnwpfap)
is recorded under delegated authority and remains open for owner confirmation or
reversal. Its narrow applicability change follows the independent
[capability audit](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/m5btrfnrfkp9yo2v6j6kgucs)
and is carried by
[VIDEO-3.1-r3](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/jojis5n01vpb3sqt4gbkelcp).
The historical integrated clause is “It proves both complete coverage and honest
partial coverage reaching judging.” Original PageSpace leaf criteria and review
history remain preserved. Only that clause's requirement for a native whole-grant
complete path is replaced by the two proof obligations below. No requested cast,
provider, browser journey, worker or race is removed.

1. **Durable complete storage proof:** real PostgreSQL transactions with accepted
   engine history must prove the unchanged complete-coverage predicate, immutable
   complete seal, committed transcript frontier and frozen reader ordering. Exact
   whole-grant coverage, including silence with zero chunks, must be evidenced;
   lease ownership or sample/chunk totals alone cannot supply it. Removing a
   historical-window guard or required observation must turn the proof RED.
2. **Native integrated proof:** actual human microphone PCM and configured STT,
   bot provider PCM over the shared LiveKit path, and calibrated full-frame
   eligibility must produce real retained transcript content. Discovery delays,
   uncertain edges, stalls, dropped clips and cancellation stay explicit gaps;
   their streams seal partial and freeze incomplete. Real human and AI judges
   consume the same immutable revision and actual retained content, with truthful
   partial/frozen browser state. Provider errors, takeover, cutoff/freeze races,
   teardown and restart recovery still require actual service proof.

The existing `packages/db/integration/media-capture.integration.ts` complete seal
and full-window refusal proofs, and `packages/media/integration/native-publication.integration.ts`
native source proofs have distinct scope. Neither alone discharges the integrated
journey. Required composed tests must independently verify:

| Boundary                     | Required positive and negative evidence                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete storage             | Actual accepted history plus continuous retained coverage seals complete; deleting coverage or widening across a grant boundary refuses or seals partial, without mutation on refusal.                                                                                     |
| Native human and bot         | Real human STT and bot PCM create retained eligible content; refreshed calibration, full uncertainty containment and consumed cadence are required. Stall, stale calibration, burst credit, cancellation and uncertain edges never publish rejected PCM or generated text. |
| Partial freeze and judging   | Native gaps remain partial through immutable incomplete freeze, shared human ballot and actual AI judge provider result; a later retry cannot heal the frozen revision or redispatch a cached validated result.                                                            |
| Concurrent durable writers   | Actual append/seal versus lease takeover, cutoff, paused scheduler and freeze preserves admission fences and idempotency; removing the owning fence fails the test.                                                                                                        |
| Browser and provider journey | Required real human/human, human/AI and judge casts retain camera, shared media, authority, transcript privacy and actual result/teardown behavior.                                                                                                                        |

A raw callback bracket observes producer delivery before the SDK queue. It is not
an acoustic/network/prior-native-queue latency bound. A conservative outer possible
time window proves eligibility only when fully contained; it does not prove
retained PCM throughout that entire window. Continuous raw observations cannot
heal rejected uncertain edge PCM. A future native complete claim needs a valid
whole-grant edge witness under all allowed calibration worlds. The audit does not
establish global impossibility, and the complete predicate, runtime statuses,
full-window authorization, privacy and immutable freeze remain unchanged.

## Replacement test obligations and existing carriers

| Historical clause / decision                                    | Required replacement and negative proof                                                                                                                                                                                                                          | Existing owner leaves                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| VIDEO-0.2 owner architecture sign-off                           | Accepted delegated architecture in docs; independent contract review and default-branch delivery remain required, distinct from implementation proof                                                                                                             | VIDEO-0.2, VIDEO-0.18, VIDEO-0.19                        |
| VIDEO-0.3 design sign-off                                       | Delegated design can proceed; real connecting/live/closed/denied/reconnect/no-JS states, human camera beside bot portrait and accessible Ready checks                                                                                                            | VIDEO-0.3, VIDEO-2.3, VIDEO-4.1                          |
| DEC-113 / VIDEO-1.1, VIDEO-1.4, VIDEO-2.1, VIDEO-2.2, VIDEO-2.6 | Real LiveKit refuses refreshed-token rejoin after verified deletion; no auto-create; terminal-vs-create, stale grant, crash/unknown dispatch, outage/retry and cleanup cannot alter result; removing terminal/fence checks must fail                             | Those same five VIDEO leaves                             |
| DEC-179 / RRD-11 third criterion                                | Fresh authorized live checkpoint/segments after accepted command, refresh and reconnect; no Delayed label; denied/private callers stay denied; judge identity remains hidden in all delivered payloads                                                           | RRD-11, CAP-C.4, ROOM-6.2, RT-4.6                        |
| ROOM-6.2 same Room reopens                                      | Three-browser human game to real ballot/result; original Room remains started with identical Round reference; return to creation and create/join/configure/ready/start a distinct Room; retry/concurrent old launch cannot create another Round or reuse consent | ROOM-6.2, CAP-B, CAP-E.2                                 |
| ROOM-6.2 placeholder/random AI ruling                           | Two human browsers with real AI judge and human/bot game use shared rubric/frozen transcript, durable ballot/outcome/receipt; retries/crash do not duplicate completion                                                                                          | ROOM-6.2, CAP-D.1 through CAP-D.5, VIDEO-4.1             |
| DEC-161 hides human tile in bot play                            | Human camera visible beside bot portrait and real LiveKit bot voice; denied/ended local tracks and reconnect display actual state                                                                                                                                | VIDEO-0.3, VIDEO-2.3, VIDEO-4.1                          |
| DEC-172 Recording Saved / Transcript Complete placeholders      | No saved-video claim without recording producer; unknown/open/partial/frozen states come from durable evidence; partial capture stays partial through freeze and judging; no audio creates no invented complete transcript                                       | VIDEO-2.3, VIDEO-3.1 through VIDEO-3.7, CAP-D.1, CAP-D.3 |
| RT fixed timetable / lease-only health                          | Actual opening after prep/yield/interrupt, timestamp race, public-path outage, sampler crash/takeover/gap, immutable horizon and both forfeit/abandonment outcomes against real services                                                                         | RT-4.1 through RT-4.6, RT-4.2-arch1, CAP-C.3             |
| ISSUE-333 privacy omission                                      | OpenRouter and configured transcription provider inventoried, text/audio private, no logging/disk persistence; real configured zero-retention proof without self-approving legal/deploy gates                                                                    | VIDEO-3.2, VIDEO-4.1, PRIV-H                             |
| ISSUE-382 route omission                                        | Shared media read/session boundary explicitly documented; no public browser PCM upload, heard-report or AI-only transport returns                                                                                                                                | CAP-E.1, CAP-E.2, VIDEO-2.1                              |
| ISSUE-403 / ISSUE-417 / ISSUE-425                               | Custom legal timings retained and contradictory inputs refused atomically; current floor/prep/mic projection after refresh; real server controls with refusal/replay/concurrency proof                                                                           | CAP-C.1 through CAP-C.5, ROOM-6.1, ROOM-6.2              |

All original residual criteria remain on their owning leaves. The four-minute
ROOM-6.2 target cannot justify weakening minimum legal format/attendance durations;
record measured duration and revise execution scheduling if necessary. Required
real browser/provider tests, meaningful observed RED then GREEN and independent
exact-candidate review remain mandatory. An exit-zero scenario that prints
"Scenario boundary documented" is NOT a passed lifecycle. `judge-flow` needs real
shared judging scenario/proof before full acceptance.
