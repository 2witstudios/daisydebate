import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationNode } from './observation-node';
import {
  createObservationPermit,
  observationEvidence,
} from './observation-permit';
import type { ObservationBase } from '@daisy/protocol';
setupRitewayBun();
const base: ObservationBase = {
  schema: 1,
  resource: { kind: 'channel', id: 'a'.repeat(24) },
  partition: { kind: 'shared', policyKey: 'v1' },
  disclosureRevision: 1,
  window: { after: null, limit: 50 },
};
test('a recovered baseline remains pending until any occupied job slot settles', async () => {
  let time = 0,
    paused = false;
  const releaseWork: (() => void)[] = [],
    received: number[] = [];
  const clock = () => (paused ? (time += 3) : time);
  const newPermit = (view: ObservationBase) => {
    const permit = createObservationPermit({
      now: () => time,
      nodeIncarnation: 'node',
    });
    const evidence = observationEvidence({
      started: time,
      remainingMs: 5000,
      fingerprint: 'same',
      dependencies: [],
    });
    permit.install(permit.begin(), {
      base: view,
      minimumContentRevision: 1,
      purgeGeneration: 0,
      subject: evidence,
      cohort: evidence,
      entitlement: evidence,
    });
    return permit;
  };
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: clock,
    yieldWork: () =>
      new Promise((resolve) => {
        releaseWork.push(resolve);
      }),
    cache: { demand: async () => {}, read: async () => null },
  });
  const target = newPermit(base);
  node.observe(base, target, (snapshot) =>
    received.push(snapshot.contentRevision),
  );
  node.accept({ base, contentRevision: 1, purgeGeneration: 0, body: 'target' });
  await node.settled();
  paused = true;
  let releaseOld!: () => void;
  for (let index = 1; index <= 1023; index++) {
    const view = {
      ...base,
      resource: { ...base.resource, id: index.toString(36).padStart(24, '0') },
    };
    const release = node.observe(view, newPermit(view), () => {});
    if (index === 1) releaseOld = release;
    node.accept({
      base: view,
      contentRevision: 1,
      purgeGeneration: 0,
      body: 'other',
    });
  }
  await Promise.resolve();
  await Promise.resolve();
  releaseOld();
  const replacement = {
    ...base,
    resource: { ...base.resource, id: 'z'.repeat(24) },
  };
  node.observe(replacement, newPermit(replacement), () => {});
  node.accept({
    base: replacement,
    contentRevision: 1,
    purgeGeneration: 0,
    body: 'replacement',
  });
  await Promise.resolve();
  await Promise.resolve();
  const occupied = node.stats().pendingKeys;
  time = 20000;
  const evidence = observationEvidence({
    started: time,
    remainingMs: 5000,
    fingerprint: 'fresh',
    dependencies: [],
  });
  target.install(target.begin(), {
    base,
    minimumContentRevision: 1,
    purgeGeneration: 0,
    subject: evidence,
    cohort: evidence,
    entitlement: evidence,
  });
  paused = false;
  for (const release of releaseWork) release();
  await node.settled();
  assert({
    given:
      '1024 actual settling jobs with a live recovered target whose enqueue initially cannot get a slot',
    should:
      'retain desired baseline state and wake it fairly when other work settles without another event or refetch',
    actual: { occupied, received, pending: node.stats().pendingKeys },
    expected: { occupied: 1024, received: [1, 1], pending: 0 },
  });
  node.close();
});
test('fresh authority restores an already delivered unchanged baseline after expiry', async () => {
  let now = 0,
    fetches = 0;
  const received: number[] = [];
  const permit = createObservationPermit({
    now: () => now,
    nodeIncarnation: 'node',
  });
  const renew = () => {
    const evidence = observationEvidence({
      started: now,
      remainingMs: 5000,
      fingerprint: 'same',
      dependencies: [],
    });
    permit.install(permit.begin(), {
      base,
      minimumContentRevision: 1,
      purgeGeneration: 0,
      subject: evidence,
      cohort: evidence,
      entitlement: evidence,
    });
  };
  renew();
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => now,
    yieldWork: async () => {},
    cache: {
      demand: async () => {},
      read: async () => {
        fetches++;
        return { base, contentRevision: 1, purgeGeneration: 0, body: 'body' };
      },
    },
  });
  const release = node.observe(base, permit, (snapshot) =>
    received.push(snapshot.contentRevision),
  );
  await node.repair();
  await node.settled();
  now = 3000;
  renew();
  await node.settled();
  now = 8000;
  renew();
  await node.settled();
  assert({
    given:
      'content delivered once, uninterrupted renewal then an expiry gap with fresh canonical authority',
    should:
      'restore the same baseline intrinsically after the gap without a mutation, re-observe or cache fetch, while ordinary renewal sends no duplicate body',
    actual: { received, fetches },
    expected: { received: [1, 1], fetches: 1 },
  });
  node.close();
  release();
  assert({
    given: 'a reader closes after final node disposal',
    should: 'retain zero active binding liability',
    actual: node.stats().bindings,
    expected: 0,
  });
});
test('one changed body fans out locally and second observer receives baseline', async () => {
  let now = 0,
    fetches = 0,
    demands = 0;
  const received: number[] = [],
    second: number[] = [];
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => now,
    yieldWork: async () => {},
    cache: {
      demand: async () => {
        demands++;
      },
      read: async () => {
        fetches++;
        return { base, contentRevision: 1, purgeGeneration: 0, body: 'body' };
      },
    },
  });
  const permit = createObservationPermit({
    now: () => now,
    nodeIncarnation: 'node',
  });
  const evidence = observationEvidence({
    started: 0,
    remainingMs: 5000,
    fingerprint: 'same',
    dependencies: [],
  });
  permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    purgeGeneration: 0,
    subject: evidence,
    cohort: evidence,
    entitlement: evidence,
  });
  node.observe(base, permit, (snapshot) =>
    received.push(snapshot.contentRevision),
  );
  await node.repair();
  node.observe(base, permit, (snapshot) =>
    second.push(snapshot.contentRevision),
  );
  await node.settled();
  now = 4900;
  node.accept({ base, contentRevision: 2, purgeGeneration: 0, body: 'new' });
  await node.settled();
  assert({
    given: 'shared content and a newly attached observer then expired permits',
    should:
      'fetch once per base and baseline immediately with zero expired enqueues',
    actual: { fetches, demands, received, second },
    expected: { fetches: 1, demands: 1, received: [1], second: [1] },
  });
});
