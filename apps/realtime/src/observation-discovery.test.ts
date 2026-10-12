import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationDiscovery } from './observation-discovery';
import type { ObservationBase } from '@daisy/protocol';
setupRitewayBun();
test('fleet discovery installs and expires shared demand with no follower SQL fallback', async () => {
  const resource = { kind: 'channel', id: 'a'.repeat(24) } as const;
  const base: ObservationBase = {
    schema: 1,
    resource,
    partition: { kind: 'shared', policyKey: 'v1' },
    disclosureRevision: 1,
    window: { after: null, limit: 50 },
  };
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
  try {
    await owner.reconcile();
  } catch {}
  assert({
    given:
      'eligible discovery, expired demand, then Redis failure while fanout allocation also runs',
    should:
      'discover bounded shared bases, release empty demand and invalidate uncertain ownership with no follower discovery',
    actual: { discoveries, changes, uncertainties },
    expected: { discoveries: 3, changes: [1, 0], uncertainties: 1 },
  });
});
