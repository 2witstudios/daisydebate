# 0019: token and secret ownership

Status: accepted.

Better Auth owns its session, verification, and credential token persistence
through its adapter. Daisy application code owns only application secrets and
opaque integration configuration at the composition boundary. Neither side
logs token values, secrets, cookies, authorization headers, raw request bodies,
or raw exception objects. Structured logs may include event names, request IDs,
principal IDs, and stable error codes.

Acceptance criteria:

- Given an auth token or secret, should be stored only by its owning adapter and
  never emitted in logs.
- Given an auth failure, should expose a stable public error while preserving
  the internal cause for diagnostics without logging the raw cause.
