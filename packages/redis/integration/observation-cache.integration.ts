import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import {
  createObservationSubscriber,
  dialObservationSubscriber,
} from '../src/observation-subscriber';
import type { ObservationHint } from '../src/observation-cache';
import { redisSuite, withRedis } from './test-support';

// redisSuite requires the test services and sets up RITEway.
const { redisUrl: url } = redisSuite();
const resource = () => ({ kind: 'channel-messages' as const, id: createId() });
const base = (r: ReturnType<typeof resource>, disclosureRevision = 1) => ({
  resource: r,
  partition: 'members',
  disclosureRevision,
});

test('observation: only the claim holder publishes, forward only within a base (ADR 0089)', () =>
  withRedis(url, async ({ redis }) => {
    const r = resource();
    const incarnation = await redis.establishObservationIncarnation(createId());
    await redis.refreshObservationInterest({
      node: 'node-a',
      resources: [r],
      ttlMs: 5000,
    });
    const owner = createId(),
      rival = createId();
    const claims = [
      await redis.claimObservation({ resource: r, incarnation, token: owner, leaseMs: 2000 }),
      await redis.claimObservation({ resource: r, incarnation, token: rival, leaseMs: 2000 }),
      await redis.claimObservation({ resource: r, incarnation, token: owner, leaseMs: 2000 }),
    ];
    const purge = await redis.beginObservationBuild({ resource: r, incarnation, token: owner });
    const publish = (contentRevision: number, token = owner, b = base(r)) =>
      redis.publishObservation({
        base: b,
        incarnation,
        token,
        purgeGeneration: purge!,
        contentRevision,
        body: JSON.stringify({ contentRevision }),
      });
    const results = [
      await publish(5),
      await publish(5),
      await publish(4),
      await publish(6, rival),
      await publish(7),
    ];
    assert({
      given: 'an owner, a rival, and repeated, stale and newer publications',
      should: 'admit one owner and install only newer bodies from it',
      actual: { claims, purge, results, read: await redis.readObservation(r, 'members') },
      expected: {
        claims: ['owned', 'taken', 'owned'],
        purge: 0,
        results: ['installed', 'current', 'refused', 'refused', 'installed'],
        read: { disclosureRevision: 1, contentRevision: 7, body: '{"contentRevision":7}' },
      },
    });
    assert({
      given: 'a newer disclosure revision and then an older one',
      should: 'replace the base and refuse the older disclosure',
      actual: [await publish(1, owner, base(r, 2)), await publish(9, owner, base(r, 1))],
      expected: ['installed', 'refused'],
    });
  }));

test('observation: a purge deletes bodies and fences out a build started before it', () =>
  withRedis(url, async ({ redis }) => {
    const r = resource();
    const incarnation = await redis.establishObservationIncarnation(createId());
    await redis.refreshObservationInterest({ node: 'node-a', resources: [r], ttlMs: 5000 });
    const token = createId();
    await redis.claimObservation({ resource: r, incarnation, token, leaseMs: 2000 });
    const before = await redis.beginObservationBuild({ resource: r, incarnation, token });
    await redis.publishObservation({ base: base(r), incarnation, token, purgeGeneration: before!, contentRevision: 3, body: '{}' });
    const purged = await redis.purgeObservation(r);
    const late = await redis.publishObservation({ base: base(r), incarnation, token, purgeGeneration: before!, contentRevision: 4, body: '{"erased":false}' });
    const after = await redis.beginObservationBuild({ resource: r, incarnation, token });
    assert({
      given: 'a delayed body install from a build that began before the purge',
      should: 'refuse it, leave no body, and give a later build the new generation',
      actual: [purged, late, await redis.readObservation(r, 'members'), after],
      expected: [1, 'refused', null, 1],
    });
  }));

