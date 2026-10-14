import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationDiscovery } from './observation-discovery';
import type { ObservationBase } from '@daisy/protocol';
import {
  observationTestBase,
  observationTestResource,
} from '@daisy/protocol/observation-testing';
setupRitewayBun();
test('fleet discovery installs and expires shared demand with no follower SQL fallback', async () => {
  const resource = observationTestResource;
  const base = observationTestBase();
  let demand: readonly ObservationBase[] = [base],
    discoveries = 0,
    uncertainties = 0,
    failed = false;
  const changes: number[] = [];
  const dependencies = {
    cache: {
      discover: async () => {
        discoveries++;
        return ['channel-' + resource.id];
      },
      readDemand: async () => {
        if (failed) throw new Error('Redis unavailable');
        return demand;
      },
    },
    worker: {
      replaceDemand: async (
        _resource: unknown,
        bases: readonly ObservationBase[],
      ) => {
        changes.push(bases.length);
        return bases.length > 0;
      },
      uncertain: () => {
        uncertainties++;
      },
    },
  };
  const follower = createObservationDiscovery({
    ...dependencies,
    eligible: false,
  });
  await follower.reconcile();
  const owner = createObservationDiscovery({ ...dependencies, eligible: true });
  await owner.reconcile();
  demand = [];
  await owner.reconcile();
  failed = true;
  const failure = await owner.reconcile().then(
    () => null,
    (error: Error) => error.message,
  );
  assert({
    given:
      'eligible discovery, expired demand, then Redis failure while fanout allocation also runs',
    should:
      'discover bounded shared bases, release empty demand and invalidate uncertain ownership with no follower discovery',
    actual: { discoveries, changes, uncertainties, failure },
    expected: {
      discoveries: 3,
      changes: [1, 0],
      uncertainties: 1,
      failure: 'Redis unavailable',
    },
  });
});
