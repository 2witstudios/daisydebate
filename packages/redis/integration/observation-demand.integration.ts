import { assert, test } from 'riteway/bun';
import { redisSuite, withRedis } from './test-support';
import type { ObservationBase } from '@daisy/protocol';
const env = redisSuite();
const resource = { kind: 'channel', id: 'a'.repeat(24) } as const;
const base: ObservationBase = {
  schema: 1,
  resource,
  partition: { kind: 'shared', policyKey: 'v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
};
test('discovery carries bounded demanded windows and reaps historical variants', async () => {
  await withRedis(env.redisUrl, async ({ redis, raw, key }) => {
    await redis.demandObservation(resource, 'node', [base]);
    const incarnation = await redis.establishObservationIncarnation('inc');
    const claim = { resource, incarnation, token: 'owner', ttlMs: 2000 };
    await redis.claimObservation(claim);
    await redis.prepareObservation({
      ...claim,
      purgeGeneration: 0,
      disclosureRevision: 1,
    });
    await redis.publishObservation({
      ...claim,
      base,
      purgeGeneration: 0,
      contentRevision: 1,
      body: 'abandoned',
      ttlMs: 30000,
    });
    const demanded = await redis.readObservationDemand(resource);
    const stored = (await raw.send('HGETALL', [
      key('observation', 'channel-' + resource.id, 'demand'),
    ])) as Record<string, string>;
    const digest = Object.keys(stored)[0]!;
    await raw.send('HSET', [
      key('observation', 'channel-' + resource.id, 'demand'),
      digest,
      JSON.stringify({ base, expiresAt: 1 }),
    ]);
    const next = { ...base, window: { after: 12, limit: 50 } };
    await redis.demandObservation(resource, 'node', [next]);
    const current = await redis.readObservationDemand(resource);
    assert({
      given: 'a live resource with abandoned window and new history window',
      should:
        'publish actual shared demand to owners and reclaim old variants while resource remains live',
      actual: {
        demanded,
        current,
        oldBody: await redis.readObservations(resource, incarnation, [base]),
      },
      expected: { demanded: [base], current: [next], oldBody: [] },
    });
  });
});
test('variant admission recovers after bounded expired window cleanup', async () => {
  await withRedis(env.redisUrl, async ({ redis, raw, key }) => {
    const bases = Array.from({ length: 64 }, (_, index) => ({
      ...base,
      window: { after: index + 1, limit: 50 },
    }));
    const full = await redis.demandObservation(resource, 'node', bases);
    const next = { ...base, window: { after: 100, limit: 50 } };
    const refused = await redis.demandObservation(resource, 'node', [next]);
    const demandKey = key('observation', 'channel-' + resource.id, 'demand');
    const stored = (await raw.send('HGETALL', [demandKey])) as Record<
      string,
      string
    >;
    const digest = Object.keys(stored)[0]!;
    await raw.send('HSET', [
      demandKey,
      digest,
      JSON.stringify({ ...JSON.parse(stored[digest]!), expiresAt: 1 }),
    ]);
    const admitted = await redis.demandObservation(resource, 'node', [next]);
    assert({
      given: '64 active windows then one abandoned window expires',
      should:
        'refuse excess demand then reclaim capacity without growing resource state',
      actual: {
        full,
        refused,
        admitted,
        count: (await redis.readObservationDemand(resource)).length,
      },
      expected: { full: true, refused: false, admitted: true, count: 64 },
    });
  });
});
test('whole demand-key expiry frees old body capacity while preserving re-demanded windows', async () => {
  await withRedis(env.redisUrl, async ({ redis, key, expireNow }) => {
    const incarnation = await redis.establishObservationIncarnation('inc');
    const claim = { resource, incarnation, token: 'owner', ttlMs: 2000 };
    await redis.claimObservation(claim);
    await redis.prepareObservation({
      ...claim,
      purgeGeneration: 0,
      disclosureRevision: 1,
    });
    const windows = Array.from({ length: 64 }, (_, index) => ({
      ...base,
      window: { after: index + 1, limit: 50 },
    }));
    await redis.demandObservation(resource, 'node', windows);
    for (const window of windows)
      await redis.publishObservation({
        ...claim,
        base: window,
        purgeGeneration: 0,
        contentRevision: 1,
        body: 'old',
        ttlMs: 30000,
      });
    await expireNow(key('observation', 'channel-' + resource.id, 'demand'));
    const next = { ...base, window: { after: 100, limit: 50 } };
    const admitted = await redis.demandObservation(resource, 'node', [
      windows[0]!,
      next,
    ]);
    const published = await redis.publishObservation({
      ...claim,
      base: next,
      purgeGeneration: 0,
      contentRevision: 1,
      body: 'new',
      ttlMs: 30000,
    });
    const bodies = await redis.readObservations(resource, incarnation, [
      windows[0]!,
      next,
      windows[1]!,
    ]);
    assert({
      given:
        '64 cached bodies survive the complete expiry of their demand hash',
      should:
        'reclaim abandoned cached windows, preserve renewed old content and publish newly admitted demand',
      actual: { admitted, published, bodies },
      expected: {
        admitted: true,
        published: 1,
        bodies: [
          { contentRevision: 1, body: 'old' },
          { contentRevision: 1, body: 'new' },
        ],
      },
    });
  });
});
