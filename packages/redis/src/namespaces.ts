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

const namespaceOf = (key: string): string => key.split(':')[0] ?? key;

/**
 * ISSUE-237: removes every namespace under `prefix` whose newest key has been
 * idle (no read or write, `OBJECT IDLETIME`) longer than `idleMs`, the
 * debris of a run that crashed, was killed or timed out before its teardown.
 * A namespace with any fresh key is a run in progress and stays whole. Reads
 * run in pipelined pages; a key that expired mid-sweep is ignored.
 */
export async function sweepIdleNamespaces(
  client: RedisCommands,
  { prefix, idleMs }: { readonly prefix: string; readonly idleMs: number },
): Promise<{ readonly namespaces: string[]; readonly keys: number }> {
  const stale = new Map<string, string[]>();
  const fresh = new Set<string>();
  await scanKeys(client, `${requireNamespace(prefix)}*`, async (keys) => {
    const undecided = keys.filter((key) => !fresh.has(namespaceOf(key)));
    const idle = await Promise.all(
      undecided.map((key) => client.send('OBJECT', ['IDLETIME', key])),
    );
    undecided.forEach((key, index) => {
      const seconds = idle[index];
      if (seconds === null || seconds === undefined) return;
      const namespace = namespaceOf(key);
      if (Number(seconds) * 1000 > idleMs) {
        stale.set(namespace, [...(stale.get(namespace) ?? []), key]);
      } else {
        fresh.add(namespace);
        stale.delete(namespace);
      }
    });
  });
  const swept = [...stale.entries()].filter(
    ([namespace]) => !fresh.has(namespace),
  );
  let keys = 0;
  for (const [, members] of swept)
    for (let from = 0; from < members.length; from += 500) {
      const page = members.slice(from, from + 500);
      keys += Number(await client.send('UNLINK', page));
    }
  return { namespaces: swept.map(([namespace]) => namespace).sort(), keys };
}

/**
 * ISSUE-237: unlinks every key of the (dedicated test) database that has no
 * expiry and returns their names, so a run that left an immortal key fails
 * loudly instead of feeding the next run's SCANs forever.
 */
export async function deleteKeysWithoutExpiry(
  client: RedisCommands,
): Promise<string[]> {
  const immortal: string[] = [];
  await scanKeys(client, '*', async (keys) => {
    const ttls = await Promise.all(
      keys.map((key) => client.send('PTTL', [key])),
    );
    keys.forEach((key, index) => {
      if (Number(ttls[index]) === -1) immortal.push(key);
    });
  });
  for (let from = 0; from < immortal.length; from += 500)
    await client.send('UNLINK', immortal.slice(from, from + 500));
  return immortal.sort();
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
