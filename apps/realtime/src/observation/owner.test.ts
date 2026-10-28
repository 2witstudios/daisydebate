import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  observationResourceKey,
  type ObservationResource,
} from '@daisy/protocol';
import { createObservationOwner, type ObservationOwnerCache } from './owner';
import { defineObservableResources, type ObservationHeader } from './resources';

setupRitewayBun();
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};
const resourceOf = (n: number): ObservationResource => ({
  kind: 'channel-messages',
  id: `c${String(n).padStart(23, '0')}`,
});

/** A shared in-memory stand-in for the guarded Redis scripts. */
function fleet(demand: readonly ObservationResource[]) {
  const owners = new Map<string, string>();
  const published = new Map<string, number>();
  let purges = 0;
  const cache: ObservationOwnerCache = {
    establishObservationIncarnation: async () => 'inc',
    claimObservation: async ({ resource, token }) => {
      const key = observationResourceKey(resource);
      const owner = owners.get(key);
      if (owner && owner !== token) return 'taken';
      owners.set(key, token);
      return 'owned';
    },
    releaseObservation: async (resource, token) =>
      owners.get(observationResourceKey(resource)) === token &&
      owners.delete(observationResourceKey(resource)),
    beginObservationBuild: async ({ resource, token }) =>
      owners.get(observationResourceKey(resource)) === token ? purges : null,
    publishObservation: async ({ base, contentRevision, token }) => {
      const key = observationResourceKey(base.resource);
      if (owners.get(key) !== token) return 'refused';
      if ((published.get(key) ?? -1) >= contentRevision) return 'current';
      published.set(key, contentRevision);
      return 'installed';
    },
    purgeObservation: async () => ++purges,
    discoverObservationDemand: async ({ limit }) => demand.slice(0, limit),
  };
  return { cache, published, owners };
}

function owner(
  shared: ReturnType<typeof fleet>,
  token: string,
  headers: Map<string, ObservationHeader>,
  counts: { headerQueries: number; builds: number },
) {
  return createObservationOwner({
    token,
    candidateIncarnation: 'inc',
    now: () => 0,
    cache: shared.cache,
    resources: defineObservableResources([
      {
        kind: 'channel-messages',
        readHeaders: async (ids) => {
          counts.headerQueries++;
          return new Map(
            ids.flatMap((id) =>
              headers.has(id) ? [[id, headers.get(id)!]] : [],
            ),
          );
        },
        project: async (id) => {
          counts.builds++;
          const header = headers.get(id);
          return header
            ? { partition: 'members', ...header, body: { id } }
            : null;
        },
        evaluatePermits: async () => [],
        parseBody: (body) => body,
      },
    ]),
  });
}

describe('observation owner fleet cardinality', () => {
  for (const nodes of [1, 4, 40])
    test(`R = ${nodes} eligible processes`, async () => {
      const demand = Array.from({ length: 10 }, (_, n) => resourceOf(n));
      const headers = new Map(
        demand.map((r) => [
          r.id,
          { contentRevision: 1, disclosureRevision: 1 },
        ]),
      );
      const shared = fleet(demand);
      const counts = { headerQueries: 0, builds: 0 };
      const workers = Array.from({ length: nodes }, (_, n) =>
        owner(shared, `token${n}`, headers, counts),
      );
      for (const worker of workers) await worker.tick();
      await settle();
      const firstCycle = { ...counts };
      for (const r of demand)
        headers.set(r.id, { contentRevision: 2, disclosureRevision: 1 });
      counts.headerQueries = 0;
      counts.builds = 0;
      for (const worker of workers) await worker.tick();
      await settle();
      assert({
        given: `10 demanded resources and ${nodes} eligible processes, then one new revision each`,
        should:
          'own each resource once, build each revision once fleet-wide, and query headers once per owning process per tick',
        actual: {
          owners: new Set(shared.owners.values()).size,
          firstBuilds: firstCycle.builds,
          headerQueries: counts.headerQueries,
          builds: counts.builds,
          published: [...shared.published.values()].every((v) => v === 2),
        },
        expected: {
          owners: 1,
          firstBuilds: 10,
          headerQueries: 1,
          builds: 10,
          published: true,
        },
      });
    });
  test('deleted resource', async () => {
    const r = resourceOf(1);
    const headers = new Map([
      [r.id, { contentRevision: 1, disclosureRevision: 1 }],
    ]);
    const shared = fleet([r]);
    const counts = { headerQueries: 0, builds: 0 };
    const worker = owner(shared, 'token', headers, counts);
    await worker.tick();
    await settle();
    headers.delete(r.id);
    await worker.tick();
    await settle();
    assert({
      given: 'a resource whose header disappears',
      should: 'purge its bodies and stop owning it',
      actual: [worker.stats().owned, shared.owners.size],
      expected: [0, 0],
    });
  });
  test('failed header read', async () => {
    const r = resourceOf(1);
    const shared = fleet([r]);
    let claims = 0;
    const cache = {
      ...shared.cache,
      claimObservation: async (
        input: Parameters<ObservationOwnerCache['claimObservation']>[0],
      ) => {
        claims++;
        return shared.cache.claimObservation(input);
      },
    };
    const worker = createObservationOwner({
      token: 't',
      candidateIncarnation: 'inc',
      now: () => 0,
      cache,
      resources: defineObservableResources([
        {
          kind: 'channel-messages',
          readHeaders: async () => {
            throw new Error('statement timeout');
          },
          project: async () => null,
          evaluatePermits: async () => [],
          parseBody: (b) => b,
        },
      ]),
    });
    await worker.tick();
    await worker.tick();
    assert({
      given: 'header reads that keep failing',
      should:
        'never renew the lease after the initial claim (progress, not heartbeat)',
      actual: claims,
      expected: 1,
    });
  });
});

