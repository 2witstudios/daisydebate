# Debate runtime boundary

Owner: domain engineers. Public API: `@daisy/debate-engine`; internal ECS adapter is never imported by applications. The foundation format is an architectural proof, not a supported competition format.

Each runtime owns one isolated Adobe database. Participant entities carry participant identity, competitive side, and readiness components; phase is a database resource. The debate ID, resolution, and creation timestamp are immutable runtime identity. Joining, readiness, and phase changes run synchronous ECS transactions; all business preconditions are checked before mutation. Queries return detached plain data, sorted by participant ID. Consumers cannot mutate the live store.

Legal lifecycle: waiting → active → completed. Starting requires both distinct sides and both participants ready. Duplicate identities, conflicting sides, readiness before joining, and backward transitions fail without state changes. Callers provide UUIDs and UTC timestamps. No ambient clock, network, timers, React, or persistence adapter exists here.

Snapshots use the portable version-1 protocol representation. Restore validates both shape and invariants before constructing a fresh ECS database. Adobe's internal storage snapshots are intentionally not the persistence format. This avoids coupling persisted records to pre-1.0 vendor storage changes. `dispose()` resets storage and prevents reuse; there are no background systems to stop today. New systems must remain deterministic, accept explicit time input, and declare scheduling order. Async I/O belongs outside transactions.

Runtime state is process-local scratch state only. Durable operations must load authoritative PostgreSQL state, execute a domain operation, and persist within an application-controlled transaction/concurrency policy. Never treat this runtime as a distributed session or durable record.

Run `bun test packages/debate-engine/src`. Contract tests exercise actual Adobe storage, transactions, isolation, failed-operation atomicity, lifecycle, and JSON round trips without Next.js.
