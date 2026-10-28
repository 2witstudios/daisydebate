import {
  observationBaseSchema,
  observationFrameBytes,
  observationResourceKey,
  parseObservationResourceKey,
  utf8Bytes,
  type ObservationBase,
  type ObservationResource,
} from '@daisy/protocol';
import { redisKey, redisSegmentPattern } from './redis-key';
import { defineScript } from './script-registry';
import type { RedisTransport } from './transport';

/**
 * Shared resource observation storage (ADR 0089). Everything here is
 * expendable: PostgreSQL owns every right and revision; a lost key costs a
 * rebuild, never a grant. Multi-key scripts touch one resource's keys plus
 * the fleet sentinel and demand sets, never another resource's.
 *
 * Keys, all expiring:
 * - `obs:incarnation` the cache incarnation every guard must match
 * - `obs:<resource>:owner` the claim token, a progress lease
 * - `obs:<resource>:guard` {incarnation, purge}: the publication fence
 * - `obs:<resource>:cache` per partition {disclosure, revision, body}
 * - `obs:<resource>:interest` node incarnation → expiry
 * - `obs:demand` / `obs:demand-expiry` resource → due time / expiry
 * - Pub/Sub channel `obs:<resource>:hint`, metadata only
 */
const SENTINEL_TTL_MS = 3_600_000;
/** Guards outlive every in-flight build and retry (bounded well under this). */
const OBSERVATION_GUARD_TTL_MS = 120_000;
/** Bodies are protected expendable data: at most 60s (ADR 0008 as amended). */
const OBSERVATION_BODY_TTL_MS = 60_000;
const OBSERVATION_MAX_NODES_PER_RESOURCE = 1_024;
const OBSERVATION_MAX_DEMAND = 100_000;
const OBSERVATION_MAX_PARTITIONS = 16;
/** Resources per batched script call; bounds a script's key list. */
const OBSERVATION_BATCH = 128;

const claimScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local current = redis.call('GET', KEYS[2])
if current and current ~= ARGV[2] then return 0 end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local demand = redis.call('ZSCORE', KEYS[3], ARGV[4])
if not demand or tonumber(demand) <= now then
  if current then redis.call('DEL', KEYS[2]) end
  return -1
end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`);
const releaseScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`);
/** Opens a build: returns the purge generation the publication must still match. */
const beginBuildScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return -1 end
if redis.call('HGET', KEYS[3], 'incarnation') ~= ARGV[1] then
  redis.call('DEL', KEYS[4])
  redis.call('HSET', KEYS[3], 'incarnation', ARGV[1])
  redis.call('HSETNX', KEYS[3], 'purge', '0')
end
redis.call('PEXPIRE', KEYS[3], ARGV[3])
return tonumber(redis.call('HGET', KEYS[3], 'purge'))
`);
/**
 * Body and head are installed together, only for the current owner token,
 * cache incarnation and purge generation, and only forward within a base.
 * Returns 1 installed, 2 already current (expiry renewed), 0 refused.
 */
const publishScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[3], 'incarnation') ~= ARGV[1] or redis.call('HGET', KEYS[3], 'purge') ~= ARGV[3] then return 0 end
local p = ARGV[4]
local disclosure = redis.call('HGET', KEYS[4], 'disclosure:' .. p)
local revision = redis.call('HGET', KEYS[4], 'revision:' .. p)
if disclosure and tonumber(disclosure) > tonumber(ARGV[5]) then return 0 end
if disclosure and tonumber(disclosure) == tonumber(ARGV[5]) then
  if tonumber(revision) == tonumber(ARGV[6]) then
    redis.call('PEXPIRE', KEYS[4], ARGV[8])
    return 2
  end
  if tonumber(revision) > tonumber(ARGV[6]) then return 0 end
end
if not disclosure and redis.call('HLEN', KEYS[4]) >= 3 * tonumber(ARGV[11]) then return 0 end
redis.call('HSET', KEYS[4], 'disclosure:' .. p, ARGV[5], 'revision:' .. p, ARGV[6], 'body:' .. p, ARGV[7])
redis.call('PEXPIRE', KEYS[4], ARGV[8])
redis.call('PEXPIRE', KEYS[3], ARGV[12])
redis.call('PUBLISH', ARGV[9], ARGV[10])
return 1
`);
/** Erasure fence: later publications from any earlier build are refused. */
const purgeScript = defineScript(`
local purge = redis.call('HINCRBY', KEYS[1], 'purge', 1)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('DEL', KEYS[2])
redis.call('PUBLISH', ARGV[1], ARGV[2])
return purge
`);
/** One body read, valid only under the current incarnation's guard. */
const readScript = defineScript(`
local incarnation = redis.call('GET', KEYS[1])
if not incarnation or redis.call('HGET', KEYS[2], 'incarnation') ~= incarnation then return {} end
local p = ARGV[1]
return {
  redis.call('HGET', KEYS[3], 'disclosure:' .. p) or false,
  redis.call('HGET', KEYS[3], 'revision:' .. p) or false,
  redis.call('HGET', KEYS[3], 'body:' .. p) or false,
}
`);
/** Batched heads: KEYS = sentinel, then (guard, cache, owner) per resource; ARGV = partitions. */
const headsScript = defineScript(`
local incarnation = redis.call('GET', KEYS[1])
local result = {}
for index = 1, #ARGV do
  local base = 1 + (index - 1) * 3
  local valid = incarnation and redis.call('HGET', KEYS[base + 1], 'incarnation') == incarnation
  local p = ARGV[index]
  table.insert(result, {
    redis.call('EXISTS', KEYS[base + 3]),
    valid and redis.call('HGET', KEYS[base + 2], 'disclosure:' .. p) or false,
    valid and redis.call('HGET', KEYS[base + 2], 'revision:' .. p) or false,
  })
end
return result
`);
/**
 * One node's batched interest refresh. KEYS = demand, demand-expiry, then
 * one interest set per resource; ARGV = node, ttl, max nodes, max demand,
 * then one resource key per interest set. Returns 1/0 per resource.
 */
const interestScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local ttl = tonumber(ARGV[2])
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, 128)
for _, resource in ipairs(expired) do
  redis.call('ZREM', KEYS[1], resource)
  redis.call('ZREM', KEYS[2], resource)
end
local result = {}
for index = 3, #KEYS do
  local resource = ARGV[index + 2]
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now)
  local ok = 1
  if not redis.call('ZSCORE', KEYS[index], ARGV[1]) and redis.call('ZCARD', KEYS[index]) >= tonumber(ARGV[3]) then ok = 0 end
  if ok == 1 and not redis.call('ZSCORE', KEYS[2], resource) and redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then ok = 0 end
  if ok == 1 then
    redis.call('ZADD', KEYS[index], now + ttl, ARGV[1])
    redis.call('PEXPIRE', KEYS[index], ttl)
    redis.call('ZADD', KEYS[1], 'NX', now, resource)
    redis.call('ZADD', KEYS[2], 'GT', now + ttl, resource)
  end
  table.insert(result, ok)
end
redis.call('PEXPIRE', KEYS[1], ttl * 4)
redis.call('PEXPIRE', KEYS[2], ttl * 4)
return result
`);
const withdrawScript = defineScript(`
redis.call('ZREM', KEYS[1], ARGV[1])
return 1
`);
/** Due demand, bounded; each returned resource is pushed back by the repair period. */
const discoverScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, 128)
for _, resource in ipairs(expired) do
  redis.call('ZREM', KEYS[1], resource)
  redis.call('ZREM', KEYS[2], resource)
end
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, tonumber(ARGV[1]))
for _, resource in ipairs(due) do redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), resource) end
return due
`);

const segment = (value: string) => {
  if (!redisSegmentPattern.test(value))
    throw new Error('Invalid observation segment');
  return value;
};
const duration = (ms: number, max = SENTINEL_TTL_MS) => {
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > max)
    throw new Error('Invalid observation duration');
  return String(ms);
};
const count = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid observation revision');
  return String(value);
};
const numberOrNull = (value: unknown) =>
  value === null || value === false || value === undefined
    ? null
    : Number(value);

export type ObservationHint =
  | {
      readonly kind: 'published';
      readonly partition: string;
      readonly disclosureRevision: number;
      readonly contentRevision: number;
    }
  | { readonly kind: 'purged' };
export type ObservationHead = {
  readonly owned: boolean;
  readonly disclosureRevision: number | null;
  readonly contentRevision: number | null;
};

export function createObservationKeys(namespace: string) {
  const resourceKey = (resource: ObservationResource, part: string) =>
    redisKey(namespace, 'obs', observationResourceKey(resource), part);
  return {
    sentinel: redisKey(namespace, 'obs', 'incarnation'),
    demand: redisKey(namespace, 'obs', 'demand'),
    demandExpiry: redisKey(namespace, 'obs', 'demand-expiry'),
    owner: (resource: ObservationResource) => resourceKey(resource, 'owner'),
    guard: (resource: ObservationResource) => resourceKey(resource, 'guard'),
    cache: (resource: ObservationResource) => resourceKey(resource, 'cache'),
    interest: (resource: ObservationResource) =>
      resourceKey(resource, 'interest'),
    hint: (resource: ObservationResource) => resourceKey(resource, 'hint'),
    /** The resource a hint channel names, or null for a foreign channel. */
    hintResource(channel: string): ObservationResource | null {
      const prefix = redisKey(namespace, 'obs') + ':';
      const suffix = ':hint';
      if (!channel.startsWith(prefix) || !channel.endsWith(suffix)) return null;
      return parseObservationResourceKey(
        channel.slice(prefix.length, -suffix.length),
      );
    },
  };
}

