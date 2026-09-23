# @daisy/db

Owner: Platform/data (see CODEOWNERS scaffold).

Typed persistence operations, migrations, bounded PostgreSQL connections. Public API: createDatabase, Database, NewDebate, DebateRecord, FormatRecord, DebateMode, DebateVisibility, DebateOutcome. Depends on Drizzle 1.0 (ADR 0038), Bun, `@daisy/protocol` (role and phase vocabularies and every jsonb column's schema; ADR 0029) and `@daisy/errors` (the typed `VALIDATION` error a mis-shaped jsonb write fails with). The `./slots` export is local slot tooling (databases, resets, `provisionTestRoles`), never imported on the request path. Application code passes portable values; tables and drivers are private. See docs/architecture/persistence.md and docs/operations/database.md.

Run `bun run typecheck` and `bun test src` from this package. Integration-enabled packages expose `bun run test:integration`; tests require explicit test infrastructure variables. All imports use the public package export.
