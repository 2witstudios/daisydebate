/**
 * Test-suite Redis support (ISSUE-237). Integration suites write to a
 * dedicated per-slot Redis database (ADR 0034) whose keys must never outlive
 * a run: every key carries an expiry, every namespace is a `t3-` one the
 * runner can sweep, and a killed run's leftovers are removed by the next run.
 */
import { RedisClient } from 'bun';
import { redisClientOptions } from './index';

/** The prefix of every integration namespace; the runner sweeps by it. */
export const TEST_NAMESPACE_PREFIX = 't3-';

/** The longest an integration run may last, and how long a namespace may sit idle before the sweep takes it. */
export const TEST_RUN_MAX_MS = 60 * 60 * 1000;

/** Ceiling on any test key's remaining life: well past a run, so a crashed run's keys clear themselves. */
export const TEST_KEY_TTL_MAX_MS = 2 * TEST_RUN_MAX_MS;

/** A fresh test namespace from a cuid2 the caller injects. */
export const testNamespace = (id: string): string =>
  `${TEST_NAMESPACE_PREFIX}${id.slice(0, 10)}`;

/**
 * A TEST_REDIS_URL that `requireTestServices` (`@daisy/config`) accepted: this
 * slot's own database on its own server. Only such a URL opens a test client,
 * so an integration file cannot reach another database through these helpers.
 */
export type GuardedTestRedisUrl = string & { readonly ownTestRedis: true };

// Commands that touch more than this test's own namespace: every key of the
// database, or a different database.
const databaseWide = new Set([
  'FLUSHALL',
  'FLUSHDB',
  'MOVE',
  'SELECT',
  'SWAPDB',
]);

const refuseWide = (what: string): never => {
  throw new Error(
    `Test Redis client refuses ${what}: match your own namespace (packages/redis/src/testing.ts)`,
  );
};

/**
 * Wraps a test client so no command can reach past its own namespace, however
 * the call is spelled (ISSUE-246): the command is normalised to upper case at
 * run time, so a template, a joined string or a variable cannot hide it from
 * the check, and a SCAN or KEYS that matches everything, FLUSHDB, FLUSHALL,
 * SELECT, SWAPDB and MOVE are refused before anything is sent. Lint catches
 * the same shapes in source; this catches what lint cannot see.
 */