/** Parses an untrusted hint; Pub/Sub carries metadata only, never a grant. */
export function parseObservationHint(text: string): ObservationHint | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const hint = value as Record<string, unknown>;
  if (hint.kind === 'purged' && Object.keys(hint).length === 1)
    return { kind: 'purged' };
  const valid = (n: unknown) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return hint.kind === 'published' &&
    Object.keys(hint).length === 4 &&
    typeof hint.partition === 'string' &&
    redisSegmentPattern.test(hint.partition) &&
    valid(hint.disclosureRevision) &&
    valid(hint.contentRevision)
    ? {
        kind: 'published',
        partition: hint.partition,
        disclosureRevision: hint.disclosureRevision as number,
        contentRevision: hint.contentRevision as number,
      }
    : null;
}

export function createObservationCacheOperations({
  client,
  namespace,
  reportFailure,
}: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  const keys = createObservationKeys(namespace);
  const run = async (
    operation: string,
    script: string,
    k: string[],
    a: string[],
  ) => {
    try {
      await client.connect();
      return await client.send('EVAL', [script, String(k.length), ...k, ...a]);
    } catch (error) {
      reportFailure(operation);
      throw error;
    }
  };
  const batches = <T>(items: readonly T[]) =>
    Array.from(
      { length: Math.ceil(items.length / OBSERVATION_BATCH) },
      (_, i) => items.slice(i * OBSERVATION_BATCH, (i + 1) * OBSERVATION_BATCH),
    );
  return {
    /**
     * The current cache incarnation, installing `candidate` when none exists.
     * A changed incarnation (Redis reset or sentinel expiry) voids every
     * guard: owners must re-claim and re-read PostgreSQL before publishing.
     */
    async establishObservationIncarnation(candidate: string): Promise<string> {
      segment(candidate);
      try {
        await client.connect();
        await client.send('SET', [
          keys.sentinel,
          candidate,
          'NX',
          'PX',
          String(SENTINEL_TTL_MS),
        ]);
        const current = await client.get(keys.sentinel);
        if (current === null) throw new Error('Observation cache unavailable');
        return segment(current);
      } catch (error) {
        reportFailure('establishObservationIncarnation');
        throw error;
      }
    },
    /** Claims or renews ownership while live demand exists; 'idle' releases it. */
    async claimObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly leaseMs: number;
    }): Promise<'owned' | 'taken' | 'idle'> {
      const result = Number(
        await run(
          'claimObservation',
          claimScript,
          [keys.sentinel, keys.owner(input.resource), keys.demandExpiry],
          [
            segment(input.incarnation),
            segment(input.token),
            duration(input.leaseMs, 10_000),
            observationResourceKey(input.resource),
            String(SENTINEL_TTL_MS),
          ],
        ),
      );
      return result === 1 ? 'owned' : result === -1 ? 'idle' : 'taken';
    },
    async releaseObservation(resource: ObservationResource, token: string) {
      return (
        Number(
          await run(
            'releaseObservation',
            releaseScript,
            [keys.owner(resource)],
            [segment(token)],
          ),
        ) === 1
      );
    },
    /** The purge generation a build started now must publish under, or null when not owner. */
    async beginObservationBuild(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
    }): Promise<number | null> {
      const purge = Number(
        await run(
          'beginObservationBuild',
          beginBuildScript,
          [
            keys.sentinel,
            keys.owner(input.resource),
            keys.guard(input.resource),
            keys.cache(input.resource),
          ],
          [
            segment(input.incarnation),
            segment(input.token),
            String(OBSERVATION_GUARD_TTL_MS),
          ],
        ),
      );
      return Number.isSafeInteger(purge) && purge >= 0 ? purge : null;
    },
    async publishObservation(input: {
      readonly base: ObservationBase;
      readonly incarnation: string;
      readonly token: string;
      readonly purgeGeneration: number;
      readonly contentRevision: number;
      readonly body: string;
    }): Promise<'installed' | 'current' | 'refused'> {
      const base = observationBaseSchema.parse(input.base);
      if (utf8Bytes(input.body) > observationFrameBytes)
        throw new Error('Observation body exceeds its byte bound');
      const hint: ObservationHint = {
        kind: 'published',
        partition: base.partition,
        disclosureRevision: base.disclosureRevision,
        contentRevision: input.contentRevision,
      };
      const result = Number(
        await run(
          'publishObservation',
          publishScript,
          [
            keys.sentinel,
            keys.owner(base.resource),
            keys.guard(base.resource),
            keys.cache(base.resource),
          ],
          [
            segment(input.incarnation),
            segment(input.token),
            count(input.purgeGeneration),
            segment(base.partition),
            count(base.disclosureRevision),
            count(input.contentRevision),
            input.body,
            String(OBSERVATION_BODY_TTL_MS),
            keys.hint(base.resource),
            JSON.stringify(hint),
            String(OBSERVATION_MAX_PARTITIONS),
            String(OBSERVATION_GUARD_TTL_MS),
          ],
        ),
      );
      return result === 1 ? 'installed' : result === 2 ? 'current' : 'refused';
    },
    /** Deletes every cached body and fences out every build started before it. */
    async purgeObservation(resource: ObservationResource): Promise<number> {
      return Number(
        await run(
          'purgeObservation',
          purgeScript,
          [keys.guard(resource), keys.cache(resource)],
          [
            keys.hint(resource),
            JSON.stringify({ kind: 'purged' } satisfies ObservationHint),
            String(OBSERVATION_GUARD_TTL_MS),
          ],
        ),
      );
    },
    async readObservation(
      resource: ObservationResource,
      partition: string,
    ): Promise<{
      readonly disclosureRevision: number;
      readonly contentRevision: number;
      readonly body: string;
    } | null> {
      const reply = (await run(
        'readObservation',
        readScript,
        [keys.sentinel, keys.guard(resource), keys.cache(resource)],
        [segment(partition)],
      )) as unknown[];
      const [disclosure, revision, body] = reply ?? [];
      return typeof body === 'string' &&
        numberOrNull(disclosure) !== null &&
        numberOrNull(revision) !== null
        ? {
            disclosureRevision: Number(disclosure),
            contentRevision: Number(revision),
            body,
          }
        : null;
    },
    /** Redis-only head repair for a node's interests: owner presence and current revisions. */
    async readObservationHeads(
      entries: readonly {
        readonly resource: ObservationResource;
        readonly partition: string;
      }[],
    ): Promise<readonly ObservationHead[]> {
      const heads: ObservationHead[] = [];
      for (const batch of batches(entries)) {
        const reply = (await run(
          'readObservationHeads',
          headsScript,
          [
            keys.sentinel,
            ...batch.flatMap(({ resource }) => [
              keys.guard(resource),
              keys.cache(resource),
              keys.owner(resource),
            ]),
          ],
          batch.map(({ partition }) => segment(partition)),
        )) as unknown[][];
        for (const [owned, disclosure, revision] of reply)
          heads.push({
            owned: Number(owned) === 1,
            disclosureRevision: numberOrNull(disclosure),
            contentRevision: numberOrNull(revision),
          });
      }
      return heads;
    },
    /** One node's interest in each resource, refreshed in bounded batches; false when a bound refuses it. */
    async refreshObservationInterest(input: {
      readonly node: string;
      readonly resources: readonly ObservationResource[];
      readonly ttlMs: number;
    }): Promise<readonly boolean[]> {
      const accepted: boolean[] = [];
      for (const batch of batches(input.resources)) {
        const reply = (await run(
          'refreshObservationInterest',
          interestScript,
          [keys.demand, keys.demandExpiry, ...batch.map(keys.interest)],
          [
            segment(input.node),
            duration(input.ttlMs, 60_000),
            String(OBSERVATION_MAX_NODES_PER_RESOURCE),
            String(OBSERVATION_MAX_DEMAND),
            ...batch.map(observationResourceKey),
          ],
        )) as unknown[];
        accepted.push(...reply.map((value) => Number(value) === 1));
      }
      return accepted;
    },
    async withdrawObservationInterest(
      resource: ObservationResource,
      node: string,
    ) {
      await run(
        'withdrawObservationInterest',
        withdrawScript,
        [keys.interest(resource)],
        [segment(node)],
      );
    },
    /** Due resources an eligible worker may try to claim, at most `limit`. */
    async discoverObservationDemand(input: {
      readonly limit: number;
      readonly repairMs: number;
    }): Promise<readonly ObservationResource[]> {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > OBSERVATION_BATCH
      )
        throw new Error('Invalid observation discovery limit');
      const reply = (await run(
        'discoverObservationDemand',
        discoverScript,
        [keys.demand, keys.demandExpiry],
        [String(input.limit), duration(input.repairMs, 10_000)],
      )) as unknown[];
      return reply.flatMap((key) => {
        const resource =
          typeof key === 'string' ? parseObservationResourceKey(key) : null;
        return resource ? [resource] : [];
      });
    },
  };
}
