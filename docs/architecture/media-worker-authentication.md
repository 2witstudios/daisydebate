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

The web feature `features/media-capture/composition.ts` composes
`composeMediaCaptureRoutes(app).handle(request)` from the injected application
clock, optional secret, existing database pool and actual media token broker.
The handler bounds the raw stream and rejects invalid UTF-8, authenticates the
exact request including any query string, then dispatches strict capture inputs.
Lease/read/append/observe/seal use the rooted capture operations; token uses the
broker's fresh lease checks around actual provider existence. The shared router
must mount this feature separately; adding the factory does not activate it.

A real Bun HTTP/PostgreSQL/LiveKit integration proves lease-less token refusal,
body tampering refusal before lease creation, scoped snapshot reads and hidden
receive-only credentials, and rejects body principal or foreign Round claims.
This boundary proof does not establish native clock eligibility, actual audio
transcription, worker recovery, coverage completeness or production provisioning.

A capture lease takeover cannot recover the previous process's in-memory PCM or
queued transcription intent. A complete seal therefore additionally requires
that every retained coverage observation and captured transcript chunk belongs
to the sealing epoch. Old-epoch evidence keeps the stream partial even when its
outer temporal union and the supplied expected chunk count appear complete.
This provenance fence preserves the existing continuous-coverage predicate and
genuine current-epoch complete-silence storage proof. It does not heal gaps or
claim that a native producer covered whole-grant edges.
