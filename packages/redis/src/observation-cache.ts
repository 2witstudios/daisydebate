import { createHash } from 'node:crypto';
import {
  observationBaseKey,
  observationBaseSchema,
  observationResourceKey,
  observationHeaderSchema,
  observationFrameBytes,
  type ObservationBase,
  type ObservationResource,
} from '@daisy/protocol';
import { redisKey, redisSegmentPattern } from './redis-key';
import { defineScript } from './script-registry';
import type { RedisTransport } from './transport';

const claimScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local existing = redis.call('GET', KEYS[2])
if existing and existing ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1
`);
const releaseScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`);
const prepareScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
local purge = redis.call('HGET', KEYS[3], 'purge')
local disclosure = redis.call('HGET', KEYS[3], 'disclosure')
if purge and tonumber(purge) > tonumber(ARGV[3]) then return 0 end
if disclosure and tonumber(disclosure) > tonumber(ARGV[4]) then return 0 end
if not purge or purge ~= ARGV[3] or disclosure ~= ARGV[4] then redis.call('DEL', KEYS[4]) end
redis.call('HSET', KEYS[3], 'purge', ARGV[3], 'disclosure', ARGV[4], 'incarnation', ARGV[1])
redis.call('PEXPIRE', KEYS[3], ARGV[5])
return 1
`);
/** All body/head writes occur after all fences. No missing guard can be recreated here. */
const publishScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local owner = redis.call('GET', KEYS[2])
if owner ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[3], 'incarnation') ~= ARGV[1] or redis.call('HGET', KEYS[3], 'purge') ~= ARGV[3] or redis.call('HGET', KEYS[3], 'disclosure') ~= ARGV[4] then return 0 end
local previous = redis.call('HGET', KEYS[4], 'head:' .. ARGV[5])
if previous and tonumber(previous) >= tonumber(ARGV[6]) then return 0 end
if not previous and redis.call('HLEN', KEYS[4]) >= 128 then return -1 end
if previous then redis.call('HDEL', KEYS[4], 'body:' .. ARGV[5] .. ':' .. previous) end
redis.call('HSET', KEYS[4], 'body:' .. ARGV[5] .. ':' .. ARGV[6], ARGV[7], 'head:' .. ARGV[5], ARGV[6])
redis.call('PEXPIRE', KEYS[4], ARGV[8])
redis.call('PUBLISH', KEYS[5], ARGV[9])
return 1
`);
const retainScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[3], 'incarnation') ~= ARGV[1] or redis.call('HGET', KEYS[3], 'purge') ~= ARGV[3] or redis.call('HGET', KEYS[3], 'disclosure') ~= ARGV[4] then return 0 end
if redis.call('HGET', KEYS[4], 'head:' .. ARGV[5]) ~= ARGV[6] or redis.call('HEXISTS', KEYS[4], 'body:' .. ARGV[5] .. ':' .. ARGV[6]) == 0 then return 0 end
redis.call('PEXPIRE', KEYS[4], ARGV[7])
return 1
`);
const purgeScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local purge = redis.call('HGET', KEYS[3], 'purge')
if purge and tonumber(purge) > tonumber(ARGV[2]) then return 0 end
local disclosure = redis.call('HGET', KEYS[3], 'disclosure')
if disclosure and tonumber(disclosure) > tonumber(ARGV[3]) then return 0 end
redis.call('DEL', KEYS[2], KEYS[4])
redis.call('HSET', KEYS[3], 'incarnation', ARGV[1], 'purge', ARGV[2], 'disclosure', ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
redis.call('PUBLISH', KEYS[5], ARGV[5])
return 1
`);
const reapDemand = `
local rows = redis.call('HGETALL', KEYS[4])
for index = 1, #rows, 2 do
 local value = cjson.decode(rows[index + 1])
 if tonumber(value.expiresAt) <= now then
  redis.call('HDEL', KEYS[4], rows[index])
  local revision = redis.call('HGET', KEYS[5], 'head:' .. rows[index])
  if revision then redis.call('HDEL', KEYS[5], 'head:' .. rows[index], 'body:' .. rows[index] .. ':' .. revision) end
 end
end
`;
const interestScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) and redis.call('ZCARD', KEYS[1]) >= 128 then return 0 end
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 128)
for _, resource in ipairs(expired) do redis.call('ZREM', KEYS[2], resource); redis.call('ZREM', KEYS[3], resource) end
if not redis.call('ZSCORE', KEYS[2], ARGV[3]) and redis.call('ZCARD', KEYS[2]) >= 10000 then return 0 end
${reapDemand}
local added = 0
for index = 4, #ARGV, 2 do if redis.call('HEXISTS', KEYS[4], ARGV[index]) == 0 then added = added + 1 end end
if redis.call('HLEN', KEYS[4]) + added > 64 then return 0 end
for index = 4, #ARGV, 2 do redis.call('HSET', KEYS[4], ARGV[index], cjson.encode({base=cjson.decode(ARGV[index+1]),expiresAt=now+tonumber(ARGV[2])})) end
redis.call('PEXPIRE', KEYS[4], ARGV[2])
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], 'NX', now, ARGV[3])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[2], 60000)
redis.call('PEXPIRE', KEYS[3], 60000)
return 1
`);
const readDemandScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
${reapDemand}
local rows = redis.call('HVALS', KEYS[4])
local result = {}
for _, row in ipairs(rows) do table.insert(result, cjson.encode(cjson.decode(row).base)) end
return result
`);
const discoverScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, 128)
for _, resource in ipairs(expired) do redis.call('ZREM', KEYS[1], resource); redis.call('ZREM', KEYS[2], resource) end
local resources = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, ARGV[1])
local live = {}
for _, resource in ipairs(resources) do
 local expiry = redis.call('ZSCORE', KEYS[2], resource)
 if expiry and tonumber(expiry) > now then
  table.insert(live, resource); redis.call('ZADD', KEYS[1], now + 500, resource)
 else redis.call('ZREM', KEYS[1], resource); redis.call('ZREM', KEYS[2], resource) end
