# ADR 0005: Framework-independent debate engine

Status: accepted. Amended by [ADR 0018](0018-cuid2-identifiers.md) and
[ADR 0023](0023-greenfield-baseline.md): marshalled identifiers are cuid2, not
UUIDs; the text below states the current rule.

The debate domain lives in `@daisy/debate-engine`: no Next, React, Bun APIs,
Drizzle, Redis, HTTP, or ambient clocks. Operations are synchronous and
deterministic; IDs and timestamps arrive as arguments; snapshots are portable
JSON defined by `@daisy/protocol`.

Why: the domain is the part of the product most likely to outlive any
framework, to be extracted into a realtime service, and to be exercised by AI
systems that must not boot a web server to reason about a debate.
Determinism also makes invariants testable in milliseconds without
infrastructure.

Tradeoffs: application code must marshal inputs (cuid2 ids, ISO timestamps,
validated snapshots) across the boundary, and mutable state lives inside the
engine runtime rather than in database rows. Durable flows follow the
load → operate → persist pattern with optimistic version checks; the engine
never talks to the database itself.
