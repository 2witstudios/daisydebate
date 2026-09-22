# 0031: Realtime service

Status: accepted. Uses the extraction seam of [ADR 0003](0003-modular-monolith.md);
builds on [ADR 0012](0012-native-bun-infrastructure.md). The delivery path
(outbox, cursors, drain) is the outbox ADR's (0032) and presence and
attendance are the presence ADR's (0033); this record fixes only the service
and its socket protocol.

## Context

Daisy needs live play: phase and turn changes pushed to debaters and
spectators, presence, and later chat, notifications, standings and video.
Today there is no transport. PageSpace, which we studied, runs a separate
socket.io service that grew into a PTY bridge, voice host and preview proxy,
checked auth only at the handshake, and let socket.io's silent drop of
unknown events force a "deploy realtime first" rule.

ADR 0003 ships one deployable application but designs extraction seams so
that "a future realtime or matchmaking service is a new deployment of
existing contracts, not a rewrite". Correctness in this epic does not live
in the socket: clients send every command over HTTP to `apps/web`, the
transactional outbox is the delivery log, and clients recover from their own
cursors. The socket is a doorbell channel that may drop at any time.

## Decision

### 1. Scope: a second deployment with four jobs

`apps/realtime` is a second deployment in this monorepo, built from the
existing contracts (ADR 0003's seam). Its scope is exactly:

1. authenticate sockets;
2. authorize subscriptions;
3. fan out outbox rows to subscribed sockets;
4. social presence (advisory Redis leases, ADR 0033).

Excluded, as decisions:

- **No domain logic.** It never imports `@daisy/debate-engine`, never
  decides a competitive outcome, and never writes competitive state. Its
  PostgreSQL role is SELECT-only except for its own `service_instances`
  lease row.
- **No video or media.** Media never passes through this WebSocket; video
  is a separate LiveKit service with its own ADR (VIDEO-1).
- **No jobs.** Email, web push, sweeps and adjudication run elsewhere
  (`apps/web` maintenance or a job queue with its own ADR).
- **Nothing else.** A new responsibility (a proxy, a bridge, a worker) goes
  to another service; adding one here requires superseding this ADR.

### 2. Transport: native `Bun.serve` WebSocket

The transport is Bun's native WebSocket on `Bun.serve` (uWebSockets). No
socket.io, no Engine.IO, and no client library: the browser uses its native
`WebSocket`. No dependency is added, so `docs/dependencies.md` is unchanged.

#### Spike (2026-09-22)

A throwaway spike (kept outside the repository, per the task) exercised both
candidates on Bun 1.4.2, macOS arm64 (Apple M1 Max), against
version-matched sources: the `bun-types@1.4.2` package that the repository
installs (`docs/runtime/http/websockets.mdx`, `serve.d.ts`), and the
installed `@socket.io/bun-engine@0.1.2` README and source with
`socket.io@4.8.3` / `socket.io-client@4.8.3`. The spike used placeholder
application codes (4401, 4408) and a shortened 300 ms `hello` timer; the
normative values are in sections 7 and 10.

| Question                                   | Native `Bun.serve` (measured)                                                                                                                                                  | socket.io + `@socket.io/bun-engine` 0.1.2 (measured)                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topics                                     | `ws.subscribe`, `server.publish`, `subscriberCount`: 2 of 3 sockets subscribed, only those 2 received the row                                                                  | Rooms work, fanned out in JavaScript by the adapter                                                                                                                         |
| Fan-out, 200 subscribers × 2,000 doorbells | 400,000 delivered in 190 ms                                                                                                                                                    | 400,000 delivered in 3,356 ms (about 17× slower)                                                                                                                            |
| Slow consumer (reader paused)              | Without `closeOnBackpressureLimit`, `server.publish` returned 0 (dropped) for 361 of 400 publishes while the socket stayed subscribed. With it, the socket closed (1006)       | 944 of 2,000 room emits silently lost; the socket stayed connected and kept receiving afterwards. The engine ignores `send()`'s status, and exposes no backpressure setting |
| App-coded close under backpressure         | `ws.close(4408, …)` when `getBufferedAmount()` exceeded 256 KiB: the client received 4408 and the reason after resuming                                                        | Server disconnect reaches the client only as the string `"io server disconnect"`; no application close codes                                                                |
| Transports                                 | WebSocket only                                                                                                                                                                 | `GET /socket.io/?EIO=4&transport=polling` answered 200 with a session id: long-polling is hardcoded (`TRANSPORTS = ["polling", "websocket"]`) with no option to disable it  |
| `maxPayloadLength`                         | Oversize inbound message closes the socket; the client saw 1006, not the 1009 the `close()` docs list                                                                          | `maxHttpBufferSize`, same underlying limit                                                                                                                                  |
| `idleTimeout`                              | With `sendPings: false`, a silent socket closed at 7,998 ms (`idleTimeout: 8`) and 32,004 ms (`32`). Values round up to 4 s (`10` closed at 12,000 ms; `1` never fired in 6 s) | Sets the HTTP `idleTimeout`, not the WebSocket one                                                                                                                          |
| `sendPings`                                | With `sendPings: true` a reader-paused peer (zero pongs) stayed open for 25 s at `idleTimeout: 8`: server pings do not reap a peer that stops reading                          | Engine.IO's own 25 s ping / 20 s timeout                                                                                                                                    |
| Per-message compression                    | `perMessageDeflate: true` negotiated `permessage-deflate; server_no_context_takeover; client_no_context_takeover`                                                              | Not configurable through the engine                                                                                                                                         |
| Client cost                                | 0 bytes (native `WebSocket`)                                                                                                                                                   | `socket.io-client` minified 49,812 B, 15,759 B gzipped                                                                                                                      |
| Maturity                                   | Part of the pinned runtime (ADR 0001)                                                                                                                                          | Pre-1.0 engine (0.1.2)                                                                                                                                                      |

socket.io showed no capability Daisy requires that the native path lacks:
its reconnection, acks, adapters and fallback transports are either owned by
this design (cursors, request ids, the outbox) or forbidden by it (polling).
It showed a concrete defect for Daisy: silent loss to a slow consumer that
stays connected. **Native is selected.**

### 3. WebSocket only, never long-polling

Long-polling spreads one logical connection over many HTTP requests that
must reach the same instance, which needs sticky sessions.
`docs/operations/production.md` says sticky sessions are "not part of any
design", so realtime accepts only WebSocket upgrades on one path and answers
every other request to that path with 400. Polling would also spend the
browser's six-connections-per-host budget. A client that cannot open a
WebSocket still plays: every command and every read is HTTP, and deadlines
never depend on the socket (ADR 0033).

### 4. Commands go over HTTP; the socket accepts five messages

Every client command (check-in, ready, chat send, reactions) goes over HTTP
to `apps/web`, which keeps its idempotency (`debate_commands`), validation
and rate limits. The socket accepts exactly these client messages, and
nothing else:

| `type`              | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `hello`             | first message: `{protocolVersion, ticket}`                     |
| `subscribe`         | `{id, topic, since?}`: join a topic, catching up from a cursor |
| `unsubscribe`       | `{id, topic}`: leave a topic                                   |
| `presence.activity` | `{activity: 'active' \| 'idle'}` for this connection's lease   |
| `ping`              | `{id}`: application heartbeat                                  |

### 5. The envelope

Every message in both directions is a JSON text frame
`{v, type, id?, ...fields}`:

- `v` is the envelope version, the integer `1`. `hello.protocolVersion`
  negotiates the protocol; an unsupported one closes with
  `protocol_unsupported`.
- `type` is the discriminant. `@daisy/protocol` owns one zod discriminated
  union for client messages and one for server messages, and the close-code
  table; TypeScript types are inferred from the schemas.
- `id` is a client-chosen request id, present on requests that expect a
  reply (`subscribe`, `unsubscribe`, `ping`). The server answers with the
  same `id`: `subscribed`, `unsubscribed`, `resync_required` or `error` for
  subscriptions, `pong` for `ping`. Server-initiated messages (`ready`
  after `hello`, `event`, `revoked`, `server.restarting`) carry no `id`.
- The receiving side always runs `safeParse`, server and client. An inbound
  message that fails to parse, or any message before a successful `hello`,
  is rejected loudly by closing the socket; nothing is silently dropped.
- Frames are text, not binary. Inbound frames are capped by
  `maxPayloadLength: 4096` bytes (a `hello` with its ticket is under 300);
  Bun closes an oversize frame abruptly (measured: 1006).

### 6. Heartbeat: application `ping` every 15 s

Browsers cannot send WebSocket ping frames, so liveness is an application
message:

- The client sends `ping` every 15 s and expects `pong` with the same `id`.
  After two missed pongs (30 s) it treats the socket as dead, closes it and
  reconnects with its cursors.
- The server sets `sendPings: false` and `idleTimeout: 32` seconds. Any
  inbound message resets the idle timer, so a live client's `ping` keeps it
  open and a half-open or non-reading peer is reaped after 32 s. The spike
  showed why server pings are not the mechanism: with `sendPings: true`, a
  peer that stopped reading stayed open indefinitely. 32 is the smallest
  multiple of 4 s (the measured rounding) that exceeds two heartbeats.
- The heartbeat period feeds the attendance invariant
  `checkInGraceMs >= heartbeatMs * 2 + reconnectBudgetMs` (ADR 0033); a
  change to 15 s is a change to that invariant.

### 7. Close codes

`@daisy/protocol` owns the close-code table, in the 4000–4999 application
range. The client reacts per code:

| Code | Name                   | Server closes when                                                                                    | Client reaction                                                                                               |
| ---- | ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 4001 | `auth_failed`          | no `hello` within 5 s; bad, expired, replayed or origin-mismatched ticket; any message before `hello` | fetch a fresh ticket and reconnect with backoff; after 3 consecutive failures, stop and show signed-out state |
| 4002 | `revoked`              | `session.revoked`, or the 60 s revalidation finds the session gone                                    | do not reconnect; refetch the session over HTTP                                                               |
| 4003 | `protocol_unsupported` | `hello.protocolVersion` unsupported, or an inbound message fails to parse                             | do not reconnect; ask the user to reload                                                                      |
| 4004 | `rate_limited`         | connection or inbound-message rate limit exceeded                                                     | reconnect with jittered backoff from a 30 s floor                                                             |
| 4005 | `slow_consumer`        | the socket's send buffer passed the soft bound (section 8)                                            | reconnect with jitter and resubscribe from cursors                                                            |
| 4006 | `server_restarting`    | SIGTERM drain                                                                                         | reconnect with 0–5 s jitter (another instance takes it)                                                       |

Transport-level closes the client also handles: `1000` (normal) and `1001`
(going away) reconnect only if still wanted; `1006` (abnormal: network loss,
Bun's hard backpressure limit, an oversize frame, `idleTimeout`) reconnects
with jittered exponential backoff and no lifetime ceiling on clean
reconnects. An unknown code is treated as `1006`.

### 8. Slow-consumer policy

Correctness never depends on the socket, so the server never buffers without
bound; it closes and lets the client catch up from its cursor. Measured
basis: `server.publish` returns one status for all subscribers and drops for
a backpressured one without closing it, so a silent gap is possible unless
the server closes.

- **Hard bound (backstop):** `backpressureLimit: 1 MiB` with
  `closeOnBackpressureLimit: true`. Bun closes the socket (the client sees 1006) instead of dropping while subscribed. This is what guarantees no
  silent gap.
- **Soft bound (coded close):** after each drain batch fans out, and after
  every direct `send`, the server checks `getBufferedAmount()` of the
  affected sockets and closes any above 256 KiB with `4005 slow_consumer`.
  A direct `send` returning `0` (dropped) also closes with 4005.
- Doorbells are about 100 bytes, so 256 KiB is thousands of undelivered
  rows: a socket that far behind is cheaper to resync than to feed.

### 9. Compression off

`perMessageDeflate` is disabled. Payloads are ~100-byte doorbells, so
compression costs per-socket CPU and memory for no gain, and compressing
owner-only deltas next to attacker-influenced bytes invites a
CRIME/BREACH-style length oracle. Revisit only with a topic whose frames
exceed 1 KiB, in a superseding ADR.

### 10. First-message tickets

A socket is authenticated by a single-use ticket sent in its first message,
never in the URL (browsers cannot set headers on a WebSocket, and a query
string lands in proxy and access logs):

1. `apps/web` issues it from `POST /api/realtime/ticket` for the caller's
   verified session. The route is same-origin and rate-limited.
2. The ticket is 32 bytes from the OS CSPRNG (`crypto.getRandomValues`),
   base64url-encoded. It is a bearer secret, so it is never a cuid2.
3. Only its SHA3-256 hash is stored, in Redis under a namespaced
   `ticket` key with a 60 s TTL, bound to `{actorId, sessionId, origin}`.
   The plaintext exists only in the HTTP response and the `hello` frame.
4. The upgrade checks `Origin` against a fail-closed allowlist and the
   per-IP rate limit, caps unauthenticated sockets per IP, and accepts the
   socket **unauthenticated**.
5. The first message must be `hello {protocolVersion, ticket}` within 5 s.
   The server hashes the ticket and consumes it atomically with a new
   `@daisy/redis` GETDEL operation, so a replay finds nothing. The binding's
   `origin` must equal the upgrade's `Origin`, and the session must still be
   valid. Any failure, or the 5 s timer, closes with `4001 auth_failed`
   (spike: a silent socket closed at 313 ms against a 300 ms timer, and a
   pre-`hello` `subscribe` closed with the app code).
6. Until `hello` succeeds, the socket can do nothing else. The session is
   revalidated every 60 s and on `session.revoked`, and subscriptions are
   re-authorized in batch every 60 s.

Tickets, raw frames and payloads are never logged; logs carry event names,
connection and actor ids, and close codes (ADR 0019).

### 11. Allowed edges

`apps/realtime` may depend on exactly:

| Workspace              | For                                                                            |
| ---------------------- | ------------------------------------------------------------------------------ |
| `@daisy/protocol`      | envelope, message and outbox schemas, close codes, topic grammar               |
| `@daisy/auth`          | principals and session-to-identity resolution                                  |
| `@daisy/db`            | SELECT on the outbox and authorization read models; `service_instances` writes |
| `@daisy/redis`         | ticket GETDEL, presence leases, rate limits                                    |
| `@daisy/clock`         | injected time (ambient `Date` is banned)                                       |
| `@daisy/config`        | validated environment                                                          |
| `@daisy/errors`        | error codes and public mapping                                                 |
| `@daisy/logger`        | structured, redacted logs                                                      |
| `@daisy/observability` | spans, correlation, bounded health checks                                      |

It never depends on `@daisy/debate-engine`, `apps/web` or a third-party
socket library. The package-map row in `docs/architecture/overview.md`
states the same list. `scripts/check-boundaries.ts` restricts workspaces
listed in `allowedWorkspaceDependencies` (`scripts/boundaries-rules.ts`);
the change that creates `apps/realtime` adds a `realtime` entry with exactly
these nine names, so the row is mechanically enforced rather than advisory.
The `@daisy/db` restriction to SELECT plus `service_instances` is enforced by
the realtime PostgreSQL role, not by the import graph.

## Consequences

- We own four small protocol pieces instead of a library: the envelope, the
  heartbeat, the close codes and the slow-consumer policy. Each is a schema
  or a constant in `@daisy/protocol` and is covered by the realtime
  integration runner (a real `Bun.serve` with a real WebSocket client).
- There is no fallback transport. A network that blocks WebSocket gets no
  live updates but loses nothing competitive, because commands, reads and
  check-ins are HTTP.
- Multi-instance fan-out needs no adapter and no Redis pub/sub: each
  instance drains the outbox itself (ADR 0032).
- A second deployable needs a deploy target, routing and secrets; that is a
  human-only decision (RT-H) and `docs/operations/production.md` is updated
  when it is made. Realtime exposes its own `/health/live` and
  `/health/ready` (ready checks PostgreSQL, LISTEN and Redis) and drains on
  SIGTERM with `4006 server_restarting`.
- The browser needs no client dependency; the connection store lives in
  `apps/web/src/features/realtime/`.

### Recorded conflicts

- **ADR 0003, "one deployable application".** This ADR adds a second
  deployment. ADR 0003 names a realtime service as the intended use of its
  seams, so this record relies on that sentence rather than overriding it;
  the amendment to ADR 0003's text is the outbox ADR's (0032), not this
  one's.
- **Process-local state.** `docs/architecture/overview.md` ("State and
  runtime semantics") and `docs/operations/production.md` ("stateless
  except pools/logger/draining") describe `apps/web`. Realtime also holds
  open sockets, their subscriptions, the drain cursor and a small ring of
  recently fanned-out rows in process memory. All of it is rebuilt on
  restart (clients reconnect with their cursors; the instance cursor starts
  at the high-water mark), so no coordination state is process-only, but
  those documents' wording is not amended here: this change owns only the
  package-map row, and the wording change is reported to the orchestrator.
- **Plan, section A.** The plan lists four socket messages and says server
  `idleTimeout` and `sendPings` reap half-open sockets. The accepted
  criteria list five messages (with `ping`), and the spike showed server
  pings do not reap a non-reading peer; this ADR follows the criteria and
  the measurement (`sendPings: false`, `idleTimeout: 32`).
