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
stick. The model alone times "no answer for too long": the read budget runs
from the first supersession since an answer, and past it the connection is
`out-of-date`, including when an answer arrives but its SDK apply never settles.
Last-known grants stay for layout, so video does not disappear. The bar's
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

A deadline right after a supersession is the case where pacing could matter, since
the boundary lets the young read finish and that browser's fresh read starts up to 2
seconds late. The floor does not depend on that read: the next speaker's read or the
recovery tick moves it, and pacing cannot slow or speed the tick.

The tick is the last resort, the only mover when every browser read is held, so one
Round never waits on another there, and it spends its passes where a floor must move
(ISSUE-972). Each tick makes one read, one query for all active sessions, and
`recoveryDue` decides from it: a commit since the Round's last pass or a clock boundary
passed since then comes first, then repairs (never passed, unsafe, terminal), then a
heartbeat for a Round with no pass in 2 s, which covers what that read cannot see, such
as a revoked seat. A Round with none of these costs no pass, and neither does one a
claim could not start for yet (a live lease, or under 500 ms since its last pass), which
would only poll the lease. At most 4 run at once per
process, and a tick does not wait for the one before it.

The tick used to visit sessions one at a time and wait for the last. On the CI runner
that took a median 337 ms with one active session, 1340 ms with four and 2684 ms with
seven. Four failing runs measured 2112 to 3527 ms deadline to permission before that log
existed, so those figures rest on the sweep timings, not on a log of those runs.

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
each attempt. Expiry is a transient failure, handled by the model's existing
retry and no second retry owner.
A read that cannot finish on a live connection keeps its transport and tracks:
LiveKit enforces every grant on the server, so it carries no authority risk. Only
an answer about authority ends the connection: 401, 403, 404, 409, 410, or the
server's unavailable or ended state. Anything else makes the state `out-of-date`,
shown as such rather than as plain connected, until a later read answers. Later
view, boundary and wake events start those reads, and so does recovery's paced wake.
Supersession restarts a read's retries but not the stall, so reads kept unanswered
past the read budget also show `out-of-date`. Revocation, terminal state and disposal
still end the connection.
The deadline bounds HTTP only. An SDK apply that never settles still holds later
applies; nothing here cancels or times out SDK work. `out-of-date` always offers
Retry, which reads current grants and keeps the connection, and rebuilds it only when
this connection's apply has been stuck past the read budget.

`media-failure.ts` is the one classifier. A 408, 429 or 5xx, a timeout or the network
is `transient`: `retrying` tries it again, and recovery paces further attempts. A 401,
403, 404 or 410 is `refused`: final for this page, with no Retry. A 409 or the
server's unavailable state ends the connection as `definite`, as does any failure
before going live that retrying cannot help, such as a reply that does not parse.
`definite` asks for a fresh view and waits for Retry; on a live connection it keeps
the tracks and shows `out-of-date`. `replaced` means LiveKit moved this seat to another
connection; it sets no timer, and Retry takes the seat back.

Recovery is part of the one model, with one timer. A transient `out-of-date` sends a
`wake` read on the same connection, with no admission. A transient `unavailable` is a
released connection, so it admits again. That covers a media connection that fails after
a good admission, unless LiveKit refused the token (401 or 403), and a first apply that
hangs past the read budget. When LiveKit drops a connection, the model releases it at
once and reports it the same way, so nothing reads on a dead connection and there is one
path back. If LiveKit says this seat connected elsewhere, this connection stops and says
so, and Retry takes the seat back.
There is one retry loop: only the first join retries its admission, and every later
attempt is one admission. Delays run 1, 2, 4, 8 then 10 seconds, and reset only once a
connection has held for 5 seconds, so one that keeps dropping stays paced. The timer is
armed only by a reported failure, so an attempt in flight is never multiplied.
An online or visible event moves a waiting attempt up, or reads again on a live page,
at most once per 5 seconds.

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
and ownership step-down release the lifetime (ISSUE-817/829, ISSUE-880).
Source failures never establish attendance, results or peer audibility.

