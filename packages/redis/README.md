# @daisy/redis

Owner: Platform/infrastructure (see CODEOWNERS scaffold).

Ephemeral storage with mandatory TTL, versioned namespaces, health and cleanup. Public API: createRedis, redisKey, RedisConfig. Depends only on Bun. Never store the only copy of competitive records. Cluster/Sentinel and pub/sub are outside the supported adapter contract.

Run `bun run typecheck` and `bun test src` from this package. Integration-enabled packages expose `bun run test:integration`; tests require explicit test infrastructure variables. All imports use the public package export.
