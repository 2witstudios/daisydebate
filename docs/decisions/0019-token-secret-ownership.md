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

## Loggable fields

Amended 2026-09-23 (ISSUE-47). `@daisy/logger` admits fields by allowlist.
A log line carries the base fields (`service`, `appVersion`, `gitCommit`,
`event`), the message, and only the fields named below, each only when its
value has the listed kind. Any other field is left out, and so is a listed
field whose value has another kind. The logger reads each listed name as an
own data property: it runs no getter and walks no nested value, so no
structure can make a log call throw. No kind admits an object, an array,
whitespace or a URL scheme, so a nested secret, a header pair, a Bearer value
or a credential URL cannot pass as any of them. The message must be fixed
prose: letters and light punctuation, no digits, and words of at most 24
characters. Any other message is replaced with `[REDACTED]`.

| Field               | Kind  |
| ------------------- | ----- |
| `operation`         | code  |
| `errorCode`         | code  |
| `source`            | code  |
| `sourceLevel`       | code  |
| `closeReason`       | code  |
| `cause`             | code  |
| `invariantId`       | code  |
| `requestId`         | id    |
| `traceId`           | id    |
| `userId`            | id    |
| `actorId`           | id    |
| `providerMessageId` | id    |
| `route`             | path  |
| `path`              | path  |
| `clientIdHash`      | hash  |
| `durationMs`        | count |
| `status`            | count |
| `port`              | count |
| `deleted`           | count |
| `batches`           | count |
| `closeCode`         | count |

Kinds: **code**, a letter followed by up to 79 letters, digits, `_`, `.` or
`-`; **id**, 1–128 letters, digits, `_` or `-`; **path**, `/` followed by
up to 199 path characters and no query or fragment; **hash**, a 64-character
lowercase hex digest; **count**, a non-negative safe integer.

A kind limits the shape of a value, not where it came from. A caller that put
a credential with an id's shape into `requestId` would log it. Values are
assigned at the call site from request state, codes or digests, never from
configuration, and a new field joins this table only with an ADR amendment.
`redact.test.ts` derives its secret keys from `@daisy/config`'s
`secretConfigKeys`, the fields the configuration schemas mark as secret, and
`scripts/observability-docs-drift-guard.test.ts` fails when this table and
`loggableFields` differ.
