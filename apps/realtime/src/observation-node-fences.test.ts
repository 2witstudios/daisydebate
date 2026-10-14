import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observationTestBase } from '@daisy/protocol/observation-testing';
import {
  grant,
  testBarrier,
  testNode,
  testPermit,
} from './observation-node.test-support';
setupRitewayBun();
const base = observationTestBase();
test('unchanged head resumes skipped recipient after renewal', async () => {
  const now = () => 4900;
  const permit = testPermit(base, { now, granted: false });
  const received: number[] = [];
  const node = testNode({
    now,
    read: async () => ({
      base,
      contentRevision: 1,
      purgeGeneration: 0,
      body: 'body',
    }),
  });
  node.observe(base, permit, (snapshot) =>
    received.push(snapshot.contentRevision),
  );
  await node.repair();
  await node.settled();
  grant(permit, base, now());
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
  const barrier = testBarrier();
  const permits = Array.from({ length: 129 }, () => testPermit(base));
  let last = 0;
  const node = testNode({ yieldWork: () => barrier.wait });
  for (const [index, permit] of permits.entries())
    node.observe(base, permit, () => {
      if (index === 128) last++;
    });
  node.accept({ base, contentRevision: 1, purgeGeneration: 0, body: 'before' });
  await Promise.resolve();
  node.accept({ base, contentRevision: 2, purgeGeneration: 1, body: 'after' });
  barrier.resume();
  await node.settled();
  assert({
    given: 'a resource purge while the send slice waits',
    should: 'never enqueue pre-purge body or use old permits',
    actual: last,
    expected: 0,
  });
});

test('a recreated key receives baseline while its disposed predecessor waits', async () => {
  const barrier = testBarrier();
  const permit = testPermit(base);
  const node = testNode({ yieldWork: () => barrier.wait });
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
  barrier.resume();
  await node.settled();
  assert({
    given: 'same-key recreation while an old slice remains pending',
    should: 'schedule the replacement baseline independently',
    actual: before,
    expected: [2],
  });
});

test('purge from a new window fences an older window of the same resource', async () => {
  const barrier = testBarrier();
  const permit = testPermit(base);
  let last = 0;
  const node = testNode({ yieldWork: () => barrier.wait });
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
  barrier.resume();
  await node.settled();
  assert({
    given:
      'a new window receives the resource purge while another window yields',
    should: 'fence every dependent window, including captured prior bodies',
    actual: last,
    expected: 0,
  });
});
