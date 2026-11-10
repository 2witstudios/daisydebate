import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRealtimeServiceLease } from './service-lease';
setupRitewayBun();

test('realtime lease samples actual delivery cursor and shutdown waits for its own renewal', async () => {
  let tick = () => {};
  let finish!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const calls: unknown[] = [];
  let cursor = { txid: '123', seq: 9n };
  const lease = startRealtimeServiceLease({
    instanceId: 'a'.repeat(24),
    deliveredThrough: () => cursor,
    renew: async (input) => {
      calls.push(input);
      await inFlight;
    },
    failed: () => {
      throw new Error('Successful fixture renewal must not report failure');
    },
    timers: {
      setInterval: (callback, ms) => {
        tick = callback;
        calls.push(ms);
        return 1;
      },
      clearInterval: () => {
        calls.push('clear');
      },
    },
  });
  cursor = { txid: '123', seq: 10n };
  finish();
  await tick();
  await tick();
  await lease.stop();
  tick();
  assert({
    given:
      'actual drain cursor sampled at lease renewal with another tick while pending',
    should:
      'write one scoped cursor renewal, avoid overlap and stop before pool close',
    actual: calls,
    expected: [
      1000,
      {
        instanceId: 'a'.repeat(24),
        role: 'realtime',
        deliveredThrough: { txid: '123', seq: 9n },
      },
      {
        instanceId: 'a'.repeat(24),
        role: 'realtime',
        deliveredThrough: { txid: '123', seq: 10n },
      },
      'clear',
    ],
  });
});

test('a failed renewal surfaces its error to the failed sink and the lease keeps renewing', async () => {
  let tick = () => {};
  const failures: unknown[] = [];
  let attempt = 0;
  const lease = startRealtimeServiceLease({
    instanceId: 'b'.repeat(24),
    deliveredThrough: () => ({ txid: '1', seq: 1n }),
    renew: async () => {
      attempt += 1;
      throw new Error(`renewal outage ${attempt}`);
    },
    failed: (error) => void failures.push(error),
    timers: {
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  await tick();
  await tick();
  await lease.stop();
  assert({
    given: 'two renewals that both reject',
    should: 'report each renewal’s own error to the failed sink',
    actual: failures.map((error) => (error as Error).message.split(' ').at(-1)),
    expected: ['1', '2'],
  });
});

test('a failure sink that throws never rejects the renewal', async () => {
  let tick: () => unknown = () => {};
  const lease = startRealtimeServiceLease({
    instanceId: 'c'.repeat(24),
    deliveredThrough: () => ({ txid: '1', seq: 1n }),
    renew: async () => {
      throw new Error('renewal outage');
    },
    failed: () => {
      throw new Error('reporter misconfigured');
    },
    timers: {
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  let rejected: unknown = null;
  try {
    await tick();
    await tick();
    await lease.stop();
  } catch (error) {
    rejected = error;
  }
  assert({
    given: 'failing renewals whose failure sink throws',
    should: 'never reject a renewal or the stop',
    actual: rejected,
    expected: null,
  });
});

test('a cursor read that throws synchronously is a failed renewal, not an escaped throw', async () => {
  let tick: () => unknown = () => {};
  const failures: unknown[] = [];
  const broken = new Error('cursor unavailable');
  let escaped: unknown = null;
  try {
    const lease = startRealtimeServiceLease({
      instanceId: 'd'.repeat(24),
      deliveredThrough: () => {
        throw broken;
      },
      renew: async () => {},
      failed: (error) => void failures.push(error),
      timers: {
        setInterval: (callback) => {
          tick = callback;
          return 1;
        },
        clearInterval: () => {},
      },
    });
    await tick();
    await lease.stop();
  } catch (error) {
    escaped = error;
  }
  assert({
    given: 'a delivery cursor read that throws on every renewal',
    should:
      'hand each failure to the failed sink and never throw from the tick',
    actual: {
      escaped,
      handed:
        failures.length > 0 && failures.every((error) => error === broken),
    },
    expected: { escaped: null, handed: true },
  });
});
