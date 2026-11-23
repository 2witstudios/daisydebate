import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRealtimeServiceLease } from './service-lease';
setupRitewayBun();

test('realtime lease samples actual delivery cursor and shutdown waits for its own renewal', async () => {
  const clock = virtualClock();
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
    waits: clock,
  });
  cursor = { txid: '123', seq: 10n };
  // The renewal due at 1000 lands while the start-up renewal is pending.
  await clock.advance(1000);
  finish();
  await clock.advance(1000);
  await lease.stop();
  await clock.advance(5000);
  assert({
    given:
      'actual drain cursor sampled at lease renewal with another tick while pending',
    should:
      'write one scoped cursor renewal, avoid overlap and stop before pool close',
    actual: { calls, sleepers: clock.sleepers() },
    expected: {
      calls: [
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
      ],
      sleepers: 0,
    },
  });
});

test('stopping the lease waits for the renewal in flight', async () => {
  const clock = virtualClock();
  let finish!: () => void;
  const inFlight = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const order: string[] = [];
  const lease = startRealtimeServiceLease({
    instanceId: 'e'.repeat(24),
    deliveredThrough: () => ({ txid: '1', seq: 1n }),
    renew: async () => {
      await inFlight;
      order.push('renewed');
    },
    failed: () => undefined,
    waits: clock,
  });
  const stopped = lease.stop().then(() => void order.push('stopped'));
  await clock.settle();
  order.push('released');
  finish();
  await stopped;
  assert({
    given: 'a stop while the start-up renewal is pending',
    should: 'resolve only after that renewal ends',
    actual: order,
    expected: ['released', 'renewed', 'stopped'],
  });
});

test('a failed renewal surfaces its error to the failed sink and the lease keeps renewing', async () => {
  const clock = virtualClock();
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
    waits: clock,
  });
  await clock.advance(1000);
  await lease.stop();
  assert({
    given: 'two renewals that both reject',
    should: 'report each renewal’s own error to the failed sink',
    actual: failures.map((error) => (error as Error).message.split(' ').at(-1)),
    expected: ['1', '2'],
  });
});

test('a failure sink that throws never rejects the renewal', async () => {
  const clock = virtualClock();
  const lease = startRealtimeServiceLease({
    instanceId: 'c'.repeat(24),
    deliveredThrough: () => ({ txid: '1', seq: 1n }),
    renew: async () => {
      throw new Error('renewal outage');
    },
    failed: () => {
      throw new Error('reporter misconfigured');
    },
    waits: clock,
  });
  let rejected: unknown = null;
  try {
    await clock.advance(1000);
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
  const clock = virtualClock();
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
      waits: clock,
    });
    await clock.advance(1000);
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
