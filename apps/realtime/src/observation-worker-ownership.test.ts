import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observationTestBase } from '@daisy/protocol/observation-testing';
import { testHeader, testWorker } from './observation-worker.test-support';
setupRitewayBun();
const base = observationTestBase();
test('fanout-only allocation cannot execute headers or projections', async () => {
  let sql = 0;
  const worker = testWorker({
    eligible: false,
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
  const worker = testWorker({
    cache: { ready: async () => ready },
    build: async () => {
      builds++;
      return { header: testHeader, body: 'body' };
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
  const worker = testWorker({
    now: () => now,
    cache: {
      claim: async () => {
        claims++;
        return true;
      },
    },
    readHeaders: async () => [{ ...testHeader, contentRevision: ++version }],
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
  const unavailable = async () => {
    if (fail) throw new Error('cache unavailable');
    return true;
  };
  const worker = testWorker({
    cache: { claim: unavailable, prepare: unavailable },
    readHeaders: async () => {
      reads++;
      return [testHeader];
    },
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
    const worker = testWorker({
      cache: {
        claim: async () => !(lost && fence === 'renew'),
        prepare: async () => !(lost && fence === 'prepare'),
      },
      readHeaders: async () => {
        reads++;
        return [testHeader];
      },
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