The checked-input adapter has one typed read result: an available choice map
(including an absent key as an empty map), or unavailable preferences with an
unreadable/invalid reason. Each capture attempt copies one freshly read,
principal-scoped Room handoff snapshot for both SDK constraints and failure
attribution. The Room has one Round, and its departure/terminal cleanup bounds
that handoff to the Round lifetime. A failed read never selects default hardware:
only the affected capture reports the preference reason; working tracks and
reception remain. Disposed owners cannot start capture or report late failures.
Explicit Retry keeps missing state when forgetting cannot persist. Room check
handoff stays best effort, and replaces invalid data only with actual passed
check evidence; it never converts an unreadable choice into permission to use
default inputs.

One private source map owns each captured track together with its requested
choice, publication phase and idempotent release capability. The phases are
captured, warm, publishing, published and retiring. SDK awaits never move a
resource through an unowned warm slot. Warm promotion first validates current
scoped choices; a changed choice replaces only that source, and an unreadable
choice cannot publish an unverified warm track. Stop releases the whole lifetime
once; repeated cleanup cannot emit an empty snapshot into a successor. A late
capture is released without installation. Unpublish rejection reports the
source failure and preserves healthy capture/reception and later settle work. The
SDK rejects only when its renegotiation fails, after it has already removed the
publication locally, so a later grant publishes a fresh capture.
The composed caller proofs are `media-warm-retry.test.ts`,
`media-source-retirement.test.ts` and `media-source-disposal.test.ts`.

Local mute and confirmed explicit departure suppression are tab-scoped keys under
`daisy:<kind>:media:<actor>:<roundId>` in sessionStorage: one account's record
cannot be read by another principal, and every record dies with the tab
(ISSUE-879).

A resume fires once per tab until the Round has rendered: `rooms/resume-attempt.ts` holds the attempt in tab storage, so a failing Round page cannot take home and the lobby with it (ISSUE-1035).

### The media model

One pure model owns a Round's media state on this tab: `round-media/model/`.
`reduceMedia(state, event, { atMs, policy })` returns the next state and effects as
data, and holds no clock, timer, storage or SDK. A rejected event returns the same state
object and no effects. `media-runtime.ts` queues events, so an effect's result is always a
later event and never a nested reduce, and it runs effects at the edge.
`adapters/livekit-room.ts` reports what the SDK did and does what it is told. Its track
handles only attach to elements: the stage decides from the model's tracks. Status, publication and captions are pure
derivations of the state, with no stored copy.

The link is one of `waiting`, `admitting`, `connecting`, `live`, `released` or `ended`.
Only `live` holds tracks, grants, a read or a mute change, so a dead connection cannot say
Connected and a new one inherits nothing. A `live` link is `establishing` until its first
answer applies, with no media and nothing to be out of date, then `established` with both.
What recovery waits to do is in the link: a transient release has its rejoin coming, and a
stale answer its read. Each source has its own state, so one failing leaves the other
working. Connection events carry their connection, read events their ticket and timer
firings their schedule, and stale ones change nothing. One answer applies at a time. An
answer superseded while waiting never starts, and one superseded while running finishes
without announcing. An older apply never holds a fresh read. Whatever waits has a timer
that ends the wait, and SDK work stuck past the read budget is rebuilt on a new connection when its paced wake fires only if nothing is live either way: nothing published and nothing received. Otherwise it is named, and Retry is the person's choice, because a rebuild drops what works. Read intent decisions stay in
`media-read-intent.ts`, which the model composes.

`model/media-transitions.test-support.ts` states what every event does in every shape of
state, and an event it does not list is rejected. A change there is a change of behaviour.

