import type { RedisClient } from 'bun';

export type PresenceActivity = 'active' | 'idle';
export type PresenceLease = {
  readonly connId: string;
  readonly actorId: string;
  readonly instanceId: string;
};
export type PresenceConnection = {
  readonly connId: string;
  readonly actorId: string;
  readonly activity: PresenceActivity;
  readonly instanceId: string;
  readonly expiresAtMs: number;
};
export type PresenceOnlineActor = {
  readonly actorId: string;
  readonly expiresAtMs: number;
};

/**
 * Every script reads `now` from Redis TIME rather than an argument: scores,
 * trims and the key TTLs below all come from the one server clock, so no
 * instance clock is ever compared with another (ADR 0033 §1.1).
 */
const nowFromTime = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`;
/**
 * Sets (or extends) KEYS[2]/KEYS[3]'s own expiry to cover the longest live
 * lease scored into them: NX arms it the first time a key is created, GT
 * only ever extends it, so it tracks the longest lease ever seen and never
 * shortens under a later, shorter-lived write. Requires `top` (a
 * ZREVRANGE ... WITHSCORES result) and `now` in scope.
 */
const armZsetExpiry = `
local function arm(key, top, now)
  if top[2] then
    local ttl = tonumber(top[2]) - now
    if ttl < 1 then ttl = 1 end
    redis.call('PEXPIRE', key, ttl, 'NX')
    redis.call('PEXPIRE', key, ttl, 'GT')
  end