export function guardTestClient(client: RedisClient): RedisClient {
  const send: Send = async (rawCommand, args) => {
    const command = String(rawCommand).toUpperCase();
    if (databaseWide.has(command)) return refuseWide(command);
    if ((command === 'SCAN' || command === 'KEYS') && args.includes('*'))
      return refuseWide(`${command} of every key`);
    return client.send(rawCommand, args);
  };
  const keys = async (pattern: string) =>
    pattern === '*' ? refuseWide('KEYS of every key') : send('KEYS', [pattern]);
  return new Proxy(client, {
    get(target, member) {
      if (member === 'send') return send;
      if (member === 'keys') return keys;
      const value: unknown = Reflect.get(target, member, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** The one way an integration file opens Redis: a client on the slot's own database that cannot reach past its namespace. */
export const openTestRedis = (url: GuardedTestRedisUrl): RedisClient =>
  guardTestClient(new RedisClient(url));

type Send = (command: string, args: string[]) => Promise<unknown>;

// Commands that only read, delete or manage scripts: they create no key.
const passthrough = new Set([
  'DEL',
  'DBSIZE',
  'EXISTS',
  'GET',
  'HGET',
  'HGETALL',
  'HMGET',
  'KEYS',
  'LLEN',
  'LRANGE',
  'MGET',
  'OBJECT',
  'PING',
  'PTTL',
  'SCAN',
  'SCARD',
  'SCRIPT',
  'SISMEMBER',
  'SMEMBERS',
  'STRLEN',
  'TIME',
  'TTL',
  'TYPE',
  'UNLINK',
  'ZCARD',
  'ZCOUNT',
  'ZRANGE',
  'ZRANGEBYSCORE',
  'ZREVRANGE',
  'ZSCORE',
]);

// Commands that write or re-time the key they name first.
const writesFirstKey = new Set([
  'APPEND',
  'DECR',
  'DECRBY',
  'EXPIRE',
  'EXPIREAT',
  'GETEX',
  'GETSET',
  'HDEL',
  'HINCRBY',
  'HSET',
  'HSETNX',
  'INCR',
  'INCRBY',
  'LPUSH',
  'PERSIST',
  'PEXPIRE',
  'PEXPIREAT',
  'RPUSH',
  'SADD',
  'SET',
  'SETEX',
  'SETNX',
  'SREM',
  'ZADD',
  'ZINCRBY',
  'ZREM',
  'ZREMRANGEBYRANK',
  'ZREMRANGEBYSCORE',
]);

const expiryOptions = new Set(['EX', 'PX', 'EXAT', 'PXAT', 'KEEPTTL']);

// Caps each key's remaining life to ARGV[1]; a missing key (PTTL -2) is skipped.
const capScript = `
for i = 1, #KEYS do
  local ttl = redis.call('PTTL', KEYS[i])
  if ttl == -1 or ttl > tonumber(ARGV[1]) then
    redis.call('PEXPIRE', KEYS[i], ARGV[1])
  end
end
return #KEYS
`;

// Client members a suite may use: none of them creates a key.
const readOnlyMembers = new Set([
  'close',
  'connect',
  'del',
  'exists',
  'get',
  'getdel',
  'ping',
  'send',
  'ttl',
]);

const refuse = (what: string): never => {
  throw new Error(
    `Test Redis client cannot bound the expiry of ${what}; use a command it knows (packages/redis/src/testing.ts)`,
  );
};

/** The keys a write command may have created or re-timed, or a refusal. */
function writtenKeys(command: string, args: readonly string[]): string[] {
  if (command === 'EVAL' || command === 'EVALSHA') {
    const count = Number(args[1]);
    if (!Number.isSafeInteger(count) || count < 0) return refuse(command);
    return args.slice(2, 2 + count);
  }
  const key = args[0];
  return key === undefined ? refuse(command) : [key];
}

/**
 * Wraps a Redis client so no key it writes can be immortal or outlive
 * `maxTtlMs`: a SET with no expiry gets `PX maxTtlMs` in the same command,
 * every other write is followed by a one-script cap of the keys it named, and
 * a write whose keys cannot be attributed is refused before it is sent. Use
 * it at the seam a test hands to the code under test.
 */
export function withBoundedExpiry(
  client: RedisClient,
  maxTtlMs: number = TEST_KEY_TTL_MAX_MS,
): RedisClient {
  const send: Send = (command, args) => client.send(command, args);
  const bounded = async (rawCommand: string, args: string[]) => {
    const command = rawCommand.toUpperCase();
    if (passthrough.has(command)) return send(command, args);
    const isScript = command === 'EVAL' || command === 'EVALSHA';
    if (!isScript && !writesFirstKey.has(command)) return refuse(command);
    const keys = writtenKeys(command, args);
    const sent =
      command === 'SET' && !args.some((arg) => expiryOptions.has(arg))
        ? [...args, 'PX', String(maxTtlMs)]
        : args;
    // Issued back to back so both ride one round trip on the connection.
    const [reply] = await Promise.all([
      send(command, sent),
      send('EVAL', [capScript, String(keys.length), ...keys, String(maxTtlMs)]),
    ]);
    return reply;
  };
  return new Proxy(client, {
    get(target, member) {
      if (member === 'send') return bounded;
      const value: unknown = Reflect.get(target, member, target);
      if (typeof value !== 'function') return value;
      return readOnlyMembers.has(String(member))
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : () => refuse(`${String(member)}()`);
    },
  });
}

/** The client a suite hands to the code under test: the adapter's own dialing options, expiry bounded. */
export const createBoundedTestClient = (
  url: GuardedTestRedisUrl,
  maxTtlMs: number = TEST_KEY_TTL_MAX_MS,
): RedisClient =>
  withBoundedExpiry(new RedisClient(url, redisClientOptions), maxTtlMs);