end
return live
`);
const readScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {} end
local result = {}
for index = 2, #ARGV do
 local revision = redis.call('HGET', KEYS[2], 'head:' .. ARGV[index])
 local body = revision and redis.call('HGET', KEYS[2], 'body:' .. ARGV[index] .. ':' .. revision)
 table.insert(result, {revision or false, body or false})
end
return result
`);
const segment = (value: string) => {
  if (!redisSegmentPattern.test(value))
    throw new Error('Invalid observation fence');
  return value;
};
const ttl = (value: number, max = 60000) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error('Invalid observation TTL');
  return String(value);
};
const baseDigest = (base: ObservationBase) =>
  createHash('sha3-256').update(observationBaseKey(base)).digest('hex');

export function createObservationCacheOperations({
  client,
  namespace,
  reportFailure,
}: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  const sentinel = redisKey(namespace, 'observation', 'incarnation');
  const keys = (resource: ObservationResource) => {
    const key = observationResourceKey(resource);
    return [
      sentinel,
      redisKey(namespace, 'observation', key, 'owner'),
      redisKey(namespace, 'observation', key, 'guard'),
      redisKey(namespace, 'observation', key, 'data'),
      redisKey(namespace, 'observation', key, 'hint'),
    ];
  };
  async function script(
    operation: string,
    source: string,
    names: string[],
    args: string[],
  ) {
    try {
      await client.connect();
      return await client.send('EVAL', [
        source,
        String(names.length),
        ...names,
        ...args,
      ]);
    } catch (error) {
      reportFailure(operation);
      throw error;
    }
  }
  return {
    async retainObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly base: ObservationBase;
      readonly purgeGeneration: number;
      readonly contentRevision: number;
      readonly ttlMs: number;
    }) {
      observationHeaderSchema.parse({
        resource: input.resource,
        contentRevision: input.contentRevision,
        disclosureRevision: input.base.disclosureRevision,
        purgeGeneration: input.purgeGeneration,
      });
      if (
        observationResourceKey(input.resource) !==
        observationResourceKey(input.base.resource)
      )
        throw new Error('Invalid observation retention');
      return (
        Number(
          await script(
            'retainObservation',
            retainScript,
            keys(input.resource).slice(0, 4),
            [
              segment(input.incarnation),
              segment(input.token),
              String(input.purgeGeneration),
              String(input.base.disclosureRevision),
              baseDigest(input.base),
              String(input.contentRevision),
              ttl(input.ttlMs),
            ],
          ),
        ) === 1
      );
    },
    async establishObservationIncarnation(candidate: string): Promise<string> {
      segment(candidate);
      await client.connect();
      await client.send('SET', [sentinel, candidate, 'NX', 'PX', '3600000']);
      const current = await client.get(sentinel);
      if (!current) throw new Error('Observation cache unavailable');
      return segment(current);
    },
    async claimObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly ttlMs: number;
    }) {
      return (
        Number(
          await script(
            'claimObservation',
            claimScript,
            keys(input.resource).slice(0, 2),
            [
              segment(input.incarnation),
              segment(input.token),
              ttl(input.ttlMs, 2000),
            ],
          ),
        ) === 1
      );
    },
    async releaseObservation(resource: ObservationResource, token: string) {
      return (
        Number(
          await script(
            'releaseObservation',
            releaseScript,
            [keys(resource)[1]!],
            [segment(token)],
          ),
        ) === 1
      );
    },
    async prepareObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly purgeGeneration: number;
      readonly disclosureRevision: number;
    }) {
      observationHeaderSchema.parse({
        resource: input.resource,
        contentRevision: 0,
        disclosureRevision: input.disclosureRevision,
        purgeGeneration: input.purgeGeneration,
      });
      return (
        Number(
          await script(
            'prepareObservation',
            prepareScript,
            keys(input.resource).slice(0, 4),
            [
              segment(input.incarnation),
              segment(input.token),
              String(input.purgeGeneration),
              String(input.disclosureRevision),
              '60000',
            ],
          ),
        ) === 1
      );
    },
    async publishObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly token: string;
      readonly purgeGeneration: number;
      readonly base: ObservationBase;
      readonly contentRevision: number;
      readonly body: string;
      readonly ttlMs: number;
    }) {
      observationHeaderSchema.parse({
        resource: input.resource,
        contentRevision: input.contentRevision,
        disclosureRevision: input.base.disclosureRevision,
        purgeGeneration: input.purgeGeneration,
      });
      if (
        observationResourceKey(input.resource) !==
          observationResourceKey(input.base.resource) ||
        Buffer.byteLength(input.body) > observationFrameBytes
      )
        throw new Error('Invalid observation body');
      return Number(
        await script(
          'publishObservation',
          publishScript,
          keys(input.resource),
          [
            segment(input.incarnation),
            segment(input.token),
            String(input.purgeGeneration),
            String(input.base.disclosureRevision),
            baseDigest(input.base),
            String(input.contentRevision),
            input.body,
            ttl(input.ttlMs),
            JSON.stringify({
              resource: input.resource,
              contentRevision: input.contentRevision,
            }),
          ],
        ),
      );
    },
    async purgeObservation(input: {
      readonly resource: ObservationResource;
      readonly incarnation: string;
      readonly purgeGeneration: number;
      readonly disclosureRevision: number;
    }) {
      observationHeaderSchema.parse({
        resource: input.resource,
        contentRevision: 0,
        disclosureRevision: input.disclosureRevision,
        purgeGeneration: input.purgeGeneration,
      });
      return (
        Number(
          await script('purgeObservation', purgeScript, keys(input.resource), [
            segment(input.incarnation),
            String(input.purgeGeneration),
            String(input.disclosureRevision),
            '60000',
            JSON.stringify({
              resource: input.resource,
              purgeGeneration: input.purgeGeneration,
            }),
          ]),
        ) === 1
      );
    },
    async demandObservation(
      resource: ObservationResource,
      nodeIncarnation: string,
      bases: readonly ObservationBase[] = [],
    ) {
      const key = observationResourceKey(resource);
      if (
        bases.length > 64 ||
        new Set(bases.map(baseDigest)).size !== bases.length ||
        bases.some(
          (base) =>
            observationResourceKey(
              observationBaseSchema.parse(base).resource,
            ) !== key,
        )
      )
        throw new Error('Invalid observation demand');
      return (
        Number(
          await script(
            'demandObservation',
            interestScript,
            [
              redisKey(namespace, 'observation', key, 'interest'),
              redisKey(namespace, 'observation', 'due'),
              redisKey(namespace, 'observation', 'live'),
              redisKey(namespace, 'observation', key, 'demand'),
              keys(resource)[3]!,
            ],
            [
              segment(nodeIncarnation),
              '5000',
              key,
              ...bases.flatMap((base) => [
                baseDigest(base),
                JSON.stringify(base),
              ]),
            ],
          ),
        ) === 1
      );
    },
    async readObservationDemand(
      resource: ObservationResource,
    ): Promise<readonly ObservationBase[]> {
      const key = observationResourceKey(resource);
      const result = await script(
        'readObservationDemand',
        readDemandScript,
        [
          redisKey(namespace, 'observation', key, 'interest'),
          redisKey(namespace, 'observation', 'due'),
          redisKey(namespace, 'observation', 'live'),
          redisKey(namespace, 'observation', key, 'demand'),
          keys(resource)[3]!,
        ],
        [],
      );
      if (!Array.isArray(result) || result.length > 64)
        throw new Error('Invalid observation demand result');
      return result.map((value) => {
        const base = observationBaseSchema.parse(JSON.parse(String(value)));
        if (observationResourceKey(base.resource) !== key)
          throw new Error('Invalid observation demand resource');
        return base;
      });
    },
    async discoverObservations(limit: number): Promise<readonly string[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128)
        throw new Error('Invalid discovery batch');
      const result = await script(
        'discoverObservations',
        discoverScript,
        [
          redisKey(namespace, 'observation', 'due'),
          redisKey(namespace, 'observation', 'live'),
        ],
        [String(limit)],
      );
      if (
        !Array.isArray(result) ||
        !result.every((value) => typeof value === 'string')
      )
        throw new Error('Invalid discovery result');
      return result;
    },
    async readObservations(
      resource: ObservationResource,
      incarnation: string,
      bases: readonly ObservationBase[],
    ): Promise<
      readonly { readonly contentRevision: number; readonly body: string }[]
    > {
      if (
        bases.length < 1 ||
        bases.length > 64 ||
        bases.some(
          (base) =>
            observationResourceKey(base.resource) !==
            observationResourceKey(resource),
        )
      )
        throw new Error('Invalid observation read');
      const result = await script(
        'readObservations',
        readScript,
        [sentinel, keys(resource)[3]!],
        [segment(incarnation), ...bases.map(baseDigest)],
      );
      if (!Array.isArray(result)) throw new Error('Invalid observation heads');
      return result.flatMap((row) =>
        Array.isArray(row) &&
        row[0] !== null &&
        row[0] !== false &&
        typeof row[1] === 'string'
          ? [{ contentRevision: Number(row[0]), body: row[1] }]
          : [],
      );
    },
  };
}
