# Round browser media

`createRoundMediaRuntime(app)` composes the existing `createMediaService` adapter
with rooted `database.mediaSessions`. It opens no additional SQL pool. Missing
media settings leave the optional feature inert and produce a public application
error on use. Browser connections require the validated public WSS origin.

Human GET `/api/rounds/:roundId/media` and POST `media/session` and
`media/reconcile` use the existing signed-member, same-origin and rate-limit
gates. POST bodies are strictly `{}`. Canonical account and Round membership are
resolved again under database locks; a browser supplies no actor or service
identity. Session replies expose only the caller's opaque media identity and
opaque identities for debaters in this Round. Hidden judges never enter peers.

`operations().botToken(scope, bearer)` is an internal worker capability. The
actual current generation run, publication epoch, memory bearer and speaking
window must verify before signing. Bot tokens publish microphone only and cannot
subscribe. Reconciliation also checks the actual live generation lease, so an
expired lease cannot reopen a connected bot's microphone. Native PCM credit
still requires the publication producer's full-window verification.

`workerTokens().captureToken(scope, authenticated)` accepts only the verified
principal returned by `@daisy/media/internal` after exact signed-body validation.
It checks the actual capture lease before and after provider existence reads;
it cannot create a missing room. The signed ingress owns authentication and
operation payload validation. Capture tokens use a fresh opaque hidden agent
identity, subscribe only, and carry neither publication nor metadata/data rights.
A safe live session issues it at once, whoever holds the session's reconcile,
instead of queueing behind back-to-back admissions and browser reconciles
(ISSUE-571). This fast path accepts a bounded recovery race: a foreign reconcile
already running at the read may later fail and delete the vendor room after the
token is issued. The worker sees a LiveKit connect drop and the supervisor
relaunches it under a fresh capture epoch. Receive-only admission grants no
competitive floor; avoiding capture starvation is worth this recoverable drop.
An unsettled vendor write, an unsafe session or closed admission instead takes
the session's reconcile hold; that held reconcile resolves or cleans up before
its own issue (ISSUE-551). The worker asks again, up to three times under a renewed
lease, when a token request's outcome is uncertain; a definite refusal is final.
No worker capability is available through the human endpoints.

Vendor creation, permission and deletion intents commit before dispatch. A
provider deadline never cancels its promise. Unknown outcomes remain durable and
block admission and opening, including after restart or an absence probe. Only
an actual acknowledgement settles an intent; recovery requires another verified
absence after every outstanding intent settles. Session ending is derived from
the locked Round and fresh PostgreSQL time, never an internal caller boolean.
The application lifecycle must invoke `recoverActiveSessions()` independently of
browser presence; the owning lifecycle composition supplies scheduling.

`roundMediaSlot(onRefresh)` supplies the runtime owner's fresh-view mount.
`RoundMediaSession` owns one transport per Round, synchronously releases local
tracks on exit or terminal state, and obtains new admission for reconnects.
Browser deadlines request fresh server views and reconciliation; they never
open microphones. Local device checks, live tracks and speaking indicators do
not establish capture completeness, transcript credit or peer audibility.

Capture, transport connectivity, subscription and playback are independent facts.
The SDK adapter validates serialized errors into the one closed source-failure
vocabulary; outer error names and status fields cannot confer device or account
authority. Only actual local publications establish capture; neither server
grants nor a desired mute choice establish it.

| Requested sources | Actual started sources    | Local outcome                                           | Independent receive path                                       |
| ----------------- | ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| None              | None                      | Receive-only; no failed capture                         | Retain authorized subscriptions and report playback separately |
| One or both       | Some                      | Report failures only for the affected sources           | Preserve working local sources and reception                   |
| One or both       | None, with typed failures | Report blocked or missing capture; offer explicit Retry | Preserve healthy authorized reception                          |

Explicit local Retry reconciles fresh server grants and reattempts capture
without readmission or reconnecting healthy reception. A failed mute operation
stops the uncertain microphone and reports its source failure while preserving
the camera and receive path. Actual transport failure, revoked/terminal authority
and ownership step-down release the lifetime. A definite 401/403/404 stops
automatic retries; an unavailable media projection requests fresh authority,
and a 409 follows the contract's fresh-read path (ISSUE-817/829, ISSUE-880).
Source failures never establish attendance, results or peer audibility.

