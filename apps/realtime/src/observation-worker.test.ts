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
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};
const healthyCache = () => ({
  ready: async () => false,
  claim: async () => true,
  prepare: async () => true,
  publish: async () => true,
  release: async () => {},
});
test('removed resource cannot survive a batch assembled before another claim await', async () => {
  const other = { ...resource, id: 'b'.repeat(24) };
  const entered = deferred<void>(),
    finish = deferred<boolean>();
  let hold = false;
  const batches: string[][] = [];
  const worker = createObservationWorker({
    eligible: true,
    now: () => 0,
    nextToken: () => 'token',
    cache: {
      ...healthyCache(),
      claim: async (current) => {
        if (hold && current.id === other.id) {
          entered.resolve();
          return finish.promise;
        }
        return true;
      },
    },
    readHeaders: async (resources) => {
      batches.push(resources.map((row) => row.id));
      return [];
    },
    build: async () => {
      throw new Error('Unexpected build');
    },
  });
  worker.demand(base);
  await worker.reconcile();
  worker.demand({ ...base, resource: other });
  hold = true;
  const pending = worker.reconcile();
  await entered.promise;
  await worker.replaceDemand(resource, []);
  finish.resolve(true);
  await pending;
  assert({
    given: 'resource A loses all demand while resource B claim is awaited',
    should:
      'exclude the released A owner immediately before batched SQL starts',
    actual: batches.at(-1),
    expected: [other.id],
  });
  await worker.close();
});
test('removed variant cannot start a body build after an awaited ready check', async () => {
  const entered = deferred<void>(),
    finish = deferred<boolean>();
  const builds: (number | string | null)[] = [];
  const worker = createObservationWorker({
    eligible: true,
    now: () => 0,
    nextToken: () => 'token',
    cache: {
      ...healthyCache(),
      ready: async (value) => {
        if (value.window.after === null) {
          entered.resolve();
          return finish.promise;
        }
        return false;
      },
    },
    readHeaders: async () => [
      {
        resource,
        contentRevision: 1,
        disclosureRevision: 1,
        purgeGeneration: 0,
      },
    ],
    build: async (value, header) => {
      builds.push(value.window.after);
      return { header, body: 'body' };
    },
  });
  worker.demand(base);
  worker.demand({ ...base, window: { after: 12, limit: 50 } });
  const pending = worker.reconcile();
  await entered.promise;
  await worker.replaceDemand(resource, [
    { ...base, window: { after: 12, limit: 50 } },
  ]);
  finish.resolve(false);
  await pending;
  await worker.settled();
  assert({
    given: 'window A is removed during ready(A) while window B stays demanded',
    should: 'start SQL only for the still-demanded window',
    actual: builds,
    expected: [12],
  });
  await worker.close();
});
test('late successful claim cannot invent another lease on response arrival', async () => {
  let now = 0,
    reads = 0;
  const entered = deferred<void>(),
    finish = deferred<boolean>();
  const worker = createObservationWorker({
    eligible: true,
    now: () => now,
    nextToken: () => 'token',
    cache: {
      ...healthyCache(),
      claim: async () => {
        entered.resolve();
        return finish.promise;
      },
    },
    readHeaders: async () => {
      reads++;
      return [];
    },
    build: async () => {
      throw new Error('Unexpected build');
    },
  });
  worker.demand(base);
  const pending = worker.reconcile();
  await entered.promise;
  now = 2001;
  finish.resolve(true);
  await pending;
  assert({
    given:
      'a claim executed at zero but its result arrives past the two-second TTL',
    should: 'start no SQL under a lease that already expired',
    actual: reads,
    expected: 0,
  });
  await worker.close();
});
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
