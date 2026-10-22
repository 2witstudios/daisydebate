# Durable media vendor reconciliation

`media_sessions` retains separate reconciliation epoch and request, running and
served integer versions. Request versions, rather than timestamp ordering,
distinguish callers within one PostgreSQL millisecond. A claim snapshots the
request version into running; completion serves that snapshot. A later request
remains unserved. All versions and the lease epoch are nondecreasing; served is
at most running, which is at most requested. Owner and lease deadline are paired.
The adapter must serialize claims and writes under the session lock, fence the
owner/epoch, and schedule a further run for unserved requests.

`media_vendor_mutations` persists intent before vendor I/O. Create/delete carry
no identity and an empty payload; permissions/remove carry an opaque competitive
seat identity. Permissions contain only unique camera/microphone publish sources,
subscribe and hidden booleans, and capture=false. Other mutations have empty
payloads. Capture-agent authorization is a separate server scope.

Intent is immutable. Settlement records one known succeeded/failed outcome with
its PostgreSQL timestamp. Unknown operations remain pending across crashes without
an expiry that invents success or failure. Pending intent cannot be directly
deleted while its session exists. Owning Round/session erasure cascades normally.
Unsafe state cannot be cleared while pending intent exists. Clearing it after
settlement additionally requires actual verified vendor cleanup in the adapter;
the database does not claim that verification from a timestamp or a failed call.
Token/open admission must refuse unsafe or pending sessions independently.

Cleanup first calls `prepareMediaAbsenceProof` under the current session owner
and epoch. It returns no proof while any intent is pending. Otherwise it records
the settled immutable-intent count with that fence. Only after that transaction
commits may the provider absence observation run. `finishMediaReconcile` accepts
the proof only if its session, owner, epoch and mutation count still match and
no intent is pending. An absence observed before a late creation settles cannot
be reused after settlement; another run must clean up and observe absence anew.
These proof fields are transient witnesses, not stored credentials or new
columns. Provider I/O remains outside every database transaction.

These fields contain no personal transcript or credentials. Timestamps, counters,
kind, outcome and strict permission payload have privacy category none. Session,
mutation, owner and opaque participant identity are category identifier, scoped
to the owning Round and vendor room. Retain this competitive operational metadata
with the Round; erase through owning Round/session deletion. No tokens, API keys,
raw vendor response or provider credentials are stored. Production activation and
existing privacy/legal human gates are unchanged.

The schema producer is separate from browser, provider and background-worker
implementation acceptance. Actual room creation/permission/cleanup and concurrent
recovery must be proven by their consuming operations.

The internal capture broker consumes
`db.createMediaCaptureOperations({nextId,buildProjection}).verifyMediaWorkerLease`
with `{roundId,sessionId,workerId,epoch}` after authenticating its server worker.
Those identifiers are scoped witnesses, never bearer credentials. Verification
uses the existing bounded transaction, shared locked engine advancement and exact
lease row. It refuses missing/stale/expired leases, terminal Rounds, ended/unsafe
sessions and pending vendor operations. It returns that scope, `expiresAt`, and
fresh post-lock `serverNow` (ISO milliseconds, calibration precision 1ms).
Monotonic send/receive brackets must surround the actual call when using the
stamp for native calibration. The broker additionally enforces the actual media
window and hidden capture-only permissions. Verification is not browser access,
room creation, competitive speaking authority or vendor cleanup proof.

`readMediaCaptureState` on that same rooted capture factory is an internal signed
worker read, not a public Round read. It advances the shared locked engine and
verifies the exact live capture lease in the same bounded transaction. Default
selection returns only a currently open competitive segment; no open segment
returns null and no intervals, so conversation cannot be queued for later
capture. An explicit scoped segmentId reads closed historical grants for valid
late flushing before cutoff/freeze. Only debater seat IDs, actor kind and opaque
media identity are returned; judge bindings and actor/account IDs are excluded.

History pages contain at most512 actual rows and a nextIntervalId cursor. Every
continuation requires the explicit segmentId and first page's expectedVersion;
a changed version refuses the page. The worker restarts that snapshot on conflict
and marks uncertain or missing observations as gaps. It must read all pages;
there is no silent history truncation or assumption that only one floor change
occurred between polls. Fresh serverNow remains a bracketed calibration sample,
not permission or an exact frame timestamp.
