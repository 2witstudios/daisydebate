# ADR 0008: Redis as expendable coordination infrastructure

Status: accepted.

Redis holds only ephemeral or reconstructible state: presence, matchmaking
queues, rate-limit counters, ephemeral room state, caches. Expiry is
mandatory and set atomically with the value. Nothing that must survive a
cache loss lives here; if a Redis outage would corrupt competitive records,
that data is in the wrong place.

We use Bun's native `RedisClient` rather than adding `redis`/`ioredis`: our
current needs are namespaced GET/SET-EX/DEL/PING, the native client covers
them, and one fewer client removes a dependency lifecycle. Offline queue is
disabled so failures surface immediately instead of silently buffering.
Keys are `<namespace>:v1:<validated-segment>`; deployments isolate through
namespace plus credentials.

Constraints documented up front: no Sentinel/Cluster support in the native
client, pub/sub is upstream-experimental. If we need distributed pub/sub or a
cluster, that is a new ADR with a possibly different driver.
