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
