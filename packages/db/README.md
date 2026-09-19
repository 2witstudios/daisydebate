# @daisy/db

Owner: Platform/data (see CODEOWNERS scaffold).

Typed persistence operations, migrations, bounded PostgreSQL connections. Public API: createDatabase, Database, NewDebate, DebateRecord. Depends only on Drizzle and Bun. Application code passes portable values; tables and drivers are private. See docs/architecture/persistence.md and docs/operations/database.md.

Run `bun run typecheck` and `bun test src` from this package. Integration-enabled packages expose `bun run test:integration`; tests require explicit test infrastructure variables. All imports use the public package export.
