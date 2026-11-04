# 0116: A gate answers the crowd before web

Status: accepted, point guard, 2026-11-04. Amends ADR 0112's page-load consequence.
Plan: [Watch page loads](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/mnatkjy8fd0himmy9fxjm43y).

## Context

ADR 0112 took viewers' polls off web, and a page load still rendered in the one process that
runs debates and read the database. 1,000 page loads a second saturated it, failed a floor pass
and refused seats. `fly.toml`'s connection limit did not protect it, and a rate limit inside web
still costs web's event loop (ISSUE-1306). Fly has no per-address limit. Machine sizes stay and
no always-on machine is added.

## Decision

**nginx stands in front of web, on web's machine.** It is a second process on its own core. It
holds Fly's port, and web moves to loopback. `apps/web/gate/` holds its configuration and start
script.

- **Anonymous Watch is cached.** `/watch` and `/watch/:id` HTML documents are cached for at
  most 5 s. Cold fills are coalesced; expired copies are never served during a slow refresh.
  Refresh misses still pass the paced anonymous lane. The key is the full path and query and
  the whole Cookie header, so a copy reaches only a request asking for the same thing.
  A request holding a session or an audience link, any nonempty query, a client navigation or
  prefetch, and a response with `Set-Cookie` are never cached. Only HTML can populate the
  document cache. A copy is older than the state it could show, so it can be late and never early.
- **Refusal per address.** Each kind of traffic has its own budget: Watch pages, anonymous
  requests, a member's pages, a member's API, machine callers and capture stages. Past it the gate
  answers 429 with `Retry-After`. The address is `Fly-Client-IP` only when the peer is the machine's
  default gateway (DEC-39). Anyone else is known by their own address.
- **One lane for the crowd.** Anonymous traffic that misses the cache shares one budget of 20
  requests a second with a short queue, then 503 with `Retry-After`. That is what bounds a crowd from
  many addresses and any attempt to miss the cache on purpose. A request with a session cookie, a
  worker's call and a stage's load do not wait in it.
- **Failure.** The gate owns a separate process group; a dead master’s surviving workers are
  killed before a replacement starts. A gate that dies restarts without touching web and logs
  `web_gate.restarted`. Five
  deaths in a minute drain web and end the machine unsuccessfully, with `web_gate.gave_up`,
  so Fly restarts it. A normal shutdown drains web before stopping the gate. Supervisor
  events use the shared logger registry, severity and deployment metadata contract, so the
  central log ingester retains them without accepting unregistered fields. Web unreachable
  fails Fly's checks and the alert probe's readiness read, which posts to Incidents. That probe's
  cadence is best effort (ADR 0046).

nginx over a proxy written in Bun: proxying is the whole risk here, including streaming, closed
sockets and slow clients, and refusing in C costs least beside a debate.

## Consequences

- Cache hits do not read the database. A cold fill does; concurrent refresh misses are
  bounded by the anonymous lane, rather than extending an expired page’s access.
- Viewers of one copy share a CSP nonce for up to 5 s. A query string bypasses the cache, so a
  cached page reflects nothing from a request.
- A takedown or a replaced link can leave a cached page up to 5 s old. The state object it reads
  is gone or moved by then, as ADR 0112 says.
- A forged session cookie skips the lane, and only the per-address budget bounds it. IPv6 callers
  are limited per address, not per /64.
- Viewers behind one address, such as a venue, share its budgets. Check them against the event.
- The gate shares the machine with web. A flood that exhausts the machine is outside this.
- `fly.toml`'s concurrency limit now counts requests at the gate, so it is raised.
