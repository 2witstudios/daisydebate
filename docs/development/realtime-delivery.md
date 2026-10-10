# Generic realtime delivery

`apps/realtime` consumes single-use Redis tickets and resolves their durable
session and actor binding through `@daisy/db`. A successful hello identifies a
current principal; it does not grant subscriptions. Each subscription consults
the canonical `@daisy/auth/authorization` evaluator with current database facts.
Room and Round use their minimal authorization projections. Channels use the
same-transaction messaging authority fence and minimal account-age facts.
Own-inbox subscriptions use the canonical collection capability.

HTTP owns commands and authoritative reads. WebSocket events are validated thin
invalidation signals. Room and channel change versions, Round entity versions
and outbox positions are history markers, never authorization revisions or grants.
The browser store owns connection, subscription reference counts and reconnect;
feature listeners refetch their protected HTTP views. The server applies the
canonical topic/payload delivery predicate, excluding stored control rows from
event delivery. Control rows still invalidate or revoke relevant subscriptions.

An authorization result includes its revision fingerprint and deadline. The
server clamps that deadline to the durable session expiry, account-age evidence
expiry and the accepted 60-second check-start bound in ADR 0031. Every asynchronous
allow is checked against current time and the connection/subscription generation
before attachment or publication. Erasure, revoked sessions, replacement,
unsubscribe and invalidation fence late results. The 50-second scheduling and
five-second operation budgets are implementation scheduling within the accepted
bound, not additional product policy or permission leases. Periodic session and
topic checks run concurrently so one stalled recipient cannot starve later ones.

Reconnect replay always consults the existing database pool. Catchup rows and
the durable deletion boundary are read in one snapshot. Prefix retention deletes
and advances that boundary atomically; locked predecessors refuse deletion.
Uncertifiable history, an advanced boundary, finality/ring loss or movement during
the final awaited fence requires resynchronization. A retained ring alone cannot
certify completeness. Reauthorization precedes replay and attachment.

Typing changes use a separate lossy hint on the same database pool's
`daisy_realtime_hints` listener. Its strict frame is
`{v:1,type:"typing_changed",topic:"channel:<id>"}`; it has no payload, position
or replay entry. Each attached recipient is freshly authorized before native
publication, with the same deadline and generation fences as durable delivery.
The hint check observes that generation without replacing or extending the
durable lease. A hint resolving while durable authorization remains pending is
dropped; it cannot cancel delivery of the durable row.
Concurrent hints for one topic coalesce, and a failing recipient cannot stop
other recipients. The generic browser listener forwards only subscribed topics
without advancing their durable cursors. Messaging owns aggregate transitions,
protected HTTP reads and approved expiry/refresh inputs. Listener reconnection
does not synthesize a change; bounded HTTP refresh handles lost hints and natural
lease expiry. Startup awaits both listeners, and shutdown releases both.

The optional public WebSocket endpoint is configured explicitly; absence leaves
ticket issuance unavailable. Browser ticket responses must bind to that exact
endpoint. Origin admission and trusted-peer resolution are separate server
checks. Canonical browser validation uses Zod's explicit jitless parsing without
relaxing CSP. Logs and diagnostics expose fixed phase/error classifications,
never ticket contents, cookies or raw exceptions.

## Verification

`bun test:integration` discovers the realtime service suites through the canonical
integration runner and uses isolated migrated databases and Redis namespaces.
The socket-authority fixture injects a real canonical database adapter bound to
`daisy_realtime`, verifies its role, and uses the fixture connection only for
setup/cleanup. The paused-reader fixture pauses an actual TCP client and measures
native buffered bytes; it also checks healthy delivery and durable reconnect.
These tests do not substitute an authorization evaluator or sink.

The registered native browser job runs Room, generic realtime and messaging
profiles in sequence. The generic profile uses its dedicated TLS process and
explicit canonical test-only messaging reading evidence, retains traces, and
keeps all commands on HTTP. The production policy remains independently gated.
A configured default-profile invalid-ticket control uses a syntactically valid,
unissued ticket to exercise actual consumption refusal and browser retry policy.

Before artifact upload, the sanitizer parses JSON/JSONL records, redacts decoded
string leaves and sensitive header objects, and reserializes nested records.
Plaintext uses the existing header, key and query redactions. Archive traversal
and replacement remain unchanged. Already truncated predecessor records cannot
be reconstructed. Current candidate results, failures and independent review
coverage belong in the task delivery record; these test entry points do not
assert that a particular candidate has passed whole acceptance.
