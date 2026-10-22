# Signed internal media worker handoff

`@daisy/media/internal` exports `createMediaWorkerAuthentication({secret,now})`.
The shared `MEDIA_WORKER_SECRET` is injected at server/worker composition; it is
32–64 OS-CSPRNG bytes encoded as canonical unpadded base64url. Never use a cuid2
identifier as this capability, log it, persist it as transcript data or activate
production configuration without the human provisioning gate.

The signer consumes POST, the exact path and the exact UTF-8 JSON body. It returns
`timestamp` (UTC ISO milliseconds) and `signature` (lowercase HMAC-SHA256 hex).
Send them in `x-daisy-media-timestamp` and `x-daisy-media-signature`. The signed
message is method, newline, path, newline, timestamp, newline, raw body. A body
change including whitespace invalidates the signature. The allowed path is
`/api/internal/media/:roundId/capture/:operation`, with operation one of token,
lease, read, append, observe or seal. Query strings and alternate routes are not
signed aliases. The raw body is capped at128KiB before authentication.

Verification allows at most5000ms clock skew in either direction and compares
equal-length signatures in constant time. After signature verification, the JSON
must identify a valid workerId and, if present, the same Round as the route. Body
actorId/serviceId claims are refused. The returned server principal is
`{serviceId: 'media-capture:' + workerId, workerId, roundId}`. The operation then
validates its complete strict payload and verifies fresh durable lease/epoch,
segment/history and cutoff/freeze authority. Signature authenticity alone never
opens a room, authorizes competitive capture or establishes continuous coverage.

A short-window replay is not new competitive authority: every call rechecks the
lease and operation scope. Captured append retries deduplicate by durable clip
identity and conflicting bodies refuse. A retried request receives a new signature
timestamp, never an invented PostgreSQL receipt or capture timestamp. No replay
is permitted to extend a lease epoch, reopen a sealed stream, revive a terminal
Round or bypass pending vendor uncertainty.

Secret and signature are category secret, retained only in process/request memory;
never log headers. Worker/Round/session identifiers are scoped identifiers. Body
transcript text is personal/private under existing capture retention and erasure;
raw bodies and audio never enter logs. This module does not mount an HTTP route
or claim actual capture/provider/browser acceptance. The real web ingress owns
strict request limits, signed-handler composition and durable mutation admission.
