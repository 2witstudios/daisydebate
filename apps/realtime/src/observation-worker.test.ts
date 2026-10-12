import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationWorker } from './observation-worker';
import type { ObservationBase, ObservationHeader } from '@daisy/protocol';
setupRitewayBun();
const resource = { kind: 'channel', id: 'a'.repeat(24) } as const;
const base: ObservationBase = {
  schema: 1,
  resource,
  partition: { kind: 'shared', policyKey: 'v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
};
test('expired fleet demand releases resource ownership and fences pending builds', async () => {
  let reads = 0,
    published = 0,
    releases = 0;
  let finish!: (value: { header: ObservationHeader; body: string }) => void;
  const header = {
    resource,
    contentRevision: 1,
    disclosureRevision: 1,
    purgeGeneration: 0,
  };
  const worker = createObservationWorker({
    eligible: true,
    now: () => 0,
    nextToken: () => 'token',
    cache: {
      ready: async () => false,
      claim: async () => true,
      prepare: async () => true,
      publish: async () => {
        published++;
        return true;
      },
      release: async () => {
        releases++;
      },
    },
    readHeaders: async () => {
      reads++;
      return [header];
    },
    build: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  worker.demand(base);
  await worker.reconcile();
  await worker.replaceDemand(resource, []);
  await worker.reconcile();
  finish({ header, body: 'late' });
  await worker.settled();
  assert({
    given: 'all fleet interest expires while a body query is pending',
    should: 'release ownership, start no more SQL and discard late publication',
    actual: { reads, published, releases },
    expected: { reads: 1, published: 0, releases: 1 },
  });
});
test('completed revisions publish through continuous dirt and lease renewal requires progress', async () => {
  let now = 0,
    revision = 1,
    reads = 0,
    builds = 0;
  const published: number[] = [],
    renewals: number[] = [];
  let resolve!: (value: { header: ObservationHeader; body: string }) => void;
  const worker = createObservationWorker({
    now: () => now,
    nextToken: () => 'owner',
    eligible: true,
    cache: {
      ready: async () => true,
      claim: async () => {
        renewals.push(now);
        return true;
      },
      prepare: async () => true,
      publish: async (snapshot) => {
        published.push(snapshot.header.contentRevision);
        return true;
      },
      release: async () => {},
    },
    readHeaders: async () => {
      reads++;
      return [
        {
          resource,
          contentRevision: revision,
          disclosureRevision: 1,
          purgeGeneration: 0,
        },
      ];
    },
    build: async () => {
      builds++;
      return new Promise((res) => {
        resolve = res;
      });
    },
  });
  worker.demand(base);
  await worker.reconcile();
  revision = 2;
  now = 100;
  await worker.reconcile();
  resolve({
    header: {
      resource,
      contentRevision: 1,
      disclosureRevision: 1,
      purgeGeneration: 0,
    },
    body: 'one',
  });
  await worker.settled();
  const first = [...published];
  now = 2100;
  await worker.reconcile();
  assert({
    given: 'a slow build with trailing dirt and then an expired lease',
    should: 'publish useful progress but start no SQL under expired ownership',
    actual: { first, reads, builds, renewals },
    expected: { first: [1], reads: 2, builds: 1, renewals: [0, 0, 100] },
  });
});
test('fanout-only allocation cannot execute headers or projections', async () => {
  let sql = 0;
  const worker = createObservationWorker({
    eligible: false,
    now: () => 0,
    nextToken: () => 'owner',
    cache: {
      ready: async () => true,
      claim: async () => true,
      prepare: async () => true,
      publish: async () => true,
      release: async () => {},
    },
    readHeaders: async () => {
      sql++;
      return [];
    },
    build: async () => {
      sql++;
      throw new Error('forbidden');
    },
  });
  worker.demand(base);
  await worker.reconcile();
  assert({
    given: 'a fanout-only node',
    should: 'keep resource discovery and SQL executor capacity separate',
    actual: sql,
    expected: 0,
  });
});

test('missing cache head rebuilds unchanged canonical revision', async () => {
  let ready = true,
    builds = 0;
  const header = {
    resource,
    contentRevision: 1,
    disclosureRevision: 1,
    purgeGeneration: 0,
  };
  const worker = createObservationWorker({
    eligible: true,
    now: () => 0,
    nextToken: () => 'owner',
    cache: {
      claim: async () => true,
      prepare: async () => true,
      ready: async () => ready,
      publish: async () => true,
      release: async () => {},
    },
    readHeaders: async () => [header],
    build: async () => {
      builds++;
      return { header, body: 'body' };
    },
  });
  worker.demand(base);
  await worker.reconcile();
  await worker.settled();
  ready = false;
  await worker.reconcile();
  await worker.settled();
  assert({
    given: 'lost Redis body after successful unchanged projection',
    should: 'rebuild shared content without needing a durable mutation',
    actual: builds,
    expected: 2,
  });
});
test('healthy variants cannot renew ownership of a stuck projection forever', async () => {
  let now = 0,
    version = 0,
    claims = 0;
  const other = { ...base, window: { after: 12, limit: 50 } };
  const pending = new Promise<never>(() => {});
  const worker = createObservationWorker({
    eligible: true,
    now: () => now,
    nextToken: () => 'owner',
    cache: {
      claim: async () => {
        claims++;
        return true;
      },
      prepare: async () => true,
      ready: async () => true,
      publish: async () => true,
      release: async () => {},
    },
    readHeaders: async () => [
      {
        resource,
        contentRevision: ++version,
        disclosureRevision: 1,
        purgeGeneration: 0,
      },
    ],
    build: async (variant, header) =>
      variant.window.after === null ? pending : { header, body: 'healthy' },
  });
  worker.demand(base);
  worker.demand(other);
  for (now = 0; now < 7000; now += 100) {
    await worker.reconcile();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  assert({
    given: 'one hung variant alongside continual healthy fills',
    should: 'stop lease renewal when that variant exceeds progress age',
    actual: claims < 25,
    expected: true,
  });
});

test('Redis uncertainty invalidates local ownership before another header read', async () => {
  let fail = false,
    reads = 0;
  const worker = createObservationWorker({
    eligible: true,
    now: () => 0,
    nextToken: () => 'owner',
    cache: {
      claim: async () => {
        if (fail) throw new Error('cache unavailable');
        return true;
      },
      prepare: async () => {
        if (fail) throw new Error('cache unavailable');
        return true;
      },
      ready: async () => true,
      publish: async () => true,
      release: async () => {},
    },
    readHeaders: async () => {
      reads++;
      return [
        {
          resource,
          contentRevision: 1,
          disclosureRevision: 1,
          purgeGeneration: 0,
        },
      ];
    },
    build: async (_base, header) => ({ header, body: 'body' }),
  });
  worker.demand(base);
  await worker.reconcile();
  await worker.settled();
  fail = true;
  try {
    await worker.reconcile();
  } catch {
    /* Uncertainty is unavailable, not permission. */
  }
  try {
    await worker.reconcile();
  } catch {
    /* No new SQL may bypass unavailable claim. */
  }
  assert({
    given: 'Redis fails after a current header read',
    should:
      'invalidate owned resources immediately and stop subsequent header SQL',
    actual: reads,
    expected: 2,
  });
});

for (const fence of ['prepare', 'renew'] as const)
  test(`false ${fence} fence stops future headers`, async () => {
    let lost = false,
      reads = 0;
    const worker = createObservationWorker({
      eligible: true,
      now: () => 0,
      nextToken: () => 'owner',
      cache: {
        claim: async () => !(lost && fence === 'renew'),
        prepare: async () => !(lost && fence === 'prepare'),
        ready: async () => true,
        publish: async () => true,
        release: async () => {},
      },
      readHeaders: async () => {
        reads++;
        return [
          {
            resource,
            contentRevision: 1,
            disclosureRevision: 1,
            purgeGeneration: 0,
          },
        ];
      },
      build: async (_base, header) => ({ header, body: 'body' }),
    });
    worker.demand(base);
    await worker.reconcile();
    await worker.settled();
    lost = true;
    await worker.reconcile();
    await worker.reconcile();
    assert({
      given:
        'a warm owner observes an exact Redis guard/token mismatch without exception',
      should: 'discard local ownership before any subsequent header query',
      actual: reads,
      expected: 2,
    });
  });
