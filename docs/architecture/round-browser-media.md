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
No reconcile's result changes such a token, so a safe live session issues it at
once, whoever holds the session's reconcile, instead of queueing behind the
admissions and browser reconciles that hold it back to back at a Round's start
(ISSUE-571). An unsettled vendor write, an unsafe session or closed admission
instead takes the session's reconcile hold, whose own reconcile resolves or
cleans up first, so a token is never minted into a room that reconcile then
tears down (ISSUE-551). The worker asks again, up to three times under a renewed
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
