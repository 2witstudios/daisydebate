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

test('unchanged head resumes skipped recipient after renewal', async () => {
  let now = 4900;
  const permit = createObservationPermit({
    now: () => now,
    nodeIncarnation: 'node',
  });
  const received: number[] = [];
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => now,
    yieldWork: async () => {},
    cache: {
      demand: async () => {},
      read: async () => ({
        base,
        contentRevision: 1,
        purgeGeneration: 0,
        body: 'body',
      }),
    },
  });
  node.observe(base, permit, (snapshot) =>
    received.push(snapshot.contentRevision),
  );
  await node.repair();
  await node.settled();
  const part = observationEvidence({
    started: now,
    remainingMs: 5000,
    fingerprint: 'same',
    dependencies: [],
  });
  permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    purgeGeneration: 0,
    subject: part,
    cohort: part,
    entitlement: part,
  });
  await node.repair();
  await node.settled();
  assert({
    given:
      'a cached body skipped while permit unavailable, followed by canonical renewal',
    should: 'resume from unchanged cache without another mutation',
    actual: received,
    expected: [1],
  });
});
test('purge during yielded fanout fences captured body', async () => {
  let resume!: () => void;
  const barrier = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const permits = Array.from({ length: 129 }, () =>
    createObservationPermit({ now: () => 0, nodeIncarnation: 'node' }),
  );
  const part = observationEvidence({
    started: 0,
    remainingMs: 5000,
    fingerprint: 'same',
    dependencies: [],
  });
  for (const permit of permits)
    permit.install(permit.begin(), {
      base,
      minimumContentRevision: 1,
      purgeGeneration: 0,
      subject: part,
      cohort: part,
      entitlement: part,
    });
  let last = 0;
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => 0,
    yieldWork: () => barrier,
    cache: { demand: async () => {}, read: async () => null },
  });
  for (const [index, permit] of permits.entries())
    node.observe(base, permit, () => {
      if (index === 128) last++;
    });
  node.accept({ base, contentRevision: 1, purgeGeneration: 0, body: 'before' });
  await Promise.resolve();
  node.accept({ base, contentRevision: 2, purgeGeneration: 1, body: 'after' });
  resume();
  await node.settled();
  assert({
    given: 'a resource purge while the send slice waits',
    should: 'never enqueue pre-purge body or use old permits',
    actual: last,
    expected: 0,
  });
});

test('a recreated key receives baseline while its disposed predecessor waits', async () => {
  let resume!: () => void;
  const wait = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const permit = createObservationPermit({
    now: () => 0,
    nodeIncarnation: 'node',
  });
  const part = observationEvidence({
    started: 0,
    remainingMs: 5000,
    fingerprint: 'same',
    dependencies: [],
  });
  permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    purgeGeneration: 0,
    subject: part,
    cohort: part,
    entitlement: part,
  });
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => 0,
    yieldWork: () => wait,
    cache: { demand: async () => {}, read: async () => null },
  });
  const releases = Array.from({ length: 129 }, () =>
    node.observe(base, permit, () => {}),
  );
  node.accept({ base, contentRevision: 1, purgeGeneration: 0, body: 'old' });
  await Promise.resolve();
  for (const release of releases) release();
  const baseline: number[] = [];
  node.observe(base, permit, (snapshot) =>
    baseline.push(snapshot.contentRevision),
  );
  node.accept({ base, contentRevision: 2, purgeGeneration: 0, body: 'new' });
  await Promise.resolve();
  const before = [...baseline];
  resume();
  await node.settled();
  assert({
    given: 'same-key recreation while an old slice remains pending',
    should: 'schedule the replacement baseline independently',
    actual: before,
    expected: [2],
  });
});

test('purge from a new window fences an older window of the same resource', async () => {
  let resume!: () => void;
  const wait = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const permit = createObservationPermit({
      now: () => 0,
      nodeIncarnation: 'node',
    }),
    part = observationEvidence({
      started: 0,
      remainingMs: 5000,
      fingerprint: 'same',
      dependencies: [],
    });
  permit.install(permit.begin(), {
    base,
    minimumContentRevision: 1,
    purgeGeneration: 0,
    subject: part,
    cohort: part,
    entitlement: part,
  });
  let last = 0;
  const node = createObservationNode({
    nodeIncarnation: 'node',
    now: () => 0,
    yieldWork: () => wait,
    cache: { demand: async () => {}, read: async () => null },
  });
  for (let index = 0; index < 129; index++)
    node.observe(base, permit, () => {
      if (index === 128) last++;
    });
  node.accept({ base, contentRevision: 1, purgeGeneration: 0, body: 'old' });
  await Promise.resolve();
  const next = { ...base, window: { after: 12, limit: 50 } };
  node.observe(next, permit, () => {});
  node.accept({
    base: next,
    contentRevision: 2,
    purgeGeneration: 1,
    body: 'new',
  });
  resume();
  await node.settled();
  assert({
    given:
      'a new window receives the resource purge while another window yields',
    should: 'fence every dependent window, including captured prior bodies',
    actual: last,
    expected: 0,
  });
});
