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
