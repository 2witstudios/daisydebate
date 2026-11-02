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

The connection and the wanted read have separate lifetimes. Admission, the SDK
connection and its tracks end only on reconnect, failure or terminal exit. The
read follows named inputs: the mount's first accepted Round view version, then
`view`, `boundary` and `wake` events to `reconcile`. A newer view, or a boundary
at the current version with a new deadline, supersedes the read in flight:
`decideMediaRead` advances the intent, the old ticket is invalid before its own
abort signal fires, and one fresh read starts on the same connection. Malformed,
equal, older and duplicate events change nothing, and wakes coalesce into one
followup. Each accepted projection also sends one, so a refresh at the same
version corrects a boundary read that reached the server too early. These inputs
only request a read; the server's reply still decides every grant.

In a burst, the first supersession since the last answered read aborts at once. A
later one lets a read under 2 seconds old finish rather than abort it, so fewer
reads overlap. This limits load and does not shorten the wait. Its reply is still
fenced, so a reply older than the current intent never applies, and a fenced read
does not retry. An older read is aborted as usual, and a read let finish is aborted
once it passes that age, so a stall cannot hold the fresh read. A pass's failure is
not its readers' answer: each gets the retryable 503.

The grant moves before the reply. A pass sets LiveKit's permission as part of
serving a read, and the browser follows LiveKit's permission without waiting for
the reply. So the bar a debater feels is commit to permission set, under 2 seconds
including in bursts, whether or not abort reaches the server. A reply arrives
later and cannot apply while newer versions keep arriving, so its wait lasts at
least the burst. Aborting
never cancels a pass already started, and a read that follows always joins or
starts one. Passes start from browser reads and from the server's recovery tick
every 500 ms, so the measured commit-to-permission figures below include recovery
and do not rest on a page asking.

While a reply is not current the Round does not claim a microphone state: from a
supersession until the next answer applies, a seat says it is checking. That cannot
stick. The controller alone times "no answer for too long": the read budget runs
from the first supersession since an answer, and past it the connection is
`out-of-date`, including when an answer arrives but its SDK apply never settles. A
local device failure hides that state, so a seat behind one says out of date at
once. Last-known grants stay for layout, so video does not disappear. The bar's
"Connected" describes the connection, not a grant.

Measured on the CI runner, one native three-browser journey per row:

| Abort reaches the server | Burst pacing | Commit to permission                       | Reply after the last event          | Refusals |
| ------------------------ | ------------ | ------------------------------------------ | ----------------------------------- | -------- |
| no                       | on           | 1462 ms at most                            | 2518 ms at most, 8 of 27 over 2 s   | 0        |
| yes                      | on           | 1047 ms at most                            | 2820 ms at most, 7 of 27 over 2 s   | 0        |
| no                       | off          | 1252 ms at most, before the journey failed | 18.6 s at most, on that failing run | 7        |

So the bars are: permission under 2 seconds, burst included; reply about 2.5 to 2.8
seconds after the last event on that runner, where a read alone takes up to about
1.7 seconds.
Inside a burst the wait is the burst's own length, not a stall. It reached 10 seconds
on the runner because the scripted burst itself ran about 8.7 seconds, and the seat
says it is checking throughout. The scripted journey clicks faster than a debate, but
these bars do not rely on that.

Whether a client disconnect reaches `request.signal` in production is unverified.
Fly's documentation does not say whether its proxy closes the upstream connection,
though Next aborts the signal when that connection closes. Assume it may not:
abandoned reads may run to completion there, and the shared polling loop is what
limits their load.

An obsolete reply or rejection cannot apply, announce, fail the connection or
clear its successor. Aborting releases the client's wait; it does not prove the
server or the SDK stopped working. An SDK apply already started may finish, so
the fresh apply waits for it and only the current ticket announces, and a queued
reply superseded while waiting never starts. Events during admission or connect
are recorded and the first read uses them, without another admission.

`createMediaRequest` owns the one 10-second deadline over headers and body for
each attempt. Expiry is a transient failure, handled by the controller's existing
retry and no second retry owner.
A read that cannot finish on a live connection keeps its transport and tracks:
LiveKit enforces every grant on the server, so it carries no authority risk. Only
an answer about authority ends the connection: 401, 403, 404, 409, 410, or the
server's unavailable or ended state. Anything else, a timeout, 429 or 5xx
included, makes the state `out-of-date`, shown as such rather than as plain
connected, until a later read answers. Later view, boundary and wake events and the
view's backstop poll start those reads. Supersession restarts a read's retries but
not the stall, so reads kept unanswered past the read budget also show `out-of-date`.
A local device failure the Round has shown is not overwritten by later reads.
Revocation, terminal state and disposal still end the connection, and admission
failure before a connection goes live is unchanged.
The deadline bounds HTTP only. An SDK apply that never settles still holds later
applies, as it always has; nothing here cancels or times out SDK work.

### Admission fairness

A browser admission waits for the session's lease for at most 8 seconds, below the
client's 10-second request deadline, and stops as soon as its request is aborted.
Either answers the retryable 503. The bound covers the wait only: a pass won late can
outlast the client's deadline, and a pass that has already started is not cancelled.
Concurrent reads of a session share one polling loop in each process, so waiting
reads do not each load the competitive lane. A browser read also stops serving when
its request is aborted, and a read that
crosses a vendor write in flight answers the same 503 rather than a refusal. These
expected deferrals log `round.media.request_deferred` and reach no error tracker.

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