Local mute and confirmed explicit departure suppression are tab-scoped keys under
`daisy:<kind>:media:<actor>:<roundId>` in sessionStorage: one account's record
cannot be read by another principal, and every record dies with the tab
(ISSUE-879).

### Browser effect ownership

| Concern                      | Pure decision / validation                                                                                                    | Effect owner and lifetime                                                                                                                                                      | Cleanup / caller proof                                                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical resume             | `rooms/resume.ts` takes the authorized active-Room output, explicit departure and injected time; no storage or navigation     | Home/lobby `ResumeRound`; target route reauthorizes audience                                                                                                                   | `location.replace` only after eligibility and advisory ownership; actual browser matrix remains the acceptance gate                                                                                                                                                                              |
| Advisory tab claim           | `mayResumeTab` rejects stale or future-dated claims; `resume-ownership.ts` validates stored shape                             | `createResumeLifetime` owns one subscription and injected heartbeat scheduler; `useResumeLifetime` binds one document identity per actor/Round                                 | Deferred direct routes do not mount media; explicit takeover steps down old media; normal teardown releases only its own claim. Crash freshness expires after five seconds and deferred lifetimes recheck without browser events. `resume-lifetime.test.ts` exercises the shared caller lifetime |
| Media recovery               | HTTP adapter mints retry / fresh-read / definite refusal facts; arbitrary serialized error names confer no internal authority | `createMediaController` owns generation, admission/reconcile flight and one mandatory injected recovery scheduler; `RoundMediaSession` supplies browser effects                | Reconnect, stop and success cancel the owned handle; stale completions cannot cancel a newer timer. Controller and composed transport regressions prove this; browser recovery remains separate proof                                                                                            |
| Request deadline             | One request includes both response headers and body                                                                           | `createMediaRequest` receives network and deadline effects from the media mount                                                                                                | Ten-second deadline aborts and settles a stall even when an adapter ignores cancellation; parent cancellation and success release the timer/listener. `request-media.test.ts` exercises both stalls                                                                                              |
| Source and playback evidence | SDK errors map to a closed display-only vocabulary; grants, actual publication, mute and peer audibility remain distinct      | Browser transport reports source failures and track snapshots, including present-but-muted publications; Round controls consume the media lifetime's actor/Round-scoped output | Producer unmount clears publication; control unsubscribe does not. Track absence cannot establish mute or peer audibility. SDK, stage and control regressions exercise these callers                                                                                                             |
| Local account preferences    | Principal/Room keys for checked-device handoff, principal/Round keys for mute and confirmed departure                         | Shell/direct-Round account binding observes account changes; only acknowledged departure suppresses resume                                                                     | Sign-out form cleans on submit while retaining native POST; account switch clears outgoing choices, terminal surface clears ended-Round choices. Browser acceptance must cover failed/unknown/canceled departure and account transitions                                                         |

The abandoned session-storage tab identity helper and the resume re-export wrapper
were deleted. Production uses a document identity so cloned sessionStorage cannot
make two tabs appear to be one. Pure decisions have one home in `rooms/resume.ts`;
storage adapters and the effect coordinator consume them directly. No generic
registry, package or competitive authority was introduced.

### Admission fairness

Media admissions announce an expendable waiter hint through the existing Redis
adapter before competing for the PostgreSQL reconcile lease. Other web instances'
recovery claims yield while a waiter exists; the admitted caller runs the same
full reconcile, including unsafe cleanup, before any mint. PostgreSQL retains
all lease, account, absence and token authority. Hints do not authorize media.
Each waiter and the namespaced set expire within one 15-second lease, with at
most 256 waiters per session. A waiting caller refreshes its own hint; release
removes only its own token. A dead waiter cannot suppress recovery indefinitely.
If Redis is unavailable or its hint capacity is exhausted, admission falls back
to ordinary canonical lease competition and records the classified
`round.media.fairness_degraded` event once per degraded episode. It never blocks
capture merely because the fairness hint is unavailable. Entry, release and
recovery hint reads each have a 250 ms deadline at the composition edge, so a
connected Redis that stops answering also degrades to canonical progress.
An underlying hint may settle after that deadline; it has no authority and
its existing expiry still bounds any stale scheduling effect.

Track elements attach by SDK track identity. Activity snapshots may replace
presentation wrappers without replacing that track; speaking changes update
labels without detaching media or clearing `srcObject`. Actual replacement and
unmount detach the old track and release its element.
