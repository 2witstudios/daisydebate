import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createSubscriptionStalenessCollection } from './subscription-staleness-service';
import {
  subscriptionScanPageLimit,
  type SubscriptionFreshness,
} from './subscription-staleness';

setupRitewayBun();
type Input = Parameters<typeof createSubscriptionStalenessCollection>[0];
const at = '2026-11-07T12:20:00.000Z';
const page = {
  sampledAt: at,
  throughId: 'z'.repeat(24),
  afterId: 'a'.repeat(24),
  exhausted: false,
  scanned: 1,
  pending: 1,
  claimed: 0,
  settled: 0,
  unconfirmed: 0,
  oldestRevisionRequestedAt: at,
  oldestObservedAt: '2026-11-07T12:05:01.000Z',
};
function collect(sample: Input['store']['sample']) {
  const observations: SubscriptionFreshness[] = [],
    errors: unknown[] = [];
  const service = createSubscriptionStalenessCollection({
    store: { sample },
    mode: 'test',
    observed: (value) => observations.push(value),
    unavailable: (error) => errors.push(error),
  });
  return { service, observations, errors };
}

test('a bounded traversal re-ages original data and resets its fixed upper bound only at the next head', async () => {
  const calls: Parameters<Input['store']['sample']>[0][] = [];
  const { service, observations } = collect(async (input) => {
    calls.push(input);
    return calls.length === 2
      ? {
          ...page,
          afterId: 'z'.repeat(24),
          exhausted: true,
          sampledAt: '2026-11-07T12:20:02.000Z',
          oldestObservedAt: '2026-11-07T12:20:01.000Z',
        }
      : page;
  });
  await service.run();
  await service.run();
  await service.run();
  assert({
    given: 'two pages, advancing DB time and a new head after completion',
    should:
      'retain the old proven timestamp, expose the mixed-time window and clear private cursors at head',
    actual: [
      observations[0]!.status,
      observations[1]!.status,
      observations[1]!.oldestObservedAgeMs,
      observations[1]!.scanDurationMs,
      observations[1]!.scanPages,
      observations[1]!.scanned,
      calls,
    ],
    expected: [
      'partial',
      'stale',
      901_000,
      2_000,
      2,
      2,
      [
        { mode: 'test' },
        { mode: 'test', afterId: page.afterId, throughId: page.throughId },
        { mode: 'test' },
      ],
    ],
  });
});

test('failed collection or regressing time cannot inherit completed coverage', async () => {
  let n = 0;
  const { service, observations, errors } = collect(async (input) => {
    n++;
    if (n === 2) throw Error('Controlled unavailable source');
    if (n === 4) return { ...page, sampledAt: '2026-11-07T12:19:59.000Z' };
    return { ...page, afterId: input.afterId ? 'b'.repeat(24) : page.afterId };
  });
  for (let i = 0; i < 5; i++) await service.run();
  assert({
    given: 'a page read failure and a later regressing database clock',
    should: 'report both failures, discard both cycles and start partial again',
    actual: [
      errors.length,
      observations.map((value) => [value.status, value.scanPages]),
    ],
    expected: [
      2,
      [
        ['partial', 1],
        ['partial', 1],
        ['partial', 1],
      ],
    ],
  });
});

test('coverage budgets do not discard traversal progress or starve a stale tail beyond twelve pages', async () => {
  let calls = 0;
  const a = collect(async (input) => {
    calls++;
    const n = input.afterId ? Number(input.afterId.slice(-4)) + 1 : 1;
    return {
      ...page,
      afterId: 'a'.repeat(20) + n.toString().padStart(4, '0'),
      oldestObservedAt: n === 14 ? '2026-11-07T12:00:00.000Z' : at,
      exhausted: n === 14,
    };
  });
  for (let i = 0; i < subscriptionScanPageLimit + 3; i++) await a.service.run();
  let timed = 0;
  const b = collect(async () => ({
    ...page,
    afterId: 'b'.repeat(20) + (++timed).toString().padStart(4, '0'),
    sampledAt: timed === 1 || timed === 4 ? at : '2026-11-07T12:21:01.000Z',
    oldestObservedAt: at,
    exhausted: timed === 3,
  }));
  for (let i = 0; i < 4; i++) await b.service.run();
  assert({
    given:
      'a stale fourteenth page and an elapsed-time overrun before actual exhaustion',
    should:
      'continue both fixed traversals as partial, reach the stale tail and restart only after exhaustion',
    actual: [
      calls,
      a.observations[13]?.status,
      a.observations[13]?.complete,
      a.observations[13]?.scanPages,
      a.observations[14]?.scanPages,
      b.observations.map((value) => [
        value.status,
        value.complete,
        value.scanPages,
      ]),
    ],
    expected: [
      15,
      'stale',
      false,
      14,
      1,
      [
        ['partial', false, 1],
        ['partial', false, 2],
        ['partial', false, 3],
        ['partial', false, 1],
      ],
    ],
  });
});

test('a retired collector neither publishes a late page nor starts another read', async () => {
  let finish!: (value: typeof page) => void,
    calls = 0;
  const { service, observations, errors } = collect(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const running = service.run();
  service.stop();
  finish(page);
  await running;
  await service.run();
  assert({
    given: 'stop while the actual read is pending',
    should: 'suppress late facts and future work',
    actual: [calls, observations.length, errors.length],
    expected: [1, 0, 0],
  });
});

test('missing cursors and changed fixed bounds fail closed instead of claiming complete coverage', async () => {
  let n = 0;
  const a = collect(async () => ({ ...page, afterId: null }));
  const b = collect(async () =>
    ++n === 1 ? page : { ...page, throughId: 'y'.repeat(24), exhausted: true },
  );
  await a.service.run();
  await b.service.run();
  await b.service.run();
  assert({
    given: 'a broken continuation or changed tail while traversing',
    should: 'emit unavailable and retain no healthy result',
    actual: [
      a.errors.length,
      a.observations.length,
      b.errors.length,
      b.observations.map((value) => value.status),
    ],
    expected: [1, 0, 1, ['partial']],
  });
});
