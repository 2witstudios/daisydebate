# @daisy/redis

Owner: Platform/infrastructure (see CODEOWNERS scaffold).

Ephemeral storage with mandatory TTL, versioned namespaces, health and cleanup. Public API: createRedis, redisKey, RedisConfig, and the presence operations (upsertPresenceLease, refreshPresenceLease, deletePresenceLease, readActorConnections, readOnlinePresence, sweepOnlinePresence). Depends on Bun and `@daisy/protocol` (presence and id validation only, ADR 0033's 2026-09-23 amendment). Never store the only copy of competitive records. Cluster/Sentinel and pub/sub are outside the supported adapter contract.

Presence Lua scripts assume a single-node Redis (ADR 0008): a connection-hash key name is built inside `readActorConnections`'s script from a validated prefix plus the zset's own connId members, rather than declared through `KEYS`, which is only required for Redis Cluster's client-side slot routing. Every script is `SCRIPT LOAD`ed once and run by `EVALSHA`, reloading and retrying once on `NOSCRIPT`. `readOnlinePresence` takes a mandatory `limit` and never mutates state (`online` is a single global key); `sweepOnlinePresence(limit)` does the bounded trimming instead, on its own schedule. See ADR 0033's amendment for the full rationale.

Run `bun run typecheck` and `bun test src` from this package. Integration-enabled packages expose `bun run test:integration`; tests require explicit test infrastructure variables. All imports use the public package export.