end
`;
/**
 * Sets the connection hash with its own TTL, scores the connId into the
 * actor's zset by expiry, then rescores the actor into the online zset by
 * its live connections' latest expiry. One EVAL, so a concurrent reader
 * never observes the hash without its zset entries or vice versa. The
 * actor and online zsets each get their own expiry covering the longest
 * live lease, so neither key can outlive every lease scored into it.
 * KEYS[1] conn hash; KEYS[2] actor zset; KEYS[3] online zset.
 * ARGV[1] actorId; ARGV[2] activity; ARGV[3] instanceId; ARGV[4] ttlMs;
 * ARGV[5] connId.
 */
const upsertPresenceLeaseScript = `
${nowFromTime}
${armZsetExpiry}
local expiresAt = now + tonumber(ARGV[4])
redis.call('HSET', KEYS[1], 'actorId', ARGV[1], 'activity', ARGV[2], 'instanceId', ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('ZADD', KEYS[2], expiresAt, ARGV[5])
local top = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
arm(KEYS[2], top, now)
if top[2] then
  redis.call('ZADD', KEYS[3], top[2], ARGV[1])
  arm(KEYS[3], top, now)
end
return 1
`;
/**
 * Extends the connection's TTL and rescores it, but only if the lease is
 * still live: a lease whose hash already expired must be re-upserted, not
 * silently resurrected by refresh. KEYS[1] conn hash; KEYS[2] actor zset;
 * KEYS[3] online zset. ARGV[1] ttlMs; ARGV[2] connId; ARGV[3] actorId.
 */
const refreshPresenceLeaseScript = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
${nowFromTime}
${armZsetExpiry}
local expiresAt = now + tonumber(ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
redis.call('ZADD', KEYS[2], expiresAt, ARGV[2])
local top = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
arm(KEYS[2], top, now)
if top[2] then
  redis.call('ZADD', KEYS[3], top[2], ARGV[3])
  arm(KEYS[3], top, now)
end
return 1
`;
/**
 * Deletes the connection hash immediately (a clean disconnect), drops it
 * from the actor's zset, then rescores or removes the actor from the
 * online zset depending on whether any connection remains. Trims stale
 * (past-scored) members from the actor zset before reading its top, so a
 * connId that already lapsed without ever being read can never masquerade
 * as the new top and get propagated into the online zset with a stale
 * score. Whenever a live top remains, both zsets are (re)armed: a prior
 * read's trim can empty and drop either key entirely between calls, and a
 * bare ZADD onto a dropped key recreates it with no TTL, so this script
 * cannot assume either key's expiry is still intact just because it was
 * armed once. KEYS[1] conn hash; KEYS[2] actor zset; KEYS[3] online zset.
 * ARGV[1] connId; ARGV[2] actorId.
 */
const deletePresenceLeaseScript = `
${nowFromTime}
${armZsetExpiry}
local existed = redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - 1)
local top = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
if top[2] then
  redis.call('ZADD', KEYS[3], top[2], ARGV[2])
  -- No-op today (upsert/refresh arm on write); kept as defence in depth for
  -- future write paths.
  arm(KEYS[2], top, now)
  arm(KEYS[3], top, now)
else
  redis.call('ZREM', KEYS[3], ARGV[2])
end
return existed
`;
/**
 * One atomic op: trim members whose score (lease expiry) is in the past,
 * range the survivors, hydrate each from its connection hash, and drop any
 * whose hash is already gone (a benign race between the two keys) or whose
 * hash names a different actor than the one requested (the zset is scoped
 * per actor, so this should never happen with server-minted ids, but the
 * read never trusts it). Returns the Redis `now` it used as the first
 * element (ADR 0033 §1.1), so a caller never substitutes an instance clock
 * for the server clock that scored these leases. KEYS[1] actor zset.
 * ARGV[1] actorId; ARGV[2] the conn-hash key prefix (namespace-qualified,
 * no trailing connId).
 */
const readActorConnectionsScript = `
${nowFromTime}
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 1)
local members = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
local result = {now}
for i = 1, #members, 2 do
  local connId = members[i]
  local expiresAt = members[i + 1]
  local hash = redis.call('HGETALL', ARGV[2] .. connId)
  if #hash > 0 then
    local record = {}
    for j = 1, #hash, 2 do record[hash[j]] = hash[j + 1] end
    if record.actorId == ARGV[1] then
      table.insert(result, connId)
      table.insert(result, record.actorId)
      table.insert(result, record.activity)
      table.insert(result, record.instanceId)
      table.insert(result, expiresAt)
    end
  end
end
return result
`;
/**
 * One atomic op: trim actorIds whose latest lease has expired, then range
 * the survivors with their scores. Returns the Redis `now` it used as the
 * first element (ADR 0033 §1.1), so a caller never substitutes an instance
 * clock for the server clock that scored these leases. KEYS[1] online zset.
 */
const readOnlinePresenceScript = `
${nowFromTime}
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 1)
local members = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
local result = {now}
for i = 1, #members do
  table.insert(result, members[i])
end
return result
`;

const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
function assertPresenceId(label: string, value: string) {
  if (!idPattern.test(value)) throw new Error(`Invalid ${label}`);
}
function assertActivity(value: string): asserts value is PresenceActivity {
  if (value !== 'active' && value !== 'idle')
    throw new Error('Invalid activity');
}
function assertTtlSeconds(ttlSeconds: number) {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)
    throw new Error('TTL must be a positive integer');
}