test('a hung projection gives up ownership behind healthy headers, and its late result is fenced', async () => {
  const r = resourceOf(1);
  const shared = fleet([r]);
  let clock = 0;
  let header = { contentRevision: 1, disclosureRevision: 1 };
  const hung = Promise.withResolvers<null>();
  let builds = 0;
  const make = (token: string, project: () => Promise<unknown>) =>
    createObservationOwner({
      token,
      candidateIncarnation: 'inc',
      now: () => clock,
      cache: shared.cache,
      resources: defineObservableResources([
        {
          kind: 'channel-messages',
          readHeaders: async (ids) => new Map(ids.map((id) => [id, header])),
          project: project as never,
          evaluatePermits: async () => [],
          parseBody: (body) => body,
        },
      ]),
    });
  const stuck = make('stuck', () => hung.promise);
  const successor = make('successor', async () => {
    builds++;
    return { partition: 'members', ...header, body: {} };
  });
  await stuck.tick();
  await settle();
  header = { contentRevision: 2, disclosureRevision: 1 };
  for (const at of [500, 1_000, 2_001]) {
    clock = at;
    await stuck.tick();
  }
  await settle();
  const released = shared.owners.size;
  for (let tick = 0; tick < 5; tick++) await successor.tick();
  await settle();
  hung.resolve(null);
  await settle();
  assert({
    given: 'a projection that never settles while header reads keep succeeding',
    should:
      'stop renewing and release after the 2s progress budget, let a successor claim and publish, and refuse the hung build any late effect',
    actual: {
      released,
      owner: [...shared.owners.values()],
      successorBuilt: builds > 0,
      published: shared.published.get(observationResourceKey(r)),
    },
    expected: {
      released: 0,
      owner: ['successor'],
      successorBuilt: true,
      published: 2,
    },
  });
});

test('lapsed demand purges the resource bodies before ownership ends', async () => {
  const r = resourceOf(1);
  const shared = fleet([r]);
  let demand = true;
  const purged: string[] = [];
  const worker = createObservationOwner({
    token: 't',
    candidateIncarnation: 'inc',
    now: () => 0,
    cache: {
      ...shared.cache,
      claimObservation: async (input) =>
        demand ? shared.cache.claimObservation(input) : 'idle',
      purgeObservation: async (resource) => {
        purged.push(resource.id);
        return 1;
      },
    },
    resources: defineObservableResources([
      {
        kind: 'channel-messages',
        readHeaders: async (ids) =>
          new Map(
            ids.map((id) => [
              id,
              { contentRevision: 1, disclosureRevision: 1 },
            ]),
          ),
        project: async () => ({
          partition: 'members',
          contentRevision: 1,
          disclosureRevision: 1,
          body: {},
        }),
        evaluatePermits: async () => [],
        parseBody: (body) => body,
      },
    ]),
  });
  await worker.tick();
  await settle();
  demand = false;
  await worker.tick();
  assert({
    given: 'an owned resource whose last node interest lapsed',
    should:
      'purge its cached bodies and stop owning it, so no body outlives observation',
    actual: [purged, worker.stats().owned],
    expected: [[r.id], 0],
  });
});
