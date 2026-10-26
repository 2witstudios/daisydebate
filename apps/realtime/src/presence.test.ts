import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createPresenceTracker,
  PRESENCE_REFRESH_MS,
  PRESENCE_TTL_SECONDS,
  type PresenceLeases,
} from './presence';

setupRitewayBun();

const actorId = 'a'.repeat(24);
const flush = () => new Promise((resolve) => setImmediate(resolve));

const harness = ({
  refreshed = true,
  failing = false,
}: { refreshed?: boolean; failing?: boolean } = {}) => {
  const calls: unknown[][] = [];
  const intervals: { callback: () => void; ms: number; cleared: boolean }[] =
    [];
  const settle = <T>(value: T) =>
    failing ? Promise.reject(new Error('redis down')) : Promise.resolve(value);
  const leases: PresenceLeases = {
    upsertPresenceLease: (lease, ttl) => {
      calls.push(['upsert', lease.connId, lease.activity, lease.instanceId, ttl]);
      return settle(undefined);
    },
    refreshPresenceLease: (lease, ttl) => {
      calls.push(['refresh', lease.connId, ttl]);
      return settle({ refreshed });
    },
    deletePresenceLease: (lease) => {
      calls.push(['delete', lease.connId, lease.actorId]);
      return settle(undefined);
    },
  };
  let ids = 0;
  const tracker = createPresenceTracker({
    leases,
    instanceId: 'inst1',
    nextId: () => `conn${(ids += 1)}`,
    timers: {
      setInterval: (callback, ms) => {
        intervals.push({ callback, ms, cleared: false });
        return intervals.length as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: (handle) => {
        intervals[(handle as unknown as number) - 1]!.cleared = true;
      },
    },
  });
  return { tracker, calls, intervals };
};

test('a socket’s lease lifecycle', async () => {
  const { tracker, calls, intervals } = harness();
  const session = tracker.start(actorId);
  intervals[0]!.callback();
  session.activity('idle');
  session.activity('idle');
  session.stop();
  session.stop();
  await flush();
  assert({
    given: 'start, a refresh tick, one idle report twice and a double stop',
    should:
      'upsert active, refresh, upsert idle once and delete once, on a minted connection id',
    actual: calls,
    expected: [
      ['upsert', 'conn1', 'active', 'inst1', PRESENCE_TTL_SECONDS],
      ['refresh', 'conn1', PRESENCE_TTL_SECONDS],
      ['upsert', 'conn1', 'idle', 'inst1', PRESENCE_TTL_SECONDS],
      ['delete', 'conn1', actorId],
    ],
  });
  assert({
    given: 'the refresh timer',
    should: 'tick every 20 s and clear on stop',
    actual: [intervals[0]!.ms, intervals[0]!.cleared],
    expected: [PRESENCE_REFRESH_MS, true],
  });
});

test('an expired lease is upserted again on refresh', async () => {
  const { tracker, calls, intervals } = harness({ refreshed: false });
  tracker.start(actorId);
  intervals[0]!.callback();
  await flush();
  assert({
    given: 'a refresh that finds the lease gone',
    should: 'upsert it again with the current activity',
    actual: calls.map((call) => call[0]),
    expected: ['upsert', 'refresh', 'upsert'],
  });
});

test('a Redis outage never throws into the socket', async () => {
  const { tracker, intervals } = harness({ failing: true });
  const session = tracker.start(actorId);
  intervals[0]!.callback();
  session.activity('idle');
  session.stop();
  await flush();
  assert({
    given: 'every lease write rejecting',
    should: 'swallow each failure',
    actual: 'no unhandled rejection',
    expected: 'no unhandled rejection',
  });
});
