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
      'schedule500ms and drive actual tick/evaluate/freeze ports plus rating recovery',
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
    },
    failed: (error) => {
      failures.push(error);
    },
  });
  await service.ready;
  await service.stop();
  assert({
    given:
      'a concurrent terminal result, a committed forfeit, pending attendance and an unrelated error',
    should:
      'finalize only the remaining active candidate and report only the unexpected failure',
    actual: { frozen, failures: failures.length },
    expected: { frozen: ['pending'], failures: 1 },
  });
});