export function createPresenceOperations({
  client,
  namespace,
  redisKey,
  reportFailure,
}: {
  readonly client: RedisClient;
  readonly namespace: string;
  readonly redisKey: (namespace: string, ...segments: string[]) => string;
  readonly reportFailure: (operation: string) => void;
}) {
  return {
    /** Atomic upsert of one connection's presence lease with a mandatory TTL. */
    async upsertPresenceLease(
      lease: PresenceLease & { readonly activity: PresenceActivity },
      ttlSeconds: number,
    ) {
      assertPresenceId('connId', lease.connId);
      assertPresenceId('actorId', lease.actorId);
      assertPresenceId('instanceId', lease.instanceId);
      assertActivity(lease.activity);
      assertTtlSeconds(ttlSeconds);
      try {
        await client.connect();
        await client.send('EVAL', [
          upsertPresenceLeaseScript,
          '3',
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          lease.actorId,
          lease.activity,
          lease.instanceId,
          String(ttlSeconds * 1000),
          lease.connId,
        ]);
      } catch (error) {
        reportFailure('upsertPresenceLease');
        throw error;
      }
    },
    /**
     * Extends an existing lease. Returns `refreshed: false` without error
     * when the lease already expired: the caller must re-upsert.
     */
    async refreshPresenceLease(
      lease: Pick<PresenceLease, 'connId' | 'actorId'>,
      ttlSeconds: number,
    ) {
      assertPresenceId('connId', lease.connId);
      assertPresenceId('actorId', lease.actorId);
      assertTtlSeconds(ttlSeconds);
      try {
        await client.connect();
        const refreshed = (await client.send('EVAL', [
          refreshPresenceLeaseScript,
          '3',
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          String(ttlSeconds * 1000),
          lease.connId,
          lease.actorId,
        ])) as number;
        return { refreshed: refreshed === 1 };
      } catch (error) {
        reportFailure('refreshPresenceLease');
        throw error;
      }
    },
    /** Atomic delete of one connection's presence lease (a clean disconnect). */
    async deletePresenceLease(
      lease: Pick<PresenceLease, 'connId' | 'actorId'>,
    ) {
      assertPresenceId('connId', lease.connId);
      assertPresenceId('actorId', lease.actorId);
      try {
        await client.connect();
        await client.send('EVAL', [
          deletePresenceLeaseScript,
          '3',
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          lease.connId,
          lease.actorId,
        ]);
      } catch (error) {
        reportFailure('deletePresenceLease');
        throw error;
      }
    },
    /**
     * An actor's live connections, trimmed, hydrated and actorId-checked in
     * one Lua op. `nowMs` is the Redis server clock the script used to trim
     * and score these leases (ADR 0033 §1.1); a caller computing
     * `derivePresence`'s `nowMs` must use this, never an instance clock.
     */
    async readActorConnections(actorId: string): Promise<{
      readonly connections: readonly PresenceConnection[];
      readonly nowMs: number;
    }> {
      assertPresenceId('actorId', actorId);
      try {
        await client.connect();
        const flat = (await client.send('EVAL', [
          readActorConnectionsScript,
          '1',
          redisKey(namespace, 'presence', 'actor', actorId),
          actorId,
          `${redisKey(namespace, 'presence', 'conn')}:`,
        ])) as (string | number)[];
        const nowMs = Number(flat[0]);
        const connections: PresenceConnection[] = [];
        for (let index = 1; index < flat.length; index += 5) {
          connections.push({
            connId: flat[index] as string,
            actorId: flat[index + 1] as string,
            activity: flat[index + 2] as PresenceActivity,
            instanceId: flat[index + 3] as string,
            expiresAtMs: Number(flat[index + 4]),
          });
        }
        return { connections, nowMs };
      } catch (error) {
        reportFailure('readActorConnections');
        throw error;
      }
    },
    /**
     * The online set of actorIds, trimming any whose latest lease has
     * expired. `nowMs` is the Redis server clock the script used to trim
     * these actors (ADR 0033 §1.1); a caller computing `derivePresence`'s
     * `nowMs` must use this, never an instance clock.
     */
    async readOnlinePresence(): Promise<{
      readonly actors: readonly PresenceOnlineActor[];
      readonly nowMs: number;
    }> {
      try {
        await client.connect();
        const flat = (await client.send('EVAL', [
          readOnlinePresenceScript,
          '1',
          redisKey(namespace, 'presence', 'online'),
        ])) as (string | number)[];
        const nowMs = Number(flat[0]);
        const actors: PresenceOnlineActor[] = [];
        for (let index = 1; index < flat.length; index += 2) {
          actors.push({
            actorId: flat[index] as string,
            expiresAtMs: Number(flat[index + 1]),
          });
        }
        return { actors, nowMs };
      } catch (error) {
        reportFailure('readOnlinePresence');
        throw error;
      }
    },
  };
}
