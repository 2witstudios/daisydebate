import { assert, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { redisSuite, withRedis } from './test-support';
import type { ObservationBase } from '@daisy/protocol';
requireTestServices(process.env);
const env = redisSuite();
const resource = { kind: 'channel', id: 'a'.repeat(24) } as const;
const base: ObservationBase = {
  schema: 1,
  resource,
  partition: { kind: 'shared', policyKey: 'v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
};
test('late body installation after purge is refused atomically', async () => {
  await withRedis(env.redisUrl, async ({ redis }) => {
    const incarnation = await redis.establishObservationIncarnation('inc');
    const claim = { resource, incarnation, token: 'owner', ttlMs: 2000 };
    const owned = await redis.claimObservation(claim);
    const prepared = await redis.prepareObservation({
      ...claim,
      purgeGeneration: 1,
      disclosureRevision: 1,
    });
    const publish = {
      ...claim,
      base,
      purgeGeneration: 1,
      contentRevision: 1,
      body: 'protected',
      ttlMs: 30000,
    };
    const installed = await redis.publishObservation(publish);
    const before = await redis.readObservations(resource, incarnation, [base]);
    const purged = await redis.purgeObservation({
      resource,
      incarnation,
      purgeGeneration: 2,
      disclosureRevision: 2,
    });
    const delayed = await redis.publishObservation({
      ...publish,
      contentRevision: 2,
    });
    const after = await redis.readObservations(resource, incarnation, [base]);
    assert({
      given: 'a completed purge followed by an old body install',
      should: 'remove content and refuse stale body and head together',
      actual: { owned, prepared, installed, before, purged, delayed, after },
      expected: {
        owned: true,
        prepared: true,
        installed: 1,
        before: [{ contentRevision: 1, purgeGeneration: 1, body: 'protected' }],
        purged: true,
        delayed: 0,
        after: [null],
      },
    });
  });
});
test('claim expiry/reset fences old jobs; interests rediscover without scans', async () => {
  await withRedis(env.redisUrl, async ({ redis, expireNow, key }) => {
    const incarnation = await redis.establishObservationIncarnation('inc');
    const first = { resource, incarnation, token: 'first', ttlMs: 2000 };
    await redis.claimObservation(first);
    await redis.prepareObservation({
      ...first,
      purgeGeneration: 1,
      disclosureRevision: 1,
    });
    await expireNow(key('observation', 'channel-' + resource.id, 'owner'));
    const successor = await redis.claimObservation({
      ...first,
      token: 'second',
    });
    const delayed = await redis.publishObservation({
      ...first,
      base,
      purgeGeneration: 1,
      contentRevision: 2,
      body: 'late',
      ttlMs: 30000,
    });
    const demand = await redis.demandObservation(resource, 'node');
    const discovered = await redis.discoverObservations(128);
    assert({
      given: 'an expired owner and reconstructed node demand',
      should:
        'permit takeover and refuse stale publication without global scanning',
      actual: { successor, delayed, demand, discovered },
      expected: {
        successor: true,
        delayed: 0,
        demand: true,
        discovered: ['channel-' + resource.id],
      },
    });
  });
});

test('pinned Bun native PubSub uses one subscriber and metadata hints', async () => {
  await withRedis(env.redisUrl, async ({ redis }) => {
    let hints = 0,
      repairs = 0;
    let received: () => void = () => {};
    const subscriber = redis.observationSubscriber(async () => {
      repairs++;
    });
    const release = await subscriber.interest(resource, () => {
      hints++;
      received();
    });
    hints = 0;
    const delivered = new Promise<void>((resolve) => {
      received = resolve;
    });
    try {
      const incarnation = await redis.establishObservationIncarnation('inc');
      const claim = { resource, incarnation, token: 'owner', ttlMs: 2000 };
      await redis.claimObservation(claim);
      await redis.prepareObservation({
        ...claim,
        purgeGeneration: 1,
        disclosureRevision: 1,
      });
      await redis.publishObservation({
        ...claim,
        base,
        purgeGeneration: 1,
        contentRevision: 1,
        body: 'protected',
        ttlMs: 30000,
      });
      await delivered;
      assert({
        given: 'Bun 1.4.2 command and native subscriber connections',
        should:
          'deliver one metadata hint after guarded publication and baseline repair',
        actual: { hints, repairs, ready: subscriber.ready() },
        expected: { hints: 1, repairs: 1, ready: true },
      });
    } finally {
      release();
      await subscriber.close();
    }
  });
});

test('older disclosure purge cannot erase a newer ready body', async () => {
  await withRedis(env.redisUrl, async ({ redis }) => {
    const incarnation = await redis.establishObservationIncarnation('inc');
    const claim = { resource, incarnation, token: 'owner', ttlMs: 2000 };
    await redis.claimObservation(claim);
    const current = { ...base, disclosureRevision: 2 };
    await redis.prepareObservation({
      ...claim,
      purgeGeneration: 1,
      disclosureRevision: 2,
    });
    await redis.publishObservation({
      ...claim,
      base: current,
      purgeGeneration: 1,
      contentRevision: 3,
      body: 'current',
      ttlMs: 30000,
    });
    const delayed = await redis.purgeObservation({
      resource,
      incarnation,
      purgeGeneration: 1,
      disclosureRevision: 1,
    });
    assert({
      given: 'delayed same-purge older-disclosure control',
      should: 'refuse regression and retain current content',
      actual: {
        delayed,
        body: await redis.readObservations(resource, incarnation, [current]),
      },
      expected: {
        delayed: false,
        body: [{ contentRevision: 3, purgeGeneration: 1, body: 'current' }],
      },
    });
  });
});
test('expired resource demand leaves discovery while live traffic retains global keys', async () => {
  await withRedis(env.redisUrl, async ({ redis, raw, key }) => {
    await redis.demandObservation(resource, 'node');
    await raw.send('ZADD', [
      key('observation', 'live'),
      '1',
      'channel-' + resource.id,
    ]);
    const other = { kind: 'channel', id: 'b'.repeat(24) } as const;
    await redis.demandObservation(other, 'node');
    const discovered = await redis.discoverObservations(128);
    assert({
      given: 'historical demand expired while another resource stays live',
      should: 'reap stale global membership and discover only live resources',
      actual: {
        discovered,
        cardinality: await raw.send('ZCARD', [key('observation', 'due')]),
      },
      expected: { discovered: ['channel-' + other.id], cardinality: 1 },
    });
  });
});

test('bounded reaping restores admission at the global demand ceiling', async () => {
  await withRedis(env.redisUrl, async ({ redis, raw, key }) => {
    await redis.demandObservation(resource, 'node');
    const historical = Array.from(
      { length: 9999 },
      (_, index) => 'channel-' + 'c' + index.toString(36).padStart(23, '0'),
    );
    for (let offset = 0; offset < historical.length; offset += 128) {
      const page = historical.slice(offset, offset + 128);
      await raw.send('ZADD', [
        key('observation', 'due'),
        ...page.flatMap((id) => ['0', id]),
      ]);
      await raw.send('ZADD', [
        key('observation', 'live'),
        ...page.flatMap((id) => ['1', id]),
      ]);
    }
    const admitted = await redis.demandObservation(
      { kind: 'channel', id: 'b'.repeat(24) },
      'node',
    );
    assert({
      given: '10,000 tracked resources with stale historical demand',
      should:
        'reap a bounded batch and admit useful work while unrelated live traffic persists',
      actual: {
        admitted,
        count: await raw.send('ZCARD', [key('observation', 'due')]),
      },
      expected: { admitted: true, count: 9873 },
    });
  });
});

test('useful owner reconciliation retains unchanged body without rebuilding or granting evidence', async () => {
  await withRedis(env.redisUrl, async ({ redis, raw, key }) => {
    const incarnation = await redis.establishObservationIncarnation('inc'),
      claim = { resource, incarnation, token: 'owner', ttlMs: 2000 };
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
      body: 'stable',
      ttlMs: 30000,
    });
    await raw.send('PEXPIRE', [
      key('observation', 'channel-' + resource.id, 'data'),
      '5000',
    ]);
    const touched = await redis.retainObservation({
      ...claim,
      base,
      purgeGeneration: 0,
      contentRevision: 1,
      ttlMs: 30000,
    });
    assert({
      given: 'unchanged coherent header under a current owner token',
      should:
        'retain active body TTL independently of permits and avoid steady-state rebuild churn',
      actual: {
        touched,
        retained:
          (await raw.pttl(
            key('observation', 'channel-' + resource.id, 'data'),
          )) > 10000,
      },
      expected: { touched: true, retained: true },
    });
  });
});