test('observation: a changed incarnation voids old guards and bodies', () =>
  withRedis(url, async ({ redis, key, raw }) => {
    const r = resource();
    const first = await redis.establishObservationIncarnation(createId());
    await redis.refreshObservationInterest({ node: 'n', resources: [r], ttlMs: 5000 });
    const token = createId();
    await redis.claimObservation({ resource: r, incarnation: first, token, leaseMs: 2000 });
    const purge = await redis.beginObservationBuild({ resource: r, incarnation: first, token });
    await redis.publishObservation({ base: base(r), incarnation: first, token, purgeGeneration: purge!, contentRevision: 1, body: '{}' });
    await raw.del(key('obs', 'incarnation'));
    const second = await redis.establishObservationIncarnation(createId());
    assert({
      given: 'a Redis reset of the cache incarnation',
      should: 'hide the old body and refuse the old owner until it reclaims',
      actual: [
        second !== first,
        await redis.readObservation(r, 'members'),
        await redis.claimObservation({ resource: r, incarnation: first, token, leaseMs: 2000 }),
        await redis.beginObservationBuild({ resource: r, incarnation: first, token }),
      ],
      expected: [true, null, 'taken', null],
    });
  }));

test('observation: demand drives discovery and ownership; withdrawn demand idles the owner', () =>
  withRedis(url, async ({ redis, key, expireNow }) => {
    const r = resource(),
      other = resource();
    const incarnation = await redis.establishObservationIncarnation(createId());
    const accepted = await redis.refreshObservationInterest({ node: 'n1', resources: [r, other], ttlMs: 5000 });
    await redis.refreshObservationInterest({ node: 'n2', resources: [r], ttlMs: 5000 });
    const discovered = await redis.discoverObservationDemand({ limit: 10, repairMs: 500 });
    const again = await redis.discoverObservationDemand({ limit: 10, repairMs: 500 });
    const token = createId();
    const owned = await redis.claimObservation({ resource: r, incarnation, token, leaseMs: 2000 });
    const heads = await redis.readObservationHeads([
      { resource: r, partition: 'members' },
      { resource: other, partition: 'members' },
    ]);
    await expireNow(key('obs', 'demand-expiry'));
    assert({
      given: 'two nodes interested in one resource and one in another',
      should: 'discover each resource once per repair period, report the owner, and idle it when demand lapses',
      actual: {
        accepted,
        discovered: discovered.map((d) => d.id).sort(),
        again,
        owned,
        heads: heads.map((h) => h.owned),
        idle: await redis.claimObservation({ resource: r, incarnation, token, leaseMs: 2000 }),
      },
      expected: {
        accepted: [true, true],
        discovered: [r.id, other.id].sort(),
        again: [],
        owned: 'owned',
        heads: [true, false],
        idle: 'idle',
      },
    });
  }));

test('observation: one subscriber connection receives published hints for observed resources only', () =>
  withRedis(url, async ({ redis, namespace }) => {
    const r = resource(),
      unobserved = resource();
    const hints: [string, ObservationHint][] = [];
    let synchronized = 0;
    const subscriber = createObservationSubscriber({
      namespace,
      open: dialObservationSubscriber(url),
      onHint: (res, hint) => hints.push([res.id, hint]),
      onSynchronized: () => synchronized++,
      onLost: () => {},
    });
    try {
      await subscriber.observe(r);
      subscriber.start();
      for (let i = 0; i < 50 && subscriber.state() !== 'synchronized'; i++)
        await Bun.sleep(20);
      const incarnation = await redis.establishObservationIncarnation(createId());
      await redis.refreshObservationInterest({ node: 'n', resources: [r, unobserved], ttlMs: 5000 });
      for (const target of [r, unobserved]) {
        const token = createId();
        await redis.claimObservation({ resource: target, incarnation, token, leaseMs: 2000 });
        const purge = await redis.beginObservationBuild({ resource: target, incarnation, token });
        await redis.publishObservation({ base: base(target), incarnation, token, purgeGeneration: purge!, contentRevision: 2, body: '{}' });
      }
      await redis.purgeObservation(r);
      for (let i = 0; i < 50 && hints.length < 2; i++) await Bun.sleep(20);
      assert({
        given: 'a publication and a purge on an observed resource and a publication elsewhere',
        should: 'deliver exactly the observed metadata hints after synchronization (Bun 1.4.2 Pub/Sub probe)',
        actual: { synchronized, hints },
        expected: {
          synchronized: 1,
          hints: [
            [r.id, { kind: 'published', partition: 'members', disclosureRevision: 1, contentRevision: 2 }],
            [r.id, { kind: 'purged' }],
          ],
        },
      });
    } finally {
      subscriber.close();
    }
  }));
