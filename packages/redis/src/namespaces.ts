/**
 * Namespace-scoped key administration for local slot tooling (ADR 0034).
 * Keys are `<namespace>:v1:...` (see redisKey), so a namespace owns exactly
 * the keys matching `<namespace>:*`. Deletion walks SCAN and UNLINKs each
 * page; it never issues FLUSHDB/FLUSHALL, which would erase other slots.
 */
type RedisCommands = {
  readonly send: (command: string, args: string[]) => Promise<unknown>;
};

// The REDIS_NAMESPACE rule: no glob metacharacters, no key separator.
const namespacePattern = /^[a-z][a-z0-9-]{0,40}$/;

const requireNamespace = (value: string): string => {
  if (!namespacePattern.test(value)) throw new Error('Invalid Redis namespace');
  return value;
};

async function scanKeys(
  client: RedisCommands,
  pattern: string,
  visit: (keys: readonly string[]) => Promise<void>,
): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = (await client.send('SCAN', [
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      '500',
    ])) as [string, string[]];
    if (keys.length > 0) await visit(keys);
    cursor = next;
  } while (cursor !== '0');
}

/** Distinct namespaces with at least one key, among those starting `prefix`. */
export async function listNamespaces(
  client: RedisCommands,
  prefix: string,
): Promise<readonly string[]> {
  const found = new Set<string>();
  await scanKeys(client, `${requireNamespace(prefix)}*`, async (keys) => {
    for (const key of keys) found.add(key.split(':')[0] ?? key);
  });
  return [...found].sort();
}

/** Deletes every key of one namespace; returns how many were removed. */
export async function deleteNamespace(
  client: RedisCommands,
  namespace: string,
): Promise<number> {
  let removed = 0;
  await scanKeys(client, `${requireNamespace(namespace)}:*`, async (keys) => {
    removed += Number(await client.send('UNLINK', [...keys]));
  });
  return removed;
}

/**
 * AUTH-7.6's post-restore step: deletes only the auth rate-limit counters
 * (`<namespace>:v1:rl:*`, the keys `consumeRateLimit` writes), leaving
 * presence and ticket keys of the same namespace untouched. A restored
 * database's fresh sessions and verification rows must not be met with
 * stale rate-limit counters carried over from the source deployment.
 */
export async function clearAuthRateLimits(
  client: RedisCommands,
  namespace: string,
): Promise<number> {
  let removed = 0;
  await scanKeys(
    client,
    `${requireNamespace(namespace)}:v1:rl:*`,
    async (keys) => {
      removed += Number(await client.send('UNLINK', [...keys]));
    },
  );
  return removed;
}
