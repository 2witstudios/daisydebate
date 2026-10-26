import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundMaintenance } from './service';
import { createAppError } from '@daisy/errors';
setupRitewayBun();

type Ports = Parameters<typeof startRoundMaintenance<number>>[0];
const ports = (): Ports => ({
  discover: async () => [],
  tick: async () => {},
  evaluate: async () => null,
  finalize: async () => {},
  rateUnrated: async () => {},
  expireIdleRooms: async () => {},
  timers: { setInterval: () => 1, clearInterval: () => {} },
  failed: (error) => {
    throw error;
  },
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('maintenance immediately discovers all casts and keeps rating recovery separate', async () => {
  const calls: string[] = [];
  let interval: number | undefined;
  const service = startRoundMaintenance({
    discover: async () => ['human-only', 'missing-session'],
    tick: async (id: string) => {
      calls.push(`tick:${id}`);
    },
    evaluate: async (id: string) => {
      calls.push(`evaluate:${id}`);
      return null;
    },
    finalize: async (id: string) => {
      calls.push(`finalize:${id}`);
    },
    rateUnrated: async () => {
      calls.push('rating-recovery');
    },
    expireIdleRooms: async () => {
      calls.push('room-expiry');
    },
    timers: {
      setInterval: (_pulse: () => void, ms: number) => {
        interval = ms;
        return 1;
      },
      clearInterval: () => {},
    },
    failed: () => {
      calls.push('failed');
    },
  });
  await service.ready;
  await service.stop();
  assert({
    given:
      'all-cast active discovery and independent committed-unrated follow-up',
    should:
      'schedule500ms and drive actual tick/evaluate/freeze ports plus rating recovery and idle Room expiry',
    actual: { interval, calls: calls.sort() },
    expected: {
      interval: 500,
      calls: [
        'tick:human-only',
        'evaluate:human-only',
        'finalize:human-only',
        'tick:missing-session',
        'evaluate:missing-session',
        'finalize:missing-session',
        'rating-recovery',
        'room-expiry',
      ].sort(),
    },
  });
});

test('a held Round does not stop discovery or rating recovery and shutdown drains its work', async () => {
  const held = gate(),
    rediscovered = gate(),
    order: string[] = [];
  let pulse = () => {},
    scans = 0,
    ratings = 0;
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => {
      scans += 1;
      if (scans === 2) rediscovered.resolve();
      return ['contended'];
    },
    tick: async () => {
      order.push('tick');
      await held.promise;
    },
    evaluate: async () => {
      order.push('evaluate');
      return null;
    },
    finalize: async () => {
      order.push('finalize');
    },
    rateUnrated: async () => {
      ratings += 1;
    },
    timers: {
      setInterval: (next) => {
        pulse = next;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  await service.ready;
  pulse();
  await rediscovered.promise;
  const closing = service.stop().then(() => {
    order.push('stopped');
  });
  held.resolve();
  await closing;
  assert({
    given: 'one Round remains in flight across another discovery pulse',
    should:
      'avoid duplicate work, preserve both independent scans and drain before pool disposal',
    actual: { scans, ratings, order },
    expected: {
      scans: 2,
      ratings: 2,
      order: ['tick', 'evaluate', 'finalize', 'stopped'],
    },
  });
});

test('terminal attendance races do not freeze and unexpected failures stay observable', async () => {
  const frozen: string[] = [],
    failures: unknown[] = [];
  const finalized = gate(),
    failed = gate();
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => ['terminal', 'forfeit', 'pending', 'fault'],
    evaluate: async (id) => {
      if (id === 'terminal')
        throw createAppError('CONFLICT', 'attendance-terminal');
      if (id === 'fault') throw new Error('actual maintenance failure');
      return id === 'forfeit' ? { decision: 'forfeit' } : null;
    },
    finalize: async (id) => {
      frozen.push(id);
      finalized.resolve();
    },
    failed: (error, stage) => {
      failures.push([error instanceof Error && error.message, stage]);
      failed.resolve();
    },
  });
  await service.ready;
  await Promise.all([finalized.promise, failed.promise]);
  await service.stop();
  assert({
    given:
      'a concurrent terminal result, a committed forfeit, pending attendance and an unrelated error',
    should:
      'finalize only the remaining active candidate and report only the unexpected failure with its stage',
    actual: { frozen, failures },
    expected: {
      frozen: ['pending'],
      failures: [['actual maintenance failure', 'evaluate']],
    },
  });
});

test('a five-Round fleet leaves capacity for public work and advances queued Rounds fairly', async () => {
  const held = gate(),
    calls: string[] = [];
  let running = 0,
    maximum = 0,
    pulse = () => {};
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => ['a', 'b', 'c', 'd', 'e'],
    tick: async (id) => {
      running += 1;
      maximum = Math.max(maximum, running);
      calls.push(id);
      await held.promise;
      running -= 1;
    },
    timers: {
      setInterval: (next) => {
        pulse = next;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  await service.ready;
  assert({
    given:
      'five current active Rounds discovered on the same maintenance pulse',
    should:
      'admit at most two Round pipelines and queue the rest in discovery order',
    actual: { calls: [...calls], maximum },
    expected: { calls: ['a', 'b'], maximum: 2 },
  });
  pulse();
  await service.ready;
  held.resolve();
  // Drain only admitted work; queued work must never start after shutdown.
  await service.stop();
  assert({
    given: 'shutdown with a queued fleet',
    should:
      'drain admitted Rounds without starting queued work or duplicate discoveries',
    actual: { calls, maximum },
    expected: { calls: ['a', 'b'], maximum: 2 },
  });
});

test('one held Round cannot monopolize the bounded fleet queue', async () => {
  const held = gate(),
    advanced = gate(),
    calls: string[] = [];
  let running = 0,
    maximum = 0;
  const service = startRoundMaintenance({
    ...ports(),
    discover: async () => ['held', 'b', 'c', 'd', 'e'],
    tick: async (id) => {
      running += 1;
      maximum = Math.max(maximum, running);
      calls.push(id);
      if (id === 'held') await held.promise;
      running -= 1;
      if (id === 'e') advanced.resolve();
    },
  });
  try {
    await service.ready;
    await advanced.promise;
    assert({
      given: 'one contended Round and four independent queued candidates',
      should:
        'advance every other candidate fairly through the second lane without filling public capacity',
      actual: { calls, maximum },
      expected: { calls: ['held', 'b', 'c', 'd', 'e'], maximum: 2 },
    });
  } finally {
    held.resolve();
    await service.stop();
  }
});
