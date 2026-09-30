/**
 * The Redis database each slot's integration suites use (ADR 0034, ISSUE-237).
 * Integration suites write to a Redis database of the slot's own, so a run's
 * SCANs and teardown never walk another slot's keys. Main keeps database 1
 * (CI's too); worktree block n owns database 2 + n, above dev (0), main's
 * test (1) and the browser suite's (2). Blocks are 1..499, so the shared
 * Redis needs `--databases 512` (infra/compose.yaml).
 */

import { RedisClient } from 'bun';
import { deleteNamespace, listNamespaces } from '@daisy/redis/namespaces';
import { TEST_NAMESPACE_PREFIX } from '@daisy/redis/testing';

type Commands = {
  readonly send: (command: string, args: string[]) => Promise<unknown>;
};

const mainTestRedisDatabase = 1;
const worktreeTestRedisDatabaseBase = 2;

/** The Redis database a slot's integration suites use (`undefined` block: main). */
export const testRedisDatabase = (block?: number): number =>
  block === undefined
    ? mainTestRedisDatabase
    : worktreeTestRedisDatabaseBase + block;

/** How many databases the Redis server must offer for that block's test database. */
export const redisDatabasesNeeded = (block?: number): number =>
  testRedisDatabase(block) + 1;

/**
 * The value of one `CONFIG GET <name>` reply. Redis answers RESP3 with a map
 * and RESP2 with a flat [name, value] list; Bun surfaces them as an object
 * or an array.
 */
export function configValue(reply: unknown, name: string): string | undefined {
  const value = Array.isArray(reply)
    ? reply[reply.indexOf(name) + 1]
    : reply instanceof Map
      ? reply.get(name)
      : (reply as Record<string, unknown> | null)?.[name];
  return value === undefined || value === null ? undefined : String(value);
}

/**
 * Why a Redis server cannot host this slot's test database, or undefined.
 * `databases` is fixed when Redis starts, so a shared Redis started before
 * ISSUE-237 (16 databases) is recreated once by the operator, never by
 * slot:up, which must not restart the stack under every checkout.
 */
export function redisDatabaseRefusal({
  available,
  block,
}: {
  readonly available: number;
  readonly block?: number;
}): string | undefined {
  const needed = redisDatabasesNeeded(block);
  return available >= needed
    ? undefined
    : `The shared Redis offers ${available} databases but this slot's test database is ${testRedisDatabase(block)} (port block ${block}); it needs ${needed}. Recreate Redis once with 'docker compose -f infra/compose.yaml up -d --force-recreate redis' (infra/compose.yaml starts it with --databases 512; its keys are expendable, but every checkout's Redis sessions and counters are lost), then run bun slot:up again.`;
}

/** Throws the refusal, if any, after asking the server how many databases it offers. */
export async function requireRedisDatabases(
  client: Commands,
  block?: number,
): Promise<void> {
  const offered = configValue(
    await client.send('CONFIG', ['GET', 'databases']),
    'databases',
  );
  const refusal = redisDatabaseRefusal({
    available: Number(offered ?? 0),
    ...(block === undefined ? {} : { block }),
  });
  if (refusal) throw new Error(refusal);
}

const databaseIndex = (url: string): number | string => {
  try {
    const path = new URL(url).pathname.slice(1);
    if (path === '') return 0;
    return /^(?:0|[1-9][0-9]*)$/.test(path) ? Number(path) : path;
  } catch {
    return 'unreadable';
  }
};

/**
 * The test database this slot owns, from the PORT `slot:up` wrote: main
 * (3000, or no PORT as in CI) is 1, worktree port block n (PORT 13000 + 10n)
 * is 2 + n; any other PORT names no block. `kind` is inferred when omitted.
 */
export function expectedTestRedisDatabase(
  port: string | undefined,
  kind: 'main' | 'worktree' | undefined = port === undefined || port === '3000'
    ? 'main'
    : 'worktree',
): number | undefined {
  if (kind === 'main') return testRedisDatabase();
  const offset = Number(port) - 13_000;
  const block = offset / 10;
  return Number.isInteger(block) && block >= 1 && block <= 499
    ? testRedisDatabase(block)
    : undefined;
}

/**
 * Why a URL is not this slot's own test database, or undefined when it is.
 * Every path that deletes from the test database (the runner's sweep and
 * post-run scan, slot:down) checks this first: exactly the slot's own
 * database, never another slot's, dev (0), e2e (2) or one past the server's.
 */
export function testRedisRefusal(
  url: string | undefined,
  expected: number | undefined,
): string | undefined {
  if (url === undefined) return 'TEST_REDIS_URL is unset';
  if (expected === undefined)
    return "PORT does not name this slot's port block, so its test Redis database cannot be derived (run bun slot:up)";
  const actual = databaseIndex(url);
  return actual === expected
    ? undefined
    : `TEST_REDIS_URL names Redis database ${actual}, expected this slot's own database ${expected} (run bun slot:up)`;
}

/** The runner's guard: TEST_REDIS_URL against the PORT in the same environment. */
export const testRedisRefusalOf = (
  env: Readonly<Record<string, string | undefined>>,
): string | undefined =>
  testRedisRefusal(env.TEST_REDIS_URL, expectedTestRedisDatabase(env.PORT));

/**
 * The client slot:down clears the test database with (it refuses main): one
 * on the worktree's own database, and only that. Any other database, shared
 * or another slot's, gets undefined, so slot:down never deletes another
 * checkout's keys.
 */
export const openOwnTestRedis = (
  url: string | undefined,
  port: string | undefined,
): RedisClient | undefined =>
  url !== undefined &&
  testRedisRefusal(url, expectedTestRedisDatabase(port, 'worktree')) ===
    undefined
    ? new RedisClient(url)
    : undefined;

/** slot:down's release of a slot's test database: every `t3-` namespace a run left, by SCAN and UNLINK. */
export async function clearTestNamespaces(
  client: Commands | undefined,
): Promise<number> {
  if (!client) return 0;
  let removed = 0;
  for (const namespace of await listNamespaces(client, TEST_NAMESPACE_PREFIX))
    removed += await deleteNamespace(client, namespace);
  return removed;
}
