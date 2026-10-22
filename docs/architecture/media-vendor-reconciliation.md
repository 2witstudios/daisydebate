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
