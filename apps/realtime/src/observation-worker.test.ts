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
