import { RedisClient } from 'bun';
export type RedisConfig = { readonly url: string; readonly namespace: string };
export type RedisEventSink = (
  event: 'redis.command.failed',
  fields: Readonly<Record<string, unknown>>,
  message: string,
) => void;
/**
 * Fixed-window counter in ONE atomic script: increment, arm the expiry on the
 * first hit (or if it is somehow missing), and decide. Denied attempts keep
 * counting, so the decision never depends on read-modify-write across calls.
 * KEYS[1] key; ARGV[1] window ms; ARGV[2] max. Returns {allowed, ttlMs}.
 */
const consumeScript = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if count > tonumber(ARGV[2]) then return {0, ttl} end
return {1, ttl}
`;
export type RateLimitRule = {
  readonly windowSeconds: number;
  readonly max: number;
};
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
 * Sets the connection hash with its own TTL, scores the connId into the
 * actor's zset by expiry, then rescores the actor into the online zset by
 * its live connections' latest expiry. One EVAL, so a concurrent reader
 * never observes the hash without its zset entries or vice versa.
 * KEYS[1] conn hash; KEYS[2] actor zset; KEYS[3] online zset.
 * ARGV[1] actorId; ARGV[2] activity; ARGV[3] instanceId; ARGV[4] ttlMs;
 * ARGV[5] expiresAtMs; ARGV[6] connId.
 */
const upsertPresenceLeaseScript = `
redis.call('HSET', KEYS[1], 'actorId', ARGV[1], 'activity', ARGV[2], 'instanceId', ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[6])
local top = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
if top[2] then
  redis.call('ZADD', KEYS[3], top[2], ARGV[1])
end
return 1
`;
/**
 * Extends the connection's TTL and rescores it, but only if the lease is
 * still live: a lease whose hash already expired must be re-upserted, not
 * silently resurrected by refresh. KEYS[1] conn hash; KEYS[2] actor zset;
 * KEYS[3] online zset. ARGV[1] ttlMs; ARGV[2] expiresAtMs; ARGV[3] connId;
 * ARGV[4] actorId.
 */
const refreshPresenceLeaseScript = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
local top = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
if top[2] then
  redis.call('ZADD', KEYS[3], top[2], ARGV[4])
end
return 1
`;
/**
 * Deletes the connection hash immediately (a clean disconnect), drops it
 * from the actor's zset, then rescores or removes the actor from the
 * online zset depending on whether any connection remains.
 * KEYS[1] conn hash; KEYS[2] actor zset; KEYS[3] online zset.
 * ARGV[1] connId; ARGV[2] actorId.
 */
const deletePresenceLeaseScript = `
local existed = redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
local top = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
if top[2] then
  redis.call('ZADD', KEYS[3], top[2], ARGV[2])
else
  redis.call('ZREM', KEYS[3], ARGV[2])
end
return existed
`;
/**
 * Trims members whose score (lease expiry) is in the past, then returns
 * the survivors with their scores, so a crashed instance's leases fall
 * off the read one by one rather than lingering until the whole key TTLs.
 * KEYS[1] zset. ARGV[1] nowMs.
 */
const readLiveZsetScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - 1)
return redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
`;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
function assertPresenceId(label: string, value: string) {
  if (!idPattern.test(value)) throw new Error(`Invalid ${label}`);
}
function assertTtlSeconds(ttlSeconds: number) {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)
    throw new Error('TTL must be a positive integer');
}
function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error('now must be a non-negative integer epoch millisecond');
}
function pairsFromZrangeWithScores(flat: string[]): Array<[string, number]> {
  const pairs: Array<[string, number]> = [];
  for (let index = 0; index < flat.length; index += 2)
    pairs.push([flat[index]!, Number(flat[index + 1])]);
  return pairs;
}
export function redisKey(namespace: string, ...segments: string[]): string {
  if (
    ![namespace, ...segments].every((segment) =>
      /^[a-zA-Z0-9_-]{1,100}$/.test(segment),
    )
  )
    throw new Error('Invalid Redis key segment');
  return [namespace, 'v1', ...segments].join(':');
}
export function createRedis({
  url,
  namespace,
  eventSink,
  client: injectedClient,
}: RedisConfig & {
  readonly eventSink?: RedisEventSink;
  /** Overrides dialing `url`; tests inject a scripted client at this seam. */
  readonly client?: RedisClient;
}) {
  redisKey(namespace);
  const client =
    injectedClient ??
    new RedisClient(url, {
      connectionTimeout: 2000,
      enableOfflineQueue: false,
      maxRetries: 2,
    });
  const reportFailure = (operation: string) =>
    eventSink?.('redis.command.failed', { operation }, 'Redis command failed');
  return {
    async health() {
      try {
        await client.connect();
        return (await client.ping()) === 'PONG';
      } catch (error) {
        reportFailure('health');
        throw error;
      }
    },
    async setEphemeral(key: string, value: string, ttlSeconds: number) {
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1)
        throw new Error('TTL must be a positive integer');
      try {
        await client.connect();
        await client.send('SET', [
          redisKey(namespace, key),
          value,
          'EX',
          String(ttlSeconds),
        ]);
      } catch (error) {
        reportFailure('setEphemeral');
        throw error;
      }
    },
    /** Atomic across instances; throws on outage so callers must fail closed. */
    async consumeRateLimit(key: string, rule: RateLimitRule) {
      if (
        !Number.isSafeInteger(rule.windowSeconds) ||
        rule.windowSeconds < 1 ||
        !Number.isSafeInteger(rule.max) ||
        rule.max < 1
      )
        throw new Error('Invalid rate limit rule');
      const namespaced = redisKey(namespace, 'rl', key);
      try {
        await client.connect();
        const [allowed, ttlMs] = (await client.send('EVAL', [
          consumeScript,
          '1',
          namespaced,
          String(rule.windowSeconds * 1000),
          String(rule.max),
        ])) as [number, number];
        return {
          allowed: allowed === 1,
          retryAfterSeconds: allowed === 1 ? 0 : Math.ceil(ttlMs / 1000),
        };
      } catch (error) {
        reportFailure('consumeRateLimit');
        throw error;
      }
    },
    async get(key: string) {
      try {
        await client.connect();
        return await client.get(redisKey(namespace, key));
      } catch (error) {
        reportFailure('get');
        throw error;
      }
    },
    async delete(key: string) {
      try {
        await client.connect();
        await client.del(redisKey(namespace, key));
      } catch (error) {
        reportFailure('delete');
        throw error;
      }
    },
    /** Atomic upsert of one connection's presence lease with a mandatory TTL. */
    async upsertPresenceLease(
      lease: PresenceLease & { readonly activity: PresenceActivity },
      ttlSeconds: number,
      now: number,
    ) {
      assertPresenceId('connId', lease.connId);
      assertPresenceId('actorId', lease.actorId);
      assertPresenceId('instanceId', lease.instanceId);
      assertTtlSeconds(ttlSeconds);
      assertNow(now);
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
          String(now + ttlSeconds * 1000),
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
      now: number,
    ) {
      assertPresenceId('connId', lease.connId);
      assertPresenceId('actorId', lease.actorId);
      assertTtlSeconds(ttlSeconds);
      assertNow(now);
      try {
        await client.connect();
        const refreshed = (await client.send('EVAL', [
          refreshPresenceLeaseScript,
          '3',
          redisKey(namespace, 'presence', 'conn', lease.connId),
          redisKey(namespace, 'presence', 'actor', lease.actorId),
          redisKey(namespace, 'presence', 'online'),
          String(ttlSeconds * 1000),
          String(now + ttlSeconds * 1000),
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
    async deletePresenceLease(lease: Pick<PresenceLease, 'connId' | 'actorId'>) {
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
     * An actor's live connections, trimming any whose lease expiry is
     * already in the past. A connId surviving the zset trim but whose
     * hash already TTL'd out (a benign race between the two keys) is
     * dropped rather than reported as live.
     */
    async readActorConnections(
      actorId: string,
      now: number,
    ): Promise<readonly PresenceConnection[]> {
      assertPresenceId('actorId', actorId);
      assertNow(now);
      try {
        await client.connect();
        const flat = (await client.send('EVAL', [
          readLiveZsetScript,
          '1',
          redisKey(namespace, 'presence', 'actor', actorId),
          String(now),
        ])) as string[];
        const live = pairsFromZrangeWithScores(flat);
        const connections = await Promise.all(
          live.map(async ([connId, expiresAtMs]) => {
            const record = await client.hgetall(
              redisKey(namespace, 'presence', 'conn', connId),
            );
            if (!record || Object.keys(record).length === 0) return null;
            return {
              connId,
              actorId: record.actorId as string,
              activity: record.activity as PresenceActivity,
              instanceId: record.instanceId as string,
              expiresAtMs,
            } satisfies PresenceConnection;
          }),
        );
        return connections.filter((c): c is PresenceConnection => c !== null);
      } catch (error) {
        reportFailure('readActorConnections');
        throw error;
      }
    },
    /** The online set of actorIds, trimming any whose latest lease has expired. */
    async readOnlinePresence(
      now: number,
    ): Promise<readonly PresenceOnlineActor[]> {
      assertNow(now);
      try {
        await client.connect();
        const flat = (await client.send('EVAL', [
          readLiveZsetScript,
          '1',
          redisKey(namespace, 'presence', 'online'),
          String(now),
        ])) as string[];
        return pairsFromZrangeWithScores(flat).map(([actorId, expiresAtMs]) => ({
          actorId,
          expiresAtMs,
        }));
      } catch (error) {
        reportFailure('readOnlinePresence');
        throw error;
      }
    },
    close() {
      client.close();
    },
  };
}