| Module                                                             | Holds                                      |
| ------------------------------------------------------------------ | ------------------------------------------ |
| `model/media-state.ts`, `media-events.ts`, `media-effects.ts`      | The types                                  |
| `model/reduce-media.ts`, `media-step.ts`                           | The reducer's routing, and what a step is  |
| `model/reduce-reads.ts`, `read-start.ts`                           | Reads: requests, outcomes, the next start  |
| `model/reduce-apply.ts`                                            | Applying one answer at a time              |
| `model/reduce-room.ts`, `reduce-sources.ts`                        | Room reports, and each source              |
| `model/reduce-recovery.ts`, `recovery-pace.ts`                     | Recovery attempts, nudges, Retry, the pace |
| `model/connection-lifecycle.ts`                                    | Joining, releasing and ending              |
| `model/media-status.ts`, `media-publication.ts`, `seat-caption.ts` | Derivations                                |
| `media-runtime.ts`, `adapters/`                                    | The edge                                   |
| `media-session.tsx`, `media-bar.tsx`, `media-stage.tsx`            | The UI                                     |

### Browser effect ownership

| Concern                      | Pure decision / validation                                                                                                                   | Effect owner and lifetime                                                                                                                                                        | Cleanup / caller proof                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical resume             | `rooms/resume.ts` takes the authorized active-Room output, explicit departure and injected time; no storage or navigation                    | Home/lobby `ResumeRound`; target route reauthorizes audience                                                                                                                     | `location.replace` only after eligibility and advisory ownership; actual browser matrix remains the acceptance gate                                                                                                                                                                              |
| Advisory tab claim           | `mayResumeTab` rejects stale or future-dated claims; `resume-ownership.ts` validates stored shape                                            | `createResumeLifetime` owns one subscription and injected heartbeat scheduler; `useResumeLifetime` binds one document identity per actor/Round                                   | Deferred direct routes do not mount media; explicit takeover steps down old media; normal teardown releases only its own claim. Crash freshness expires after five seconds and deferred lifetimes recheck without browser events. `resume-lifetime.test.ts` exercises the shared caller lifetime |
| Media recovery               | `media-failure.ts` classifies answers as transient, definite, ending or refused; the model decides from the kind; error names confer nothing | `reduceMedia` decides the one timer, the connection and its reads; `createMediaRuntime` runs them                                                                                | Every release cancels the timers. `model/reduce-media.test.ts` proves this; browser recovery remains separate proof                                                                                                                                                                              |
| Request deadline             | One request includes both response headers and body                                                                                          | `createMediaRequest` receives network and deadline effects from the media mount                                                                                                  | Ten-second deadline aborts and settles a stall even when an adapter ignores cancellation; parent cancellation and success release the timer/listener. `request-media.test.ts` exercises both stalls                                                                                              |
| Source and playback evidence | SDK errors map to a closed display-only vocabulary; grants, actual publication, mute and peer audibility remain distinct                     | The LiveKit adapter reports source failures and track snapshots, including present-but-muted publications; Round controls consume the media lifetime's actor/Round-scoped output | Producer unmount clears publication; control unsubscribe does not. Track absence cannot establish mute or peer audibility. SDK, stage and control regressions exercise these callers                                                                                                             |
| Local account preferences    | Principal/Room keys for checked-device handoff, principal/Round keys for mute; `rooms/resume-departure.ts` keeps the confirmed departure     | Shell/direct-Round account binding observes account changes; only acknowledged departure suppresses resume                                                                       | Sign-out form cleans on submit while retaining native POST; account switch clears outgoing choices, terminal surface clears ended-Round choices. Browser acceptance must cover failed/unknown/canceled departure and account transitions                                                         |

Every home or lobby entry reads the signed active Room and resumes while the
member stays seated; recovery has no per-tab budget, and `location.replace`
leaves no history entry to loop through. Other shell pages stay usable and offer
Resume. A remote tile reads the room's observed presence and publications: a
peer gone from the room is disconnected, whatever its grant says.

A document identity names each tab, because a cloned sessionStorage would make
two tabs look like one. Pure decisions live in `rooms/resume.ts`; storage adapters
and the effect coordinator consume them directly.

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
