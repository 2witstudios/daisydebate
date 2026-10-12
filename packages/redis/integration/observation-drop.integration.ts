import { assert, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import type { ObservationBase } from '@daisy/protocol';
import { redisSuite, withRedis } from './test-support';
import {
  observationTestBase,
  observationTestResource,
} from '@daisy/protocol/observation-testing';

requireTestServices(process.env);
const env = redisSuite();
const resource = observationTestResource;
const base = observationTestBase();

test('a deleted resource is dropped by its owner and stays unpublishable', async () => {
  await withRedis(env.redisUrl, async ({ redis }) => {
    const incarnation = await redis.establishObservationIncarnation('inc');
    const claim = { resource, incarnation, token: 'owner', ttlMs: 2000 };
    await redis.claimObservation(claim);
    await redis.prepareObservation({
      ...claim,
      purgeGeneration: 0,
      disclosureRevision: 1,
    });
    const publish = {
      ...claim,
      base,
      purgeGeneration: 0,
      contentRevision: 1,
      body: 'protected',
      ttlMs: 30000,
    };
    await redis.publishObservation(publish);
    const intruder = await redis.dropObservation({ ...claim, token: 'other' });
    const dropped = await redis.dropObservation(claim);
    const late = await redis.publishObservation({
      ...publish,
      contentRevision: 2,
    });
    assert({
      given:
        'an installed body, a non-owner drop, the owner drop and a late job',
      should:
        'refuse the non-owner, remove heads and bodies, and refuse later publication',
      actual: {
        intruder,
        dropped,
        late,
        bodies: await redis.readObservations(resource, incarnation, [base]),
      },
      expected: { intruder: false, dropped: true, late: 0, bodies: [null] },
    });
  });
});
